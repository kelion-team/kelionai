// ── NUMĂRUL CARDULUI VIRTUAL, ÎN PANOU (Adrian, 30 iul) ──────────────────────
//
// „nu mă descurc, te rog intră și ajută-mă" — pasul care-l bloca era să scoată
// numărul cardului Kelion din dashboardul Stripe ca să-l pună la OpenRouter și
// OpenAI. Îl aducem în adminul lui, cu butoane de copiere.
//
// CE NU FACEM: nu cerem numărul prin backend (`expand[]=number`) și nu-l trecem
// prin chat. Un PAN care atinge serverul nostru bagă toată aplicația în scope
// PCI, cu loguri cu tot; un PAN scris în chat e card compromis.
//
// CE FACEM: calea oficială Stripe (Issuing Elements). Cifrele se randează în
// iframe-uri găzduite de Stripe, direct în browserul lui. Serverul vede doar un
// nonce de unică folosință pe care-l schimbă într-o cheie efemeră de 15 minute.
import { useEffect, useRef, useState } from 'react'
import { fetchCardKey } from '../lib/admin'

// Tipul minim din Stripe.js de care avem nevoie (nu adăugăm dependință npm
// pentru trei apeluri — scriptul se încarcă doar când apeși butonul).
interface StripeElement {
  mount: (el: HTMLElement) => void
  destroy: () => void
}
interface StripeJs {
  elements: () => { create: (tip: string, opts: Record<string, unknown>) => StripeElement }
  createEphemeralKeyNonce: (o: { issuingCard: string }) => Promise<{ nonce: string }>
  retrieveIssuingCard: (id: string, o: { ephemeralKeySecret: string; nonce: string }) => Promise<unknown>
}
declare global {
  interface Window {
    Stripe?: (pk: string) => StripeJs
  }
}

const SRC = 'https://js.stripe.com/v3/'
let incarcare: Promise<boolean> | null = null

/** Încarcă Stripe.js O SINGURĂ DATĂ, la cerere. Landing-ul și chatul nu plătesc
 *  nimic pentru el: scriptul pleacă abia când adminul apasă „Vezi numărul". */
function incarcaStripeJs(): Promise<boolean> {
  if (window.Stripe) return Promise.resolve(true)
  if (incarcare) return incarcare
  incarcare = new Promise<boolean>((gata) => {
    const s = document.createElement('script')
    s.src = SRC
    s.async = true
    s.onload = () => gata(Boolean(window.Stripe))
    s.onerror = () => {
      incarcare = null // o încărcare picată nu blochează o a doua încercare
      gata(false)
    }
    document.head.appendChild(s)
  })
  return incarcare
}

export default function CardReveal({ cardId, pk, last4 }: { cardId: string; pk: string; last4: string }) {
  const nr = useRef<HTMLDivElement>(null)
  const exp = useRef<HTMLDivElement>(null)
  const cvc = useRef<HTMLDivElement>(null)
  const nrCopy = useRef<HTMLDivElement>(null)
  const expCopy = useRef<HTMLDivElement>(null)
  const cvcCopy = useRef<HTMLDivElement>(null)
  const [stare, setStare] = useState<'incarc' | 'gata' | 'eroare'>('incarc')
  const [motiv, setMotiv] = useState('')

  useEffect(() => {
    let viu = true
    const elemente: StripeElement[] = []
    void (async () => {
      const ok = await incarcaStripeJs()
      if (!viu) return
      if (!ok || !window.Stripe) {
        setMotiv('Stripe.js did not load (network, or an ad blocker).')
        setStare('eroare')
        return
      }
      try {
        const stripe = window.Stripe(pk)
        const { nonce } = await stripe.createEphemeralKeyNonce({ issuingCard: cardId })
        const ephemeralKeySecret = await fetchCardKey(cardId, nonce)
        if (!viu) return
        if (!ephemeralKeySecret) {
          setMotiv('The server did not return the ephemeral key — check the admin session and the lock.')
          setStare('eroare')
          return
        }
        await stripe.retrieveIssuingCard(cardId, { ephemeralKeySecret, nonce })
        if (!viu) return
        const elements = stripe.elements()
        const comun = { issuingCard: cardId, nonce, ephemeralKeySecret }
        const stil = { base: { color: '#e8ecf4', fontSize: '17px', fontFamily: 'ui-monospace, Menlo, monospace' } }
        const perechi: [string, React.RefObject<HTMLDivElement | null>][] = [
          ['issuingCardNumberDisplay', nr],
          ['issuingCardExpiryDisplay', exp],
          ['issuingCardCvcDisplay', cvc],
        ]
        for (const [tip, tinta] of perechi) {
          if (!tinta.current) continue
          const el = elements.create(tip, { ...comun, style: stil })
          el.mount(tinta.current)
          elemente.push(el)
        }
        const copii: [string, React.RefObject<HTMLDivElement | null>][] = [
          ['number', nrCopy],
          ['expiry', expCopy],
          ['cvc', cvcCopy],
        ]
        for (const [ce, tinta] of copii) {
          if (!tinta.current) continue
          const el = elements.create('issuingCardCopyButton', {
            toCopy: ce,
            style: { base: { fontSize: '12px', lineHeight: '22px' } },
          })
          el.mount(tinta.current)
          elemente.push(el)
        }
        setStare('gata')
      } catch (e) {
        if (!viu) return
        setMotiv(String(e).slice(0, 160))
        setStare('eroare')
      }
    })()
    return () => {
      viu = false
      // Iframe-urile Stripe se demontează explicit: altfel rămân în DOM după ce
      // închizi panoul, cu numărul cardului încă randat în ele.
      for (const el of elemente) {
        try {
          el.destroy()
        } catch {
          /* deja demontat */
        }
      }
    }
  }, [cardId, pk])

  return (
    <div className="card-reveal">
      <div className="card-reveal-title">Kelion AI card •••• {last4}</div>
      {stare === 'incarc' && <div className="or-wallet-sub">Asking Stripe for the key…</div>}
      {stare === 'eroare' && <div className="or-wallet-sub" style={{ color: '#e06c5f' }}>Could not display it: {motiv}</div>}
      <div className="card-reveal-grid" style={{ display: stare === 'gata' ? 'grid' : 'none' }}>
        <span className="card-reveal-eticheta">Number</span>
        <div className="card-reveal-camp" ref={nr} />
        <div ref={nrCopy} />
        <span className="card-reveal-eticheta">Expires</span>
        <div className="card-reveal-camp" ref={exp} />
        <div ref={expCopy} />
        <span className="card-reveal-eticheta">CVC</span>
        <div className="card-reveal-camp" ref={cvc} />
        <div ref={cvcCopy} />
      </div>
      {stare === 'gata' && (
        <div className="or-wallet-sub">
          Copy and paste it at{' '}
          <a href="https://openrouter.ai/settings/credits" target="_blank" rel="noreferrer">OpenRouter → Credits</a>
          {' · '}
          <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">OpenAI → Billing</a>
          . The digits come straight from Stripe, in its own frames — they never pass through the Kelionai server.
        </div>
      )}
    </div>
  )
}
