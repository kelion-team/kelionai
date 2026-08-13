import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ─────────────────────────────────────────────────────────────────────────────
// LACĂT — RAPORTUL DE VIZITATORI ARATĂ „CE AU VIZITAT" (owner, 13 aug 2026:
// „dacă la raport nu am și ce au vizitat, nu mă ajută cu nimic") + GOLIREA bazei
// de vizitatori conform GDPR („golești baza de date de vizitatori, cine va fi
// acolo va avea o poză cu acceptul lor").
//
// Fără testul ăsta, o sesiune viitoare ar putea „curăța" plumbing-ul (coloana
// pages, path-ul pe beacon/ping, coloana din raport) fără să știe că exact aia
// era cerința. Fiecare aserție de mai jos ține un capăt al firului CE→raport.
// ─────────────────────────────────────────────────────────────────────────────

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('LACĂT — „ce au vizitat" ajunge în raport', () => {
  it('tabela visits are coloana `pages` (secțiunile deschise, acumulate)', () => {
    const db = sursa('./db.ts')
    expect(/ALTER TABLE visits ADD COLUMN IF NOT EXISTS pages/.test(db)).toBe(true)
  })

  it('logVisit și touchVisit primesc `path` și îl acumulează DISTINCT pe rând', () => {
    const db = sursa('./db.ts')
    // helperul de acumulare distinctă există și e reutilizat (nu duplicat)
    expect(/function appendPagina/.test(db)).toBe(true)
    // dedup pe listă cu virgule: nu adaugă o secțiune deja prezentă
    expect(/position\(',' \|\| \$2 \|\| ',' in ',' \|\| pages \|\| ','\)/.test(db)).toBe(true)
    // ambele căi de scriere primesc path
    expect(/export async function logVisit\([\s\S]*?path = '',/.test(db)).toBe(true)
    expect(/export async function touchVisit\([\s\S]*?path = '',/.test(db)).toBe(true)
  })

  it('getDemoStats scoate `v.pages` în raport, iar tipul DemoRecent îl are', () => {
    const db = sursa('./db.ts')
    expect(/v\.photo_url, v\.pages/.test(db)).toBe(true)
    expect(/pages: r\.pages \?\? ''/.test(db)).toBe(true)
    const tip = sursa('./shared/api-types.ts')
    expect(/pages: string/.test(tip)).toBe(true)
  })

  it('rutele /api/visit și /api/visit/ping citesc `path` din body', () => {
    const demo = sursa('./routes/demo.ts')
    // beacon + ping trimit path mai departe către logVisit/touchVisit
    expect((demo.match(/req\.body\?\.path/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(/touchVisit\(fp, ip, email, path\)/.test(demo)).toBe(true)
  })

  it('frontendul trimite eticheta secțiunii pe fiecare pagină', () => {
    const helper = sursa('../../frontend/src/lib/vizita.ts')
    expect(/export function raporteazaPagina/.test(helper)).toBe(true)
    // fiecare pagină publică își anunță secțiunea
    expect(/raporteazaPagina\('acasă'\)/.test(sursa('../../frontend/src/pages/Landing.tsx'))).toBe(true)
    expect(/raporteazaPagina\('credite'\)/.test(sursa('../../frontend/src/pages/Credits.tsx'))).toBe(true)
    expect(/raporteazaPagina\('manual'\)/.test(sursa('../../frontend/src/pages/Manual.tsx'))).toBe(true)
    // aplicația (Stage) trimite secțiunea pe ping-ul de prezență
    expect(/path: 'aplicație'/.test(sursa('../../frontend/src/pages/Stage.tsx'))).toBe(true)
  })

  it('adminul AFIȘEAZĂ ce a vizitat fiecare (nu doar cine e)', () => {
    const panel = sursa('../../frontend/src/components/AdminPanel.tsx')
    expect(/a vizitat:/.test(panel)).toBe(true)
    expect(/visitor-pages/.test(panel)).toBe(true)
  })
})

describe('LACĂT — golirea bazei de vizitatori (GDPR)', () => {
  it('purgeVisits șterge din visits și e MĂSURAT (-1 = necitibil, nu 0 inventat)', () => {
    const db = sursa('./db.ts')
    expect(/export async function purgeVisits/.test(db)).toBe(true)
    expect(/DELETE FROM visits/.test(db)).toBe(true)
    expect(/if \(!dbEnabled\(\)\) return -1/.test(db)).toBe(true)
  })

  it('endpointul de golire e ADMIN-only și lovește DOAR tabela visits', () => {
    const admin = sursa('./routes/admin.ts')
    expect(/\/api\/admin\/visitors\/purge/.test(admin)).toBe(true)
    // gardat de cerAdmin, ca orice altă acțiune de admin
    expect(/purge'[\s\S]*?cerAdmin\(req, reply\)/.test(admin)).toBe(true)
    // purgeVisits șterge exact o tabelă: visits. (Un singur DELETE, pe visits.)
    const db = sursa('./db.ts')
    const corp = db.slice(db.indexOf('export async function purgeVisits'))
    const pana = corp.slice(0, corp.indexOf('\n}'))
    expect(/DELETE FROM visits/.test(pana)).toBe(true)
    expect(/DELETE FROM (?!visits)/.test(pana)).toBe(false)
  })

  it('butonul din admin cere confirmarea ownerului (nu golește tăcut)', () => {
    const panel = sursa('../../frontend/src/components/AdminPanel.tsx')
    expect(/golesteVizitatori/.test(panel)).toBe(true)
    expect(/window\.confirm/.test(panel)).toBe(true)
  })
})
