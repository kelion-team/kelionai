// ── GUEST VOICES (Adrian, Aug 1) ─────────────────────────────────────────────
// The product rule, in his words: "trebuie sa poata raspunde cand titularul de
// cont sa-i ceara sa vorbeasca si cu alta persoana; daca nu primeste cererea
// explicita de la titular, ignora alte persoane pe care le aude (femei,
// barbati, tv, radio). Poate salva si la persoana aditionala poza si amprenta,
// identifica ce grad are cu proprietarul contului (sotie, fiu, prieten, fica)
// si o memoreaza pentru un chat viitor — dar sub aprobarea titularului."
//
// How it works:
//   1. The HOLDER asks (voice or text): "vorbește și cu soția mea Maria" →
//      the brain calls allow_guest_voice → a time-boxed WINDOW opens here.
//   2. While the window is open, the first voice that is NOT the holder is
//      NOT ignored: its print is stored as a PENDING guest (name/relation
//      from the window) and the brain is told to ask the holder to confirm.
//   3. approve_guest_voice(true) → the print becomes permanent: on any FUTURE
//      chat this voice is recognised by timbre and allowed, with a restricted
//      context (zero admin/financial/destructive actions).
//      approve_guest_voice(false) → the pending print is deleted.
//   4. Without a window and without an approved print, a foreign voice is
//      IGNORED COMPLETELY — the turn never reaches the brain.
//
// The window is in-memory (one process, minutes-long): a deploy simply closes
// it, which is safe — the holder asks again. The PRINTS are in Postgres
// (voice_guests), so approved guests survive every upgrade.

import {
  listGuestVoices,
  latestPendingGuest,
  decideGuestVoice,
  forgetGuestVoices,
  vectorDistance,
  type GuestVoiceRow,
} from '../db.js'
import { VOICE_MATCH_THRESHOLD } from './voiceMatch.js'

// Same threshold as the holder check (realtime.ts / chat.ts): under this
// distance, two prints are the same person. Single source: voiceMatch.ts.
const MATCH_THRESHOLD = VOICE_MATCH_THRESHOLD

interface GuestWindow {
  name: string
  relation: string
  until: number
}

const windows = new Map<string, GuestWindow>()

export function openGuestWindow(email: string, name: string, relation: string, minutes: number): GuestWindow {
  const w: GuestWindow = {
    name: name.trim(),
    relation: relation.trim(),
    until: Date.now() + Math.max(1, Math.min(60, minutes)) * 60_000,
  }
  windows.set(email.toLowerCase(), w)
  return w
}

export function activeGuestWindow(email: string): GuestWindow | null {
  const w = windows.get(email.toLowerCase())
  if (!w) return null
  if (Date.now() > w.until) {
    windows.delete(email.toLowerCase())
    return null
  }
  return w
}

export function closeGuestWindow(email: string): void {
  windows.delete(email.toLowerCase())
}

// Recognise a foreign voice among the holder's APPROVED guests (1:N over a
// handful of prints). Returns the best match under the threshold, or null.
export async function matchApprovedGuest(accountEmail: string, vector: number[]): Promise<GuestVoiceRow | null> {
  const guests = await listGuestVoices(accountEmail, true)
  let best: GuestVoiceRow | null = null
  let bestDist = Infinity
  for (const g of guests) {
    if (!g.features.length) continue
    const d = vectorDistance(vector, g.features)
    if (d < bestDist) {
      bestDist = d
      best = g
    }
  }
  return best && bestDist < MATCH_THRESHOLD ? best : null
}

// ── THE BRAIN'S THREE TOOLS (holder-only by construction: they act on the
// SESSION user's own account — every user is the holder of their account) ────

export async function execGuestVoiceTool(
  name: string,
  args: Record<string, unknown>,
  email: string,
): Promise<string | null> {
  switch (name) {
    case 'allow_guest_voice': {
      const guestName = String(args.name ?? '').trim()
      const relation = String(args.relation ?? '').trim()
      if (!guestName) return JSON.stringify({ error: 'no_name', detaliu: 'Cere titularului numele persoanei.' })
      const minutes = Number(args.minutes ?? 10) || 10
      const w = openGuestWindow(email, guestName, relation, minutes)
      return JSON.stringify({
        ok: true,
        fereastra_minute: Math.round((w.until - Date.now()) / 60_000),
        oaspete: w.name,
        relatie: w.relation || '(neprecizată)',
        instructiune:
          `Spune-i lui ${w.name} că poate vorbi acum. La prima frază rostită îi salvez amprenta vocală ca NEAPROBATĂ ` +
          `și îți cer confirmarea ÎN SCRIS sau vocal (approve_guest_voice) ca s-o păstrez pentru viitor. ` +
          `Fără aprobarea ta, vocea revine la a fi ignorată când se închide fereastra.`,
      })
    }
    case 'approve_guest_voice': {
      const approve = args.approve === true
      const pending = await latestPendingGuest(email)
      if (!pending)
        return JSON.stringify({ error: 'no_pending_guest', detaliu: 'Nu există nicio amprentă de oaspete în așteptare.' })
      const name = String(args.name ?? '').trim() || undefined
      const relation = String(args.relation ?? '').trim() || undefined
      const ok = await decideGuestVoice(pending.id, approve, name, relation)
      if (!ok) return JSON.stringify({ error: 'db_error' })
      closeGuestWindow(email)
      return JSON.stringify(
        approve
          ? {
              ok: true,
              salvat: true,
              oaspete: name ?? pending.name,
              relatie: relation ?? pending.relation,
              instructiune: `Amprenta lui ${name ?? pending.name} e păstrată definitiv. De acum îl/o recunosc din timbru în orice chat viitor — cu drepturi de oaspete (zero acțiuni administrative, financiare sau distructive).`,
            }
          : { ok: true, salvat: false, instructiune: 'Amprenta neconfirmată a fost ștearsă; vocea revine la a fi ignorată.' },
      )
    }
    case 'forget_guest': {
      const guestName = String(args.name ?? '').trim()
      if (!guestName) return JSON.stringify({ error: 'no_name' })
      const n = await forgetGuestVoices(email, guestName)
      return JSON.stringify({ ok: true, sterse: n })
    }
    default:
      return null
  }
}

// THE single list of the guest-voice tool names — imported by adminTools.ts
// (dispatch + USER_SCOPED_TOOLS) so the names are never repeated inline.
export const GUEST_VOICE_TOOLS: ReadonlySet<string> = new Set([
  'allow_guest_voice',
  'approve_guest_voice',
  'forget_guest',
])
