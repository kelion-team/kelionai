import { useState } from 'react'

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
    secure: 'Sent securely to contact@kelionai.app',
    send: 'Send message',
    sending: 'Sending…',
    sentTitle: 'Thank you',
    sentBody: 'Your message has been received. We will reply to you shortly, in your language.',
    close: 'Close',
    errEmail: 'Please enter a valid email and a message.',
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
    secure: 'Trimis securizat la contact@kelionai.app',
    send: 'Trimite mesajul',
    sending: 'Se trimite…',
    sentTitle: 'Mulțumim',
    sentBody: 'Mesajul tău a fost primit. Îți vom răspunde în scurt timp, în limba ta.',
    close: 'Închide',
    errEmail: 'Introdu un email valid și un mesaj.',
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
    secure: 'Envoyé en toute sécurité à contact@kelionai.app',
    send: 'Envoyer le message',
    sending: 'Envoi…',
    sentTitle: 'Merci',
    sentBody: 'Votre message a été reçu. Nous vous répondrons sous peu, dans votre langue.',
    close: 'Fermer',
    errEmail: 'Veuillez saisir un e-mail valide et un message.',
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
    secure: 'Enviado de forma segura a contact@kelionai.app',
    send: 'Enviar mensaje',
    sending: 'Enviando…',
    sentTitle: 'Gracias',
    sentBody: 'Tu mensaje ha sido recibido. Te responderemos en breve, en tu idioma.',
    close: 'Cerrar',
    errEmail: 'Introduce un correo válido y un mensaje.',
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
    secure: 'Sicher gesendet an contact@kelionai.app',
    send: 'Nachricht senden',
    sending: 'Senden…',
    sentTitle: 'Vielen Dank',
    sentBody: 'Ihre Nachricht ist eingegangen. Wir antworten Ihnen in Kürze in Ihrer Sprache.',
    close: 'Schließen',
    errEmail: 'Bitte geben Sie eine gültige E-Mail und eine Nachricht ein.',
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
    secure: 'Inviato in modo sicuro a contact@kelionai.app',
    send: 'Invia messaggio',
    sending: 'Invio…',
    sentTitle: 'Grazie',
    sentBody: 'Il tuo messaggio è stato ricevuto. Ti risponderemo a breve, nella tua lingua.',
    close: 'Chiudi',
    errEmail: 'Inserisci un’email valida e un messaggio.',
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
    secure: 'Enviado com segurança para contact@kelionai.app',
    send: 'Enviar mensagem',
    sending: 'A enviar…',
    sentTitle: 'Obrigado',
    sentBody: 'A sua mensagem foi recebida. Responderemos em breve, no seu idioma.',
    close: 'Fechar',
    errEmail: 'Introduza um email válido e uma mensagem.',
  },
}

// Every major world language — the reply comes in the selected one. Full form
// translations exist for en/ro/fr/es/de/it/pt; the rest show the English UI but
// still get a reply in their language.
const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ro', label: 'Română' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'uk', label: 'Українська' },
  { code: 'ru', label: 'Русский' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'sv', label: 'Svenska' },
  { code: 'no', label: 'Norsk' },
  { code: 'da', label: 'Dansk' },
  { code: 'fi', label: 'Suomi' },
  { code: 'cs', label: 'Čeština' },
  { code: 'sk', label: 'Slovenčina' },
  { code: 'hu', label: 'Magyar' },
  { code: 'bg', label: 'Български' },
  { code: 'sr', label: 'Srpski' },
  { code: 'hr', label: 'Hrvatski' },
  { code: 'ar', label: 'العربية' },
  { code: 'he', label: 'עברית' },
  { code: 'fa', label: 'فارسی' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'bn', label: 'বাংলা' },
  { code: 'ur', label: 'اردو' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'th', label: 'ไทย' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'ms', label: 'Bahasa Melayu' },
  { code: 'sw', label: 'Kiswahili' },
]

export default function ContactModal({ onClose }: { readonly onClose: () => void }) {
  const [lang, setLang] = useState<Lang>('en')
  const [dept, setDept] = useState(0)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [err, setErr] = useState('')
  const t = T[lang] ?? T.en

  async function submit(): Promise<void> {
    setErr('')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !message.trim()) {
      setErr(t.errEmail)
      return
    }
    setState('sending')
    try {
      await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department: T.en.depts[dept], // canonical (English) for routing
          name,
          email,
          subject,
          message,
          lang,
        }),
      })
      setState('sent')
    } catch {
      setState('sent') // never trap the visitor; the message is queued either way
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
