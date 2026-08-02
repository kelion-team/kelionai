// ── TOOL HONESTY (hardcoding audit): a tool answers with REAL data or an
// HONEST error — never prefabricated data dressed up as live. ────────────────
//
// What is pinned here:
//  1. The web_search OpenRouter FALLBACK is clearly marked as a degraded
//     fallback (source + fallback:true + an explanatory note), and an answer
//     without any cited source is flagged as unverified — the brain can never
//     present it as the full Serper search.
//  2. youtube_search distinguishes "the search backend failed"
//     (search_unavailable) from "no playable videos" (not_found) — the old
//     code merged them and the brain would claim no videos exist when the
//     search never ran.
//  3. translateMany counts the messages it could NOT translate (returned as
//     the original text) in `failed`, so a half-failed translation is never
//     mistaken for a complete one.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// No keys, no network: translateText must take the OpenRouter path, which we
// mock below. google.ts only reads config inside functions, so a minimal
// shape is enough.
vi.mock('../config.js', () => ({
  config: {
    google: { clientId: '', clientSecret: '' },
    serperKey: '',
    geminiKey: '',
    geminiModel: 'test-model',
    openrouter: { key: 'test-key', searchModel: 'test-search-model' },
  },
}))

const openrouterComplete = vi.fn()
const openrouterWebSearch = vi.fn()
vi.mock('./openrouter.js', () => ({
  openrouterComplete: (...a: unknown[]) => openrouterComplete(...a),
  openrouterWebSearch: (...a: unknown[]) => openrouterWebSearch(...a),
}))

import {
  composeOpenrouterFallback,
  extractYoutubeCandidates,
  translateMany,
  youtubeSearch,
} from './google.js'

describe('composeOpenrouterFallback — the web_search fallback is clearly marked', () => {
  it('returns null when there is NOTHING (no text, no sources) → honest search_unavailable', () => {
    expect(composeOpenrouterFallback('', [], 8)).toBeNull()
  })

  it('marks fallback:true and source:openrouter, with a note that the extras are missing', () => {
    const out = composeOpenrouterFallback(
      'Răspuns',
      [{ title: 'A', url: 'https://a.ro' }],
      8,
    )!
    const j = JSON.parse(out) as {
      answer: string
      results: { title: string; link: string }[]
      source: string
      fallback: boolean
      uncited_sources?: boolean
      note: string
    }
    expect(j.source).toBe('openrouter')
    expect(j.fallback).toBe(true)
    expect(j.note).toMatch(/FALLBACK/)
    expect(j.note).toMatch(/no knowledge graph/i)
    expect(j.results).toEqual([{ title: 'A', link: 'https://a.ro', snippet: '' }])
    // With cited sources present, the answer is NOT flagged as uncited.
    expect(j.uncited_sources).toBeUndefined()
  })

  it('flags an answer with NO cited sources as unverified (it may be model memory)', () => {
    const out = composeOpenrouterFallback('Doar text, fără surse', [], 8)!
    const j = JSON.parse(out) as { uncited_sources?: boolean; note: string }
    expect(j.uncited_sources).toBe(true)
    expect(j.note).toMatch(/NO cited sources/)
  })

  it('caps the links at the requested n', () => {
    const sources = Array.from({ length: 10 }, (_, i) => ({ title: `T${i}`, url: `https://x.ro/${i}` }))
    const j = JSON.parse(composeOpenrouterFallback('', sources, 3)!) as { results: unknown[] }
    expect(j.results).toHaveLength(3)
  })
})

describe('extractYoutubeCandidates — only real YouTube links, deduplicated', () => {
  it('collects watch links from citations and from "Title — URL" lines', () => {
    const vids = extractYoutubeCandidates(
      'Song A — https://www.youtube.com/watch?v=aaaaaaaaaaa\nSong B — https://youtu.be/bbbbbbbbbbb',
      [{ title: 'Cited', url: 'https://www.youtube.com/watch?v=ccccccccccc' }],
    )
    const links = vids.map((v) => v.link)
    expect(links).toContain('https://www.youtube.com/watch?v=ccccccccccc')
    expect(links).toContain('https://www.youtube.com/watch?v=aaaaaaaaaaa')
    expect(links).toContain('https://youtu.be/bbbbbbbbbbb')
  })

  it('ignores non-YouTube links and deduplicates', () => {
    const vids = extractYoutubeCandidates('x', [
      { title: 'Blog', url: 'https://blog.ro/post' },
      { title: 'YT', url: 'https://www.youtube.com/watch?v=ddddddddddd' },
      { title: 'YT again', url: 'https://www.youtube.com/watch?v=ddddddddddd' },
    ])
    expect(vids).toHaveLength(1)
    expect(vids[0].title).toBe('YT')
  })
})

describe('youtubeSearch — backend-down is NOT "no videos found"', () => {
  beforeEach(() => {
    openrouterWebSearch.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('answers search_unavailable when the search backend returns nothing at all', async () => {
    openrouterWebSearch.mockResolvedValue({ text: '', sources: [], costUsd: 0 })
    const out = JSON.parse(await youtubeSearch('relaxing music', 5)) as { error?: string; not_found?: boolean }
    expect(out.error).toBe('search_unavailable')
    expect(out.not_found).toBeUndefined()
  })

  it('answers not_found when the search ran but no clip survives the live playability check', async () => {
    openrouterWebSearch.mockResolvedValue({
      text: 'Song — https://www.youtube.com/watch?v=eeeeeeeeeee',
      sources: [],
      costUsd: 0,
    })
    // oEmbed says the clip does not exist / is not embeddable.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as Response))
    const out = JSON.parse(await youtubeSearch('relaxing music', 5)) as { videos: unknown[]; not_found?: boolean; error?: string }
    expect(out.error).toBeUndefined()
    expect(out.not_found).toBe(true)
    expect(out.videos).toEqual([])
  })

  it('returns only clips the live oEmbed check proves playable', async () => {
    openrouterWebSearch.mockResolvedValue({
      text: 'Song — https://www.youtube.com/watch?v=fffffffffff',
      sources: [],
      costUsd: 0,
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response))
    const out = JSON.parse(await youtubeSearch('relaxing music', 5)) as {
      videos: { title: string; link: string }[]
      screen_url?: string
    }
    expect(out.videos).toHaveLength(1)
    expect(out.screen_url).toContain('https://www.youtube.com/embed/fffffffffff')
  })
})

describe('translateMany — a failed translation is counted, never silent', () => {
  beforeEach(() => {
    openrouterComplete.mockReset()
  })

  it('counts every message the translation service failed for (original returned)', async () => {
    // The provider answers with EMPTY text → translateText errors → original kept.
    openrouterComplete.mockResolvedValue({ text: '', costUsd: 0, model: 'm' })
    const r = await translateMany(['Hello', 'World'], 'Romanian')
    expect(r.translations).toEqual(['Hello', 'World'])
    expect(r.failed).toBe(2)
  })

  it('reports failed:0 when everything translated, and keeps the real translations', async () => {
    openrouterComplete.mockResolvedValue({ text: 'Salut', costUsd: 0, model: 'm' })
    const r = await translateMany(['Hello', 'Hi'], 'Romanian')
    expect(r.translations).toEqual(['Salut', 'Salut'])
    expect(r.failed).toBe(0)
  })

  it('does not count empty input messages as failures (there was nothing to translate)', async () => {
    openrouterComplete.mockResolvedValue({ text: '', costUsd: 0, model: 'm' })
    const r = await translateMany(['', 'Hello'], 'Romanian')
    expect(r.translations).toEqual(['', 'Hello'])
    expect(r.failed).toBe(1)
  })

  it('counts a rejection from the provider as a failure, not a crash', async () => {
    openrouterComplete.mockRejectedValue(new Error('network down'))
    const r = await translateMany(['Hello'], 'Romanian')
    expect(r.translations).toEqual(['Hello'])
    expect(r.failed).toBe(1)
  })
})
