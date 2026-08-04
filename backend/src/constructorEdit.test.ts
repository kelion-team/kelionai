import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ── POTRIVIREA ROBUSTĂ A LUI 'edit' (4 aug 2026) ─────────────────────────────
// Cauza reală a ordinelor picate ca #53: modelul dă „old" cu spații/indentare
// puțin diferite, iar potrivirea STRICT exactă refuza — și constructorul ardea
// pașii reîncercând până la plafon. `potrivesteEdit` adaugă o a doua treaptă,
// tolerantă la spații, DAR tot UNICĂ (nu atinge din greșeală altă bucată).
// Testele astea țin garda: exact-unic trece, ambiguu (exact SAU tolerant) e
// refuzat, indentarea diferită se potrivește tolerant, ce nu există dă null.
//
// Ca și testul Fable: modulul VPS e ESM în afara rădăcinii backend — nu se poate
// încărca în-proces (vitest îl rupe la load). Îl exersăm REAL printr-un
// subproces node care-l importă nativ și răspunde cu JSON.

const MJS = fileURLToPath(new URL('../../deploy/constructor-agent.mjs', import.meta.url))

interface Rezultat {
  mod: string | null
  slice: string | null
  literal: string | null
}

function proba(src: string, vechi: string): Rezultat {
  const script = `
    const m = await import(${JSON.stringify('file:///' + MJS.replace(/\\/g, '/'))});
    const src = ${JSON.stringify(src)};
    const vechi = ${JSON.stringify(vechi)};
    const r = m.potrivesteEdit(src, vechi);
    let out;
    if (r && typeof r === 'object') out = { mod: r.mod, slice: src.slice(r.start, r.end), literal: null };
    else out = { mod: null, slice: null, literal: r === null ? null : String(r) };
    console.log(JSON.stringify(out));
  `
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 30000,
  })
  return JSON.parse(stdout.trim()) as Rezultat
}

describe('potrivesteEdit — exact, unic', () => {
  it('găsește o singură apariție exactă', () => {
    const r = proba('alpha beta gamma', 'beta')
    expect(r.mod).toBe('exacta')
    expect(r.slice).toBe('beta')
  })
})

describe('potrivesteEdit — ambiguu = refuz', () => {
  it('apariție exactă multiplă → exacta_multipla', () => {
    const r = proba('xoxo', 'xo')
    expect(r.literal).toBe('exacta_multipla')
  })
  it('potrivire tolerantă multiplă → toleranta_multipla', () => {
    // „x y" nu apare exact (spații diferite), dar tolerant se potrivește de 2 ori
    const r = proba('x  y and x   y', 'x y')
    expect(r.literal).toBe('toleranta_multipla')
  })
})

describe('potrivesteEdit — tolerant la spații (cauza #53)', () => {
  it('indentare diferită se potrivește tolerant, unic', () => {
    const src = 'if (a) {\n        doStuff()\n}'
    const vechi = 'if (a) {\n  doStuff()\n}'
    const r = proba(src, vechi)
    expect(r.mod).toBe('toleranta')
    // slice-ul acoperă bucata REALĂ din sursă (cu indentarea ei), nu „old"-ul
    expect(r.slice).toBe(src)
  })
  it('spații multiple în interior se potrivesc', () => {
    const r = proba('const  x = 1;', 'const x = 1;')
    expect(r.mod).toBe('toleranta')
    expect(r.slice).toBe('const  x = 1;')
  })
})

describe('potrivesteEdit — negative', () => {
  it('ce nu există deloc → null', () => {
    const r = proba('hello world', 'xyz')
    expect(r.mod).toBeNull()
    expect(r.literal).toBeNull()
  })
  it('„old" gol → null', () => {
    const r = proba('abc', '')
    expect(r.mod).toBeNull()
    expect(r.literal).toBeNull()
  })
})

// ── EDIT PE LINII (edit_lines) — plasa pentru fișiere MARI (#65, 4 aug) ───────
// Pe admin.ts de 45KB, 'write' se tăia și 'edit' nu potrivea „old" → ordin picat.
// inlocuiesteLinii înlocuiește un interval de linii fără potrivire de text.
import { execFileSync as ef2 } from 'node:child_process'
function probaLinii(src: string, from: number, to: number, nou: string): { text: string | null; err: string | null } {
  const script = `
    const m = await import(${JSON.stringify('file:///' + MJS.replace(/\\/g, '/'))});
    const r = m.inlocuiesteLinii(${JSON.stringify(src)}, ${from}, ${to}, ${JSON.stringify(nou)});
    console.log(JSON.stringify({ text: r.text ?? null, err: r.err ?? null }));
  `
  return JSON.parse(ef2(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30000 }).trim())
}

describe('edit_lines — înlocuire pe interval de linii', () => {
  it('înlocuiește liniile 2-3 cu o linie', () => {
    const r = probaLinii('a\nb\nc\nd', 2, 3, 'X')
    expect(r.text).toBe('a\nX\nd')
  })
  it('șterge liniile 2-3 (new gol înseamnă o linie goală în loc)', () => {
    const r = probaLinii('a\nb\nc\nd', 2, 2, 'B2')
    expect(r.text).toBe('a\nB2\nc\nd')
  })
  it('interval invalid → err, fără text', () => {
    const r = probaLinii('a\nb', 5, 6, 'x')
    expect(r.text).toBeNull()
    expect(r.err).toContain('interval invalid')
  })
})
