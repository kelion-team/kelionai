// ── SERPER — the web search the key was paid for ─────────────────────────────
//
// Serper is the single server-side search integration. These tests pin the JSON
// the brain receives (pure, no network),
// the same pattern as composePlace in geocode.test.ts.
import { describe, it, expect } from 'vitest'
import { composeSerperResult } from './google.js'

describe('composeSerperResult — the Serper page → the brain JSON', () => {
  it('returns the answerBox, organic results and source=serper', () => {
    const out = composeSerperResult(
      {
        answerBox: { answer: 'București' },
        organic: [
          { title: 'A', link: 'https://a.ro', snippet: 'sa' },
          { title: 'B', link: 'https://b.ro', snippet: 'sb' },
        ],
      },
      8,
    )
    expect(out).not.toBeNull()
    const j = JSON.parse(out!) as {
      answer: string
      results: { title: string; link: string; snippet: string }[]
      source: string
    }
    expect(j.source).toBe('serper')
    expect(j.answer).toBe('București')
    expect(j.results).toHaveLength(2)
    expect(j.results[0]).toEqual({ title: 'A', link: 'https://a.ro', snippet: 'sa' })
  })

  it('caps the organic results at the requested n', () => {
    const organic = Array.from({ length: 12 }, (_, i) => ({
      title: `T${i}`,
      link: `https://x.ro/${i}`,
      snippet: `s${i}`,
    }))
    const j = JSON.parse(composeSerperResult({ organic }, 3)!) as { results: unknown[] }
    expect(j.results).toHaveLength(3)
  })

  it('returns null on an EMPTY page so webSearch answers an honest search_unavailable', () => {
    expect(composeSerperResult({}, 8)).toBeNull()
    expect(composeSerperResult({ organic: [] }, 8)).toBeNull()
    // An organic hit WITHOUT a link is useless — still empty.
    expect(composeSerperResult({ organic: [{ title: 'x', snippet: 'y' }] }, 8)).toBeNull()
  })

  it('keeps the knowledge graph, people-also-ask, news and related searches', () => {
    const j = JSON.parse(
      composeSerperResult(
        {
          knowledgeGraph: { title: 'România', type: 'Country', description: 'Țară în UE', descriptionLink: 'https://w.ro' },
          peopleAlsoAsk: [{ question: 'Ce capitală are?', snippet: 'București', link: 'https://q.ro' }],
          topStories: [{ title: 'Știre', link: 'https://s.ro', source: 'Digi24', date: 'acum 1 oră' }],
          relatedSearches: [{ query: 'romania populatie' }],
          organic: [{ title: 'A', link: 'https://a.ro' }],
        },
        8,
      )!,
    ) as {
      knowledge_graph: { title: string; description: string }
      people_also_ask: { question: string; answer: string }[]
      news: { title: string; source: string }[]
      related_searches: string[]
    }
    expect(j.knowledge_graph.title).toBe('România')
    expect(j.people_also_ask[0]).toEqual({ question: 'Ce capitală are?', answer: 'București', link: 'https://q.ro' })
    expect(j.news[0].source).toBe('Digi24')
    expect(j.related_searches).toEqual(['romania populatie'])
  })

  it('never carries the API key or guessed fields into the output', () => {
    const out = composeSerperResult({ answerBox: { answer: 'x' } }, 8)!
    expect(out).not.toMatch(/api[-_]?key/i)
    const j = JSON.parse(out) as Record<string, unknown>
    expect(j.knowledge_graph).toBeUndefined()
    expect(j.people_also_ask).toEqual([])
    expect(j.news).toEqual([])
    expect(j.related_searches).toEqual([])
  })
})
