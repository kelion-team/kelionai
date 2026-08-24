import rawManifest from '../offline-kit.manifest.json'

export type OfflineKitComponent = 'brain' | 'hearing'

export interface OfflineArtifact {
  cache: 'webllm/config' | 'webllm/model' | 'webllm/wasm' | 'transformers-cache'
  path: string
  url?: string
  sizeBytes: number
  sha256: string
  etag?: string
}

export interface OfflineKitManifest {
  schemaVersion: 2
  kitVersion: string
  minimumStorageHeadroomBytes: number
  /** Sursele ORT pin-uite; URL-urile servite sunt generate exclusiv din dist. */
  runtimeSources: Array<{ sourcePath: string; sizeBytes: number; sha256: string }>
  components: {
    brain: {
      id: string
      runtime: string
      runtimeVersion: string
      repository: string
      revisionSha: string
      modelLibraryVersion: string
      estimatedBytes: number
      deviceRequirements: {
        requiredFeatures: string[]
        minimumMaxBufferSize: number
        vramRequiredMB: number
      }
      artifacts: OfflineArtifact[]
    }
    hearing: {
      id: string
      runtime: string
      runtimeVersion: string
      repository: string
      revisionSha: string
      estimatedBytes: number
      deviceRequirements: {
        requiredFeatures: string[]
        minimumMaxBufferSize: number
      }
      artifacts: OfflineArtifact[]
    }
  }
  localVoice: {
    runtime: 'web-speech-local'
    runtimeVersion: 'browser'
    downloadedBytes: 0
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function bytes(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function sha256(value: unknown): value is string {
  return text(value) && /^[a-f0-9]{64}$/.test(value)
}

function safePath(value: unknown): value is string {
  return text(value) && !value.startsWith('/') && !value.includes('\\') && !value.split('/').includes('..')
}

const CACHE_NAMES = new Set<OfflineArtifact['cache']>([
  'webllm/config',
  'webllm/model',
  'webllm/wasm',
  'transformers-cache',
])

function validArtifact(value: unknown): value is OfflineArtifact {
  if (!record(value) || !CACHE_NAMES.has(value.cache as OfflineArtifact['cache']) || !safePath(value.path) ||
    !bytes(value.sizeBytes) || !sha256(value.sha256)) return false
  if (value.etag !== undefined && !sha256(value.etag)) return false
  if (value.url !== undefined && (!text(value.url) ||
    !/^https:\/\/raw\.githubusercontent\.com\/mlc-ai\/binary-mlc-llm-libs\/[a-f0-9]{40}\/[a-zA-Z0-9_./-]+$/.test(value.url))) return false
  return true
}

function exactArtifactInventory(
  artifacts: OfflineArtifact[],
  requiredPaths: string[],
  cache: OfflineArtifact['cache'],
): boolean {
  const paths = artifacts.map((artifact) => artifact.path)
  return artifacts.every((artifact) => artifact.cache === cache) &&
    paths.length === new Set(paths).size && requiredPaths.every((path) => paths.includes(path))
}

function artifactBytes(artifacts: OfflineArtifact[]): number {
  return artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0)
}

function validRepository(value: unknown): value is string {
  return text(value) && /^https:\/\/huggingface\.co\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value)
}

function validateOfflineKitManifest(value: unknown): OfflineKitManifest {
  if (!record(value) || value.schemaVersion !== 2 || !text(value.kitVersion) ||
    !bytes(value.minimumStorageHeadroomBytes) || !Array.isArray(value.runtimeSources) ||
    !record(value.components)) {
    throw new Error('invalid offline kit manifest header')
  }

  const { brain, hearing } = value.components
  const localVoice = value.localVoice
  const runtimeSources = value.runtimeSources
  const runtimeOk = runtimeSources.length === 4 && runtimeSources.every((artifact) =>
    record(artifact) && safePath(artifact.sourcePath) && artifact.sourcePath.startsWith('ort/') &&
    (artifact.sourcePath.endsWith('.mjs') || artifact.sourcePath.endsWith('.wasm')) &&
    bytes(artifact.sizeBytes) && sha256(artifact.sha256)) &&
    new Set(runtimeSources.map((artifact) => record(artifact) ? artifact.sourcePath : '')).size === runtimeSources.length
  const brainArtifacts = record(brain) && Array.isArray(brain.artifacts) && brain.artifacts.every(validArtifact)
    ? brain.artifacts as OfflineArtifact[]
    : []
  const hearingArtifacts = record(hearing) && Array.isArray(hearing.artifacts) && hearing.artifacts.every(validArtifact)
    ? hearing.artifacts as OfflineArtifact[]
    : []

  const shardPaths = brainArtifacts.filter((artifact) => /^params_shard_\d+\.bin$/.test(artifact.path)).map((artifact) => artifact.path)
  const shardIndexes = shardPaths.map((path) => Number(/\d+/.exec(path)?.[0])).sort((a, b) => a - b)
  const contiguousShards = shardIndexes.length > 0 && shardIndexes.every((index, position) => index === position)
  const brainOk = record(brain) && text(brain.id) && text(brain.runtime) && text(brain.runtimeVersion) &&
    validRepository(brain.repository) && text(brain.revisionSha) && /^[a-f0-9]{40}$/.test(brain.revisionSha) &&
    text(brain.modelLibraryVersion) && bytes(brain.estimatedBytes) && record(brain.deviceRequirements) &&
    Array.isArray(brain.deviceRequirements.requiredFeatures) && brain.deviceRequirements.requiredFeatures.every(text) &&
    bytes(brain.deviceRequirements.minimumMaxBufferSize) && typeof brain.deviceRequirements.vramRequiredMB === 'number' &&
    brain.deviceRequirements.vramRequiredMB > 0 && brainArtifacts.length > 0 && contiguousShards &&
    exactArtifactInventory(brainArtifacts.filter((artifact) => artifact.cache === 'webllm/config'), ['mlc-chat-config.json'], 'webllm/config') &&
    exactArtifactInventory(brainArtifacts.filter((artifact) => artifact.cache === 'webllm/model'), ['ndarray-cache.json', 'tokenizer.json', ...shardPaths], 'webllm/model') &&
    brainArtifacts.filter((artifact) => artifact.cache === 'webllm/wasm' && artifact.url).length === 1 &&
    brain.estimatedBytes === artifactBytes(brainArtifacts)

  const hearingRequired = [
    'config.json',
    'generation_config.json',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/encoder_model_q4.onnx',
    'onnx/decoder_model_merged_q4.onnx',
  ]
  const hearingOk = record(hearing) && text(hearing.id) && text(hearing.runtime) && text(hearing.runtimeVersion) &&
    validRepository(hearing.repository) && text(hearing.revisionSha) && /^[a-f0-9]{40}$/.test(hearing.revisionSha) &&
    bytes(hearing.estimatedBytes) && record(hearing.deviceRequirements) &&
    Array.isArray(hearing.deviceRequirements.requiredFeatures) && hearing.deviceRequirements.requiredFeatures.every(text) &&
    bytes(hearing.deviceRequirements.minimumMaxBufferSize) &&
    hearing.deviceRequirements.minimumMaxBufferSize >= Math.max(...hearingArtifacts.filter((artifact) => artifact.path.endsWith('.onnx')).map((artifact) => artifact.sizeBytes), 0) &&
    hearingArtifacts.length === hearingRequired.length &&
    exactArtifactInventory(hearingArtifacts, hearingRequired, 'transformers-cache') &&
    hearing.estimatedBytes === artifactBytes(hearingArtifacts)

  const voiceOk = record(localVoice) && localVoice.runtime === 'web-speech-local' &&
    localVoice.runtimeVersion === 'browser' && localVoice.downloadedBytes === 0

  if (!runtimeOk || !brainOk || !hearingOk || !voiceOk) throw new Error('invalid offline kit component')
  return value as unknown as OfflineKitManifest
}

export const offlineKitManifest = validateOfflineKitManifest(rawManifest)

export function offlineKitEstimatedBytes(runtimeBytes?: number): number {
  const { brain, hearing } = offlineKitManifest.components
  return brain.estimatedBytes + hearing.estimatedBytes +
    (runtimeBytes ?? offlineKitManifest.runtimeSources.reduce((total, artifact) => total + artifact.sizeBytes, 0))
}

export function offlineKitArtifacts(component: OfflineKitComponent): OfflineArtifact[] {
  return [...offlineKitManifest.components[component].artifacts]
}

export function offlineKitRevision(component: OfflineKitComponent): string {
  const artifacts = offlineKitArtifacts(component).map((artifact) => artifact.sha256).join('.')
  const item = offlineKitManifest.components[component]
  return `${offlineKitManifest.kitVersion}/${item.runtimeVersion}/${artifacts}`
}
