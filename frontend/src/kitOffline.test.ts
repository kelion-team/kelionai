import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const stocare = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => stocare.get(k) ?? null,
  setItem: (k: string, v: string) => void stocare.set(k, v),
  removeItem: (k: string) => void stocare.delete(k),
})

const { wavBase64LaFloat32 } = await import('./lib/urecheaOffline')
const { offlineKitManifest, offlineKitEstimatedBytes } = await import('./lib/offlineKitManifest')

// Părțile pure se probează executabil; cablajul, pe cod viu.
const aici = dirname(fileURLToPath(import.meta.url))
function codViu(rel: string): string {
  return readFileSync(join(aici, rel), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('urechea Whisper — părțile pure', () => {
  it('wavBase64LaFloat32 decodează WAV 16-bit mono (header 44B) la [-1..1]', () => {
    // Același container RIFF/PCM produs de micStream, inclusiv data URI.
    const octeti = new Uint8Array(44 + 8)
    const dv = new DataView(octeti.buffer)
    const wr = (off: number, value: string): void => {
      for (let i = 0; i < value.length; i++) dv.setUint8(off + i, value.charCodeAt(i))
    }
    wr(0, 'RIFF'); dv.setUint32(4, 36 + 8, true); wr(8, 'WAVE'); wr(12, 'fmt ')
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
    dv.setUint32(24, 16_000, true); dv.setUint32(28, 32_000, true)
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, 8, true)
    dv.setInt16(44, 0, true)
    dv.setInt16(46, 16384, true)
    dv.setInt16(48, -16384, true)
    dv.setInt16(50, 32767, true)
    const b64 = btoa(String.fromCharCode(...octeti))
    const f = wavBase64LaFloat32(`data:audio/wav;base64,${b64}`)
    expect(f.length).toBe(4)
    expect(f[0]).toBe(0)
    expect(f[1]).toBeCloseTo(0.5, 3)
    expect(f[2]).toBeCloseTo(-0.5, 3)
    expect(f[3]).toBeCloseTo(1, 2)
  })

  it('respinge containerul WAV corupt sau un format audio nepotrivit', () => {
    expect(() => wavBase64LaFloat32(btoa('not a wav'))).toThrow('wav_too_short')
    const octeti = new Uint8Array(44)
    const dv = new DataView(octeti.buffer)
    const wr = (off: number, value: string): void => {
      for (let i = 0; i < value.length; i++) dv.setUint8(off + i, value.charCodeAt(i))
    }
    wr(0, 'RIFF'); dv.setUint32(4, 36, true); wr(8, 'WAVE'); wr(12, 'fmt ')
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true)
    dv.setUint32(24, 16_000, true); dv.setUint32(28, 64_000, true)
    dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, 0, true)
    const b64 = btoa(String.fromCharCode(...octeti))
    expect(() => wavBase64LaFloat32(b64)).toThrow('wav_format_unsupported')
  })

  it('nu trimite către Whisper un WAV valid care conține numai liniște', () => {
    const bytes = new Uint8Array(44 + 320)
    const view = new DataView(bytes.buffer)
    const wr = (off: number, value: string): void => {
      for (let i = 0; i < value.length; i++) view.setUint8(off + i, value.charCodeAt(i))
    }
    wr(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); wr(8, 'WAVE'); wr(12, 'fmt ')
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
    view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true)
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); wr(36, 'data'); view.setUint32(40, 320, true)
    const encoded = btoa(String.fromCharCode(...bytes))
    expect(() => wavBase64LaFloat32(`data:audio/wav;base64,${encoded}`)).toThrow('wav_no_speech')
  })
})

describe('cablajul kitului — cod viu', () => {
  it('cache-urile modelelor sunt păstrate la activarea unui shell nou', () => {
    const sw = readFileSync(join(aici, '../public/sw.js'), 'utf8')
    expect(sw).toMatch(/eModelOffline = \(k\) => k\.startsWith\('webllm\/'\) \|\| k === 'transformers-cache'/)
    expect(sw).toMatch(/const ePastrat = \(k\) => k === SHELL \|\| k === ASSET_CACHE \|\| k === OFFLINE_RUNTIME_META_CACHE \|\| eModelOffline\(k\)/)
    expect(sw).not.toContain("kelion-clear-caches")
  })

  it('o navigare secundară nu poate suprascrie shell-ul offline de la rădăcină', () => {
    const sw = readFileSync(join(aici, '../public/sw.js'), 'utf8')
    expect(sw).toMatch(/caleRevizuitaPastrata\(isHTML && url\.pathname === '\/' \? '\/' : url\.pathname\)/)
    expect(sw).toMatch(/const root = await assetCurent\(cache, '\/'\)/)
  })

  it('runtime-urile ASR sunt pregătite de build, fără runtime vocal terț', () => {
    const pkg = readFileSync(join(aici, '../package.json'), 'utf8')
    expect(pkg).toMatch(/"prebuild": "node scripts\/copiaza-active-offline\.mjs"/)
    expect(pkg).not.toContain('@mintplex-labs/piper-tts-web')
    expect(offlineKitManifest.localVoice).toMatchObject({
      runtime: 'web-speech-local',
      downloadedBytes: 0,
    })
  })

  it('kitul nu se descarcă automat; are numai instalare explicită din Setări', () => {
    const kit = codViu('lib/kitOffline.ts')
    const chat = codViu('components/ChatPanel.tsx')
    const settings = codViu('components/CustomerSettings.tsx')
    expect(kit).toMatch(/export function installOfflineKit/)
    expect(kit).toMatch(/offlineKitPreflight\(before\.components, before\.runtimeReady, before\.runtimeBytes\)/)
    expect(chat).not.toMatch(/installOfflineKit|sincronizeazaKitOffline/)
    expect(settings).toMatch(/Descarcă kitul offline/)
    expect(settings).toMatch(/offlineConsent/)
  })

  it('manifestul pinuit are revizii, dimensiuni și hashuri valide', () => {
    expect(offlineKitManifest.schemaVersion).toBe(2)
    expect(offlineKitManifest.components.brain.revisionSha).toMatch(/^[a-f0-9]{40}$/)
    expect(offlineKitManifest.components.hearing.revisionSha).toMatch(/^[a-f0-9]{40}$/)
    const artifacts = [
      ...offlineKitManifest.components.brain.artifacts,
      ...offlineKitManifest.components.hearing.artifacts,
    ]
    expect(artifacts.every((item) => /^[a-f0-9]{64}$/.test(item.sha256))).toBe(true)
    expect(offlineKitManifest.components.brain.id).toBe('SmolLM2-360M-Instruct-q4f32_1-MLC')
    expect(offlineKitManifest.components.brain.artifacts.length).toBeGreaterThan(5)
    const exactBytes = offlineKitManifest.components.brain.estimatedBytes +
      offlineKitManifest.components.hearing.estimatedBytes +
      offlineKitManifest.runtimeSources.reduce((total, item) => total + item.sizeBytes, 0)
    expect(offlineKitEstimatedBytes()).toBe(exactBytes)
    expect(offlineKitManifest.components.hearing.deviceRequirements.minimumMaxBufferSize)
      .toBeLessThan(128 * 1024 * 1024)
  })

  it('readiness-ul creierului nu acceptă un cache parțial pe baza numărului de chei', () => {
    const brain = codViu('lib/creierLocal.ts')
    const integrity = codViu('lib/offlineKitIntegrity.ts')
    expect(brain).not.toMatch(/keys\(\)[\s\S]{0,120}length\s*>\s*0/)
    expect(brain).toMatch(/reconcileOfflineComponent\('brain'\)/)
    expect(integrity).toMatch(/artifact\.sizeBytes/)
    expect(integrity).toMatch(/artifact\.sha256/)
    expect(integrity).toMatch(/markOfflineComponentReady\(component\)/)
  })

  it('modul avion interzice accesul remote pentru Whisper', () => {
    const bridge = codViu('lib/urecheaOffline.ts')
    const worker = codViu('lib/urecheaOffline.worker.ts')
    expect(bridge).toMatch(/!allowNetwork && !\(await reconcileOfflineComponent\('hearing'\)\)\.ok/)
    expect(worker).toMatch(/AutoModelForSpeechSeq2Seq\.from_pretrained/)
    expect(worker).toMatch(/revision: component\.revisionSha/)
    expect(worker).toMatch(/offline_model_asset_missing/)
    expect(worker).toMatch(/env\.allowRemoteModels = true/)
    expect(worker).toMatch(/env\.allowLocalModels = false/)
    expect(worker).toMatch(/new Float32Array\(1_600\)/)
  })

  it('vocea offline acceptă numai o voce OS marcată localService', () => {
    const voice = codViu('lib/voceBrowser.ts')
    expect(voice).toMatch(/voice\.localService === true/)
    expect(voice).toMatch(/if \(!voce\) return false/)
  })

  it('gura și urechea offline împart lifecycle-ul pentru barge-in', () => {
    const chat = codViu('components/ChatPanel.tsx')
    expect(chat).toMatch(/vorbesteLocal\(deRostit, lang, \{\s*onStart: \(\) => urecheaLocalaRef\.current\?\.setMuted\(true\)/)
    expect(chat).toMatch(/onEnd: \(\) => urecheaLocalaRef\.current\?\.setMuted\(false\)/)
    expect(chat).toMatch(/onBargeIn: \(\) => \{[\s\S]*?opresteVoceLocal\(\)[\s\S]*?setMuted\(false\)/)
  })

  it('urechea locală intră pe drumul tastării (send), nu pe vreun canal nou', () => {
    const chat = codViu('components/ChatPanel.tsx')
    expect(chat).toMatch(/const pcm = wavBase64LaFloat32\(audio\)/)
    expect(chat).toMatch(/generation === connectionGenerationRef\.current/)
  })
})
