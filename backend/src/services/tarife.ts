// ── MENIUL DE PREȚURI AL EXTRA-SERVICIILOR (owner, 14 aug, seara) ────────────
//
// Ordinele, verbatim: „facem 1 la recomandarea ta" (extra-serviciile se plătesc
// în credite, per bucată) + „trebuie făcut meniu de prețuri regăsite și în
// manual" + „în tot ce faci ca meniu preț prinzi și profitul" + „afișezi prețul
// cu profit cu tot".
//
// O SINGURĂ sursă de adevăr: lista de aici hrănește (1) taxarea reală
// (taxeazaServiciu), (2) meniul public /api/tarife (pagina de credite) și
// (3) secțiunea de prețuri din manual — ca cifra afișată și cifra taxată să nu
// poată diverge NICIODATĂ. Prețul afișat e FINAL, cu profitul copt înăuntru —
// userul vede un singur număr; defalcarea cost/marjă e treaba ownerului, nu a
// clientului.
//
// CIFRELE: costul real vine din lista oficială Google (video.ts:
// PRET_VIDEO_USD_PE_SECUNDA, corectată 14 aug — e PE SECUNDĂ, un clip are 4-8s).
// Marja ~2× peste cost la video, mai mare la serviciile ieftine. Fiecare tarif
// e reglabil din env (TARIF_*) FĂRĂ deploy — negustorul decide, codul ascultă.
// Ownerul e scutit peste tot (e casa lui).

import { config } from '../config.js'
import { citesteSold, debitWallet, grantCredit } from '../db.js'

export interface Tarif {
  /** Cheia internă (stabilă — pe ea taxează codul). */
  cheie: string
  /** Eticheta pentru oameni (EN — manualul e sursă EN, tradus ca tot restul). */
  eticheta: string
  /** Prețul FINAL în credite (profitul copt înăuntru), reglabil din env. */
  credite: number
  /** Numele env-ului care îl reglează fără deploy. */
  env: string
}

/** Tarifele implicite — validate de owner pe cifrele CORECTATE (clip 8s:
 *  lite ~£0.31 cost → 6 credite; fast ~£0.62 → 12; preview ~£2.50 → 50). */
const IMPLICITE: readonly { cheie: string; eticheta: string; credite: number }[] = [
  { cheie: 'video_lite', eticheta: 'Video clip, 8s (standard quality)', credite: 6 },
  { cheie: 'video_fast', eticheta: 'Video clip, 8s (high quality)', credite: 12 },
  { cheie: 'video_preview', eticheta: 'Video clip, 8s (top quality)', credite: 50 },
  { cheie: 'imagine', eticheta: 'Generated image', credite: 1 },
  { cheie: 'cv', eticheta: 'CV adaptation for a job', credite: 2 },
]

function crediteDinEnv(cheie: string, implicit: number): number {
  const brut = process.env[`TARIF_${cheie.toUpperCase()}`]
  // Env NEsetat/gol = implicitul. (Prins de test: `Number('')` e 0 — cu vechiul
  // `?? ''`, orice env lipsă făcea tariful 0, adică TOTUL gratuit, pe tăcute.)
  if (brut == null || brut.trim() === '') return implicit
  const n = Number(brut)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : implicit
}

/** Meniul viu (env citit la fiecare apel — reglabil fără deploy). */
export function meniulDeTarife(): Tarif[] {
  return IMPLICITE.map((t) => ({
    ...t,
    credite: crediteDinEnv(t.cheie, t.credite),
    env: `TARIF_${t.cheie.toUpperCase()}`,
  }))
}

/** Prețul unui serviciu în credite; null = serviciu necunoscut (nu inventăm). */
export function creditePentru(cheie: string): number | null {
  const t = meniulDeTarife().find((x) => x.cheie === cheie)
  return t ? t.credite : null
}

/** Prețul în moneda de afișaj (lire) — credite × valoarea creditului. */
export function lirePentru(cheie: string): number | null {
  const c = creditePentru(cheie)
  return c === null ? null : Math.round(c * config.billing.creditValue * 100) / 100
}

/** Cheia de tarif video pentru modelul Veo ACTIV (config.videoModel). */
export function cheiaTarifVideo(model = config.videoModel): string {
  if (/lite/i.test(model)) return 'video_lite'
  if (/fast/i.test(model)) return 'video_fast'
  return 'video_preview'
}

export type Taxare =
  | { ok: true; scazutGbp: number; ramburseaza: () => Promise<void> }
  | { ok: false; motiv: string }

/** Taxează serviciul ÎNAINTE de consum (zidul de plată al extra-serviciilor):
 *  întâi se citește soldul (necititul NU e zero — regula #1), apoi se scade.
 *  `ramburseaza()` întoarce banii DOAR dacă generarea a picat — nimeni nu
 *  plătește un clip care nu s-a născut. Ownerul nu se taxează (casa lui);
 *  tarif 0 = serviciu inclus, fără taxare. */
export async function taxeazaServiciu(email: string, cheie: string, esteAdmin: boolean): Promise<Taxare> {
  if (esteAdmin) return { ok: true, scazutGbp: 0, ramburseaza: async () => {} }
  const lire = lirePentru(cheie)
  if (lire === null) return { ok: false, motiv: `serviciu fără tarif definit: ${cheie} — nu taxez pe ghicite` }
  if (lire <= 0) return { ok: true, scazutGbp: 0, ramburseaza: async () => {} }
  const sold = await citesteSold(email)
  if (!sold.citit) return { ok: false, motiv: `nu pot verifica portofelul (${sold.motiv}) — nu pornesc un serviciu plătit pe necitit` }
  if (sold.sold < lire) {
    const lipsesc = Math.round((lire - sold.sold) * 100) / 100
    return { ok: false, motiv: `sold insuficient: serviciul costă £${lire.toFixed(2)}, mai ai £${sold.sold.toFixed(2)} — reîncarcă măcar £${lipsesc.toFixed(2)}` }
  }
  await debitWallet(email, lire, `tarif:${cheie}`)
  return {
    ok: true,
    scazutGbp: lire,
    // Rambursul intră prin grantCredit → ambele registre îl văd (nimic pe
    // ascuns); motivul rambursului rămâne în jurnalul serverului.
    ramburseaza: async () => {
      console.error(`[tarife] ramburs £${lire.toFixed(2)} către ${email} — serviciul ${cheie} a picat după taxare`)
      await grantCredit(email, lire)
    },
  }
}
