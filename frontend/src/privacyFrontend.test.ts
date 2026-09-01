import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchConstructorWorkerAdmin } from './lib/admin'
import { submissionSessionId } from './lib/submissionSession'
import { deleteMyAccount } from './lib/prefs'

const aici = dirname(fileURLToPath(import.meta.url))
const sursa = (cale: string): string => readFileSync(join(aici, cale), 'utf8')

afterEach(() => vi.unstubAllGlobals())

describe('privacy frontend', () => {
  it('ID-ul leadului este UUID per sesiune, fără fingerprint de dispozitiv', () => {
    expect(submissionSessionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    const helper = sursa('lib/submissionSession.ts')
    expect(helper).not.toMatch(/canvas|userAgent|deviceMemory|hardwareConcurrency|screen\.|navigator\.language/i)
    const landing = sursa('pages/Landing.tsx')
    expect(landing).toContain('submissionSession')
    expect(landing).not.toMatch(/\bfp\b|fingerprint/i)
  })

  it('beaconurile de vizită nu trimit poză sau identificator client', () => {
    const vizita = sursa('lib/vizita.ts')
    const stage = sursa('pages/Stage.tsx')
    expect(vizita).not.toMatch(/foto|photo|fingerprint|visitSessionId|\bfp\b/i)
    expect(stage.slice(stage.indexOf("'/api/visit/ping'"), stage.indexOf("'/api/visit/ping'") + 400)).not.toMatch(/\bfp\b|fingerprint/i)
  })

  it('consimțământul biometric nu blochează intrarea în produs', () => {
    const app = sursa('App.tsx')
    const landing = sursa('pages/Landing.tsx')
    const login = sursa('pages/Login.tsx')
    expect(app).not.toMatch(/ConsimtamantFoto|consimt-gate|getUserMedia|faceprint/i)
    expect(landing).not.toMatch(/getUserMedia|faceprint|fotografie.*obligator|refuz.*acces/i)
    expect(login).not.toMatch(/getUserMedia|faceprint|fotografie.*obligator|refuz.*acces/i)
    expect(existsSync(join(aici, 'components/ConsimtamantFoto.tsx'))).toBe(false)
    expect(existsSync(join(aici, 'lib/faceprint.ts'))).toBe(false)
    const chat = sursa('components/ChatPanel.tsx')
    expect(chat).toMatch(/cameraConsentPrompt/)
    expect(chat).toMatch(/useState\(false\).*camera|const \[cameraOn, setCameraOn\] = useState\(false\)/s)
  })

  it('starea Constructorului păstrează numai executorul local și nu propagă metadata cloud sau secrete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      worker: { state: 'ready', lastHeartbeat: '2026-08-24T10:00:00.000Z' },
      setupInstructions: null,
      taskUrl: 'https://chatgpt.com/codex/tasks/private',
      status: 'gata',
      internalCostUsd: 0.0123,
      executor: 'OpenCode + Qwen local (llama.cpp)',
      queue: 'build_jobs',
      token: 'nu-trebuie-să-ajungă',
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const constructor = await fetchConstructorWorkerAdmin()
    expect(constructor).toEqual({
      worker: { state: 'ready', lastHeartbeat: '2026-08-24T10:00:00.000Z' },
      setupInstructions: null,
      status: 'gata',
      executor: 'OpenCode + Qwen local (llama.cpp)',
      queue: 'build_jobs',
    })
    expect(JSON.stringify(constructor)).not.toMatch(/nu-trebuie-să-ajungă|chatgpt\.com|internalCostUsd|taskUrl/)
  })

  it('nu inventează metadata executorului local când serverul nu o confirmă', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      worker: { state: 'unknown', lastHeartbeat: 'not-a-date' },
      setupInstructions: null,
      status: null,
      executor: 'alt executor',
      queue: 'alt_queue',
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    await expect(fetchConstructorWorkerAdmin()).resolves.toMatchObject({
      worker: { state: 'unknown', lastHeartbeat: null },
      executor: null,
      queue: null,
    })
  })

  it('nu afișează conectare cloud pentru Constructor și păstrează numai profilul spectral user-scoped', () => {
    const admin = sursa('components/admin/AdminProductie.tsx')
    const settings = sursa('components/CustomerSettings.tsx')
    const adminText = sursa('lib/adminText.ts')
    expect(admin).not.toMatch(/Conectează Codex|connectUrl|Codex.*OAuth|chatgpt\.com\/codex/i)
    expect(adminText).not.toMatch(/voiceprintKept|never deleted|nu se șterge/i)
    expect(settings).not.toContain('/api/faceprint/me')
    expect(settings).toContain("apiFetch('/api/voiceprint/me', { method: 'DELETE' })")
    expect(settings).not.toMatch(/\/api\/voce\/sample|Coqui|clonareVoce/i)
    expect(admin).not.toMatch(/mostraAudio|amprentă vocală|voiceprint/i)
  })

  it('configurația OpenAI din Admin este numai pentru citire', () => {
    const adminApi = sursa('lib/admin.ts')
    const admin = sursa('components/admin/AdminProductie.tsx')
    expect(adminApi).toContain("apiFetch('/api/admin/creier', { credentials: 'include' })")
    expect(adminApi).not.toMatch(/setCreier|apiFetch\('\/api\/admin\/creier',[\s\S]{0,120}method: 'POST'/)
    expect(admin).not.toMatch(/Salvează modelul OpenAI|\bsetCreier\b|modelSelect/)
    expect(admin).toContain('Configurația este read-only în browser.')
  })

  it('chatul vizitatorului folosește numai sesiunea cookie HttpOnly a serverului', () => {
    const widget = sursa('components/VisitorChatWidget.tsx')
    expect(widget).toContain("apiFetch('/api/visitor-chat/session'")
    expect(widget).not.toMatch(/localStorage|Math\.random|\bconv\b/)
    expect(widget).toMatch(/JSON\.stringify\(\{ text: t \}\)/)
  })

  it('ștergerea contului trimite confirmarea exactă și nu inventează succesul la reautentificare', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'recent_reauthentication_required',
      reauthenticatePath: '/auth/google',
    }), { status: 428, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(deleteMyAccount()).resolves.toEqual({
      ok: false,
      error: 'recent_reauthentication_required',
      reauthenticatePath: '/auth/google',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/me/delete', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }))
  })

  it('afișează succes numai când serverul întoarce receipt-ul de ștergere', async () => {
    const receipt = {
      requestId: 'delete-123',
      completedAt: '2026-08-24T10:00:00.000Z',
      deleted: ['profile', 'biometrics'],
      retained: [{ category: 'billing_ledger', reason: 'legal_obligation', until: '2032-08-24' }],
      backups: { beyondUse: true, purgeAfter: '2026-09-24' },
      googleRevocation: 'completed' as const,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, receipt }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))

    await expect(deleteMyAccount()).resolves.toEqual({ ok: true, receipt })
  })
})
