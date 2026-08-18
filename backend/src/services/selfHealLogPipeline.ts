// ── PIPELINE DE SCANARE LOGURI ȘI ENGINE DE DECIZIE PENTRU AUTO-VINDECARE ─────
//
// Arhitectură: Pipeline decuplat cu Adaptoare de Loguri și Engine de Decizie
// - LogSourceAdapter: interfață comună pentru surse de loguri (Server, Constructor/Gazdă)
// - FingerprintExtractor & Aggregator: extragere amprente normalizate și agregare contor
// - SelfHealDecisionEngine: aplicare politici de prag, dedup prin KV și declanșare
//   ordine de build_software (createBuildJob).

import { recentLogs, type LogEntry } from './logbuffer.js'
import { FISIERE_GAZDA, coadaLogGazda, semnaturiEroare, type FisierGazda } from './logGazda.js'
import { createBuildJob, loadKv, saveKv } from '../db.js'
import { sursaOcupata, signature } from './selfHeal.js'

/** Anti-bucla: nu naste ordine din constructor.log (nu blocheaza server/gazda). */
export function eSursaConstructorLog(sursa: string, text = ''): boolean {
  const s = `${sursa} ${text}`.toLowerCase()
  return (
    s.includes('constructor.log') ||
    s.includes('(constructor logs)') ||
    s.includes('auto-vindecare (constructor logs)')
  )
}

export interface RawLogItem {
  source: 'server' | 'constructor' | 'gazda'
  fileOrContext: string
  message: string
  timestamp?: number
}

export interface AggregatedLogGroup {
  fingerprint: string
  sampleMessage: string
  source: 'server' | 'constructor' | 'gazda'
  fileOrContext: string
  count: number
}

export interface LogScannerAdapter {
  name: string
  scan(): Promise<RawLogItem[]>
}

/**
 * Adaptor pentru logurile de server (din inelul de memorie `recentLogs` / erori server).
 */
export class ServerLogAdapter implements LogScannerAdapter {
  name = 'server'
  private minLevel: number
  private limit: number

  constructor(minLevel = 40, limit = 100) {
    this.minLevel = minLevel
    this.limit = limit
  }

  async scan(): Promise<RawLogItem[]> {
    const logs = recentLogs(this.minLevel, this.limit)
    return logs
      .filter((entry: LogEntry) => Boolean(entry.msg || (entry as unknown as { message?: string }).message))
      .map((entry: LogEntry) => {
        const msg = String(entry.msg || (entry as unknown as { message?: string }).message || '')
        const ts = entry.t ? Date.parse(entry.t) : Date.now()
        return {
          source: 'server' as const,
          fileOrContext: 'server.logbuffer',
          message: msg,
          timestamp: isNaN(ts) ? Date.now() : ts,
        }
      })
  }
}

/**
 * Adaptor pentru logurile constructorului și gazdei (constructor.log, auto-publicare.log).
 */
export class ConstructorLogAdapter implements LogScannerAdapter {
  name = 'constructor'
  private fisiere: readonly FisierGazda[]

  constructor(fisiere: readonly FisierGazda[] = FISIERE_GAZDA) {
    this.fisiere = fisiere
  }

  async scan(): Promise<RawLogItem[]> {
    const out: RawLogItem[] = []
    for (const fisier of this.fisiere) {
      const coada = await coadaLogGazda(fisier)
      if (!coada.ok) continue
      const linii = semnaturiEroare(coada.text)
      for (const linie of linii) {
        out.push({
          source: fisier === 'constructor.log' ? 'constructor' : 'gazda',
          fileOrContext: fisier,
          message: linie,
          timestamp: Date.now(),
        })
      }
    }
    return out
  }
}

/**
 * Extrage amprenta canonică dintr-un mesaj de eroare.
 */
export function extractLogFingerprint(message: string): string {
  const norm = message
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}[t ][\d:.,+z-]*/gi, '')
    .replace(/[0-9a-f]{8,}/gi, '')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  return signature(norm || message)
}

/**
 * Grupează logurile brute pe amprente și numără frecvența.
 */
export function groupLogsByFingerprint(items: RawLogItem[]): AggregatedLogGroup[] {
  const groups = new Map<string, AggregatedLogGroup>()

  for (const item of items) {
    const fp = extractLogFingerprint(item.message)
    const key = `${item.source}:${item.fileOrContext}:${fp}`
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
    } else {
      groups.set(key, {
        fingerprint: fp,
        sampleMessage: item.message,
        source: item.source,
        fileOrContext: item.fileOrContext,
        count: 1,
      })
    }
  }

  return Array.from(groups.values())
}

export interface DecisionEngineOptions {
  thresholds?: {
    server?: number
    constructor?: number
    gazda?: number
  }
  maxOrdersPerRun?: number
}

/**
 * Engine de decizie pentru loguri: aplică praguri, dedup în KV și creează joburi de build_software.
 */
export class SelfHealDecisionEngine {
  private serverThreshold: number
  private constructorThreshold: number
  private gazdaThreshold: number
  private maxOrders: number

  constructor(options: DecisionEngineOptions = {}) {
    // Praguri implicite:
    // - Server: 2 apariții (erorile de server recurente cer reparație)
    // - Constructor / Gazdă: 2 apariții (evită un singur fulger / eroare tranzitorie)
    this.serverThreshold = options.thresholds?.server ?? 2
    this.constructorThreshold = options.thresholds?.constructor ?? 2
    this.gazdaThreshold = options.thresholds?.gazda ?? 2
    this.maxOrders = options.maxOrdersPerRun ?? 2
  }

  getThreshold(source: 'server' | 'constructor' | 'gazda'): number {
    if (source === 'server') return this.serverThreshold
    if (source === 'constructor') return this.constructorThreshold
    return this.gazdaThreshold
  }

  async processAggregatedGroups(groups: AggregatedLogGroup[]): Promise<{ filed: number }> {
    let filed = 0

    for (const group of groups) {
      // Anti-bucla: doar constructor.log, nu server/gazda.
      if (eSursaConstructorLog(group.source, group.fileOrContext + ' ' + group.sampleMessage)) continue
      if (filed >= this.maxOrders) break

      const scope = group.source === 'server'
        ? 'kelion-autovindecare-server'
        : 'kelion-autovindecare-gazda'

      if (await sursaOcupata(scope)) {
        continue
      }

      const threshold = this.getThreshold(group.source)
      const cheieContor = `selfheal-log-n:${group.source}:${group.fingerprint}`
      const cheieFiled = `selfheal-log-filed:${group.source}:${group.fingerprint}`

      // Verificăm dacă a fost deja deschis un ordin pentru această amprentă
      if (await loadKv(cheieFiled)) {
        continue
      }

      // Adunăm numărul de apariții detectate anterior cu cel din scanarea curentă
      const anterior = Number((await loadKv(cheieContor)) ?? '0')
      const totalCount = anterior + group.count
      await saveKv(cheieContor, String(totalCount))

      if (totalCount < threshold) {
        continue
      }

      // Constructor logs are evidence for the mandatory incident strategist,
      // never a source of recursive constructor orders. The old behavior created
      // #475-#478 from earlier failures and made the broken executor repair itself
      // by spawning more work into the same broken executor.
      if (group.source === 'constructor') {
        await saveKv(cheieFiled, JSON.stringify({
          at: Date.now(),
          count: totalCount,
          handedTo: 'constructor_incident_strategist',
          evidence: group.sampleMessage.slice(0, 500),
        }))
        continue
      }

      const orderPrompt =
        `AUTO-VINDECARE (${group.source} logs): în ${group.fileOrContext} apare RECURENT eroarea (count=${totalCount}, prag=${threshold}):\n` +
        `${group.sampleMessage}\n\n` +
        `Găsește CAUZA REALĂ în cod (search_source pe mesaj; context: ${group.fileOrContext}) ` +
        `și rescrie curat modulul responsabil — fără petice. NU schimba nimic în afara cauzei.\n` +
        `Verifică: build + teste (backend și, dacă atingi, frontend).`

      if (eSursaConstructorLog(group.source, group.fileOrContext + ' ' + group.sampleMessage)) {
        continue
      }

      const jobId = await createBuildJob(scope, orderPrompt)
      if (jobId) {
        await saveKv(cheieFiled, JSON.stringify({ at: Date.now(), job: jobId, count: totalCount }))
        filed += 1
      }
    }

    return { filed }
  }
}

/**
 * Rulează scanarea completă prin pipeline-ul decuplat de adaptoare și motorul de decizie.
 */
export async function runLogSelfHealPipeline(
  adapters: LogScannerAdapter[] = [new ServerLogAdapter(), new ConstructorLogAdapter()],
  engine: SelfHealDecisionEngine = new SelfHealDecisionEngine(),
): Promise<{ filed: number }> {
  const allItems: RawLogItem[] = []

  for (const adapter of adapters) {
    try {
      const items = await adapter.scan()
      allItems.push(...items)
    } catch {
      // Un adaptor care eșuează nu oprește celelalte adaptoare
    }
  }

  const grouped = groupLogsByFingerprint(allItems)
  return await engine.processAggregatedGroups(grouped)
}
