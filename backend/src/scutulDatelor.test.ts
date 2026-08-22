import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── SCUTUL DATELOR DE NEATINS (owner, 14 aug 2026) ───────────────────────────
//
// Ordinele, verbatim: „baza de date de utilizatori trebuie să nu se poată
// șterge niciodată, prin nicio comandă, să nu se poată suprascrie prin
// înlocuire ci doar prin adăugare cu validare, legată de sistemele de plăți"
// + „amprentele vocale trebuie să se păstreze".
//
// Scutul are DOUĂ straturi (triggere în Postgres + poarta din dbQuery) și un
// drum închis (ștergerea amprentelor). Testele de aici țin cele trei promisiuni
// în sursă — ca la poartaExecutiei, pentru cod care trăiește lângă pool-ul viu.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const db = sursa('./db.ts')
const rutaVoce = sursa('./routes/voiceprint.ts')

describe('stratul 1: triggerele din Postgres refuză DELETE/TRUNCATE', () => {
  it('lista protejată acoperă identitatea, banii și biometria', () => {
    for (const t of [
      'local_accounts', 'google_accounts', 'wallets', 'transactions',
      'billing_events', 'payment_codes', 'voiceprints', 'faceprints',
    ])
      expect(db, `tabelul ${t} lipsește din TABELE_PROTEJATE`).toMatch(new RegExp(`TABELE_PROTEJATE = \\[[^\\]]*'${t}'`))
  })

  it('scutul se ridică la initDb și pune ambele triggere (del + trunc)', () => {
    expect(db).toMatch(/await scutulDatelor\(\)/)
    expect(db).toMatch(/CREATE TRIGGER scut_\$\{t\}_del BEFORE DELETE/)
    expect(db).toMatch(/CREATE TRIGGER scut_\$\{t\}_trunc BEFORE TRUNCATE/)
    expect(db).toMatch(/RAISE EXCEPTION 'PROTEJAT/)
  })

  it('un scut care nu se poate ridica STRIGĂ, nu tace', () => {
    expect(db).toMatch(/\[scutul datelor\] nu s-a putut ridica/)
  })
})

describe('stratul 2: poarta din dbQuery — comenzile brute doar CITESC protejatele', () => {
  it('poarta stă ÎNAINTE de conexiunea la pool și refuză ne-citirile', () => {
    const bloc = /export async function dbQuery[\s\S]*?conexiuneDb\(\)/.exec(db)?.[0] ?? ''
    expect(bloc.length).toBeGreaterThan(200)
    expect(bloc).toMatch(/TABELE_PROTEJATE\.filter/)
    expect(bloc).toMatch(/tabel_protejat/)
    // Citirea rămâne liberă — dar de la 22 aug decide predicatul ÎNTĂRIT
    // eSqlDeCitire (nu primul cuvânt: verificatorul a demonstrat că
    // „WITH x AS (UPDATE wallets …) SELECT" ocolea scutul pe prefixul vechi).
    expect(bloc).toMatch(/const eCitire = eSqlDeCitire\(text\)/)
    expect(bloc).not.toMatch(/primulCuvant/)
  })
})

describe('drumul închis: amprentele vocale se păstrează', () => {
  it('nu mai există NICIUN `DELETE FROM voiceprints` în db.ts', () => {
    expect(db).not.toMatch(/DELETE FROM voiceprints/)
  })
  it('ruta de ștergere răspunde 403 cu motivul ordinului, nu șterge', () => {
    expect(rutaVoce).toMatch(/code\(403\)/)
    expect(rutaVoce).toMatch(/amprentele_se_pastreaza/)
    expect(rutaVoce).not.toMatch(/deleteVoiceprint/)
  })
})
