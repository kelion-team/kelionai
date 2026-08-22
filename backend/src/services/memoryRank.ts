// ── MEMORIE SMART: TIP + IMPORTANȚĂ + UITARE ÎN TIMP (owner, 19 aug: „schimba
// acum complet cu toate atuurile de imbunatatire") ──────────────────────────
//
// Studiat din modelul de memorie de Agent al TencentDB („vector + graf +
// relațional"): ce aduce PLUS la scara unui singur user NU e infrastructura de
// vectori (pgvector la miliarde de rânduri), ci MODELUL: memorii TIPIZATE, cu
// IMPORTANȚĂ și cu UITARE în timp, iar recall-ul le cântărește pe toate trei,
// nu doar similaritatea. Recall-ul semantic (embeddings Gemini + cosinus) există
// deja; aici e nucleul PUR care le combină — separat + exportat ca să fie PROBAT,
// fără rețea, fără DB. Nicio cifră de bani/prag arătată omului: sunt constante de
// reglaj ale rangării, declarate pe linie.

/** Felurile de memorie (studiate din TencentDB: episodic/semantic/procedural/
 *  preferință), adaptate la un asistent personal. `null`/necunoscut = fapt
 *  generic (memoriile vechi, dinaintea tipizării, rămân valide).
 *
 *  22 aug 2026 (owner: „simte mediul"): tipuri SENZORIALE — vizual, auditiv,
 *  emoțional, temporal — pentru memoria unificată cross-modal. */
export type MemoryType =
  | 'identity' // cine e omul (nume, unde locuiește, ce e)
  | 'preference' // cum îi place (răspunsuri scurte, limba, stil)
  | 'relationship' // cine cu cine (familie, colegi)
  | 'project' // la ce lucrează (proiecte în curs)
  | 'episodic' // ce s-a întâmplat (o discuție, un eveniment)
  | 'fact' // orice alt fapt durabil
  | 'visual' // ce a văzut Kelion (cadru cu mișcare, obiect, persoană)
  | 'auditory' // ce a auzit Kelion (alarmă, sonerie, conversație, sunet)
  | 'emotional' // starea emoțională detectată (supărat, vesel, stresat)
  | 'temporal' // rutine și patternuri temporale (la 8 merge la muncă)

const TIPURI: ReadonlySet<string> = new Set<MemoryType>([
  'identity', 'preference', 'relationship', 'project', 'episodic', 'fact',
  'visual', 'auditory', 'emotional', 'temporal',
])

/** Importanța implicită a unei memorii tipizate: identitatea/preferințele/relațiile
 *  contează mai mult și se sting mai greu decât un episod trecător. PURĂ. */
export function importantaImplicita(tip: MemoryType | null): number {
  switch (tip) {
    case 'identity': return 0.95 // hardcod-permis: reglaj de rangare al memoriei, nu cifră arătată omului
    case 'preference': return 0.85 // hardcod-permis: reglaj de rangare al memoriei
    case 'relationship': return 0.8 // hardcod-permis: reglaj de rangare al memoriei
    case 'project': return 0.7 // hardcod-permis: reglaj de rangare al memoriei
    case 'fact': return 0.55 // hardcod-permis: reglaj de rangare al memoriei
    case 'episodic': return 0.4 // hardcod-permis: reglaj de rangare al memoriei
    case 'emotional': return 0.65 // hardcod-permis: starea emoțională contează pentru adaptare
    case 'temporal': return 0.6 // hardcod-permis: rutinele ajută proactivitatea
    case 'visual': return 0.45 // hardcod-permis: observații vizuale — context, nu fapt durabil
    case 'auditory': return 0.5 // hardcod-permis: evenimente sonore — mai importante ca vizualul
    default: return 0.5 // hardcod-permis: memorie negenerică/veche — importanță neutră
  }
}

/** Cât „trăiește" pe jumătate importanța unei memorii, pe tip: identitatea nu se
 *  uită (ani), un episod se stinge în zile. Milisecunde. PURĂ. */
export function injumatatireMsPeTip(tip: MemoryType | null): number {
  const ZI = 24 * 60 * 60 * 1000
  switch (tip) {
    case 'identity': return 3650 * ZI // hardcod-permis: ~10 ani = practic nu se uită
    case 'preference': return 730 * ZI // hardcod-permis: ~2 ani
    case 'relationship': return 730 * ZI // hardcod-permis: ~2 ani
    case 'project': return 120 * ZI // hardcod-permis: ~4 luni (proiectele se schimbă)
    case 'fact': return 365 * ZI // hardcod-permis: ~1 an
    case 'episodic': return 30 * ZI // hardcod-permis: ~1 lună (un episod se stinge repede)
    case 'emotional': return 7 * ZI // hardcod-permis: ~1 săptămână (starea se schimbă)
    case 'temporal': return 180 * ZI // hardcod-permis: ~6 luni (rutinele se schimbă sezonier)
    case 'visual': return 3 * ZI // hardcod-permis: ~3 zile (ce ai văzut se uită repede)
    case 'auditory': return 7 * ZI // hardcod-permis: ~1 săptămână (evenimentele sonore mai durabile)
    default: return 365 * ZI // hardcod-permis: memorie veche fără tip — ~1 an
  }
}

export function normalizeazaTip(raw: unknown): MemoryType | null {
  const s = String(raw ?? '').trim().toLowerCase()
  return TIPURI.has(s) ? (s as MemoryType) : null
}

/** Mărginește importanța la [0,1]; valoarea absentă/nevalidă → implicita tipului. */
export function clampImportanta(x: unknown, tip: MemoryType | null): number {
  const n = Number(x)
  if (!Number.isFinite(n)) return importantaImplicita(tip)
  return Math.max(0, Math.min(1, n))
}

/** Decăderea în timp (0..1): 0.5^(vârstă / înjumătățire). O memorie proaspătă = 1;
 *  la o înjumătățire = 0.5; mult mai bătrână → tinde spre 0. PURĂ. */
export function decadereInTimp(varstaMs: number, injumatatireMs: number): number {
  if (!Number.isFinite(varstaMs) || varstaMs <= 0) return 1
  if (!Number.isFinite(injumatatireMs) || injumatatireMs <= 0) return 1
  return Math.pow(0.5, varstaMs / injumatatireMs)
}

/** A expirat? (memoriile cu `expiresAt` trecut nu se mai reamintesc). PURĂ. */
export function esteExpirata(expiresAtMs: number | null | undefined, acumMs: number): boolean {
  return typeof expiresAtMs === 'number' && Number.isFinite(expiresAtMs) && expiresAtMs <= acumMs
}

export interface MemorieDeRangat {
  content: string
  tip: MemoryType | null
  importanta: number // 0..1 (deja mărginită)
  semantic: number // similaritatea cu întrebarea, 0..1 (0 = necunoscută/negăsită semantic)
  varstaMs: number // de când n-a mai fost văzută
  expiresAtMs: number | null
}

/** Scorul final al unei memorii pentru recall: similaritate × importanță ×
 *  decădere-în-timp, cu un prag de similaritate pentru cele găsite semantic.
 *  O memorie fără scor semantic (adusă pe recență/cuvinte) primește o bază mică,
 *  ca importanța + prospețimea ei să conteze totuși. PURĂ + testabilă. */
export function scorMemorie(m: MemorieDeRangat, acumMs: number): number {
  if (esteExpirata(m.expiresAtMs, acumMs)) return 0
  const injum = injumatatireMsPeTip(m.tip)
  const proaspat = decadereInTimp(m.varstaMs, injum)
  // baza semantică: dacă avem o similaritate reală, o folosim; altfel o bază mică
  // (0.35) ca memoriile importante/recente să nu dispară doar fiindcă n-au vector.
  const baza = m.semantic > 0 ? m.semantic : 0.35 // hardcod-permis: bază pentru memoriile fără scor semantic
  return baza * (0.25 + 0.75 * m.importanta) * proaspat // hardcod-permis: importanța contează, dar nu anulează total o memorie
}

/** Rangare completă: exclude expiratele, calculează scorul, sortează descrescător,
 *  taie la `limit`. PURĂ — deci se probează pe date, fără DB. */
export function rangheazaMemorii(
  memorii: readonly MemorieDeRangat[],
  acumMs: number,
  limit: number,
): MemorieDeRangat[] {
  return memorii
    .filter((m) => !esteExpirata(m.expiresAtMs, acumMs))
    .map((m) => ({ m, s: scorMemorie(m, acumMs) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.max(0, limit))
    .map((x) => x.m)
}
