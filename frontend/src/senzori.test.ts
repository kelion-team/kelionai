import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clasificaIndiciuSunet } from './lib/auzAmbiental'
import { contextPentruCreier } from './lib/contextOffline'

const aici = dirname(fileURLToPath(import.meta.url))

describe('senzori — semnale măsurate, fără verdicte inventate', () => {
  it('FFT-ul emite numai indicii grosiere, niciodată alarmă/plâns/spargere', () => {
    const iesiri = [
      clasificaIndiciuSunet(0, 0, 0),
      clasificaIndiciuSunet(10, 60, 10),
      clasificaIndiciuSunet(50, 50, 50),
      clasificaIndiciuSunet(60, 3, 2),
    ]
    expect(iesiri).toEqual(['liniste', 'conversatie_posibila', 'muzica_posibila', 'zgomot_brusc'])
    expect(iesiri).not.toContain('alarma')
    expect(iesiri).not.toContain('plans')
    expect(iesiri).not.toContain('spargere')
  })

  it('contextul offline marchează sunetul drept euristic', () => {
    const c = contextPentruCreier({
      sunetAmbiental: 'zgomot_brusc',
    })
    expect(c).toMatch(/heuristic/i)
    expect(c).toMatch(/not a confirmed event/i)
  })
})

describe('senzori — cablajul viu', () => {
  it('camera creează un singur instantaneu numai la apelul explicit', () => {
    const camera = readFileSync(join(aici, 'components/CameraView.tsx'), 'utf8')
    expect(camera).toMatch(/captureRef\.current = capture/)
    expect(camera).toMatch(/canvas\.toBlob/)
    expect(camera).not.toMatch(/setInterval|startFaceSampling|face-api|vedereContinua/)
    const chat = readFileSync(join(aici, 'components/ChatPanel.tsx'), 'utf8')
    expect(chat).toMatch(/cameraImageRequested\(msg\)[\s\S]{0,120}await captureRef\.current/)
    expect(chat).not.toMatch(/faceDescriptor|facePhoto|continuousVision|watchPosition/)
  })

  it('auzul ambiental nu deschide și nu oprește propriul microfon', () => {
    const auz = readFileSync(join(aici, 'lib/auzAmbiental.ts'), 'utf8')
    expect(auz).not.toMatch(/getUserMedia\s*\(/)
    expect(auz).not.toMatch(/stream\.getTracks\(\).*\.stop/)
    const chat = readFileSync(join(aici, 'components/ChatPanel.tsx'), 'utf8')
    expect(chat).toMatch(/fluxMicrofon\(\)/)
    expect(chat).toMatch(/pornesteAuzulAmbiental\(stream\)/)
  })

  it('elimină lip-reading-ul geometric fals și clonarea vocală online', () => {
    expect(existsSync(join(aici, 'lib/cititBuze.ts'))).toBe(false)
    expect(existsSync(join(aici, 'lib/clonareVoce.ts'))).toBe(false)
    const camera = readFileSync(join(aici, 'components/CameraView.tsx'), 'utf8')
    expect(camera).not.toMatch(/clonareVoce|CititBuze|cuvantBuze|faceprint|indiciiExpresie/)
    const settings = readFileSync(join(aici, 'components/CustomerSettings.tsx'), 'utf8')
    expect(settings).not.toMatch(/clonareVoce|Coqui|\/api\/voce\/sample|coquiActiv|acordSampleVoce/i)
    expect(settings).toMatch(/\/api\/voiceprint\/me/)
  })
})
