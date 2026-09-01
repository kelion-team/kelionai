import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './lib/markdown'

describe('safe markdown renderer', () => {
  it('escapes raw HTML and event handlers', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)><script>alert(2)</script>')
    expect(html).toContain('&lt;img')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script>')
  })

  it('does not turn javascript or attribute-injection payloads into links', () => {
    const js = renderMarkdown('[click](javascript:alert(1))')
    expect(js).not.toContain('<a ')

    const quote = renderMarkdown('[click](https://example.com/&quot; onmouseover=&quot;alert(1))')
    expect(quote).not.toContain('<a ')
    expect(quote).not.toContain('onmouseover="')
  })

  it('keeps executable HTML inert inside code fences', () => {
    const html = renderMarkdown('```html\n<script>alert(1)</script>\n```')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})
