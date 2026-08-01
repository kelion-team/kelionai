import fs from 'node:fs/promises'
import { cpus } from 'node:os'

// ── HOST RESOURCES: MEMORY + LOAD ───────────────────────────────────────────
//
// Adrian, 31 Jul: "buddy but I already have one there" / "what's not ok with
// that?" — about getting another VPS for the second agent instead of using
// the existing one. Then: "wouldn't it be better to do everything on the
// current VPS and see later, if it can't cope we raise the RAM?" — his plan,
// better than mine. And: "can the load on the server be measured, is it
// easy" — yes, and it is the other half of the answer.
//
// I had answered "I wouldn't put it on the same VPS". When he asked why, I
// looked at the code: the disk was measured in two places (health.ts,
// ops.ts), memory and load in NONE. So it wasn't an answer, it was an
// opinion handed down as a verdict — exactly what I'm not allowed (rule 1).
//
// The two measure different things, and both are needed:
//   MEMORY  → DOES IT FIT? Full, the kernel kills processes (OOM), with no
//             error, no warning. The container dies, the sentinel restarts
//             it, and the log is left with "restarted" and no "why".
//   LOAD    → CAN IT COPE? Saturated, nothing dies — everything becomes
//             slow. The chat that must answer in under a second answers in
//             five.
//
// Why /proc and not os.freemem(): inside a container, /proc shows the HOST
// — exactly what you need to answer "does one more agent fit on this
// machine?".

export interface ResurseGazda {
  /** The host's total memory, GB. */
  totalGb: number
  /** Really available memory (free + reclaimable cache), GB. */
  liberGb: number
  /** Free percentage of the total. Below PRAG_MEMORIE_PCT = OOM is a matter of time. */
  liberPct: number
  procesoare: number
  /** The 1 / 5 / 15 minute load average, raw (like `uptime`). */
  incarcare: [number, number, number]
  /**
   * The 15-min load relative to the number of processors, in percent.
   * 100% = exactly as many waiting processes as there are cores. Above = queue.
   */
  incarcarePct: number
}

/** Below this much free memory, the kernel starts killing processes. */
export const PRAG_MEMORIE_PCT = 10

/**
 * Above this much sustained load (15-min average), the machine is queueing.
 * 100% would be "exactly at capacity" — the threshold is higher so it doesn't
 * scream at normal peaks (a build, a deploy). 200% = every core has a process
 * waiting behind it; then it really is cramped.
 */
export const PRAG_INCARCARE_PCT = 200

interface Memorie {
  totalGb: number
  liberGb: number
  liberPct: number
}

/**
 * Parses /proc/meminfo. Pure — that is why it is separate: it is tested with
 * real text, without depending on the machine the test runs on.
 * Returns null if the text is not /proc/meminfo (other platform, empty file).
 */
export function citesteMeminfo(text: string): Memorie | null {
  const kb = (camp: string): number => Number(new RegExp(`^${camp}:\\s+(\\d+) kB`, 'm').exec(text)?.[1] ?? 0)
  const total = kb('MemTotal')
  // MemAvailable, not MemFree: MemFree excludes the cache, which is
  // reclaimable on the spot. On a server running for a week MemFree is
  // always small and would set off the alarm every day for nothing.
  // MemAvailable is the real figure.
  const liber = kb('MemAvailable')
  if (total <= 0) return null
  return {
    totalGb: total / 1024 / 1024,
    liberGb: liber / 1024 / 1024,
    liberPct: Math.round((liber / total) * 100),
  }
}

/** Parses /proc/loadavg ("0.13 0.23 0.17 1/111 26260"). Pure, as above. */
export function citesteLoadavg(text: string): [number, number, number] | null {
  const m = /^\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(text)
  if (!m) return null
  const v: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return v.some((n) => !Number.isFinite(n)) ? null : v
}

/** Reads the host resources. null on anything other than Linux — missing, not zero. */
export async function resurseGazda(): Promise<ResurseGazda | null> {
  const citeste = async (cale: string): Promise<string | null> => {
    try {
      return await fs.readFile(cale, 'utf8')
    } catch {
      return null // no /proc — declared missing, never invented as 0
    }
  }
  const [mText, lText] = await Promise.all([citeste('/proc/meminfo'), citeste('/proc/loadavg')])
  const mem = mText === null ? null : citesteMeminfo(mText)
  const load = lText === null ? null : citesteLoadavg(lText)
  if (!mem || !load) return null
  const procesoare = cpus().length || 1
  return {
    ...mem,
    procesoare,
    incarcare: load,
    incarcarePct: Math.round((load[2] / procesoare) * 100),
  }
}

/** „3.1 GB liberi din 7.8 GB (40%), încărcare 17% din 4 procesoare (…)" */
export function descrieResurse(r: ResurseGazda): string {
  return (
    `${r.liberGb.toFixed(1)} GB liberi din ${r.totalGb.toFixed(1)} GB (${r.liberPct}%), ` +
    `încărcare ${r.incarcarePct}% din ${r.procesoare} procesoare ` +
    `(${r.incarcare.map((n) => n.toFixed(2)).join(' / ')} la 1/5/15 min)`
  )
}
