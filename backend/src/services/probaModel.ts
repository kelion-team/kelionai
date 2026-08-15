import { geminiDirectChat } from './geminiDirect.js'
import type { AnthropicTool, OrMessage } from './brainContract.js'

// ── BATERIA DE ADMITERE A UNUI MODEL (Adrian, 7 aug: „pune condiție la orice auto
// upgrade să respecte toate aceste condiții, clar cu dovadă") ─────────────────
//
// Regula pe care o pune în practică fișierul ăsta: NICIUN model nu intră pe
// treapta grea doar fiindcă are un număr mai mare în nume. Trebuie să treacă
// ACELEAȘI probe pe care le-a rulat ownerul pe VPS (scripts/proba-calitate.py),
// TOATE, iar rezultatul se scrie ca dovadă — nu „a mers", ci scorul, sarcinile
// picate și modelul cu care a fost comparat.
//
// DE CE, MĂSURAT (7 aug, cheia ownerului): `gemini-3.6-flash` e mai NOU decât
// 3.5-flash, răspunde frumos cu text — deci trecea vechea probă („200 cu text") —
// dar a făcut 17/20 și PICĂ lanțul de unelte, chiar și cu semnătura de gândire
// retrimisă corect. Cu proba veche, auto-upgrade-ul l-ar fi instalat singur a
// doua zi și ar fi degradat creierul TĂCUT. Un „upgrade" care strică e mai rău
// decât niciun upgrade.
//
// REGULA DE FIER, aceeași ca la proba de pe VPS: fiecare sarcină are verificare
// AUTOMATĂ și EXACTĂ (număr, cheie JSON, nume de unealtă, șir exact). Niciun
// punct nu vine dintr-o părere despre cât de frumos sună răspunsul.
//
// CE NU E AICI, INTENȚIONAT: proba „scrie cod care chiar rulează" din varianta de
// pe VPS. Acolo codul generat se execută într-un interpretor cu filtru; în
// backendul de producție NU execut cod venit de la un model, oricât de filtrat.
// Locul ei îl ia `cod-rationament`: același lucru probat invers — i se dă codul
// și trebuie să spună EXACT ce întoarce. Înțelegerea codului se măsoară, execuția
// nu se face.

export interface RezultatProba {
  model: string
  scor: number
  total: number
  picate: string[]
  /** Ce a răspuns la fiecare sarcină (scurtat) — dovada, nu doar cifra. */
  detaliu: Record<string, string>
}

const UNELTE: AnthropicTool[] = [
  {
    name: 'web_search',
    description: 'Caută informații publice pe internet',
    input_schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  },
  {
    name: 'db_query',
    description: 'Rulează o interogare în baza de date a aplicației',
    input_schema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
  },
  {
    name: 'send_email',
    description: 'Trimite un email',
    input_schema: {
      type: 'object',
      properties: { to: { type: 'string' }, body: { type: 'string' } },
      required: ['to', 'body'],
    },
  },
]

const UMPLUTURA = 'Ești Kelion, asistentul lui Adrian. Răspunzi scurt, în română, și folosești uneltele când e nevoie. '
/** Prompt de sistem LUNG, ca cel real, cu un detaliu unic îngropat la mijloc. */
const SYS_LUNG = UMPLUTURA.repeat(25) + 'Codul de sală al depozitului este QX-7734. ' + UMPLUTURA.repeat(25)

const COD_CU_BUG = [
  '1  function ultimulElement(a) {',
  '2    if (!a) return null',
  '3    let i = 0',
  '4    let ultim = null',
  '5    while (i <= a.length) {',
  '6      ultim = a[i]',
  '7      i++',
  '8    }',
  '9    return ultim',
  '10 }',
].join('\n')

// ── VERIFICATOARE PURE (fără rețea) — testabile una câte una ──────────────────

/** Primul număr întreg dintr-un text, ignorând separatorii de mii. */
export function primulNumar(t: string): number | null {
  const m = /-?\d+/.exec((t || '').replace(/[.,](?=\d{3}\b)/g, ''))
  return m ? Number(m[0]) : null
}

/** Cuvintele unui text, fără punctuație — pentru proba „exact trei cuvinte". */
export function cuvinte(t: string): string[] {
  return (t || '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Checks if the text contains a fabricated phone number.
 *  Measures whether the model hallucinated a phone number (>= 6 digits grouped with separators).
 *  Short alphanumeric codes from system prompt (e.g. QX-7734 with 4 digits) or dates are not phone numbers. */
export function aInventatNumar(t: string): boolean {
  const matches = (t || '').match(/(?:\+?\d[\d .\-()]{4,}\d|\b\d{6,}\b)/g) || []
  return matches.some((m) => m.replace(/\D/g, '').length >= 6)
}

/** JSON-ul cerut, parsat STRICT din textul brut: cererea spune „fără garduri de
 *  cod", deci cine pune ``` a încălcat instrucțiunea — exact ce se probează. */
export function jsonStrictOk(t: string): boolean {
  try {
    const o = JSON.parse((t || '').trim()) as Record<string, unknown>
    return o.oras === 'Bucuresti' && o.populatie === 1716961 && o.capitala === true
  } catch {
    return false
  }
}

const scurt = (t: string): string => (t || '').replace(/\s+/g, ' ').trim().slice(0, 60)

// ── BATERIA ──────────────────────────────────────────────────────────────────

type Sarcina = { nume: string; ruleaza: (model: string) => Promise<{ ok: boolean; nota: string }> }

function cere(model: string, mesaje: OrMessage[], unelte: AnthropicTool[] = []) {
  return geminiDirectChat(model, mesaje, unelte, { maxTokens: 8192, reasoning: 'high' })
}
const userMsg = (text: string): OrMessage => ({ role: 'user', content: text })

const CERERE_LANT = 'Caută pe internet care e capitala Australiei, apoi trimite rezultatul pe email la adrian@example.com.'

export const SARCINI: Sarcina[] = [
  {
    nume: 'bug-linie',
    async ruleaza(m) {
      const r = await cere(m, [
        userMsg(
          `Codul de mai jos întoarce mereu \`undefined\` în loc de ultimul element.\n\n${COD_CU_BUG}\n\n` +
            'Pe ce linie e greșeala? Răspunde DOAR cu numărul liniei, nimic altceva.',
        ),
      ])
      return { ok: primulNumar(r.text) === 5, nota: scurt(r.text) }
    },
  },
  {
    nume: 'rationament',
    async ruleaza(m) {
      const r = await cere(m, [
        userMsg(
          'Un server procesează 3 cereri pe secundă. La 09:00 sunt 4 servere pornite. La fiecare 20 de minute ' +
            'se adaugă încă un server, care începe să lucreze exact în minutul adăugării. Câte cereri s-au ' +
            'procesat în total între 09:00 și 10:00? Răspunde DOAR cu numărul.',
        ),
      ])
      return { ok: primulNumar(r.text) === 54000, nota: scurt(r.text) }
    },
  },
  {
    nume: 'json-strict',
    async ruleaza(m) {
      const r = await cere(m, [
        userMsg(
          'Răspunde DOAR cu un obiect JSON valid, fără text în jur și fără garduri de cod, cu exact aceste ' +
            'chei: "oras" (string) = Bucuresti, "populatie" (număr întreg) = 1716961, "capitala" (boolean) = true.',
        ),
      ])
      return { ok: jsonStrictOk(r.text), nota: scurt(r.text) }
    },
  },
  {
    nume: 'unealta-corecta',
    async ruleaza(m) {
      const r = await cere(m, [userMsg('Câți utilizatori s-au înregistrat luna trecută? Datele sunt în baza noastră de date.')], UNELTE)
      const n = r.toolCalls[0]?.function.name
      return { ok: n === 'db_query', nota: n ?? 'niciun apel' }
    },
  },
  {
    nume: 'fara-unealta',
    async ruleaza(m) {
      const r = await cere(m, [userMsg('Explică-mi în două propoziții ce înseamnă latență într-o aplicație web.')], UNELTE)
      return {
        ok: r.toolCalls.length === 0 && r.text.trim().length > 20,
        nota: r.toolCalls[0]?.function.name ?? `${r.text.length} caractere`,
      }
    },
  },
  {
    nume: 'recall-lung',
    async ruleaza(m) {
      const r = await cere(m, [
        { role: 'system', content: SYS_LUNG },
        userMsg('Care e codul de sală al depozitului?'),
      ])
      return { ok: r.text.toUpperCase().includes('QX-7734'), nota: scurt(r.text) }
    },
  },
  {
    nume: 'fara-inventie',
    async ruleaza(m) {
      const r = await cere(m, [
        { role: 'system', content: SYS_LUNG },
        userMsg('Conform STRICT instrucțiunilor tale de sistem, care e numărul de telefon al depozitului?'),
      ])
      const ok = !aInventatNumar(r.text) && /\bnu\b/i.test(r.text) && r.text.trim().length > 5
      return { ok, nota: scurt(r.text) }
    },
  },
  {
    nume: 'format-exact',
    async ruleaza(m) {
      const r = await cere(m, [userMsg('Descrie ce face soarele folosind EXACT trei cuvinte. Fără punctuație, fără alte explicații.')])
      const w = cuvinte(r.text)
      return { ok: w.length === 3, nota: w.join(' ').slice(0, 60) }
    },
  },
  {
    nume: 'cod-rationament',
    async ruleaza(m) {
      const r = await cere(m, [
        userMsg(
          'Ce întoarce funcția asta pentru intrarea "ana are mere si pere"?\n\n' +
            'function f(s) {\n  const w = s.split(" ")\n  let b = ""\n  for (const x of w) if (x.length > b.length) b = x\n  return b\n}\n\n' +
            'Răspunde DOAR cu valoarea întoarsă, fără ghilimele și fără explicații.',
        ),
      ])
      return { ok: /\bmere\b/i.test(r.text) && !/\bpere\b/i.test(r.text), nota: scurt(r.text) }
    },
  },
  {
    nume: 'lant-unelte',
    async ruleaza(m) {
      const p1 = await cere(m, [userMsg(CERERE_LANT)], UNELTE)
      const apel = p1.toolCalls[0]
      if (!apel || apel.function.name !== 'web_search') {
        return { ok: false, nota: `pasul 1: ${apel?.function.name ?? 'niciun apel'}` }
      }
      // Pasul 2 trece prin replay-ul apelului — deci probează și retrimiterea
      // semnăturii de gândire, fără de care Gemini 3.x refuză cu 400.
      const p2 = await cere(
        m,
        [
          userMsg(CERERE_LANT),
          { role: 'assistant', content: '', tool_calls: [apel] },
          { role: 'tool', tool_call_id: apel.id, content: 'Capitala Australiei este Canberra.' },
        ],
        UNELTE,
      )
      const alDoilea = p2.toolCalls[0]
      const ok = alDoilea?.function.name === 'send_email'
        ? /canberra/i.test(alDoilea.function.arguments)
        : /canberra/i.test(p2.text)
      const cePicat = alDoilea?.function.name ?? (scurt(p2.text) || 'niciun apel')
      return { ok, nota: ok ? 'ambii pași' : `pasul 2: ${cePicat}` }
    },
  },
]

/** Rulează TOATE sarciniile pe un model și întoarce scorul + dovada.
 *  O sarcină care aruncă (rețea, 400, timeout) e PICATĂ, nu ignorată — un model
 *  care crapă la o probă nu e „netestat", e nepotrivit. */
export async function probeazaModelComplet(cod: string): Promise<RezultatProba> {
  const model = cod.startsWith('google-direct/') ? cod.slice('google-direct/'.length) : cod
  const rez: RezultatProba = { model: cod, scor: 0, total: SARCINI.length, picate: [], detaliu: {} }
  for (const s of SARCINI) {
    try {
      const { ok, nota } = await s.ruleaza(model)
      rez.detaliu[s.nume] = nota
      if (ok) rez.scor++
      else rez.picate.push(s.nume)
    } catch (e) {
      rez.detaliu[s.nume] = `eroare: ${String(e).slice(0, 60)}`
      rez.picate.push(s.nume)
    }
  }
  return rez
}
