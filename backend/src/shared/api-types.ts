// ── CONTRACTUL HTTP dintre backend și frontend — O SINGURĂ DECLARAȚIE ────────
//
// DE CE EXISTĂ (Adrian: „principiul permanent unic, fără duplicate"; „0 clone,
// ăsta e targetul"): formele astea de date circulă prin API și erau declarate de
// DOUĂ ori — o dată în backend (`db.ts`, `stripe.ts`) și o dată, identic, în
// frontend (`lib/admin.ts`). Detectorul le raporta ca cele mai mari clone din
// proiect (42 + 36 + 20 = 98 de linii). Cauza nu era neglijență, ci lipsa unui
// loc COMUN: cele două build-uri n-aveau niciun fișier partajat.
//
// REGULI pentru fișierul ăsta (ca să rămână legal în ambele build-uri):
//   • DOAR tipuri (`interface` / `type`). Zero logică, zero import de runtime.
//     Așa dispare complet la compilare și nu contează că backend-ul e NodeNext
//     iar frontend-ul bundler — nu se emite niciun `import` real.
//   • Se importă cu `import type { … }`, din ambele capete.
//   • Ce e AICI e contract PUBLIC (ce vede clientul). Formele interne de bază de
//     date rămân în backend — nu se urcă aici doar ca să scadă un număr.
//
// Lotul A din `PROCEDURA-REFACERE-CLONE.md`.

/** Un rând din analiza vizitatorilor: cine, de unde, cu ce, ce l-a interesat. */
export interface DemoRecent {
  kind: 'visit' | 'demo'
  ip: string
  country: string
  code: string
  city: string
  region: string
  isp: string
  browser: string
  os: string
  device: string
  lang: string
  referrer: string
  is_bot: boolean
  started_at: string
  /** La un rând DEMO: emailul temporar a cărui conversație o poate deschide
   *  owner-ul (click pe rând). Gol la vizitele simple (n-au vorbit niciodată). */
  session_email: string
  /** Ce l-a interesat: prima întrebare/temă din proba demo. Gol la vizite simple. */
  topic: string
}

/** Analiza vizitatorilor, agregată (admin-only): totaluri + țări + ultimele sosiri. */
export interface DemoStats {
  total: number
  today: number
  bots: number
  visitsTotal: number
  visitsToday: number
  byCountry: { country: string; code: string; count: number }[]
  recent: DemoRecent[]
}

/** CIRCUITUL BANILOR (admin-only): starea LIVE a fiecărei verigi Stripe→AI. */
export interface IssuingCharge {
  /** Cine a taxat cardul (numele comerciantului, exact cum îl dă Stripe). */
  merchant: string
  /** Suma în moneda contului (pozitivă = cheltuit). */
  amount: number
  /** Data, ISO. */
  at: string
}

/** O cheltuiala a aplicatiei si de unde se plateste. Adrian, 30 iul: „se pot
 *  pune toate cheltuielile sa fie doar din punga?" — raspunsul e da, dar numai
 *  daca fiecare furnizor are cardul virtual pus la el. Lista asta arata negru pe
 *  alb care mai curge din buzunarul propriu. */
export interface ExpenseLine {
  /** Numele furnizorului, asa cum il stie omul. */
  name: string
  /** Pentru ce se plateste. */
  what: string
  /** E configurat in aplicatie? (cheia exista) */
  configured: boolean
  /** Unde se plateste factura lui. */
  billing: string
}

export interface MoneyCircuit {
  /** 'manual' = corect (banii rămân în pungă, nu pleacă automat). */
  payoutsInterval: string
  /** 'active' | 'inactive' | 'pending' | 'unknown'. */
  issuingStatus: string
  cards: { id: string; last4: string; status: string }[]
  /** Cheia PUBLICĂ Stripe (pk_live_…), dacă e pusă în env. Cu ea panoul poate
   *  afișa numărul cardului prin Issuing Elements (iframe Stripe, cifrele nu
   *  trec prin serverul nostru). Gol = butonul „Vezi numărul" nu apare. */
  stripePk?: string
  /** Punga Issuing (bani gata de cheltuit pe card), în moneda contului. */
  issuingAvailable: number
  /** DOVADA că veriga 4 (cardul pus la furnizorii de AI) chiar există: dacă
   *  OpenRouter/OpenAI au taxat cardul, aici sunt tranzacțiile lor. Listă goală
   *  = cardul n-a fost încă folosit de nimeni, deci nu e legat (sau nu s-a
   *  ajuns la prima taxare). Un rând care spune „e pornit" fără asta e o
   *  presupunere, nu o stare. */
  issuingCharges?: IssuingCharge[]
  /** Toate cheltuielile aplicatiei, cu locul de unde se platesc. */
  expenses?: ExpenseLine[]
  /** REGULA BATUTA IN CUIE: platile catre AI trebuie sa iasa din punga.
   *  Codul nu poate pune cardul in contul furnizorului (nu exista API), dar
   *  poate PRINDE cand nu e pus: daca am consumat AI de X si cardul a fost
   *  taxat cu 0, inseamna ca furnizorii sunt platiti din ALTA parte. */
  pouchRule?: {
    /** Cat am consumat la AI (masurat de noi), in moneda contului. */
    spent: number
    /** Cat a fost taxat cardul virtual. */
    charged: number
    /** Regula e respectata? */
    ok: boolean
    /** Ce e de facut, pe intelesul omului. */
    verdict: string
  }
  /** Ultima încercare de alimentare AUTOMATĂ plăți→card (Balance Transfer API). */
  autoFund?: { at: string; ok: boolean; detail: string } | null
  error?: string
}

/** Activitatea per USER (admin-only): cine s-a conectat, ultimul IP/loc/dispozitiv,
 *  cât a stat în total și soldul lui. */
export interface UserActivityRow {
  email: string
  sessions: number
  seconds: number
  actions: number
  messages: number
  last_seen: string
  last_ip: string
  city: string
  country: string
  code: string
  device: string
  browser: string
  blocked: boolean
  balance: number
}
