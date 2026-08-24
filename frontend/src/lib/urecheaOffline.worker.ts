import {
  AutomaticSpeechRecognitionPipeline,
  AutoModelForSpeechSeq2Seq,
  env,
  WhisperFeatureExtractor,
  WhisperProcessor,
  WhisperTokenizer,
} from '@huggingface/transformers'
import asyncifyWasmUrl from '/node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url'
import { offlineKitManifest } from './offlineKitManifest'

type Request =
  | { tip: 'pregateste'; allowNetwork: boolean }
  | { tip: 'transcrie'; audio: Float32Array; limba: string; id: number }

let recognizer: unknown | null = null
let loading: Promise<unknown> | null = null
let inferenceQueue: Promise<void> = Promise.resolve()
let allowModelNetwork = true

const isSafari = typeof navigator !== 'undefined' &&
  /^((?!chrome|chromium|android).)*safari/i.test(navigator.userAgent)
const ortBase = new URL('/ort/', self.location.origin)
const asyncifyWasmHref = new URL(asyncifyWasmUrl, self.location.origin).href
// Factory-ul rămâne script same-origin. Cache-ul intern Transformers ar crea
// un import blob:, blocat intenționat de CSP-ul aplicației.
env.useWasmCache = false
const wasmBackend = env.backends.onnx.wasm
if (!wasmBackend) throw new Error('onnx_wasm_backend_unavailable')
wasmBackend.wasmPaths = isSafari
  ? {
      mjs: new URL('ort-wasm-simd-threaded.mjs', ortBase).href,
      wasm: new URL('ort-wasm-simd-threaded.wasm', ortBase).href,
    }
  : {
      mjs: new URL('ort-wasm-simd-threaded.asyncify.mjs', ortBase).href,
      // Vite emite exact același WASM pe care îl importă ORT. Folosirea URL-ului
      // construit de bundler evită o a doua copie în /ort și rămâne content-hashed.
      wasm: asyncifyWasmHref,
    }

const offlineRuntimePaths = new Set([
  new URL('ort-wasm-simd-threaded.mjs', ortBase).pathname,
  new URL('ort-wasm-simd-threaded.wasm', ortBase).pathname,
  new URL('ort-wasm-simd-threaded.asyncify.mjs', ortBase).pathname,
  new URL(asyncifyWasmHref).pathname,
])
const workerFetch = self.fetch.bind(self)
self.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const href = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input)
  const url = new URL(href, self.location.href)
  if (!allowModelNetwork &&
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    (url.origin !== self.location.origin || !offlineRuntimePaths.has(url.pathname))) {
    return Promise.reject(new TypeError('offline_model_asset_missing'))
  }
  return workerFetch(input, init)
}) as typeof fetch

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function loadPinnedJson(path: string, allowNetwork: boolean): Promise<unknown> {
  const component = offlineKitManifest.components.hearing
  const artifact = component.artifacts.find((candidate) => candidate.path === path)
  if (!artifact) throw new Error(`offline_hearing_artifact_unknown:${path}`)
  const url = `${component.repository}/resolve/${component.revisionSha}/${path}`
  const cache = await caches.open(artifact.cache)
  let response = await cache.match(url)
  let downloaded = false
  if (!response) {
    if (!allowNetwork) throw new Error(`offline_hearing_artifact_missing:${path}`)
    response = await workerFetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer' })
    if (!response.ok) throw new Error(`offline_hearing_artifact_http_${response.status}:${path}`)
    downloaded = true
  }
  const bytes = await response.arrayBuffer()
  const digest = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
  if (bytes.byteLength !== artifact.sizeBytes || digest !== artifact.sha256) {
    throw new Error(`offline_hearing_artifact_integrity:${path}`)
  }
  if (downloaded) {
    await cache.put(url, new Response(bytes, {
      headers: { 'content-type': 'application/json' },
    }))
  }
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
  self.postMessage({ tip: 'progres', loaded: artifact.sizeBytes, total: artifact.sizeBytes, file: path })
  return parsed
}

async function ensureRecognizer(allowNetwork: boolean): Promise<unknown> {
  allowModelNetwork = allowNetwork
  if (recognizer) return recognizer
  // Cache Storage folosește drept cheie URL-ul Hugging Face cu revizia pin-uită.
  // Păstrăm semantică remote pentru lookup-ul acelei chei, dar wrapperul fetch
  // refuză orice request extern în avion. Un cache miss e astfel fail-closed.
  env.allowRemoteModels = true
  env.allowLocalModels = false
  const component = offlineKitManifest.components.hearing
  const sharedOptions = {
    revision: component.revisionSha,
    local_files_only: false,
  }
  loading = loading ?? Promise.all([
    loadPinnedJson('config.json', allowNetwork),
    loadPinnedJson('generation_config.json', allowNetwork),
    loadPinnedJson('preprocessor_config.json', allowNetwork),
    loadPinnedJson('tokenizer_config.json', allowNetwork),
    loadPinnedJson('tokenizer.json', allowNetwork),
  ]).then(async ([config, _generationConfig, preprocessorConfig, tokenizerConfig, tokenizerJson]) => {
    const tokenizer = new (WhisperTokenizer as unknown as {
      new(tokenizerJSON: unknown, tokenizerConfiguration: unknown): InstanceType<typeof WhisperTokenizer>
    })(tokenizerJson, tokenizerConfig)
    const featureExtractor = new WhisperFeatureExtractor(preprocessorConfig)
    const processor = new WhisperProcessor({}, { tokenizer, feature_extractor: featureExtractor }, '')
    const model = await AutoModelForSpeechSeq2Seq.from_pretrained(component.id, {
      ...sharedOptions,
      config: config as never,
      device: 'webgpu',
      dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' },
    })
    if (!(processor as { feature_extractor?: unknown }).feature_extractor || !tokenizer || !model) {
      throw new Error('offline_hearing_components_incomplete')
    }
    const result = new AutomaticSpeechRecognitionPipeline({
      task: 'automatic-speech-recognition',
      model,
      tokenizer,
      processor,
    } as never)
    // Inventarul complet nu este suficient: o inferență minimă confirmă că
    // processorul, modelul și runtime-ul WebGPU lucrează împreună înainte de ✓.
    await result(new Float32Array(1_600), {
      language: 'en',
      task: 'transcribe',
      max_new_tokens: 1,
      no_speech_threshold: 1,
      condition_on_prev_tokens: false,
    })
    recognizer = result
    return recognizer
  }).catch((error) => {
    loading = null
    throw error
  })
  return loading
}

self.onmessage = (event: MessageEvent<Request>) => {
  const message = event.data
  if (message.tip === 'pregateste') {
    void (async () => {
      try {
        await ensureRecognizer(message.allowNetwork)
        self.postMessage({ tip: 'gata' })
      } catch (error) {
        self.postMessage({ tip: 'eroare', motiv: String((error as Error)?.message ?? error).slice(0, 200) })
      }
    })()
    return
  }
  // ONNX session nu este reentrantă. Fiecare transcriere începe numai după
  // finalizarea celei anterioare, păstrând ordinea mesajelor.
  inferenceQueue = inferenceQueue.then(async () => {
    try {
      const asr = (await ensureRecognizer(false)) as (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string }>
      const result = await asr(message.audio, {
        language: message.limba,
        task: 'transcribe',
        no_speech_threshold: 0.6,
        condition_on_prev_tokens: false,
      })
      self.postMessage({ tip: 'text', id: message.id, text: String(result?.text ?? '').trim() })
    } catch (error) {
      self.postMessage({ tip: 'eroare', id: message.id, motiv: String((error as Error)?.message ?? error).slice(0, 200) })
    }
  })
}
