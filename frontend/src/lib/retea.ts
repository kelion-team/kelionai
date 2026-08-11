// ── DETECȚIA CONEXIUNII LENTE (owner, 11 aug: „aplicația trebuie să meargă și
// pe 3G date") ────────────────────────────────────────────────────────────────
// Pe 3G / 2G / cu economie de date, avatarul 3D (~1 MB three.js) fură lățimea de
// bandă de care au nevoie chatul și vocea. Deci pe conexiune slabă NU-l mai
// descărcăm deloc — interfața rămâne întreagă, doar fără chip 3D (exact ca la
// volan). NetworkInformation API; când browserul nu-l expune (multe desktopuri),
// presupunem RAPIDĂ, ca să nu penalizăm pe cine n-are cum fi pe 3G.
interface ConexiuneReala {
  saveData?: boolean
  effectiveType?: string
}

export function reteaLenta(): boolean {
  const c = (navigator as Navigator & { connection?: ConexiuneReala }).connection
  if (!c) return false
  if (c.saveData) return true
  const t = String(c.effectiveType ?? '')
  return t === 'slow-2g' || t === '2g' || t === '3g'
}
