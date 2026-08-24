import { useRef, useState } from 'react'
import { LANG_OPTIONS } from '../lib/langList'
import { productConfig } from '../lib/productConfig'
import { apiFetch } from '../lib/transport'
import { createRetryIdempotencyLease } from '../lib/retryIdempotency'

// The public contact form. A language selector offers EVERY language; the
// chosen one is the language Kelion replies in. The form's own labels are
// translated for the languages we ship full strings for, and fall back to
// English for the rest — but the reply always comes in the selected language.
// Default English.
type Lang = string

interface Strings {
  title: string
  sub: string
  lang: string
  dept: string
  depts: string[]
  name: string
  namePh: string
  email: string
  emailPh: string
  subject: string
  subjectPh: string
  message: string
  messagePh: string
  secure: string
  send: string
  sending: string
  sentTitle: string
  sentBody: string
  close: string
  errEmail: string
  errSend: string
}

const T: Record<Lang, Strings> = {
  en: {
    title: 'Contact us',
    sub: 'Write to us in any language — we reply in yours.',
    lang: 'Language',
    dept: 'Department',
    depts: ['General enquiry', 'Support', 'Sales', 'Press and media', 'Legal'],
    name: 'Your name',
    namePh: 'Jonathan Whitfield',
    email: 'Your email',
    emailPh: 'name@example.com',
    subject: 'Subject',
    subjectPh: 'A brief line about your enquiry',
    message: 'Message',
    messagePh: 'Dear Kelionai,',
    secure: `Sent securely to ${productConfig.supportEmail}`,
    send: 'Send message',
    sending: 'Sending…',
    sentTitle: 'Thank you',
    sentBody: 'Your message is stored securely for the support team.',
    close: 'Close',
    errEmail: 'Please enter a valid email and a message.',
    errSend: 'Could not send — the server did not confirm. Please try again.',
  },
  ro: {
    title: 'Contact',
    sub: 'Scrie-ne în orice limbă — răspundem în limba ta.',
    lang: 'Limba',
    dept: 'Departament',
    depts: ['Întrebare generală', 'Suport', 'Vânzări', 'Presă și media', 'Juridic'],
    name: 'Numele tău',
    namePh: 'Ion Popescu',
    email: 'Emailul tău',
    emailPh: 'nume@exemplu.com',
    subject: 'Subiect',
    subjectPh: 'Un rând scurt despre solicitare',
    message: 'Mesaj',
    messagePh: 'Dragă Kelionai,',
    secure: `Trimis securizat la ${productConfig.supportEmail}`,
    send: 'Trimite mesajul',
    sending: 'Se trimite…',
    sentTitle: 'Mulțumim',
    sentBody: 'Mesajul tău este stocat în siguranță pentru echipa de suport.',
    close: 'Închide',
    errEmail: 'Introdu un email valid și un mesaj.',
    errSend: 'Nu s-a putut trimite — serverul n-a confirmat. Încearcă din nou.',
  },
  fr: {
    title: 'Contactez-nous',
    sub: 'Écrivez-nous dans n’importe quelle langue — nous répondons dans la vôtre.',
    lang: 'Langue',
    dept: 'Département',
    depts: ['Demande générale', 'Assistance', 'Ventes', 'Presse et médias', 'Juridique'],
    name: 'Votre nom',
    namePh: 'Jean Dupont',
    email: 'Votre e-mail',
    emailPh: 'nom@exemple.com',
    subject: 'Objet',
    subjectPh: 'Une brève ligne sur votre demande',
    message: 'Message',
    messagePh: 'Cher Kelionai,',
    secure: `Envoyé en toute sécurité à ${productConfig.supportEmail}`,
    send: 'Envoyer le message',
    sending: 'Envoi…',
    sentTitle: 'Merci',
    sentBody: 'Votre message est conservé en toute sécurité pour l’équipe d’assistance.',
    close: 'Fermer',
    errEmail: 'Veuillez saisir un e-mail valide et un message.',
    errSend: 'Échec de l’envoi — le serveur n’a pas confirmé. Réessayez.',
  },
  es: {
    title: 'Contáctanos',
    sub: 'Escríbenos en cualquier idioma — respondemos en el tuyo.',
    lang: 'Idioma',
    dept: 'Departamento',
    depts: ['Consulta general', 'Soporte', 'Ventas', 'Prensa y medios', 'Legal'],
    name: 'Tu nombre',
    namePh: 'Juan Pérez',
    email: 'Tu correo',
    emailPh: 'nombre@ejemplo.com',
    subject: 'Asunto',
    subjectPh: 'Una breve línea sobre tu consulta',
    message: 'Mensaje',
    messagePh: 'Estimado Kelionai,',
    secure: `Enviado de forma segura a ${productConfig.supportEmail}`,
    send: 'Enviar mensaje',
    sending: 'Enviando…',
    sentTitle: 'Gracias',
    sentBody: 'Tu mensaje se ha guardado de forma segura para el equipo de soporte.',
    close: 'Cerrar',
    errEmail: 'Introduce un correo válido y un mensaje.',
    errSend: 'No se pudo enviar — el servidor no confirmó. Inténtalo de nuevo.',
  },
  de: {
    title: 'Kontakt',
    sub: 'Schreiben Sie uns in jeder Sprache — wir antworten in Ihrer.',
    lang: 'Sprache',
    dept: 'Abteilung',
    depts: ['Allgemeine Anfrage', 'Support', 'Vertrieb', 'Presse und Medien', 'Rechtliches'],
    name: 'Ihr Name',
    namePh: 'Max Mustermann',
    email: 'Ihre E-Mail',
    emailPh: 'name@beispiel.com',
    subject: 'Betreff',
    subjectPh: 'Eine kurze Zeile zu Ihrem Anliegen',
    message: 'Nachricht',
    messagePh: 'Sehr geehrtes Kelionai,',
    secure: `Sicher gesendet an ${productConfig.supportEmail}`,
    send: 'Nachricht senden',
    sending: 'Senden…',
    sentTitle: 'Vielen Dank',
    sentBody: 'Ihre Nachricht wurde sicher für das Support-Team gespeichert.',
    close: 'Schließen',
    errEmail: 'Bitte geben Sie eine gültige E-Mail und eine Nachricht ein.',
    errSend: 'Senden fehlgeschlagen — der Server hat nicht bestätigt. Bitte erneut versuchen.',
  },
  it: {
    title: 'Contattaci',
    sub: 'Scrivici in qualsiasi lingua — rispondiamo nella tua.',
    lang: 'Lingua',
    dept: 'Reparto',
    depts: ['Richiesta generale', 'Assistenza', 'Vendite', 'Stampa e media', 'Legale'],
    name: 'Il tuo nome',
    namePh: 'Mario Rossi',
    email: 'La tua email',
    emailPh: 'nome@esempio.com',
    subject: 'Oggetto',
    subjectPh: 'Una breve riga sulla tua richiesta',
    message: 'Messaggio',
    messagePh: 'Gentile Kelionai,',
    secure: `Inviato in modo sicuro a ${productConfig.supportEmail}`,
    send: 'Invia messaggio',
    sending: 'Invio…',
    sentTitle: 'Grazie',
    sentBody: 'Il tuo messaggio è archiviato in modo sicuro per il team di assistenza.',
    close: 'Chiudi',
    errEmail: 'Inserisci un’email valida e un messaggio.',
    errSend: 'Invio non riuscito — il server non ha confermato. Riprova.',
  },
  pt: {
    title: 'Contacte-nos',
    sub: 'Escreva-nos em qualquer idioma — respondemos no seu.',
    lang: 'Idioma',
    dept: 'Departamento',
    depts: ['Questão geral', 'Suporte', 'Vendas', 'Imprensa e media', 'Jurídico'],
    name: 'O seu nome',
    namePh: 'João Silva',
    email: 'O seu email',
    emailPh: 'nome@exemplo.com',
    subject: 'Assunto',
    subjectPh: 'Uma breve linha sobre o seu pedido',
    message: 'Mensagem',
    messagePh: 'Caro Kelionai,',
    secure: `Enviado com segurança para ${productConfig.supportEmail}`,
    send: 'Enviar mensagem',
    sending: 'A enviar…',
    sentTitle: 'Obrigado',
    sentBody: 'A sua mensagem foi guardada com segurança para a equipa de suporte.',
    close: 'Fechar',
    errEmail: 'Introduza um email válido e uma mensagem.',
    errSend: 'Não foi possível enviar — o servidor não confirmou. Tente novamente.',
  },
}

// Every major world language — the reply comes in the selected one. Full form
// translations exist for en/ro/fr/es/de/it/pt; the rest show the English UI but
// still get a reply in their language.
const LANGS: { code: Lang; label: string }[] = LANG_OPTIONS as { code: Lang; label: string }[]

export default function ContactModal({ onClose }: { readonly onClose: () => void }) {
  const [lang, setLang] = useState<Lang>('en')
  const [dept, setDept] = useState(0)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [err, setErr] = useState('')
  const pendingSubmission = useRef(createRetryIdempotencyLease())
  const t = T[lang] ?? T.en

  async function submit(): Promise<void> {
    setErr('')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !message.trim()) {
      setErr(t.errEmail)
      return
    }
    setState('sending')
    try {
      const payload = {
        department: T.en.depts[dept],
        name,
        email,
        subject,
        message,
        lang,
      }
      const fingerprint = JSON.stringify(payload)
      const submissionId = pendingSubmission.current.keyFor(fingerprint)
      const res = await apiFetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          submissionId,
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      pendingSubmission.current.complete(fingerprint)
      setState('sent')
    } catch {
      setState('idle')
      setErr(t.errSend)
    }
  }

  return (
    <div className="contact-overlay" onClick={onClose}>
      <div className="contact-panel" onClick={(e) => e.stopPropagation()}>
        {state === 'sent' ? (
          <div className="contact-sent">
            <div className="contact-crest">K</div>
            <h3>{t.sentTitle}</h3>
            <p>{t.sentBody}</p>
            <button type="button" className="composer-send" onClick={onClose}>
              {t.close}
            </button>
          </div>
        ) : (
          <>
            <div className="contact-langbar">
              <select
                aria-label={t.lang}
                value={lang}
                onChange={(e) => setLang(e.target.value as Lang)}
              >
                {LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
              <button type="button" className="contact-x" aria-label={t.close} onClick={onClose}>
                ✕
              </button>
            </div>
            <div className="contact-head">
              <div className="contact-crest">K</div>
              <div className="contact-title">{t.title}</div>
              <div className="contact-sub">{t.sub}</div>
              <div className="contact-rule" />
            </div>
            <label className="contact-label">{t.dept}</label>
            <select value={dept} onChange={(e) => setDept(Number(e.target.value))}>
              {t.depts.map((d, i) => (
                <option key={i} value={i}>
                  {d}
                </option>
              ))}
            </select>
            <div className="contact-grid">
              <div>
                <label className="contact-label">{t.name}</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePh} />
              </div>
              <div>
                <label className="contact-label">{t.email}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.emailPh}
                />
              </div>
            </div>
            <label className="contact-label">{t.subject}</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t.subjectPh}
            />
            <label className="contact-label">{t.message}</label>
            <textarea
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t.messagePh}
            />
            {err && <div className="contact-err">{err}</div>}
            <div className="contact-actions">
              <span className="contact-secure">🔒 {t.secure}</span>
              <button
                type="button"
                className="contact-send"
                disabled={state === 'sending'}
                onClick={() => void submit()}
              >
                {state === 'sending' ? t.sending : t.send}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
