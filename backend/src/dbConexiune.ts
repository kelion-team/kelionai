// ── CONEXIUNEA LA POSTGRES: ȚINTA, CLASIFICAREA ȘI RĂBDAREA ──────────────────
//
// AUTO-VINDECARE (server.logbuffer, 21 aug, count=2, prag=2):
//   `route error err: connect ECONNREFUSED 127.0.0.1:5432`
//
// CAUZA REALĂ, măsurată (nu presupusă). Nașterea pool-ului stătea în `db.ts`:
//   pool = new pg.Pool({ connectionString: config.databaseUrl, ssl })
// și `config.databaseUrl` e `''` când `DATABASE_URL`/`POSTGRES_URL` lipsește sau
// e stricată (ghilimele/spații/prefix — vezi `deploy/deploy.sh`, unde un
// `ADMIN_EMAIL` cu ghilimele a rupt deja adminul o dată). Măsurătoare pe `pg`
// (node -e, pg 8, în repo):
//   new pg.Pool({ connectionString: '' }).query('SELECT 1')
//     → AggregateError [ECONNREFUSED], message = '' (GOL!), iar sub-erorile:
//       connect ECONNREFUSED ::1:5432 / connect ECONNREFUSED 127.0.0.1:5432
//   parse('"postgres://u:p@10.0.0.5:5432/kelion"')  (cu ghilimele)
//     → { host: 'base', database: '"postgres://u:p@10.0.0.5:5432/kelion"' }
// Adică: pe o țintă GOALĂ sau STRICATĂ, driverul NU se plânge — își INVENTEAZĂ
// una (localhost:5432, sau o gazdă din cioburi) și lovește un Postgres fantomă
// până la refuz. Eroarea ajunge brută în rută (500 + `route error`), inelul de
// loguri se umple, iar autovindecarea deschide ordine de REPARAT COD pentru un
// defect care nu e în cod. Tot pe drumul ăsta: `AggregateError` cu mesaj GOL,
// deci logul nu spune nici măcar unde a încercat să se ducă.
//
// MODULUL ĂSTA e răspunsul, și e singurul responsabil de conexiune:
//   1. ȚINTA se citește și se VALIDEAZĂ înainte de orice socket — goală sau
//      nevalidă = eroare pe față, cu motiv, NU un pool ghicit pe 127.0.0.1.
//   2. Erorile de CONECTARE (înainte ca vreo interogare să plece spre server) se
//      recunosc pe cod, inclusiv în `AggregateError`, și se DESCRIU cu ținta
//      reală — niciun mesaj gol.
//   3. RĂBDARE mărginită: o repornire de Postgres de câteva sute de ms nu mai
//      pică cererea (reîncercări doar pe clasa „nu s-a deschis conexiunea", deci
//      fără risc de a executa a doua oară o scriere).
//   4. Când nici răbdarea nu ajunge: `BazaIndisponibila` (statusCode 503) —
//      infrastructură lipsă, nu defect al aplicației. `index.ts` o notează la
//      nivel `warn` și NU o mai bagă în simptomele care declanșează ordine.
import pg from 'pg'

/** Portul implicit al protocolului Postgres (nu o cifră de business). */
const PORT_IMPLICIT = 5432

export interface TintaDbBuna {
  ok: true
  /** URL-ul curățat, exact cum se dă driverului. */
  url: string
  gazda: string
  port: number
  baza: string
  /** TLS pornit? (local/`sslmode=disable` = fără TLS, ca pe VPS.) */
  tls: boolean
  /** `gazdă:port/bază` — pentru loguri și diagnostic; fără user/parolă. */
  eticheta: string
}

export interface TintaDbRea {
  ok: false
  /** De ce nu e bună, în clar (intră direct în mesajul de eroare). */
  motiv: string
}

export type TintaDb = TintaDbBuna | TintaDbRea

/**
 * Citește ȚINTA din valoarea de env, fără să inventeze nimic.
 * Ghilimelele/spațiile din jur (clasa de stricăciuni din env-file) se curăță;
 * orice altceva nevalid se RAPORTEAZĂ, nu se completează cu implicituri.
 */
export function citesteTintaDb(brut: string | undefined | null): TintaDb {
  const curat = String(brut ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim()
  if (!curat) return { ok: false, motiv: 'e goală (DATABASE_URL / POSTGRES_URL lipsește)' }
  if (!/^postgres(ql)?:\/\//i.test(curat))
    return { ok: false, motiv: 'nu începe cu postgres:// sau postgresql://' }
  let u: URL
  try {
    u = new URL(curat)
  } catch {
    return { ok: false, motiv: 'nu e o adresă validă' }
  }
  const gazda = u.hostname
  if (!gazda) return { ok: false, motiv: 'nu are gazdă' }
  const port = Number(u.port || PORT_IMPLICIT)
  if (!Number.isInteger(port) || port <= 0) return { ok: false, motiv: `are un port nevalid („${u.port}")` }
  const baza = decodeURIComponent(u.pathname.replace(/^\//, ''))
  // Postgres local/pe aceeași mașină (VPS, `--network host`) sau `sslmode=disable`
  // explicit → fără TLS; orice altă țintă primește TLS cu certificat self-signed
  // acceptat (proxy-urile gestionate).
  const local = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(gazda)
  const faraTls = /sslmode=disable/i.test(curat) || local
  return { ok: true, url: curat, gazda, port, baza, tls: !faraTls, eticheta: `${gazda}:${port}/${baza || '(fără bază)'}` }
}

/** Semnătura de eroare a unei conexiuni care NU s-a deschis. */
const CODURI_CONEXIUNE = new Set([
  'ECONNREFUSED', // nu ascultă nimeni pe gazdă:port (Postgres oprit / repornire)
  'ENOTFOUND', // gazda nu se rezolvă
  'EAI_AGAIN', // DNS temporar indisponibil
  'EHOSTUNREACH',
  'ENETUNREACH',
  '57P03', // Postgres: cannot_connect_now (pornește / recuperează)
])

/** Mesajele pg-ului pentru „n-am reușit să deschid conexiunea" (fără cod). */
const TEXTE_CONEXIUNE =
  /timeout exceeded when trying to connect|connection terminated due to connection timeout|the database system is (starting up|shutting down)/i

function coduri(err: unknown, adancime = 0): string[] {
  if (!err || typeof err !== 'object' || adancime > 3) return []
  const e = err as { code?: unknown; errors?: unknown[]; cause?: unknown; message?: unknown }
  const out: string[] = []
  if (typeof e.code === 'string') out.push(e.code)
  if (typeof e.message === 'string' && TEXTE_CONEXIUNE.test(e.message)) out.push('ECONNREFUSED')
  if (Array.isArray(e.errors)) for (const sub of e.errors) out.push(...coduri(sub, adancime + 1))
  if (e.cause) out.push(...coduri(e.cause, adancime + 1))
  return out
}

/**
 * Motivul de conexiune (codul), dacă eroarea e din clasa „conexiunea nu s-a
 * deschis" — deci NICIO interogare n-a plecat spre server și reîncercarea e
 * sigură. `null` = altceva (eroare de SQL, de date, de aplicație): se lasă exact
 * cum e, neatinsă.
 */
export function motivConexiune(err: unknown): string | null {
  for (const c of coduri(err)) if (CODURI_CONEXIUNE.has(c)) return c
  return null
}

/** Baza de date nu răspunde: INFRASTRUCTURĂ (503), nu defect al aplicației. */
export class BazaIndisponibila extends Error {
  readonly statusCode = 503
  readonly bazaIndisponibila = true
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'BazaIndisponibila'
  }
}

export function esteBazaIndisponibila(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { bazaIndisponibila?: unknown }).bazaIndisponibila === true)
}

export interface PoliticaReincercare {
  /** Câte reîncercări DUPĂ prima încercare. */
  reincercari: number
  /** Pauza de bază între încercări (crește liniar cu numărul încercării). */
  pauzaMs: number
  /** Cât așteaptă pg să se deschidă conexiunea. */
  timeoutConectareMs: number
}

/**
 * Politica din env — nimic înfipt în cod pe drumul viu. Marginile țin regula de
 * latență (chat/voce: prima vorbă sub 1s): implicit 2 reîncercări × ~120ms, deci
 * o repornire scurtă de Postgres se acoperă fără să se simtă.
 */
export function politicaDinEnv(env: NodeJS.ProcessEnv = process.env): PoliticaReincercare {
  const nr = (nume: string, implicit: number, min: number, max: number): number => {
    const brut = String(env[nume] ?? '').trim()
    const v = Number(brut)
    if (!brut || !Number.isFinite(v)) return implicit
    return Math.min(max, Math.max(min, Math.round(v)))
  }
  return {
    reincercari: nr('DB_CONNECT_RETRIES', 2, 0, 10),
    pauzaMs: nr('DB_RETRY_DELAY_MS', 120, 0, 5_000),
    timeoutConectareMs: nr('DB_CONNECT_TIMEOUT_MS', 4_000, 500, 60_000),
  }
}

/** Ce s-a întâmplat, cu ținta REALĂ în mesaj (pg lasă `AggregateError` cu mesaj gol). */
export function descrieEroareConexiune(
  motiv: string,
  tinta: TintaDbBuna,
  incercari: number,
  durataMs: number,
): string {
  return `baza de date nu răspunde: ${motiv} la ${tinta.eticheta} (${incercari} încercări, ${durataMs}ms)`
}

const asteapta = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function cuRabdare<T>(
  fn: () => Promise<T>,
  tinta: TintaDbBuna,
  politica: PoliticaReincercare,
): Promise<T> {
  const start = Date.now()
  let motiv = ''
  let ultima: unknown
  for (let i = 0; i <= politica.reincercari; i++) {
    try {
      return await fn()
    } catch (e) {
      const m = motivConexiune(e)
      if (!m) throw e // nu e conexiune: eroarea rămâne exact cum e
      motiv = m
      ultima = e
      if (i < politica.reincercari) await asteapta(politica.pauzaMs * (i + 1))
    }
  }
  throw new BazaIndisponibila(
    descrieEroareConexiune(motiv, tinta, politica.reincercari + 1, Date.now() - start),
    { cause: ultima },
  )
}

/**
 * Pool-ul viu: țintă validată, timeout de conectare din env, `keepAlive`, iar
 * `query`/`connect` îmbrăcate în răbdarea de mai sus. Toți consumatorii merg
 * prin `getPool()` (db.ts), deci nu există al doilea drum spre Postgres.
 *
 * Aruncă `BazaIndisponibila` când ținta nu e validă — mai bine o eroare care
 * SPUNE ce lipsește decât un pool ghicit pe 127.0.0.1:5432.
 */
export function creeazaPoolDb(
  brut: string | undefined | null,
  politica: PoliticaReincercare = politicaDinEnv(),
): pg.Pool {
  const tinta = citesteTintaDb(brut)
  if (!tinta.ok)
    throw new BazaIndisponibila(
      `adresa bazei de date ${tinta.motiv} — nu deschid o conexiune ghicită pe 127.0.0.1:${PORT_IMPLICIT}`,
    )

  const pool = new pg.Pool({
    connectionString: tinta.url,
    ssl: tinta.tls ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: politica.timeoutConectareMs,
    keepAlive: true,
  })

  type Metoda = (...args: unknown[]) => unknown
  const queryOriginal = pool.query.bind(pool) as unknown as Metoda
  const connectOriginal = pool.connect.bind(pool) as unknown as Metoda

  const imbraca = (original: Metoda): Metoda =>
    (...args: unknown[]): unknown => {
      // Forma cu callback (nefolosită în cod) se predă NEATINSĂ, ca să nu
      // schimbăm semantica driverului.
      if (typeof args[args.length - 1] === 'function') return original(...args)
      return cuRabdare(() => original(...args) as Promise<unknown>, tinta, politica)
    }

  pool.query = imbraca(queryOriginal) as unknown as typeof pool.query
  pool.connect = imbraca(connectOriginal) as unknown as typeof pool.connect

  return pool
}
