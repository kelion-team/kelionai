import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── FUNCTIONAL PROOF OF THE VOICEPRINT RULES (the voice-gate audit) ─────────
//
// poartaVoce.test.ts guards the WIRING (source-level). This file guards the
// BEHAVIOUR, with real vectors through the real comparison code:
//   1. The match threshold ACCEPTS the holder and REJECTS a foreign voice —
//      not by inspecting a constant, but by running embeddings through it.
//   2. An approved guest is recognised by timbre; a stranger is not.
//   3. The holder's consent is EXPLICIT: the window opens only through
//      allow_guest_voice, and a print becomes permanent only through
//      approve_guest_voice with a literal `approve: true`.
//
// The DB is mocked at the module boundary; the distance math, the threshold
// and the whole guest-window state machine are the REAL production code.

vi.mock('./db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db.js')>()
  return {
    ...actual,
    listGuestVoices: vi.fn(),
    latestPendingGuest: vi.fn(),
    decideGuestVoice: vi.fn(),
    forgetGuestVoices: vi.fn(),
  }
})

import {
  listGuestVoices,
  latestPendingGuest,
  decideGuestVoice,
  forgetGuestVoices,
  type GuestVoiceRow,
} from './db.js'
import { VOICE_MATCH_THRESHOLD, sameSpeaker } from './services/voiceMatch.js'
import {
  openGuestWindow,
  activeGuestWindow,
  closeGuestWindow,
  matchApprovedGuest,
  execGuestVoiceTool,
} from './services/guestVoices.js'

const mockList = vi.mocked(listGuestVoices)
const mockPending = vi.mocked(latestPendingGuest)
const mockDecide = vi.mocked(decideGuestVoice)
const mockForget = vi.mocked(forgetGuestVoices)

// A realistic 12-d feature vector (the client extracts ~a dozen normalized
// features: pitch stats, spectral ratios, formant-ish bands).
const DIM = 12
const holderVec = Array.from({ length: DIM }, (_, i) => 0.4 + i * 0.05)
// The same person, another utterance: every feature wobbles a little.
const holderAgain = holderVec.map((x, i) => x + (i % 2 === 0 ? 0.01 : -0.01))
// A FOREIGN voice (woman / TV / radio): shifted far away in every dimension.
const foreignVec = holderVec.map((x) => x + 0.9)

function guestRow(id: number, features: number[], approved = true): GuestVoiceRow {
  return {
    id,
    accountEmail: 'adrian@kelion.ai',
    name: `Oaspete ${id}`,
    relation: 'prieten',
    features,
    approved,
    hasPhoto: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
  closeGuestWindow('adrian@kelion.ai')
})

describe('pragul de potrivire: acceptă titularul, respinge străinul', () => {
  it('aceeași voce (ușor zgomotoasă) trece pragul', () => {
    expect(sameSpeaker(holderAgain, holderVec)).toBe(true)
  })

  it('o voce STRĂINĂ (embeddings diverși) e respinsă', () => {
    expect(sameSpeaker(foreignVec, holderVec)).toBe(false)
  })

  it('verdictul e STRICT sub prag — exact la limită e alt vorbitor', () => {
    // Craft a vector at exactly the threshold distance: one differing
    // coordinate, sqrt(d²/DIM) = threshold → d = threshold * sqrt(DIM).
    const d = VOICE_MATCH_THRESHOLD * Math.sqrt(DIM)
    const atBoundary = holderVec.map((x, i) => (i === 0 ? x + d : x))
    expect(sameSpeaker(atBoundary, holderVec)).toBe(false)
    // …and just under it is the same speaker.
    const justUnder = holderVec.map((x, i) => (i === 0 ? x + d * 0.99 : x))
    expect(sameSpeaker(justUnder, holderVec)).toBe(true)
  })

  it('fără referință (sau fără vector) NU e niciodată potrivire', () => {
    expect(sameSpeaker(holderVec, [])).toBe(false)
    expect(sameSpeaker([], holderVec)).toBe(false)
  })
})

describe('recunoașterea oaspetelui aprobat după timbru', () => {
  it('vocea unui oaspete aprobat e recunoscută', async () => {
    mockList.mockResolvedValue([guestRow(7, holderVec)])
    const m = await matchApprovedGuest('adrian@kelion.ai', holderAgain)
    expect(m?.id).toBe(7)
    // Only APPROVED prints are ever compared (onlyApproved = true).
    expect(mockList).toHaveBeenCalledWith('adrian@kelion.ai', true)
  })

  it('un străin NU e recunoscut, oricâți oaspeți aprobați ar exista', async () => {
    mockList.mockResolvedValue([guestRow(7, holderVec), guestRow(8, holderVec.map((x) => x * 0.5))])
    expect(await matchApprovedGuest('adrian@kelion.ai', foreignVec)).toBeNull()
  })

  it('dintre mai multe potriviri sub prag câștigă cea mai apropiată', async () => {
    const farther = holderAgain.map((x) => x + 0.04)
    mockList.mockResolvedValue([guestRow(7, farther), guestRow(8, holderVec)])
    const m = await matchApprovedGuest('adrian@kelion.ai', holderAgain)
    expect(m?.id).toBe(8)
  })

  it('amprentele goale sunt sărite, nu pot produce o potrivire falsă', async () => {
    mockList.mockResolvedValue([guestRow(7, []), guestRow(8, foreignVec)])
    expect(await matchApprovedGuest('adrian@kelion.ai', holderVec)).toBeNull()
  })
})

describe('fereastra de oaspete — deschisă doar la cererea titularului', () => {
  it('allow_guest_voice fără nume e refuzat (nu deschide nicio fereastră)', async () => {
    const out = await execGuestVoiceTool('allow_guest_voice', { name: ' ', relation: 'soție' }, 'adrian@kelion.ai')
    expect(JSON.parse(out!).error).toBe('no_name')
    expect(activeGuestWindow('adrian@kelion.ai')).toBeNull()
  })

  it('allow_guest_voice cu nume deschide fereastra cu relația', async () => {
    const out = await execGuestVoiceTool(
      'allow_guest_voice',
      { name: 'Maria', relation: 'soție', minutes: 10 },
      'adrian@kelion.ai',
    )
    expect(JSON.parse(out!).ok).toBe(true)
    const w = activeGuestWindow('adrian@kelion.ai')
    expect(w?.name).toBe('Maria')
    expect(w?.relation).toBe('soție')
  })

  it('fereastra expiră singură — un oaspete neconfirmat revine la ignorat', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-07T12:00:00Z'))
    openGuestWindow('adrian@kelion.ai', 'Maria', 'soție', 1)
    expect(activeGuestWindow('adrian@kelion.ai')).not.toBeNull()
    vi.setSystemTime(new Date('2026-02-07T12:01:01Z'))
    expect(activeGuestWindow('adrian@kelion.ai')).toBeNull()
  })

  it('fereastra e per cont — alt titular nu o moștenește', () => {
    openGuestWindow('adrian@kelion.ai', 'Maria', 'soție', 10)
    expect(activeGuestWindow('altul@kelion.ai')).toBeNull()
  })
})

describe('acordul EXPLICIT al titularului (approve_guest_voice)', () => {
  it('fără amprentă în așteptare → eroare, nimic nu se salvează', async () => {
    mockPending.mockResolvedValue(null)
    const out = await execGuestVoiceTool('approve_guest_voice', { approve: true }, 'adrian@kelion.ai')
    expect(JSON.parse(out!).error).toBe('no_pending_guest')
    expect(mockDecide).not.toHaveBeenCalled()
  })

  it('approve:true păstrează amprenta DEFINITIV (cu nume și relație)', async () => {
    mockPending.mockResolvedValue(guestRow(9, foreignVec, false))
    mockDecide.mockResolvedValue(true)
    const out = await execGuestVoiceTool(
      'approve_guest_voice',
      { approve: true, name: 'Maria', relation: 'soție' },
      'adrian@kelion.ai',
    )
    expect(JSON.parse(out!).salvat).toBe(true)
    expect(mockDecide).toHaveBeenCalledWith(9, true, 'Maria', 'soție')
  })

  it('approve:false șterge amprenta neconfirmată', async () => {
    mockPending.mockResolvedValue(guestRow(9, foreignVec, false))
    mockDecide.mockResolvedValue(true)
    const out = await execGuestVoiceTool('approve_guest_voice', { approve: false }, 'adrian@kelion.ai')
    expect(JSON.parse(out!).salvat).toBe(false)
    expect(mockDecide).toHaveBeenCalledWith(9, false, undefined, undefined)
  })

  it('acordul e un boolean LITERAL — „true" ca string NU aprobă (șterge)', async () => {
    // The model's JSON sometimes arrives with "true" as a string. Consent to
    // keep a voiceprint forever must be unambiguous: anything that is not the
    // literal boolean true is a refusal.
    mockPending.mockResolvedValue(guestRow(9, foreignVec, false))
    mockDecide.mockResolvedValue(true)
    const out = await execGuestVoiceTool('approve_guest_voice', { approve: 'true' }, 'adrian@kelion.ai')
    expect(JSON.parse(out!).salvat).toBe(false)
    expect(mockDecide).toHaveBeenCalledWith(9, false, undefined, undefined)
  })

  it('după decizie fereastra se închide', async () => {
    openGuestWindow('adrian@kelion.ai', 'Maria', 'soție', 10)
    mockPending.mockResolvedValue(guestRow(9, foreignVec, false))
    mockDecide.mockResolvedValue(true)
    await execGuestVoiceTool('approve_guest_voice', { approve: true }, 'adrian@kelion.ai')
    expect(activeGuestWindow('adrian@kelion.ai')).toBeNull()
  })
})

describe('uitarea oaspeților', () => {
  it('forget_guest fără nume e refuzat', async () => {
    const out = await execGuestVoiceTool('forget_guest', {}, 'adrian@kelion.ai')
    expect(JSON.parse(out!).error).toBe('no_name')
    expect(mockForget).not.toHaveBeenCalled()
  })

  it('forget_guest cu nume șterge amprentele acelui oaspete', async () => {
    mockForget.mockResolvedValue(2)
    const out = await execGuestVoiceTool('forget_guest', { name: 'Maria' }, 'adrian@kelion.ai')
    expect(JSON.parse(out!).sterse).toBe(2)
    expect(mockForget).toHaveBeenCalledWith('adrian@kelion.ai', 'Maria')
  })

  it('unealtă necunoscută → null (nu e treaba acestui modul)', async () => {
    expect(await execGuestVoiceTool('get_weather', {}, 'adrian@kelion.ai')).toBeNull()
  })
})
