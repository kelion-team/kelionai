// ── #10 PERSONALITATE CARE EVOLUEAZĂ (owner, 22 aug 2026: „uimește-mă") ──────
//
// Kelion nu e un template. Personalitatea se modelează pe tine în timp:
//   - Dacă răspunzi scurt, devine mai concis
//   - Dacă glumești, învață umorul tău
//   - Dacă ești analitic, devine mai precis
//   - După 6 luni, Kelion al tău e diferit de Kelion al altcuiva
//
// Stocat ca profil de personalitate în DB (KV), nu ca prompt hardcodat.
// Injectat în promptul de sistem la fiecare conversație.

export interface ProfilPersonalitate {
  // Dimensiuni (0-1):
  concizie: number // 0 = detaliat, 1 = foarte scurt
  umor: number // 0 = serios, 1 = glumeț
  precizie: number // 0 = relaxat, 1 = foarte exact
  empatie: number // 0 = factual, 1 = foarte empatic
  proactivitate: number // 0 = reactiv, 1 = foarte proactiv
  formalitate: number // 0 = informal, 1 = foarte formal
  // Metadata:
  nrInteractiuni: number
  ultimaActualizare: number
}

let profil: ProfilPersonalitate = {
  concizie: 0.5,
  umor: 0.3,
  precizie: 0.6,
  empatie: 0.5,
  proactivitate: 0.4,
  formalitate: 0.4,
  nrInteractiuni: 0,
  ultimaActualizare: Date.now(),
}

const KV_KEY = 'profil_personalitate'
const RATA_INVATARE = 0.02 // hardcod-permis: rată tehnică de învățare — cât de repede se adaptează

/** Încarcă profilul din KV (apelat la startup). */
export async function incarcaProfilPersonalitate(): Promise<void> {
  try {
    const { loadKv } = await import('../db.js')
    const raw = await loadKv(KV_KEY)
    if (raw) {
      const parsat = JSON.parse(raw) as Partial<ProfilPersonalitate>
      profil = { ...profil, ...parsat }
    }
  } catch { /* KV indisponibil — profil default */ }
}

/** Salvează profilul în KV. */
async function salveazaProfil(): Promise<void> {
  try {
    const { saveKv } = await import('../db.js')
    await saveKv(KV_KEY, JSON.stringify(profil))
  } catch { /* KV indisponibil — rămâne in-memory */ }
}

/** Actualizează profilul pe baza unei interacțiuni.
 *  Analizează mesajul userului + răspunsul lui Kelion și ajustează dimensiunile. */
async function actualizeazaProfil(
  mesajUser: string,
  raspunsKelion: string,
  emotieUser?: string,
): Promise<void> {
  profil.nrInteractiuni++
  const r = RATA_INVATARE

  // Concizie: userul scrie scurt → Kelion devine mai concis
  const lungimeMedieUser = mesajUser.length
  if (lungimeMedieUser < 50) {
    profil.concizie = Math.min(1, profil.concizie + r)
  } else if (lungimeMedieUser > 300) {
    profil.concizie = Math.max(0, profil.concizie - r)
  }

  // Umor: userul glumește (cuvinte specifice, emoji, exclații)
  const indicatoriUmor = ['😂', '😄', 'haha', 'lol', '😂', '🤣', 'glum', 'păcăl']
  const areUmor = indicatoriUmor.some((i) => mesajUser.toLowerCase().includes(i))
  if (areUmor) {
    profil.umor = Math.min(1, profil.umor + r * 2)
  }

  // Precizie: userul pune întrebări tehnice, cere detalii
  const indicatoriPrecizie = ['exact', 'precis', 'detaliu', 'specific', 'număr', 'cifră', 'sursă', 'dovadă']
  const cerePrecizie = indicatoriPrecizie.some((i) => mesajUser.toLowerCase().includes(i))
  if (cerePrecizie) {
    profil.precizie = Math.min(1, profil.precizie + r)
  }

  // Empatie: userul e supărat/trist → Kelion devine mai empatic
  if (emotieUser === 'suparat' || emotieUser === 'trist') {
    profil.empatie = Math.min(1, profil.empatie + r * 2)
  }

  // Proactivitate: userul apreciază când Kelion oferă sugestii
  const indicatoriProactiv = ['mulțum', 'bine că', 'bună idee', 'mă ajut', 'ce bine']
  const apreciaza = indicatoriProactiv.some((i) => mesajUser.toLowerCase().includes(i))
  if (apreciaza) {
    profil.proactivitate = Math.min(1, profil.proactivitate + r)
  }

  // Formalitate: userul folosește „dumneavoastră" → Kelion devine mai formal
  if (mesajUser.toLowerCase().includes('dumneavoastră') || mesajUser.toLowerCase().includes('domnule')) {
    profil.formalitate = Math.min(1, profil.formalitate + r * 2)
  } else if (mesajUser.toLowerCase().includes('tu') || mesajUser.toLowerCase().includes('kelion')) {
    profil.formalitate = Math.max(0, profil.formalitate - r)
  }

  profil.ultimaActualizare = Date.now()
  // Salvează la fiecare 10 interacțiuni (nu la fiecare — ar fi prea mult DB)
  if (profil.nrInteractiuni % 10 === 0) {
    await salveazaProfil()
  }
}

/** Profilul curent (pentru injectare în promptul de sistem). */
export function getProfilPersonalitate(): ProfilPersonalitate {
  return profil
}

/** Generează fragmentul de prompt pe baza profilului (injectat în sistem prompt). */
export function promptPersonalitate(): string {
  const p = profil
  const trasaturi: string[] = []
  if (p.concizie > 0.7) trasaturi.push('Răspunde foarte scurt și la obiect.')
  else if (p.concizie < 0.3) trasaturi.push('Răspunde detaliat, cu explicații complete.')
  if (p.umor > 0.6) trasaturi.push('Poți glumi — userul apreciază umorul.')
  else if (p.umor < 0.2) trasaturi.push('Fii serios, fără glume.')
  if (p.precizie > 0.7) trasaturi.push('Fii foarte precis — cifre, surse, detalii exacte.')
  if (p.empatie > 0.7) trasaturi.push('Fii foarte empatic — userul trece prin momente grele.')
  if (p.proactivitate > 0.6) trasaturi.push('Fii proactiv — oferă sugestii înainte să ți se ceară.')
  if (p.formalitate > 0.7) trasaturi.push('Fii formal — userul preferă „dumneavoastră".')
  else if (p.formalitate < 0.3) trasaturi.push('Fii informal — userul preferă „tu".')

  if (trasaturi.length === 0) return ''
  return `\n\nPROFILUL TĂU DE PERSONALITATE (adaptat pe acest user în ${profil.nrInteractiuni} interacțiuni):\n${trasaturi.join(' ')}`
}
