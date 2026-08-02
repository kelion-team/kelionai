// MINI MARKDOWN for the monitor (Adrian, Aug 2: "the monitor still can't run
// every format the skills provide"). .md files used to show as raw text;
// now they render formatted. No dependency (the bundle stays lean) — a tiny,
// SAFE renderer: the source is HTML-escaped FIRST, then the markdown patterns
// become tags, so nothing injected can ever execute. Supported: headings,
// bold/italic, inline code + code fences, links (http/https only), lists, hr.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}

export function renderMarkdown(src: string): string {
  const lines = escapeHtml(src).split('\n')
  const out: string[] = []
  let inCode = false
  let inList = false
  const closeList = (): void => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }
  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inCode) out.push('</code></pre>')
      else {
        closeList()
        out.push('<pre class="md-code"><code>')
      }
      inCode = !inCode
      continue
    }
    if (inCode) {
      out.push(line + '\n')
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      closeList()
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      continue
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inline(line.replace(/^\s*([-*+]|\d+\.)\s+/, ''))}</li>`)
      continue
    }
    closeList()
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      out.push('<hr>')
    } else if (line.trim() === '') {
      out.push('')
    } else {
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  if (inCode) out.push('</code></pre>')
  closeList()
  return out.join('\n')
}
