// ── POSTGRES DE HÂRTIE, DOAR PENTRU TESTE ───────────────────────────────────
//
// Căile cu BANI din db.ts (creditare, taxare, refund) nu se pot testa fără o
// bază de date — și tocmai ele n-aveau niciun test. În loc să ceară Postgres în
// CI, testul rulează pe motorul ăsta minuscul: ține `wallets`, `billing_events`
// și `transactions` în memorie și înțelege EXACT interogările pe care le scrie
// db.ts, cu semanticile care contează pentru bani:
//
//   • BEGIN/COMMIT/ROLLBACK reale — un ROLLBACK chiar anulează tot ce s-a scris
//     de la BEGIN (altfel „s-a creditat pe jumătate" ar trece drept corect);
//   • indexul UNIC pe `ref` — a doua creditare pe aceeași plată ARUNCĂ,
//     exact ca Postgres (a doua linie de apărare a idempotenței);
//   • `ON CONFLICT ... DO UPDATE SET` evaluează partea dreaptă pe rândul VECHI,
//     ca Postgres — de asta `topup_ref = wallets.balance + $2` iese NOUL sold;
//   • coloanele NUMERIC se întorc ca ȘIRURI, ca driverul `pg` — dacă apelantul
//     uită un Number(), testul o vede.
//
// Ce NU știe: orice altă interogare. Intenționat — o interogare nerecunoscută
// ARUNCĂ, ca testul să nu treacă „verde" pe cod pe care nu l-a executat.

export interface WalletRow {
  user_email: string
  balance: number
  currency: string
  topup_ref: number
}
export interface BillingRow {
  user_email: string
  kind: string
  amount: number
  ref: string | null
  meta: string | null
}
export interface TxRow {
  user_id: string
  amount: number
  credits: number
  status: string
  payment_ref: string | null
}

export interface Baza {
  wallets: Map<string, WalletRow>
  billing: BillingRow[]
  tx: TxRow[]
}

export interface FakePg {
  baza: Baza
  /** Toate interogările executate (pentru verificări pe forma SQL-ului). */
  sqluri: string[]
  reset(): void
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>
}

/** Conținutul dintre paranteza deschisă de la `start` și perechea ei. */
function balansat(s: string, start: number): { corp: string; end: number } {
  let adancime = 0
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') adancime++
    else if (s[i] === ')') {
      adancime--
      if (adancime === 0) return { corp: s.slice(start + 1, i), end: i }
    }
  }
  throw new Error(`fake-pg: paranteză nebalansată în „${s}"`)
}

/** Împarte pe virgulele de la nivelul 0 (nu cele din paranteze sau ghilimele). */
function bucati(s: string): string[] {
  const out: string[] = []
  let adancime = 0
  let inGhilimele = false
  let cur = ''
  for (const ch of s) {
    if (ch === "'") inGhilimele = !inGhilimele
    if (!inGhilimele) {
      if (ch === '(') adancime++
      else if (ch === ')') adancime--
      else if (ch === ',' && adancime === 0) {
        out.push(cur.trim())
        cur = ''
        continue
      }
    }
    cur += ch
  }
  out.push(cur.trim())
  return out
}

/** Evaluează o expresie din VALUES: `$2`, `lower($1)`, `-($2::numeric)`, `'text'`. */
function valoare(expr: string, p: unknown[]): unknown {
  const e = expr.trim()
  let m: RegExpMatchArray | null
  if ((m = e.match(/^lower\(\$(\d+)\)$/i))) return String(p[Number(m[1]) - 1] ?? '').toLowerCase()
  if ((m = e.match(/^-\(\$(\d+)::numeric\)$/i))) return -Number(p[Number(m[1]) - 1])
  if ((m = e.match(/^\$(\d+)(::numeric)?$/))) return p[Number(m[1]) - 1]
  if ((m = e.match(/^'(.*)'$/s))) return m[1]
  if (/^now\(\)$/i.test(e)) return 'now()'
  if (/^null$/i.test(e)) return null
  if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e)
  throw new Error(`fake-pg: expresie necunoscută „${e}"`)
}

/** Evaluează partea dreaptă a unui SET, pe rândul VECHI (semantica Postgres). */
function valoareSet(expr: string, vechi: Record<string, unknown>, p: unknown[]): unknown {
  const m = expr.match(/^(\w+)\.(\w+)\s*([+-])\s*(.+)$/)
  if (m) {
    const baza = Number(vechi[m[2]] ?? 0)
    const delta = Number(valoare(m[4], p))
    return m[3] === '+' ? baza + delta : baza - delta
  }
  const m2 = expr.match(/^(\w+)\s*([+-])\s*(.+)$/)
  if (m2 && !m2[1].startsWith('$') && !expr.startsWith("'")) {
    const baza = Number(vechi[m2[1]] ?? 0)
    const delta = Number(valoare(m2[3], p))
    return m2[2] === '+' ? baza + delta : baza - delta
  }
  return valoare(expr, p)
}

const nr = (v: unknown): string => String(Number(v ?? 0))

export function creeazaFakePg(): FakePg {
  const baza: Baza = { wallets: new Map(), billing: [], tx: [] }
  const sqluri: string[] = []
  let instantaneu: Baza | null = null

  const clona = (b: Baza): Baza => ({
    wallets: new Map([...b.wallets].map(([k, v]) => [k, { ...v }])),
    billing: b.billing.map((r) => ({ ...r })),
    tx: b.tx.map((r) => ({ ...r })),
  })
  const restaureaza = (b: Baza): void => {
    baza.wallets = b.wallets
    baza.billing = b.billing
    baza.tx = b.tx
  }

  const gol = { rows: [] as Record<string, unknown>[], rowCount: 0 }

  function insereaza(q: string, p: unknown[]): { rows: Record<string, unknown>[]; rowCount: number } {
    const cap = q.match(/^INSERT INTO (\w+)\s*\(/i)
    if (!cap) throw new Error(`fake-pg: INSERT nerecunoscut „${q}"`)
    const tabela = cap[1]
    const coloane = balansat(q, q.indexOf('(', cap[0].length - 1))
    const cols = bucati(coloane.corp).map((c) => c.trim())
    const idxValues = q.toUpperCase().indexOf('VALUES', coloane.end)
    const tuplu = balansat(q, q.indexOf('(', idxValues))
    const vals = bucati(tuplu.corp).map((v) => valoare(v, p))
    const coada = q.slice(tuplu.end + 1).trim()

    const rand: Record<string, unknown> = {}
    cols.forEach((c, i) => {
      rand[c] = vals[i]
    })

    if (tabela === 'billing_events') {
      const ref = (rand.ref as string | undefined) ?? null
      if (ref !== null && baza.billing.some((r) => r.ref === ref)) {
        // uniq_billing_ref — a doua creditare pe aceeași plată.
        if (/ON CONFLICT DO NOTHING/i.test(coada)) return gol
        throw new Error('duplicate key value violates unique constraint "uniq_billing_ref"')
      }
      baza.billing.push({
        user_email: String(rand.user_email ?? ''),
        kind: String(rand.kind ?? ''),
        amount: Number(rand.amount ?? 0),
        ref,
        meta: (rand.meta as string | undefined) ?? null,
      })
      return { rows: [], rowCount: 1 }
    }

    if (tabela === 'wallets') {
      const cheie = String(rand.user_email ?? '')
      const vechi = baza.wallets.get(cheie)
      if (vechi) {
        const set = coada.match(/DO UPDATE SET (.+)$/i)
        if (!set) throw new Error(`fake-pg: conflict pe wallets fără DO UPDATE „${q}"`)
        const noi: Record<string, unknown> = {}
        for (const buc of bucati(set[1])) {
          const [col, ...rest] = buc.split('=')
          noi[col.trim()] = valoareSet(rest.join('=').trim(), vechi as unknown as Record<string, unknown>, p)
        }
        if ('balance' in noi) vechi.balance = Number(noi.balance)
        if ('topup_ref' in noi) vechi.topup_ref = Number(noi.topup_ref)
        if ('currency' in noi) vechi.currency = String(noi.currency)
        return { rows: [], rowCount: 1 }
      }
      baza.wallets.set(cheie, {
        user_email: cheie,
        balance: Number(rand.balance ?? 0),
        currency: String(rand.currency ?? 'gbp'),
        topup_ref: Number(rand.topup_ref ?? 0),
      })
      return { rows: [], rowCount: 1 }
    }

    if (tabela === 'transactions') {
      const ref = (rand.payment_ref as string | undefined) ?? null
      const vechi = ref ? baza.tx.find((t) => t.payment_ref === ref) : undefined
      if (vechi) {
        const set = coada.match(/DO UPDATE SET (.+)$/i)
        if (!set) throw new Error('duplicate key value violates unique constraint "uniq_transactions_ref"')
        for (const buc of bucati(set[1])) {
          const [col, ...rest] = buc.split('=')
          if (col.trim() === 'status') vechi.status = String(valoare(rest.join('=').trim(), p))
        }
        return { rows: [], rowCount: 1 }
      }
      baza.tx.push({
        user_id: String(rand.user_id ?? ''),
        amount: Number(rand.amount ?? 0),
        credits: Number(rand.credits ?? 0),
        status: String(rand.status ?? 'pending'),
        payment_ref: ref,
      })
      return { rows: [], rowCount: 1 }
    }

    throw new Error(`fake-pg: tabelă necunoscută „${tabela}"`)
  }

  async function query(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    const q = sql.replace(/\s+/g, ' ').trim()
    sqluri.push(q)
    const p = params

    if (/^BEGIN$/i.test(q)) {
      instantaneu = clona(baza)
      return gol
    }
    if (/^COMMIT$/i.test(q)) {
      instantaneu = null
      return gol
    }
    if (/^ROLLBACK$/i.test(q)) {
      if (instantaneu) restaureaza(instantaneu)
      instantaneu = null
      return gol
    }

    let m: RegExpMatchArray | null

    if (/^SELECT 1 FROM billing_events WHERE ref = \$1$/i.test(q)) {
      const n = baza.billing.filter((r) => r.ref === p[0]).length
      return { rows: Array.from({ length: n }, () => ({ '?column?': 1 })), rowCount: n }
    }

    if (/^SELECT balance FROM wallets WHERE user_email = (\$1|lower\(\$1\))$/i.test(q)) {
      const cheie = /lower/i.test(q) ? String(p[0]).toLowerCase() : String(p[0])
      const w = baza.wallets.get(cheie)
      return { rows: w ? [{ balance: nr(w.balance) }] : [], rowCount: w ? 1 : 0 }
    }

    if (/^SELECT balance, topup_ref FROM wallets WHERE user_email = (\$1|lower\(\$1\))$/i.test(q)) {
      const cheie = /lower/i.test(q) ? String(p[0]).toLowerCase() : String(p[0])
      const w = baza.wallets.get(cheie)
      return {
        rows: w ? [{ balance: nr(w.balance), topup_ref: nr(w.topup_ref) }] : [],
        rowCount: w ? 1 : 0,
      }
    }

    if (/^INSERT INTO/i.test(q)) return insereaza(q, p)

    throw new Error(`fake-pg: interogare neacoperită de motorul de test → „${q}"`)
  }

  return {
    baza,
    sqluri,
    reset() {
      baza.wallets.clear()
      baza.billing.length = 0
      baza.tx.length = 0
      sqluri.length = 0
      instantaneu = null
    },
    query,
  }
}
