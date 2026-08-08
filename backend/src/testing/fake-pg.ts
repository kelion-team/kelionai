// ── PAPER POSTGRES, FOR TESTS ONLY ──────────────────────────────────────────
//
// The MONEY paths in db.ts (crediting, charging, refunds) can't be tested
// without a database — and they were exactly the ones with no tests. Instead
// of requiring Postgres in CI, the test runs on this tiny engine: it keeps
// `wallets`, `billing_events` and `transactions` in memory and understands
// EXACTLY the queries db.ts writes, with the semantics that matter for money:
//
//   • real BEGIN/COMMIT/ROLLBACK — a ROLLBACK really undoes everything written
//     since BEGIN (otherwise "half-credited" would pass as correct);
//   • the UNIQUE index on `ref` — a second credit on the same payment THROWS,
//     exactly like Postgres (the second line of idempotency defense);
//   • `ON CONFLICT ... DO UPDATE SET` evaluates the right side on the OLD row,
//     like Postgres — that's why `topup_ref = wallets.balance + $2` yields the
//     NEW balance;
//   • NUMERIC columns come back as STRINGS, like the `pg` driver — if the
//     caller forgets a Number(), the test sees it.
//
// What it does NOT know: any other query. On purpose — an unrecognized query
// THROWS, so a test can't pass "green" on code it never executed.

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

export interface CodRow {
  code: string
  user_email: string
  amount: number
  currency: string
  status: string
  bank_ref: string | null
  created_at: number
  paid_at: number | null
}
export interface NetRow {
  id: number
  bank_ref: string
  referinta: string
  amount: number
  currency: string
  status: string
  resolved_email: string | null
  seen_at: number
}

export interface Baza {
  wallets: Map<string, WalletRow>
  billing: BillingRow[]
  tx: TxRow[]
  // The money-mission tables (M2/M5, Aug 2): payment codes + the net.
  coduri: CodRow[]
  neatribuite: NetRow[]
}

export interface FakePg {
  baza: Baza
  /** All executed queries (for assertions on the SQL shape). */
  sqluri: string[]
  reset(): void
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>
}

/** The content between the paren opened at `start` and its match. */
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

/** Splits on the commas at level 0 (not those inside parens or quotes). */
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

/** Evaluates a VALUES expression: `$2`, `lower($1)`, `-($2::numeric)`, `'text'`. */
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

/** Evaluates the right side of a SET, on the OLD row (Postgres semantics). */
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
  const baza: Baza = { wallets: new Map(), billing: [], tx: [], coduri: [], neatribuite: [] }
  const sqluri: string[] = []
  let instantaneu: Baza | null = null
  let netId = 0

  const clona = (b: Baza): Baza => ({
    wallets: new Map([...b.wallets].map(([k, v]) => [k, { ...v }])),
    billing: b.billing.map((r) => ({ ...r })),
    tx: b.tx.map((r) => ({ ...r })),
    coduri: b.coduri.map((r) => ({ ...r })),
    neatribuite: b.neatribuite.map((r) => ({ ...r })),
  })
  const restaureaza = (b: Baza): void => {
    baza.wallets = b.wallets
    baza.billing = b.billing
    baza.tx = b.tx
    baza.coduri = b.coduri
    baza.neatribuite = b.neatribuite
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
        // uniq_billing_ref — a second credit on the same payment.
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

    if (tabela === 'payment_codes') {
      const code = String(rand.code ?? '')
      if (baza.coduri.some((c) => c.code === code))
        // The PRIMARY KEY on `code` — the collision `creeazaCodPlata` retries on.
        throw new Error('duplicate key value violates unique constraint "payment_codes_pkey"')
      baza.coduri.push({
        code,
        user_email: String(rand.user_email ?? ''),
        amount: Number(rand.amount ?? 0),
        currency: String(rand.currency ?? 'gbp'),
        status: 'pending',
        bank_ref: null,
        created_at: baza.coduri.length, // monotonic — enough for ORDER BY
        paid_at: null,
      })
      return { rows: [], rowCount: 1 }
    }

    if (tabela === 'plati_neatribuite') {
      const ref = String(rand.bank_ref ?? '')
      if (baza.neatribuite.some((n) => n.bank_ref === ref)) {
        // bank_ref UNIQUE: the reader re-sees old transactions forever.
        if (/ON CONFLICT \(bank_ref\) DO NOTHING/i.test(coada)) return gol
        throw new Error('duplicate key value violates unique constraint "plati_neatribuite_bank_ref_key"')
      }
      netId += 1
      baza.neatribuite.push({
        id: netId,
        bank_ref: ref,
        referinta: String(rand.referinta ?? ''),
        amount: Number(rand.amount ?? 0),
        currency: String(rand.currency ?? 'gbp'),
        status: 'noua',
        resolved_email: null,
        seen_at: netId,
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

    // ── payment_codes (M5, Aug 2) ────────────────────────────────────────────
    if (/^SELECT user_email FROM payment_codes WHERE code = \$1 AND status = 'pending' FOR UPDATE$/i.test(q)) {
      const c = baza.coduri.find((x) => x.code === p[0] && x.status === 'pending')
      return { rows: c ? [{ user_email: c.user_email }] : [], rowCount: c ? 1 : 0 }
    }
    if (/^UPDATE payment_codes SET status = 'paid', bank_ref = \$2, paid_at = now\(\), amount = \$3 WHERE code = \$1 AND status = 'pending'$/i.test(q)) {
      const c = baza.coduri.find((x) => x.code === p[0] && x.status === 'pending')
      if (!c) return gol
      c.status = 'paid'
      c.bank_ref = String(p[1])
      c.amount = Number(p[2])
      c.paid_at = Date.now()
      return { rows: [], rowCount: 1 }
    }
    if (/^SELECT code, amount, currency FROM payment_codes WHERE user_email = \$1 AND status = 'pending' AND created_at > now\(\) - interval '2 hours' ORDER BY created_at DESC LIMIT 1$/i.test(q)) {
      const ale = baza.coduri.filter((x) => x.user_email === p[0] && x.status === 'pending')
      const c = ale.at(-1)
      return { rows: c ? [{ code: c.code, amount: nr(c.amount), currency: c.currency }] : [], rowCount: c ? 1 : 0 }
    }
    if (/^SELECT status, count\(\*\)::int AS n FROM payment_codes GROUP BY status$/i.test(q)) {
      const pe = new Map<string, number>()
      for (const c of baza.coduri) pe.set(c.status, (pe.get(c.status) ?? 0) + 1)
      return { rows: [...pe].map(([status, n]) => ({ status, n })), rowCount: pe.size }
    }
    if (/^SELECT code, user_email, amount, currency, status, created_at, paid_at FROM payment_codes ORDER BY created_at DESC LIMIT 30$/i.test(q)) {
      const rows = [...baza.coduri].reverse().slice(0, 30).map((c) => ({
        code: c.code,
        user_email: c.user_email,
        amount: nr(c.amount),
        currency: c.currency,
        status: c.status,
        created_at: String(c.created_at),
        paid_at: c.paid_at === null ? null : String(c.paid_at),
      }))
      return { rows, rowCount: rows.length }
    }

    // ── plati_neatribuite (M2/M5, Aug 2) ─────────────────────────────────────
    if (/^SELECT id, bank_ref, referinta, amount, currency, status, seen_at FROM plati_neatribuite WHERE status = 'noua' ORDER BY seen_at DESC LIMIT \$1$/i.test(q)) {
      const rows = baza.neatribuite
        .filter((n) => n.status === 'noua')
        .reverse()
        .slice(0, Number(p[0] ?? 50))
        .map((n) => ({
          id: n.id,
          bank_ref: n.bank_ref,
          referinta: n.referinta,
          amount: nr(n.amount),
          currency: n.currency,
          status: n.status,
          seen_at: String(n.seen_at),
        }))
      return { rows, rowCount: rows.length }
    }
    if (/^SELECT bank_ref, amount, currency FROM plati_neatribuite WHERE id = \$1 AND status = 'noua'$/i.test(q)) {
      const n = baza.neatribuite.find((x) => x.id === Number(p[0]) && x.status === 'noua')
      return { rows: n ? [{ bank_ref: n.bank_ref, amount: nr(n.amount), currency: n.currency }] : [], rowCount: n ? 1 : 0 }
    }
    if (/^UPDATE plati_neatribuite SET status = 'atribuita', resolved_email = \$2, resolved_at = now\(\) WHERE id = \$1 AND status = 'noua'$/i.test(q)) {
      const n = baza.neatribuite.find((x) => x.id === Number(p[0]) && x.status === 'noua')
      if (!n) return gol
      n.status = 'atribuita'
      n.resolved_email = String(p[1])
      return { rows: [], rowCount: 1 }
    }
    if (/^UPDATE plati_neatribuite SET status = 'ignorata', resolved_at = now\(\) WHERE id = \$1 AND status = 'noua'$/i.test(q)) {
      const n = baza.neatribuite.find((x) => x.id === Number(p[0]) && x.status === 'noua')
      if (!n) return gol
      n.status = 'ignorata'
      return { rows: [], rowCount: 1 }
    }
    if (/^SELECT count\(\*\)::int AS n FROM plati_neatribuite WHERE status = 'noua'$/i.test(q)) {
      return { rows: [{ n: baza.neatribuite.filter((x) => x.status === 'noua').length }], rowCount: 1 }
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
      baza.coduri.length = 0
      baza.neatribuite.length = 0
      netId = 0
      sqluri.length = 0
      instantaneu = null
    },
    query,
  }
}
