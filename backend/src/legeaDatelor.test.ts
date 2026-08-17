// ── P26: LEGEA DATELOR (15 aug 2026) ─────────────────────────────────────────
// (owner, verbatim: „aici avem, o regula clara, orice se intimpla cu aplicatia,
// baza de date nu se sterge, sau se pierde, nici la suprascriere, se scrie doar
// unde e necesar dar cu istoric salvat cu dovezi cine a modificat,
// trasabilitate 24 din 24 de ore" + „atentie se ataseaza inclusiv monstra de
// voce, citeste cu mare atentie softul")
//
// Lacătele de mai jos țin fiecare verigă a legii pe loc — o sesiune viitoare
// care ar „curăța" registrul, scutul sau urmele ar pica aici, cu ordinul citat.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const db = sursa('./db.ts')
const admin = sursa('./routes/admin.ts')
const panou = sursa('../../frontend/src/components/AdminPanel.tsx')

describe('P26 — registrul de audit: cine a modificat, când, ce', () => {
  it('tabelul audit_log există în schemă, cu actor/acțiune/vechi/nou', () => {
    expect(db).toMatch(/CREATE TABLE IF NOT EXISTS audit_log/)
    for (const col of ['actor', 'actiune', 'tabel', 'cheie', 'vechi', 'nou']) {
      expect(db).toMatch(new RegExp(`${col} TEXT NOT NULL DEFAULT ''`))
    }
  })

  it('urma se scrie fire-and-forget, iar EȘECUL ei se strigă (un audit mut nu e audit)', () => {
    expect(db).toMatch(/export function noteazaAudit/)
    expect(db).toMatch(/\[audit\] urma NU s-a putut scrie/)
  })

  it('punctele de mutație pe datele omului lasă urmă: blocare, golire GDPR, limbă, amprenta vocii', () => {
    expect(db).toMatch(/noteazaAudit\('admin', 'blocare-user'/)
    expect(db).toMatch(/noteazaAudit\('admin', 'deblocare-user'/)
    expect(db).toMatch(/noteazaAudit\('admin', 'golire-vizitatori \(buton GDPR\)'/)
    expect(db).toMatch(/noteazaAudit\(email, 'limba-vorbirii'/)
    expect(db).toMatch(/'amprenta-vocii \(adaptare\)' : 'amprenta-vocii \(înscriere\)'/)
  })

  it('banii au deja registrul lor (billing_events la fiecare debitare) — nu se dublează', () => {
    expect(db).toMatch(/INSERT INTO billing_events \(user_email, kind, amount, meta\) VALUES \(\$1, 'usage'/)
  })
})

describe('P26 — nimic nu se șterge, nici registrul însuși', () => {
  it('scutul acoperă și istoricul conversațiilor și audit_log (pe lângă identitate/bani/biometrie)', () => {
    expect(db).toMatch(/'messages', 'audit_log', 'video_invatat',\s*\n\] as const/)
  })

  it('măsurat înainte de scut: NICIO cale de cod nu ștergea messages', () => {
    expect(db).not.toMatch(/DELETE FROM messages/)
  })
})

describe('P26 — panoul: registrul + dovada backupului + cardul complet al omului', () => {
  it('ruta /api/admin/registru-audit e gardată de cerAdmin și măsoară backupul de pe disc', () => {
    expect(admin).toMatch(/app\.get\('\/api\/admin\/registru-audit'[\s\S]{0,220}?cerAdmin\(req, reply\)/)
    expect(admin).toMatch(/BACKUP_DIR/)
    expect(admin).toMatch(/st\.mtimeMs > cel\.t/)
  })

  it('tabul Utilizatori desenează registrul (cine/când/ce) și spune cinstit lipsa backupului', () => {
    expect(panou).toMatch(/function RegistruAudit/)
    expect(panou).toMatch(/Registrul modificărilor \(audit — cine, când, ce\)/)
    expect(panou).toMatch(/Backup: nemăsurabil de aici/)
  })

  it('cardul userului poartă poza de pe server și mostra de voce („se ataseaza inclusiv monstra de voce")', () => {
    expect(db).toMatch(/AS foto,/)
    expect(db).toMatch(/EXISTS\(SELECT 1 FROM voiceprints vp WHERE lower\(vp\.user_email\) = MIN\(lower\(v\.user_email\)\)\) AS voce/)
    expect(panou).toMatch(/u\.foto \|\| pozaUser\(u\.email\)/)
    expect(panou).toMatch(/🎤 voce/)
  })

  it('bugul din captura ownerului: eșecul citirii activității nu mai e MUT — cauza se strigă', () => {
    expect(db).toMatch(/\[users\] getUserActivity a picat:/)
  })
})
