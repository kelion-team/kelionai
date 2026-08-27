import { useEffect, useState } from 'react'
import { adminStrings } from '../../lib/adminText'
import {
  fetchInbound,
  fetchMailboxLive,
  fetchContactMessages,
  fetchNotificari,
  markNotificareCitit,
  type MailboxLiveResult,
  type InboundEmail,
  type ContactMessage,
  type NotificareAdmin,
} from '../../lib/admin'
import { productConfig } from '../../lib/productConfig'
import { apiFetch } from '../../lib/transport'
import { ShareGrid } from './shared'
// ── INBOX tab ───────────────────────────────────────────────────────────────

export function AdminInbox() {
  const A = adminStrings()
  const [inbound, setInbound] = useState<InboundEmail[] | null | 'necitit'>('necitit')
  const [mailboxLive, setMailboxLive] = useState<MailboxLiveResult | null | 'necitit'>('necitit')
  const [mailboxLoading, setMailboxLoading] = useState(false)
  const [mailSel, setMailSel] = useState<Set<number>>(new Set())
  const [mailDelMsg, setMailDelMsg] = useState('')
  const [mailDelBusy, setMailDelBusy] = useState(false)
  const [contactMsgs, setContactMsgs] = useState<ContactMessage[] | null | 'necitit'>('necitit')

  useEffect(() => {
    setMailSel(new Set())
    setMailDelMsg('')
    void fetchInbound().then(setInbound)
    void fetchContactMessages().then(setContactMsgs)
    setMailboxLoading(true)
    void fetchMailboxLive().then((m) => { setMailboxLive(m); setMailboxLoading(false) })
  }, [])

  const mailboxData = typeof mailboxLive === 'object' && mailboxLive !== null ? mailboxLive : null
  const inboundData = Array.isArray(inbound) ? inbound : null
  const contactData = Array.isArray(contactMsgs) ? contactMsgs : null

  const toggleMailSel = (uid: number): void =>
    setMailSel((prev) => { const n = new Set(prev); if (n.has(uid)) n.delete(uid); else n.add(uid); return n })

  const stergeMailuri = (uids: number[]): void => {
    if (!uids.length || mailDelBusy) return
    if (!window.confirm(A.confirmDeleteInboxMsg(uids.length))) return
    setMailDelBusy(true)
    void apiFetch('/api/admin/mailbox-delete', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ uids }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { sterse?: number; detaliu?: string } | null) => {
        setMailDelMsg(j ? A.mailDeleteResult(j.sterse ?? 0, j.detaliu ?? '') : A.mailDeleteFailed)
        setMailSel(new Set())
        setMailboxLoading(true)
        void fetchMailboxLive().then((m) => { setMailboxLive(m); setMailboxLoading(false) })
      })
      .catch(() => setMailDelMsg(A.mailDeleteFailed))
      .finally(() => setMailDelBusy(false))
  }

  return (
    <div className="admin-tab-content">
      <div className="admin-card">
        <div className="admin-card-head admin-card-head-row">
          <span>
            📬 Cutia {productConfig.supportEmail} — DOAR folderul INBOX, citit direct din server (ultimele 40, citite sau nu). Mesajele deja procesate de Secretar stau în folderele Kelion-Answered / Kelion-ToAnswer / Kelion-Automated. Bifează și șterge — una sau mai multe odată.
          </span>
          <span className="admin-card-actions">
            {mailboxData && mailboxData.emails.length > 0 && (
              <button type="button" className="ghost" style={{ fontSize: 12 }}
                onClick={() => setMailSel((prev) => prev.size === mailboxData.emails.length ? new Set() : new Set(mailboxData.emails.map((m) => m.uid)))}>
                {mailboxData && mailSel.size === mailboxData.emails.length && mailboxData.emails.length > 0 ? 'Deselectează tot' : 'Selectează tot'}
              </button>
            )}
            {mailSel.size > 0 && (
              <button type="button" className="ghost" style={{ fontSize: 12, color: '#ff7a7a' }} disabled={mailDelBusy}
                onClick={() => stergeMailuri([...mailSel])}>
                {mailDelBusy ? '…' : `Șterge selectate (${mailSel.size})`}
              </button>
            )}
          </span>
        </div>
        {mailDelMsg && <div className="chat-hint">{mailDelMsg}</div>}
        {mailboxLoading && <p className="chat-hint">{A.readingMailbox}</p>}
        {!mailboxLoading && mailboxLive === null && (
          <p className="chat-hint" style={{ color: '#e6a23c' }}>⚠ {A.mailboxReadFail.replace('{motiv}', 'ruta serverului nu a răspuns')}</p>
        )}
        {!mailboxLoading && mailboxData && !mailboxData.ok && (
          <p className="chat-hint" style={{ color: '#e6a23c' }}>
            ⚠ {mailboxData.motiv === 'mail_neconfigurat' ? A.mailboxNotConfigured : A.mailboxReadFail.replace('{motiv}', mailboxData.motiv ?? 'motiv necunoscut')}
          </p>
        )}
        {!mailboxLoading && mailboxData?.ok && mailboxData.emails.length === 0 && <p className="chat-hint">{A.mailboxEmpty}</p>}
        {(mailboxData?.emails ?? []).map((m) => (
          <div className="inbox-item" key={m.uid}>
            <div className="inbox-top">
              <span className="inbox-from" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={mailSel.has(m.uid)} onChange={() => toggleMailSel(m.uid)} title="Selectează pentru ștergere" />
                {m.fromName ? `${m.fromName} <${m.from}>` : m.from || '(expeditor necunoscut)'}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span className={`inbox-flag ${m.seen ? 'ok' : 'wait'}`}>{m.seen ? 'citit' : '● necitit'}</span>
                <button type="button" className="ghost" style={{ fontSize: 12, color: '#ff7a7a' }} disabled={mailDelBusy}
                  onClick={() => stergeMailuri([m.uid])} title="Șterge acest mesaj">✕</button>
              </span>
            </div>
            <div className="inbox-subj">{m.subject || '(fără subiect)'}</div>
            <div className="chat-hint">{new Date(m.date).toLocaleString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        ))}
      </div>

      <div className="admin-card">
        <div className="admin-card-head">Mesaje din formularul „Contact" — salvate MEREU aici, chiar dacă emailul (MAIL_PASS) nu e configurat. Niciun mesaj nu se mai pierde.</div>
        {contactMsgs === 'necitit' && <p className="chat-hint">{A.loading}</p>}
        {contactMsgs === null && <p className="chat-hint" style={{ color: '#e6a23c' }}>⚠ Nu am putut citi mesajele de contact — citire eșuată (posibil sesiune expirată), nu listă goală.</p>}
        {contactData && contactData.length === 0 && <p className="chat-hint">{A.noContactMessagesYet}</p>}
        {(contactData ?? []).map((m) => (
          <div className="inbox-item" key={m.id}>
            <div className="inbox-top">
              <span className="inbox-from">{m.name || '(fără nume)'} &lt;{m.email}&gt;</span>
              <span className={`inbox-flag ${m.emailed ? 'ok' : 'wait'}`}>{m.emailed ? '✉️ redirecționat pe email' : '📥 doar salvat (trimiterea a picat sau email off)'}</span>
            </div>
            <div className="inbox-subj">{m.department ? `[${m.department}] ` : ''}{m.subject || '(fără subiect)'}</div>
            <div className="inbox-body">{m.message.slice(0, 500)}</div>
            <div className="chat-hint">{new Date(m.created_at).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        ))}
      </div>

      <div className="admin-card">
        <div className="admin-card-head">Inbox {productConfig.supportEmail} — emailurile PRIMITE și răspunsul redactat automat de Secretar (row 19). Se citesc la fiecare 3 minute.</div>
        {inbound === 'necitit' && <p className="chat-hint">{A.loading}</p>}
        {inbound === null && <p className="chat-hint" style={{ color: '#e6a23c' }}>⚠ Nu am putut citi scrisorile — citire eșuată (posibil sesiune expirată), nu listă goală.</p>}
        {inboundData && inboundData.length === 0 && <p className="chat-hint">{A.noLettersYet}</p>}
        {(inboundData ?? []).map((m) => (
          <div className="inbox-item" key={m.id}>
            <div className="inbox-top">
              <span className="inbox-from">{m.from_name || m.from_addr}</span>
              <span className={`inbox-flag ${m.replied ? 'ok' : 'wait'}`}>{m.replied ? '✅ răspuns trimis' : '⏳ fără răspuns'}</span>
            </div>
            <div className="inbox-subj">{m.subject || '(fără subiect)'}</div>
            {m.body && <div className="inbox-body">{m.body.slice(0, 300)}</div>}
            {m.reply && <div className="inbox-reply"><b>{A.reply}</b> {m.reply.slice(0, 300)}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── NOTIFICARI tab ──────────────────────────────────────────────────────────

export function AdminNotificari() {
  const [notificari, setNotificari] = useState<NotificareAdmin[] | null | 'necitit'>('necitit')

  const loadNotificari = (): void => { fetchNotificari().then((n) => setNotificari(n)) }

  useEffect(() => {
    loadNotificari()
    const id = window.setInterval(loadNotificari, 20000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="admin-tab-content">
      <div className="admin-card">
        <div className="admin-card-head">Notificări — cereri noi care cer atenția ta (plată neatribuită, cerere neacoperită).</div>
        {notificari === 'necitit' && <p className="chat-hint">Se încarcă…</p>}
        {notificari === null && <p className="chat-hint" style={{ color: '#e6a23c' }}>⚠ Nu pot citi notificările — citirea a eșuat (NU înseamnă „zero"). Reîncerc automat la 20s.</p>}
        {Array.isArray(notificari) && notificari.length === 0 && <p className="chat-hint" style={{ marginTop: 8 }}>Nicio cerere nouă. 🎉</p>}
        {Array.isArray(notificari) && notificari.map((n) => (
          <div key={n.id} className="admin-notif-row" style={{ opacity: n.read ? 0.55 : 1 }}>
            <div className="admin-notif-head">
              {!n.read && <span className="admin-notif-dot" aria-hidden />}
              <span className="admin-notif-title">{n.title}</span>
              <span className="chat-hint" style={{ fontSize: 12 }}>{n.type}</span>
              {!n.read && (
                <button type="button" className="ghost" style={{ marginLeft: 'auto', fontSize: 12, padding: '2px 8px' }}
                  onClick={async () => { if (await markNotificareCitit(n.id)) loadNotificari() }}>
                  Marchează citit
                </button>
              )}
            </div>
            <div style={{ marginTop: 3 }}>{n.message}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── SHARE tab ───────────────────────────────────────────────────────────────

const SHARE_TEXT_IMPLICIT =
  'Ți-l prezint pe Kelion — asistentul meu AI cu avatar și voce: vede, aude și vorbește, în orice limbă. Contul e gratuit și îl faci în 30 de secunde:'

export function AdminShare() {
  const A = adminStrings()
  const [shareText, setShareText] = useState<string>(() => {
    try { return window.localStorage.getItem('kelionai:share-text') || SHARE_TEXT_IMPLICIT }
    catch { return SHARE_TEXT_IMPLICIT }
  })
  const [copied, setCopied] = useState(false)

  const salveazaShareText = (t: string): void => {
    setShareText(t)
    try { window.localStorage.setItem('kelionai:share-text', t) } catch { /* privat/incognito */ }
  }

  const url = productConfig.publicAppOrigin
  const text = shareText.trim() || SHARE_TEXT_IMPLICIT
  const enc = encodeURIComponent
  const links: { name: string; href: string }[] = [
    { name: 'X (Twitter)', href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}` },
    { name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}&quote=${enc(text)}` },
    { name: 'WhatsApp', href: `https://wa.me/?text=${enc(`${text} ${url}`)}` },
    { name: 'Telegram', href: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}` },
    { name: 'LinkedIn (doar linkul)', href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}` },
    { name: 'Reddit', href: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(text)}` },
  ]
  const uploads: { name: string; href: string }[] = [
    { name: 'TikTok — încarcă clip', href: 'https://www.tiktok.com/tiktokstudio/upload' },
    { name: 'Instagram', href: 'https://www.instagram.com/' },
    { name: 'YouTube Studio', href: 'https://studio.youtube.com/' },
    { name: 'Facebook Reels', href: 'https://www.facebook.com/reels/create' },
  ]

  return (
    <div className="admin-tab-content">
      <div className="admin-card">
        <div className="admin-card-head">{A.appLink}</div>
        <div className="share-row">
          <code className="share-url">{url}</code>
          <button type="button" className="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(`${text} ${url}`)
                .then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800) })
                .catch(() => { setCopied(false); window.alert('Nu s-a putut copia (browserul a refuzat clipboard-ul) — copiază manual textul.') })
            }}>
            {copied ? 'Copiat ✓' : 'Copiază text + link'}
          </button>
          {'share' in navigator && (
            <button type="button" className="ghost"
              onClick={() => void navigator.share({ title: 'Kelionai', text, url }).catch(() => {})}>
              Distribuie…
            </button>
          )}
        </div>
      </div>
      <div className="admin-card">
        <div className="admin-card-head">Mesajul tău de prezentare — îl scrii o dată, îl folosesc toate butoanele de mai jos. Se salvează în browserul ăsta.</div>
        <textarea className="admin-input" style={{ width: '100%', minHeight: 64, resize: 'vertical' }}
          value={shareText} onChange={(e) => salveazaShareText(e.target.value)} placeholder={SHARE_TEXT_IMPLICIT} />
        {shareText !== SHARE_TEXT_IMPLICIT && (
          <button type="button" className="ghost" style={{ fontSize: 12, marginTop: 6 }}
            onClick={() => salveazaShareText(SHARE_TEXT_IMPLICIT)}>
            Revino la mesajul standard
          </button>
        )}
      </div>
      <ShareGrid title={A.shareOnSocial} items={links} />
      <div className="admin-card">
        <div className="admin-card-head">
          Clipul promo — fluxul real, pas cu pas: (1) îi ceri lui Kelion în chat „pregătește clipul promo" — îl compune și ți-l salvează în Downloads; (2) deschizi studioul platformei de mai jos; (3) urci clipul din Downloads acolo. Butoanele DOAR deschid studiourile — nicio platformă nu permite încărcare automată din afară.
        </div>
      </div>
      <ShareGrid title={A.videoPlatforms} items={uploads} />
    </div>
  )
}
