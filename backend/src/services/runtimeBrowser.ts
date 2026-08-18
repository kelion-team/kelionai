// Runtime browser executor helpers + runner.
// Pure helpers stay free of config imports so unit tests don't need dotenv.

export interface RezultatRuntime {
  ok: boolean
  shotUrl: string
  logApeluri: string[]
  motiv: string
  brain: 'runtime_browser'
}

export function originePotrivita(origin: string | undefined, appOrigin: string): boolean {
  if (!origin) return false
  try { return new URL(origin).origin === new URL(appOrigin).origin } catch { return false }
}

export function extrageEvidence(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const r = result as Record<string, unknown>
  return typeof r.shotUrl === 'string' && /^https?:\/\//i.test(r.shotUrl) ? r.shotUrl : ''
}

function evidenceFromText(text: string): string {
  const m = String(text).match(/https?:\/\/[^\s"'\\]+\/api\/browser\/shot\/[A-Za-z0-9-]+/i)
  return m ? m[0] : ''
}

export async function origineApp(): Promise<string> {
  const { config } = await import('../config.js')
  try { return new URL(config.google.redirectUri).origin }
  catch { return config.isProd ? 'https://kelionai.app' : 'http://localhost:5173' }
}

/** Same brain, browser hands only. Success = real tool calls + real screenshot URL. */
export async function executaRuntimeBrowser(ordin: string, email?: string): Promise<RezultatRuntime> {
  const { BROWSER_TOOLS } = await import('./brainToolDefs.js')
  const { rationeazaCuUnelte } = await import('./creierRationament.js')
  const { uneltele } = await import('./autonomie.js')
  const { browserClose } = await import('./browser.js')
  const { config } = await import('../config.js')
  type AnthropicTool = { name: string; description: string; input_schema: Record<string, unknown> }

  const who = email || config.adminEmail
  const logApeluri: string[] = []
  const baseUrl = await origineApp()
  let shot = ''
  const allow = new Set(BROWSER_TOOLS.map((t: { name: string }) => t.name))

  const execTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    if (!allow.has(name)) {
      logApeluri.push(name + ':REFUZ')
      return JSON.stringify({ error: 'unealta_interzisa_runtime:' + name })
    }
    logApeluri.push(`${name}(${JSON.stringify(args).slice(0, 180)})`)
    const out = await uneltele(name, args)
    const e1 = evidenceFromText(out)
    if (e1) shot = e1
    try {
      const e2 = extrageEvidence(JSON.parse(out))
      if (e2) shot = e2
    } catch { /* ignore */ }
    return out.slice(0, 20000)
  }

  const url = (String(ordin).match(/https?:\/\/[^\s]+/i) || [baseUrl])[0]
  const prompt =
    `ORDIN RUNTIME browser real, fara cod.\nOrigine app: ${baseUrl}\nDeschide: ${url}\n` +
    `Foloseste DOAR browser_*. Trebuie shotUrl real /api/browser/shot/...\n` +
    `Cerinta:\n${String(ordin).slice(0, 2500)}\n`

  try {
    const spus = await rationeazaCuUnelte(
      prompt,
      BROWSER_TOOLS as unknown as AnthropicTool[],
      execTool,
      { ruta: 'service.runtimeBrowser', maxRounds: 12, maxTokens: 1500 },
    )
    const ok = logApeluri.length > 0 && !!shot
    return {
      ok,
      shotUrl: shot,
      logApeluri,
      motiv: ok ? ('Runtime OK. ' + spus.slice(0, 200)) : ('Fara dovada. ' + spus.slice(0, 200)),
      brain: 'runtime_browser',
    }
  } catch (e) {
    return {
      ok: false,
      shotUrl: shot,
      logApeluri,
      motiv: 'Runtime crash: ' + String((e as Error)?.message || e).slice(0, 300),
      brain: 'runtime_browser',
    }
  } finally {
    await browserClose(who).catch(() => {})
  }
}
