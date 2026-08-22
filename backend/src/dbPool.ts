import pg from 'pg'
import { config } from './config.js'

// ── VIAȚA CONEXIUNILOR POSTGRES — un singur modul responsabil ────────────────
// CAUZA REALĂ a lui `uncaughtException: terminating connection due to
// administrator command`: `new pg.Pool(...)` se năștea în db.ts FĂRĂ nicio
// ureche pe evenimentul `error`. În `pg-pool`, când serverul închide o
// conexiune care stă în repaus (restart de Postgres, `pg_terminate_backend`,
// mentenanță pe gazdă), clientul primește eroarea pe socket și pool-ul face
// `pool.emit('error', err, client)`. Un `EventEmitter` care emite `error` fără
// ascultător ARUNCĂ — deci eroarea ieșea din orice `try/catch` (nu era în
// niciun query) și lovea `process.on('uncaughtException')` din index.ts. De
// aici stiva fără nicio linie de-a noastră: parser → Socket.emit.
// A doua gaură, aceeași clasă: la `pool.connect()`, pg-pool ȘTERGE ascultătorul
// de eroare al clientului împrumutat (`_acquireClient` → `removeListener`), așa
// că un client ținut între două query-uri (tranzacțiile din db.ts) rămânea
// complet descoperit. `conexiuneDb()` pune ureche pe toată durata împrumutului
// și predă clientul rupt pool-ului la eliberare, ca să fie distrus, nu reciclat.
//
// Erorile de conexiune pierdută NU sunt defecte ale aplicației: se notează la
// nivel `warn` (deci nu mai umplu inelul de erori care declanșa autovindecarea)
// și rămân numărate pentru diagnostic.

export type MotivPool = 'conexiune-pierduta' | 'eroare-conexiune'

/** Semnăturile prin care Postgres/socketul spun „conexiunea asta s-a dus".
 *  Sunt cauze de INFRASTRUCTURĂ (repornire, mentenanță, rețea), nu bug-uri:
 *  pool-ul aruncă clientul și deschide altul la următorul query. */
const SEMNATURI_CONEXIUNE_PIERDUTA = [
  'terminating connection due to administrator command',
  'terminating connection due to unexpected postmaster exit',
  'terminating connection because of crash of another server process',
  'the database system is shutting down',
  'the database system is starting up',
  'connection terminated unexpectedly',
  'connection terminated',
  'server closed the connection unexpectedly',
  'client has encountered a connection error',
]

const CODURI_SOCKET_PIERDUT = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', '57P01', '57P02', '57P03', '08006', '08003']

function textEroare(err: unknown): string {
  if (err instanceof Error) return `${err.message}`
  if (typeof err === 'object' && err !== null) {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string') return m
  }
  return String(err ?? '')
}

function codEroare(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const c = (err as { code?: unknown }).code
    if (typeof c === 'string') return c.toUpperCase()
  }
  return ''
}

/** Funcție PURĂ (testată): eroarea vine dintr-o conexiune închisă de partea
 *  cealaltă, nu dintr-un defect al aplicației? */
export function esteConexiunePierduta(err: unknown): boolean {
  const mesaj = textEroare(err).toLowerCase()
  if (SEMNATURI_CONEXIUNE_PIERDUTA.some((s) => mesaj.includes(s))) return true
  const cod = codEroare(err)
  return cod !== '' && CODURI_SOCKET_PIERDUT.includes(cod)
}

/** Reglajele pool-ului vin din env (sursă vie, schimbabilă fără deploy):
 *  gazda își reporneaște Postgres-ul, deci conexiunile trebuie să se recicleze
 *  singure și să nu aștepte la infinit. */
function numar(nume: string, implicit: number, minim: number): number {
  const brut = Number(process.env[nume] ?? implicit)
  return Number.isFinite(brut) && brut >= minim ? brut : implicit
}

/** Funcție PURĂ (testată): TLS-ul cerut de ținta din `DATABASE_URL`.
 *  Postgres local (aceeași mașină, `sslmode=disable`) merge fără TLS; orice
 *  altă țintă primește TLS cu certificat self-signed acceptat (proxy-uri). */
export function optiuniPool(url: string): pg.PoolConfig {
  const faraTls = /sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1)[:/]/.test(url)
  return {
    connectionString: url,
    ssl: faraTls ? false : { rejectUnauthorized: false },
    max: numar('DB_POOL_MAX', 10, 1),
    idleTimeoutMillis: numar('DB_IDLE_TIMEOUT_MS', 30_000, 1_000),
    connectionTimeoutMillis: numar('DB_CONNECT_TIMEOUT_MS', 10_000, 1_000),
    // Conexiunile nu îmbătrânesc la infinit: una reciclată din vreme e una pe
    // care mentenanța gazdei nu mai are ce să ne-o taie sub mână.
    maxLifetimeSeconds: numar('DB_MAX_LIFETIME_SEC', 1_800, 1),
    keepAlive: true,
  }
}

export interface StarePool {
  /** Câte erori de conexiune pierdută am înghițit (infrastructură). */
  conexiuniPierdute: number
  /** Câte alte erori de pool am notat. */
  erori: number
  ultimaEroare: string
  ultimaEroareLa: string
}

const stare: StarePool = { conexiuniPierdute: 0, erori: 0, ultimaEroare: '', ultimaEroareLa: '' }

/** Numărătoarea pentru diagnostic (autodiagnostic / server_logs). */
export function starePool(): StarePool {
  return { ...stare }
}

function noteazaEroare(err: unknown, unde: string): MotivPool {
  const mesaj = textEroare(err).slice(0, 300)
  stare.ultimaEroare = `${unde}: ${mesaj}`
  stare.ultimaEroareLa = new Date().toISOString()
  if (esteConexiunePierduta(err)) {
    stare.conexiuniPierdute += 1
    // WARN, nu ERROR: gazda a închis conexiunea, aplicația e sănătoasă și
    // pool-ul deschide alta la următorul query. Rămâne vizibil în inel.
    console.warn(`[db] conexiune închisă de server (${unde}), pool-ul o înlocuiește: ${mesaj}`)
    return 'conexiune-pierduta'
  }
  stare.erori += 1
  console.error(`[db] eroare pe conexiune (${unde}): ${mesaj}`)
  return 'eroare-conexiune'
}

let pool: pg.Pool | null = null

/** Pool-ul unic al aplicației, cu urechea pe `error` pusă LA NAȘTERE. */
export function getPool(): pg.Pool {
  if (!pool) {
    const nou = new pg.Pool(optiuniPool(config.databaseUrl))
    // FĂRĂ ăsta, procesul cade: `pool.emit('error')` fără ascultător aruncă.
    nou.on('error', (err) => {
      noteazaEroare(err, 'client în repaus')
    })
    pool = nou
  }
  return pool
}

/** Pune urechea pe clientul împrumutat și face `release()` idempotent: o
 *  eroare de socket între două query-uri e notată (nu mai urcă necuprinsă),
 *  iar clientul rupt e predat pool-ului CU eroarea, ca să fie distrus, nu
 *  întors în inel. Separat de `conexiuneDb` ca să fie testabil fără Postgres. */
export function imbracaClientImprumutat(client: pg.PoolClient): pg.PoolClient {
  let rupt: Error | null = null
  const laEroare = (err: Error): void => {
    rupt = err instanceof Error ? err : new Error(textEroare(err))
    noteazaEroare(err, 'client împrumutat')
  }
  client.on('error', laEroare)

  const eliberareOriginala = client.release.bind(client)
  let eliberat = false
  client.release = ((err?: Error | boolean): void => {
    if (eliberat) return
    eliberat = true
    client.removeListener('error', laEroare)
    const motiv = err instanceof Error ? err : rupt
    eliberareOriginala(motiv ?? undefined)
  }) as pg.PoolClient['release']

  return client
}

/** Împrumută un client acoperit pentru o tranzacție. */
export async function conexiuneDb(): Promise<pg.PoolClient> {
  return imbracaClientImprumutat(await getPool().connect())
}

/** Închide pool-ul (oprire curată / teste). Următorul `getPool()` naște altul. */
export async function inchidePool(): Promise<void> {
  const curent = pool
  pool = null
  if (!curent) return
  try {
    await curent.end()
  } catch (e) {
    noteazaEroare(e, 'închidere pool')
  }
}
