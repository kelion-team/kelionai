import { useEffect, useRef, useState } from 'react'
import { PUBLIC_TEXT } from '../lib/publicText'
import { apiFetch } from '../lib/transport'

// Live chat widget for anonymous visitors on the landing page. A floating button
// opens a small panel; the visitor talks to the OWNER (not the AI). Both sides
// poll — the visitor here, the owner from the admin inbox. Conversation identity
// is issued and kept by the server in an HttpOnly cookie; the browser never
// chooses a conversation id or persists a capability in JavaScript storage.
//
// HONESTY REWRITE (frontend audit, Aug 2). Two silent failures lived here:
//  1. a failed poll rendered the empty-state hint as fact ("no replies yet")
//     while the owner's replies existed on the server — now a small offline
//     line says the server can't be reached, and it clears on the next 200;
//  2. a failed send showed NOTHING: the button re-enabled and the text stayed,
//     indistinguishable from success — now the failure is said in the panel.
// All texts now come from PUBLIC_TEXT (logged-out surface = English by design).

interface Msg {
  id: number
  role: string
  text: string
  displayKey?: string
}

export default function VisitorChatWidget() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  // Honest states: the poll can't reach the server / the last send failed.
  const [offline, setOffline] = useState(false)
  const [sendFailed, setSendFailed] = useState(false)
  const lastId = useRef(0)
  const sessionReady = useRef(false)
  const sessionPromise = useRef<Promise<boolean> | null>(null)
  const sessionEpoch = useRef(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  const ensureSession = async (renew = false): Promise<boolean> => {
    if (renew) {
      sessionReady.current = false
      lastId.current = 0
    }
    if (sessionReady.current) return true
    if (sessionPromise.current) return sessionPromise.current
    sessionPromise.current = apiFetch('/api/visitor-chat/session', {
      method: 'POST',
      credentials: 'include',
    })
      .then((r) => {
        if (!r.ok) return false
        sessionReady.current = true
        sessionEpoch.current += 1
        return true
      })
      .catch(() => false)
      .finally(() => {
        sessionPromise.current = null
      })
    return sessionPromise.current
  }

  // Poll for new messages while the panel is open (every 3s).
  useEffect(() => {
    if (!open) return
    let alive = true
    const tick = async (retried = false): Promise<void> => {
      try {
        if (!(await ensureSession())) {
          if (alive) setOffline(true)
          return
        }
        const r = await apiFetch(
          `/api/visitor-chat/poll?after=${lastId.current}`,
          { credentials: 'include' },
        )
        if (!alive) return
        if ((r.status === 401 || r.status === 410) && !retried) {
          if (await ensureSession(true)) await tick(true)
          return
        }
        if (!r.ok) {
          setOffline(true)
          return
        }
        const j = (await r.json()) as { messages?: Msg[] }
        if (!alive) return
        setOffline(false)
        const noi = Array.isArray(j.messages) ? j.messages : []
        if (noi.length > 0) {
          const epoch = sessionEpoch.current
          setMsgs((m) => [
            ...m,
            ...noi.map((mesaj) => ({ ...mesaj, displayKey: `${epoch}:${mesaj.id}` })),
          ])
          lastId.current = noi[noi.length - 1].id
        }
      } catch {
        if (alive) setOffline(true)
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

  async function send(retried = false): Promise<void> {
    const t = text.trim()
    if (!t || (sending && !retried)) return
    setSending(true)
    setSendFailed(false)
    try {
      if (!(await ensureSession())) {
        setSendFailed(true)
        return
      }
      const r = await apiFetch('/api/visitor-chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: t }),
      })
      if ((r.status === 401 || r.status === 410) && !retried) {
        if (await ensureSession(true)) await send(true)
        else setSendFailed(true)
        return
      }
      if (r.ok) {
        const j = (await r.json()) as { ok?: boolean; id: number }
        // ȘI CORPUL, nu doar statusul HTTP (auditul admin, 3 aug): serverul
        // vechi răspundea 200 cu {ok:false, id:0} când INSERT-ul picase —
        // bula apărea „livrată" deși mesajul nu exista nicăieri și adminul
        // nu l-ar fi văzut niciodată. (Serverul dă acum 502, dar plasa rămâne.)
        if (j.ok === false || !(j.id > 0)) {
          setSendFailed(true) // the text stays in the input for a retry
        } else {
          setMsgs((m) => [
            ...m,
            { id: j.id, role: 'visitor', text: t, displayKey: `${sessionEpoch.current}:${j.id}` },
          ])
          lastId.current = Math.max(lastId.current, j.id)
          setText('')
        }
      } else {
        setSendFailed(true) // the text stays in the input for a retry
      }
    } catch {
      setSendFailed(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="vchat">
      {open && (
        <div className="vchat-panel">
          <div className="vchat-head">
            <span>{PUBLIC_TEXT.vchatHead}</span>
            <button type="button" className="vchat-x" onClick={() => setOpen(false)} aria-label={PUBLIC_TEXT.vchatClose}>
              ×
            </button>
          </div>
          <div className="vchat-log">
            {msgs.length === 0 && !offline && (
              <p className="vchat-hint">{PUBLIC_TEXT.vchatHint}</p>
            )}
            {msgs.map((m) => (
              <div key={m.displayKey ?? m.id} className={`vchat-bubble ${m.role === 'owner' ? 'owner' : 'me'}`}>
                {m.text}
              </div>
            ))}
            {offline && <p className="vchat-hint vchat-err">{PUBLIC_TEXT.vchatOffline}</p>}
            {sendFailed && <p className="vchat-hint vchat-err">{PUBLIC_TEXT.vchatSendFailed}</p>}
            <div ref={bottomRef} />
          </div>
          <div className="vchat-row">
            <input
              className="vchat-input"
              value={text}
              placeholder={PUBLIC_TEXT.vchatPlaceholder}
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
      <button type="button" className="vchat-fab" onClick={() => setOpen((o) => !o)} aria-label={PUBLIC_TEXT.vchatToggle}>
        {open ? '×' : '💬'}
      </button>
    </div>
  )
}
