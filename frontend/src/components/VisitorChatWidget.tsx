import { useEffect, useRef, useState } from 'react'

// Live chat widget for anonymous visitors on the landing page. A floating button
// opens a small panel; the visitor talks to the OWNER (not the AI). Both sides
// poll — the visitor here, the owner from the admin inbox. The thread is a random
// conv_id kept in localStorage so it survives a refresh.

interface Msg {
  id: number
  role: string
  text: string
}

function convId(): string {
  let id = localStorage.getItem('kelion_chat_conv')
  if (!id) {
    id = `v_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
    localStorage.setItem('kelion_chat_conv', id)
  }
  return id
}

export default function VisitorChatWidget() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const lastId = useRef(0)
  const conv = useRef('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    conv.current = convId()
  }, [])

  // Poll for new messages while the panel is open (every 3s).
  useEffect(() => {
    if (!open) return
    let alive = true
    const tick = async (): Promise<void> => {
      try {
        const r = await fetch(
          `/api/visitor-chat/poll?conv=${encodeURIComponent(conv.current)}&after=${lastId.current}`,
        )
        if (!r.ok) return
        const j = (await r.json()) as { messages: Msg[] }
        if (alive && j.messages.length > 0) {
          setMsgs((m) => [...m, ...j.messages])
          lastId.current = j.messages[j.messages.length - 1].id
        }
      } catch {
        /* ignore */
      }
    }
    void tick()
    const iv = window.setInterval(() => void tick(), 3000)
    return () => {
      alive = false
      window.clearInterval(iv)
    }
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  async function send(): Promise<void> {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    try {
      const r = await fetch('/api/visitor-chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conv: conv.current, text: t }),
      })
      if (r.ok) {
        const j = (await r.json()) as { id: number }
        setMsgs((m) => [...m, { id: j.id, role: 'visitor', text: t }])
        lastId.current = Math.max(lastId.current, j.id)
        setText('')
      }
    } catch {
      /* ignore */
    }
    setSending(false)
  }

  return (
    <div className="vchat">
      {open && (
        <div className="vchat-panel">
          <div className="vchat-head">
            <span>Message us — we reply live</span>
            <button type="button" className="vchat-x" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="vchat-log">
            {msgs.length === 0 && (
              <p className="vchat-hint">Hi! Leave us a message and we'll reply as soon as we can.</p>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={`vchat-bubble ${m.role === 'owner' ? 'owner' : 'me'}`}>
                {m.text}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="vchat-row">
            <input
              className="vchat-input"
              value={text}
              placeholder="Your message…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send()
              }}
            />
            <button type="button" className="vchat-send" onClick={() => void send()} disabled={sending}>
              ↑
            </button>
          </div>
        </div>
      )}
      <button type="button" className="vchat-fab" onClick={() => setOpen((o) => !o)} aria-label="Chat">
        {open ? '×' : '💬'}
      </button>
    </div>
  )
}
