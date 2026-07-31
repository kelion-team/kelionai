// ── CARDUL LA FURNIZORI, PUS DE EL, LA CEREREA TA, RECUNOSCUT DUPĂ VOCE ──────
//
// Adrian, 31 iul: „asta era cerința care dovedea autonomia reală" · „să opereze
// pentru mine când îi cer doar eu, folosind sistemul de recunoaștere vocală, ca
// securitate sporită."
//
// Am ținut pasul ăsta închis o zi întreagă, și aveam un motiv bun — dar numai
// jumătate din el era valabil. Cele două probleme sunt DIFERITE:
//
//   CINE are voie → rezolvat de amprenta vocală. `hasVoiceUnlock` cere ca
//   sesiunea să fie deblocată ANUME prin voce, nu printr-un secret tastat: un
//   cod poate fi furat sau citit peste umăr; vocea cere să fii TU, acolo.
//
//   CE SE SCURGE → rezolvat aici. Un card scris cu `browser_type` obișnuit ar
//   ajunge în trei locuri deodată: în conversație (modelul îl primește ca
//   argument), în capturile de ecran de pe monitor, și în textul paginii
//   întors după fiecare pas. Trei copii ale unui PAN, în trei jurnale.
//
// Soluția: modelul NU primește niciodată valoarea. El spune doar „câmpul 7 e
// numărul cardului", iar SERVERUL scrie acolo, luând valoarea din env. Plus
// modul discret pe toată durata: zero capturi, cifrele mascate în text.
//
// Ce rămâne al tău, o singură dată: valorile cardului se pun ca secrete în
// GitHub, de mâna ta. NU prin Kelion — `secret_pune` refuză din construcție
// orice arată a card, și rămâne așa. Pentru cea mai sensibilă valoare din
// sistem, un pas manual e preferabil unei automatizări care poate greși.
import { browserType, setModDiscret, browserRead, mascheazaCifre } from './browser.js'
import type { BrowserResult } from './browser.js'
import { voceRecenta } from './adminLock.js'
import { loadKv, saveKv } from '../db.js'

/** Câmpurile pe care le poate completa. Numele lor NU dau valoarea. */
export type CampCard = 'numar' | 'expirare' | 'cvc' | 'nume' | 'cod_postal'

const DIN_ENV: Record<CampCard, string> = {
  numar: 'CARD_NUMAR',
  expirare: 'CARD_EXPIRARE',
  cvc: 'CARD_CVC',
  nume: 'CARD_NUME',
  cod_postal: 'CARD_COD_POSTAL',
}

/** Ce câmpuri sunt configurate — fără să spună CE conțin. */
export function cardConfigurat(): { gata: boolean; lipsesc: CampCard[] } {
  const lipsesc = (Object.keys(DIN_ENV) as CampCard[]).filter((c) => !(process.env[DIN_ENV[c]] ?? '').trim())
  // Codul poștal e opțional — nu toți furnizorii îl cer.
  const esentiale = lipsesc.filter((c) => c !== 'cod_postal')
  return { gata: esentiale.length === 0, lipsesc }
}

/**
 * Scrie ÎN PAGINĂ valoarea unui câmp de card, fără ca modelul s-o vadă vreodată.
 *
 * Întoarce doar starea paginii (deja mascată de modul discret) și CE câmp a
 * fost completat — niciodată ce s-a scris. Dacă valoarea nu e configurată, o
 * spune limpede: mai bine „lipsește CARD_NUMAR" decât un câmp completat greșit
 * pe o pagină de plată.
 */
export async function completeazaCard(
  email: string,
  baseUrl: string,
  camp: CampCard,
  index: number,
): Promise<{ ok: boolean; camp: CampCard; detaliu: string; pagina?: BrowserResult }> {
  // POARTA CERUTĂ DE OWNER: „doar când îi cer EU, prin recunoaștere vocală".
  // Nu „ești admin" — ci „ai vorbit ACUM și te-am recunoscut". Un cookie de
  // admin poate fi furat; fereastra asta se deschide doar când amprenta ta s-a
  // potrivit, și se închide singură în 15 minute.
  if (!voceRecenta(email)) {
    return {
      ok: false,
      camp,
      detaliu:
        'nu ating cardul fără să te fi recunoscut după voce. Vorbește-mi (o frază ajunge), ' +
        'apoi cere-mi din nou — fereastra ține 15 minute și se închide singură.',
    }
  }
  const cheie = DIN_ENV[camp]
  if (!cheie) return { ok: false, camp, detaliu: `câmp necunoscut: ${String(camp)}` }
  const valoare = (process.env[cheie] ?? '').trim()
  if (!valoare) {
    return {
      ok: false,
      camp,
      detaliu:
        `nu e configurat ${cheie}. Se pune O SINGURĂ DATĂ, de mâna ownerului, în ` +
        `GitHub → Settings → Secrets → Actions, apoi se rulează vps-set-env. ` +
        `NU prin mine: uneltele mele refuză din construcție orice arată a card.`,
    }
  }
  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, camp, detaliu: 'index de câmp invalid — citește întâi pagina' }
  }
  // Modul discret e pornit AICI, nu lăsat în seama nimănui: din clipa în care
  // se scrie un card, pagina nu mai are voie să ajungă pe monitor.
  setModDiscret(email, true)
  const pagina = await browserType(email, baseUrl, index, valoare, false)
  return {
    ok: !('error' in pagina),
    camp,
    detaliu: 'error' in pagina ? `pagina a refuzat: ${pagina.error}` : `am completat „${camp}" în câmpul ${index}`,
    pagina,
  }
}

// ── PLĂȚILE AUTOMATE — SCOPUL, nu cardul ─────────────────────────────────────
//
// Adrian, 31 iul: „plățile automate". Cardul pus într-un formular nu e ținta;
// ținta e ca furnizorul să se încaseze SINGUR, ca Kelion să nu se oprească
// niciodată din lipsă de credit, fără ca ownerul să apese ceva.
//
// Deci pasul nu e „am completat câmpurile", ci „pagina furnizorului arată acum
// un card la dosar ȘI reîncărcarea automată pornită". Iar asta o MĂSOARĂ codul
// de aici, pe textul paginii, nu o declară modelul (regula #1 a ownerului: o
// valoare care n-a venit dintr-o citire reușită nu e o valoare).

/** Card la dosar: „•••• 4242", „ending in 4242", „card on file", „Visa …4242". */
const MARCA_CARD =
  /(?:[•*·x]{2,}\s?\d{4}|ending\s+in\s+\d{4}|card\s+on\s+file|payment\s+method\s+(?:added|on file)|se\s+termină\s+în\s+\d{4})/i
/** Plată automată pornită: auto-recharge / auto top-up / automatic payments. */
const MARCA_AUTOMAT =
  /(?:auto[-\s]?(?:recharge|reload|top[-\s]?up|renew(?:al)?|pay(?:ment)?s?)|automatic\s+(?:payments?|billing|recharge)|recurring\s+(?:payment|billing)|reîncărcare\s+automată|plăți\s+automate)/i

export interface StareFurnizor {
  /** Numele furnizorului, spus de el: „openrouter", „anthropic"… */
  furnizor: string
  /** Textul paginii arăta un card la dosar, la închiderea sesiunii. */
  card: boolean
  /** …și reîncărcarea automată pornită. ĂSTA e scopul. */
  automat: boolean
  /** Fragmentul de pagină pe care s-a făcut potrivirea (mascat). */
  dovada: string
  cand: string
}

const CHEIE = 'card:furnizori'

/** Ce furnizori sunt configurați — CITIT din ce s-a măsurat, nu din promisiuni. */
export async function stareFurnizori(): Promise<StareFurnizor[]> {
  try {
    const raw = await loadKv(CHEIE)
    const j = raw ? (JSON.parse(raw) as StareFurnizor[]) : []
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

/** Dovada pentru misiune: măcar un furnizor cu plata automată PORNITĂ. */
export async function platiAutomatePornite(): Promise<boolean> {
  return (await stareFurnizori()).some((f) => f.automat)
}

async function noteazaFurnizor(s: StareFurnizor): Promise<void> {
  const toate = await stareFurnizori()
  const fara = toate.filter((f) => f.furnizor !== s.furnizor)
  await saveKv(CHEIE, JSON.stringify([...fara, s].slice(-20))).catch(() => {})
}

/**
 * Închide sesiunea discretă și MĂSOARĂ ce a rămas pe pagină.
 *
 * Ordinea contează: citim CÂT timp modul discret e încă pornit (deci fără
 * captură de ecran și cu cifrele mascate), și abia apoi îl stingem. Invers —
 * cum era prima variantă — ultima citire ar fi fotografiat exact pagina de
 * plată pe care tocmai scrisesem cardul.
 */
export async function terminaCard(
  email: string,
  baseUrl: string,
  furnizor = '',
): Promise<{ pagina: BrowserResult; card: boolean; automat: boolean; detaliu: string }> {
  const pagina = await browserRead(email, baseUrl)
  setModDiscret(email, false)
  const text = 'error' in pagina ? '' : pagina.text
  const potrivireCard = MARCA_CARD.exec(text)
  const potrivireAuto = MARCA_AUTOMAT.exec(text)
  const card = Boolean(potrivireCard)
  const automat = Boolean(potrivireAuto)
  const nume = furnizor.trim().toLowerCase().slice(0, 40)
  if (nume && (card || automat)) {
    await noteazaFurnizor({
      furnizor: nume,
      card,
      automat,
      dovada: mascheazaCifre(`${potrivireCard?.[0] ?? ''} ${potrivireAuto?.[0] ?? ''}`.trim()).slice(0, 200),
      cand: new Date().toISOString(),
    })
  }
  const detaliu = !nume
    ? 'sesiunea de card e închisă (fără furnizor spus → n-am ce nota)'
    : automat
      ? `la ${nume}: card la dosar ȘI plată automată — măsurat pe pagină`
      : card
        ? `la ${nume}: card la dosar, dar NU văd plata automată pornită pe pagină. Pornește-o, apoi cheamă din nou card_gata.`
        : `la ${nume}: nu văd nici card la dosar, nici plată automată pe pagina asta. Nu notez nimic — nu declar ce n-am măsurat.`
  return { pagina, card, automat, detaliu }
}
