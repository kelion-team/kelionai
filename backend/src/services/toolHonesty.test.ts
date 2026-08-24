// ── TOOL HONESTY (hardcoding audit): a tool answers with REAL data or an
// HONEST error — never prefabricated data dressed up as live. ────────────────
//
// What is pinned here:
//  1. youtube_search distinguishes "the search backend failed"
//     (search_unavailable) from "no playable videos" (not_found) — the old
//     code merged them and the brain would claim no videos exist when the
//     search never ran.
//  2. translateMany counts the messages it could NOT translate (returned as
//     the original text) in `failed`, so a half-failed translation is never
//     mistaken for a complete one.
import { describe, it, expect, vi, afterEach } from 'vitest'

const rationeaza = vi.hoisted(() => vi.fn())
vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>()
  return {
    ...actual,
    config: {
      ...actual.config,
      serperKey: 'test-serper-key',
      openai: { ...actual.config.openai, key: 'test-openai-key' },
    },
  }
})
vi.mock('./creierRationament.js', () => ({ rationeaza }))

import {
  extractYoutubeCandidates,
  translateMany,
  youtubeSearch,
} from './google.js'

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
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // youtube_search makes two kinds of network call: Serper's /videos search and
  // YouTube's oEmbed playability probe. Route them by URL so each test drives
  // the whole Serper path without touching the real network.
  const stubNetwork = (opts: {
    serper: { ok: boolean; videos?: { title?: string; link?: string }[] }
    oembedOk?: boolean
  }): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).includes('google.serper.dev/videos')) {
          return { ok: opts.serper.ok, json: async () => ({ videos: opts.serper.videos ?? [] }) } as Response
        }
        // youtube.com/oembed — the live playability probe.
        return { ok: Boolean(opts.oembedOk) } as Response
      }),
    )
  }

  it('answers search_unavailable when the Serper videos search returns nothing / non-ok', async () => {
    stubNetwork({ serper: { ok: false } })
    const out = JSON.parse(await youtubeSearch('relaxing music', 5)) as { error?: string; not_found?: boolean }
    expect(out.error).toBe('search_unavailable')
    expect(out.not_found).toBeUndefined()
  })

  it('answers not_found when Serper returns a clip but no clip survives the live playability check', async () => {
    // Serper gives one YouTube link, but oEmbed says it does not exist / is not embeddable.
    stubNetwork({
      serper: { ok: true, videos: [{ title: 'Song', link: 'https://www.youtube.com/watch?v=eeeeeeeeeee' }] },
      oembedOk: false,
    })
    const out = JSON.parse(await youtubeSearch('relaxing music', 5)) as { videos: unknown[]; not_found?: boolean; error?: string }
    expect(out.error).toBeUndefined()
    expect(out.not_found).toBe(true)
    expect(out.videos).toEqual([])
  })

  it('returns only clips the live oEmbed check proves playable', async () => {
    stubNetwork({
      serper: { ok: true, videos: [{ title: 'Song', link: 'https://www.youtube.com/watch?v=fffffffffff' }] },
      oembedOk: true,
    })
    const out = JSON.parse(await youtubeSearch('relaxing music', 5)) as {
      videos: { title: string; link: string }[]
      screen_url?: string
    }
    expect(out.videos).toHaveLength(1)
    expect(out.screen_url).toContain('https://www.youtube.com/embed/fffffffffff')
  })
})

describe('translateMany — a failed translation is counted, never silent', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    rationeaza.mockReset()
  })

  const stubTranslation = (mode: 'ok' | 'empty' | 'reject'): void => {
    if (mode === 'reject') rationeaza.mockRejectedValue(new Error('network down'))
    else rationeaza.mockResolvedValue(mode === 'ok' ? 'Salut' : '')
  }

  it('counts every message the translation service failed for (original returned)', async () => {
    // The provider answers with EMPTY text → translateText errors → original kept.
    stubTranslation('empty')
    const r = await translateMany(['Hello', 'World'], 'Romanian')
    expect(r.translations).toEqual(['Hello', 'World'])
    expect(r.failed).toBe(2)
  })

  it('reports failed:0 when everything translated, and keeps the real translations', async () => {
    stubTranslation('ok')
    const r = await translateMany(['Hello', 'Hi'], 'Romanian')
    expect(r.translations).toEqual(['Salut', 'Salut'])
    expect(r.failed).toBe(0)
  })

  it('does not count empty input messages as failures (there was nothing to translate)', async () => {
    stubTranslation('empty')
    const r = await translateMany(['', 'Hello'], 'Romanian')
    expect(r.translations).toEqual(['', 'Hello'])
    expect(r.failed).toBe(1)
  })

  it('counts a rejection from the provider as a failure, not a crash', async () => {
    stubTranslation('reject')
    const r = await translateMany(['Hello'], 'Romanian')
    expect(r.translations).toEqual(['Hello'])
    expect(r.failed).toBe(1)
  })
})
