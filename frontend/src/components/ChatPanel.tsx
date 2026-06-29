import { useEffect, useRef, useState } from 'react'
import { streamChat, type ChatMessage } from '../lib/chat'

export default function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages([...next, { role: 'assistant', content: '' }])
    setBusy(true)
    try {
      let acc = ''
      for await (const chunk of streamChat(next)) {
        acc += chunk
        setMessages([...next, { role: 'assistant', content: acc }])
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Eroare.'
      setMessages([...next, { role: 'assistant', content: `⚠️ ${msg}` }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={scrollRef}>
        {messages.length === 0 && (
          <p className="chat-hint">Scrie-i lui Kelion ceva…</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.content || (busy && i === messages.length - 1 ? '…' : '')}
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder="Scrie un mesaj…"
          disabled={busy}
        />
        <button type="button" onClick={() => void send()} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  )
}
