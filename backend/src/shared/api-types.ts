// ── THE HTTP CONTRACT between backend and frontend — ONE SINGLE DECLARATION ──
//
// WHY IT EXISTS (Adrian: "the permanent single-source principle, no
// duplicates"; "0 clones, that's the target"): these data shapes travel
// through the API and were declared TWICE — once in the backend (`db.ts`, the
// payment services) and once, identically, in the frontend (`lib/admin.ts`).
// The detector reported them as the biggest clones in the project
// (42 + 36 + 20 = 98 lines). The cause was not negligence but the lack of a
// COMMON place: the two builds had no shared file.
//
// RULES for this file (so it stays legal in both builds):
//   • ONLY types (`interface` / `type`). Zero logic, zero runtime imports.
//     That way it disappears completely at compile time and it doesn't matter
//     that the backend is NodeNext and the frontend is bundler — no real
//     `import` is ever emitted.
//   • Imported with `import type { … }` from both ends.
//   • What is HERE is a PUBLIC contract (what the client sees). Internal
//     database shapes stay in the backend — they are not promoted here just
//     to lower a number.
//
// Batch A of `PROCEDURA-REFACERE-CLONE.md`.

/** One row of the visitor analysis: who, from where, with what, what interested them. */
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
  /** On a DEMO row: the temporary email whose conversation the owner can
   *  open (click on the row). Empty on simple visits (they never spoke). */
  session_email: string
  /** What interested them: the first question/topic of the demo trial. Empty on simple visits. */
  topic: string
  /** Their timezone (IANA, e.g. "Europe/Bucharest"). Tells you what time it
   *  was AT THEIR PLACE when they came in — not your time. The column existed
   *  in the table and was never read. */
  tz: string
  /** How many times they visited BEFORE this visit (same fingerprint).
   *  0 = first time. A person returning for the third time is not the same
   *  thing as one who landed on the site once. */
  vizite_anterioare: number
  /** URL of the photo captured during the visit (webcam snapshot). Empty if none. */
  photo_url: string
  /** CE AU VIZITAT (owner, 13 aug): secțiunile deschise de acest vizitator în
   *  sesiune — listă distinctă separată prin virgulă (acasă, aplicație, credite,
   *  manual, autentificare). Gol dacă n-a fost înregistrată nicio secțiune. */
  pages: string
  /** P25 (owner, 15 aug: „nu-mi trebuie pe acelasi om mai multe pozitii, o
   *  pozitie, cu poza lui, si in cadrul aceluiasi, vizitele, toate"): rândul e
   *  al OMULUI, nu al vizitei — aici stau TOATE vizitele lui, cea mai nouă
   *  prima. Meta de sus (ip/oraș/browser…) e a ULTIMEI vizite. */
  vizite?: VizitaScurta[]
  /** Prima lui vizită (ISO) — cardul poartă și începutul relației. */
  prima_vizita?: string
}

/** The visitor analysis, aggregated (admin-only): totals + countries + latest arrivals. */
/** O vizită din istoricul UNUI om (P25): când a intrat + ce secțiuni a deschis. */
export interface VizitaScurta {
  la: string
  pages: string
}

export interface DemoStats {
  total: number
  today: number
  bots: number
  visitsTotal: number
  visitsToday: number
  byCountry: { country: string; code: string; count: number }[]
  recent: DemoRecent[]
  /** P25, LEGEA pozei (owner, 15 aug: „daca nu are poza acceptata... nu intra"):
   *  câți OAMENI (și câte vizite ale lor) NU apar în listă fiindcă n-au nicio
   *  poză acceptată — cifra se spune pe față, ca totalurile să nu pară scăzute
   *  fără explicație. */
  faraPoza?: { persoane: number; vizite: number }
}

/** THE MONEY CIRCUIT (admin-only): the LIVE state of every payment→AI link.
 *  Stripe left completely (31 Jul) — the old virtual-card links disappeared
 *  with it; what remains here are only live measurements. */

/** An expense of the application and where it is paid from. Adrian, 30 Jul:
 *  "can all expenses be paid only from the pouch?" — the answer is yes, but
 *  only if each provider has the virtual card set on it. This list shows in
 *  black and white which one still flows from our own pocket. */
export interface ExpenseLine {
  /** The provider's name, as the person knows it. */
  name: string
  /** What it is paid for. */
  what: string
  /** Is it configured in the app? (the key exists) */
  configured: boolean
  /** Where its invoice is paid. */
  billing: string
  /** THEIR billing page, where the card is changed (Adrian, 30 Jul: "link
   *  to each AI, so I can change the card"). Empty for providers that don't
   *  have one (free, or paid from elsewhere) — then no button is shown at
   *  all, so we don't send the person into a void. */
  billingUrl?: string
  /** MEASURED on the provider's page (31 Jul): the card is on file there.
   *  Missing if nobody has been on that page — then nothing is shown,
   *  because "I don't know" must not be written as "no" (rule #1). */
  cardPus?: boolean
  /** MEASURED: automatic top-up is on. That is the goal — a card without
   *  automatic payment means that in a month Kelion goes silent again. */
  platiAutomate?: boolean
}

export interface MoneyCircuit {
  /** All the application's expenses, with the place they are paid from. */
  expenses?: ExpenseLine[]
  /** The state of the Revolut payment reader (Adrian, 30 Jul: automatic
   *  crediting with a unique code). `ok:false` = WE COULD NOT READ the
   *  account — something other than "nobody paid", which is why it is
   *  reported separately, not as a soothing zero. */
  citirePlati?: { la: string; ok: boolean; detaliu: string } | null
  /** The Revolut-email payment reader (Pro path, Aug 3): reads "Ai primit …"
   *  mails from the owner's Gmail and credits by code. `ok:false` = couldn't
   *  read the inbox (Google not connected), NOT "nobody paid". */
  citirePlatiEmail?: { la: string; ok: boolean; detaliu: string } | null
  /** The last pass of the loop that makes Kelion get to work BY HIMSELF
   *  (Adrian, 30 Jul: "make him autonomous"). `ok:true` = something really
   *  started at that moment. Shown so you don't have to take it on faith
   *  that the loop is alive. */
  autonomie?: { la: string; ok: boolean; detaliu: string } | null
  /** The REAL cost at the providers: total, today, and what it went on. It
   *  existed only as a tool — you had to ASK to find out. Now it is visible,
   *  next to the money. It cuts nothing. */
  // `masurat` = the money stated by the provider; `estimat` = my fixed rate × quantity.
  // They were mixed into a single "real" — and the biggest row (voice
  // minutes) happened to be the estimated one. The panel must be able to
  // tell them apart.
  costReal?: {
    total: number
    today: number
    byKind: Record<string, number>
    masurat: number
    estimat: number
    felul: Record<string, 'masurat' | 'estimat'>
  } | null
  /** M7b (8 aug): când costReal e null, AICI scrie DE CE (citirea a picat) —
   *  panoul arată motivul, nu ascunde blocul în tăcere. */
  costRealMotiv?: string
  /** The fixed voice rate ($/min) the estimate above is computed with — sent
   *  by the server so the panel never shows a hand-written figure that has
   *  drifted from the one actually used (env: VOICE_USD_PER_MINUTE). */
  voiceUsdPerMin?: number
  /** The owner's lever: is autonomy stopped? A limit HE chooses is not a
   *  barrier; one set by me is. That is why it is visible, and it is his. */
  autonomiaOprita?: boolean
  error?: string
}

/** Per-USER activity (admin-only): who connected, last IP/place/device,
 *  total time spent and their balance. */
/** Un DEVICE al unui utilizator: (device, browser) cu datele lui agregate —
 *  P6 (owner, 15 aug: „se pastreaza unica si se adauga doar device cu care
 *  intra cu datele aferente"). */
export interface UserDeviceRow {
  device: string
  browser: string
  sessions: number
  seconds: number
  last_seen: string
  ip: string
  city: string
  country: string
  code: string
}

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
  /** Cât a COSTAT userul ăsta pe furnizori (USD, suma cost_events pe emailul
   *  lui) — monitorizarea pe user (Adrian, 10 aug: „sistemul de monitorizare
   *  pe user inexistent"). Consumul, lângă sold: se vede cine arde banii. */
  consumedUsd: number
  /** Device-urile LUI, dedesubt (P6) — în locul listei plate de sesiuni care
   *  repeta același om de N ori. */
  devices: UserDeviceRow[]
  /** P26 (owner, 15 aug: „baza de date completa cu poza cu tot… se ataseaza
   *  inclusiv monstra de voce"): poza contului (faceprints, dată cu acord la
   *  enrolare) — gol dacă nu există; nu se inventează siluete. */
  foto: string
  /** Are amprentă vocală înscrisă (voiceprints)? */
  voce: boolean
  /** Amprenta lui are și mostra AUDIO ascultabilă (butonul ▶ din Amprente)? */
  mostraAudio: boolean
  /** P10: ownerul e scutit de taxare peste tot — soldul lui (negativ, istoric,
   *  dinaintea scutirilor) se afișează cu explicația, nu ca datorie vie. */
  scutit: boolean
}
