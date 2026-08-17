// ── P22: STUDIOUL DE CLIPURI (owner, 15 aug, verbatim) ──────────────────────
// „se poate numi aplicatia Studioul de Clipuri, care cuprinde toate 6, nu?
//  ii dai o ideie, ii spui foloseste studioul de clipuri si el face tot, nu?"
// + „cu functie timer de promovare eventual la ore prestabilite"
// + „orice clip se salveaza cu nume sugestiv data ora" + „in download"
// + calea GRATIS: „prin google flow" + „fiecare user logat poate sa le
//   foloseasca" + „exact la asta ma gindeam".
//
// MĂSURAT (15 aug): Google Flow (labs.google/flow) dă credite gratuite zilnice
// oricărui cont Google, dar N-ARE API — deci calea gratis e o REȚETĂ pe care
// omul o execută pe contul LUI (Kelion îi dă promptul șlefuit și pașii);
// automatizarea NU apasă în Flow în locul omului (contra regulilor Google).
// Complet-automatul rămâne pe API-ul plătit (Veo), sub comutatorul din P29.
//
// Serviciul e PUR (intră text, iese plan) — creierul primește planul și îl
// urmează pas cu pas; nimic de aici nu cheltuie bani singur.

export const RETETE_STUDIO = [
  'Clip din idee',
  'Spot publicitar',
  'Tutorial',
  'Raport video de seară',
  'Demo cu camera',
  'Clip bilingv',
] as const
export type RetetaStudio = (typeof RETETE_STUDIO)[number]

/** Numele sugestiv al fișierului (ordinul verbatim: „orice clip se salveaza
 *  cu nume sugestiv data ora"): Rețeta-Subiect-AAAA-LL-ZZ_HH-mm. */
export function numeClip(reteta: string, subiect: string, la: Date): string {
  const slug = (s: string): string =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'Clip'
  const p = (n: number): string => String(n).padStart(2, '0')
  const data = `${la.getFullYear()}-${p(la.getMonth() + 1)}-${p(la.getDate())}_${p(la.getHours())}-${p(la.getMinutes())}`
  return `${slug(reteta)}-${slug(subiect)}-${data}`
}

/** Promptul șlefuit pentru Veo/Flow — în engleză (modelele video ascultă cel
 *  mai bine engleza), construit din ideea omului, fără să o inventeze. */
export function promptVideoDinIdee(idee: string, reteta: RetetaStudio | string): string {
  const stil: Record<string, string> = {
    'Clip din idee': 'cinematic, natural lighting, smooth camera movement',
    'Spot publicitar': 'polished commercial look, product-hero framing, vibrant colors, energetic pacing',
    Tutorial: 'clean screen-style presentation, clear focus on the subject, steady framing',
    'Raport video de seară': 'calm documentary tone, warm evening light, steady shots',
    'Demo cu camera': 'handheld realistic style, first-person feel, authentic environment',
    'Clip bilingv': 'cinematic, neutral setting suitable for voice-over in two languages',
  }
  const s = stil[reteta] ?? stil['Clip din idee']
  return `${idee.trim()}. Style: ${s}. High quality, 8 seconds.`
}

export interface PlanStudio {
  reteta: string
  cale: 'gratis' | 'platit'
  numeFisier: string
  /** Pașii pe care creierul îi URMEAZĂ și îi spune omului — planul e al
   *  studioului, nu improvizația modelului. */
  pasi: string[]
  /** Pe calea GRATIS: promptul gata de lipit în Google Flow. */
  promptFlow?: string
  /** Pe calea PLĂTITĂ: promptul gata pentru generate_video. */
  promptVeo?: string
}

export function planStudio(
  idee: string,
  reteta: string | undefined,
  cale: 'gratis' | 'platit',
  la: Date,
): PlanStudio | { error: string } {
  const i = (idee ?? '').trim()
  if (!i) return { error: 'fara_idee: cere-i omului ideea clipului (o frază ajunge)' }
  const r = (RETETE_STUDIO as readonly string[]).includes(reteta ?? '') ? (reteta as RetetaStudio) : 'Clip din idee'
  const nume = numeClip(r, i, la)
  const prompt = promptVideoDinIdee(i, r)
  if (cale === 'gratis') {
    return {
      reteta: r,
      cale,
      numeFisier: `${nume}.mp4`,
      promptFlow: prompt,
      pasi: [
        'Spune-i omului că folosește calea GRATUITĂ: Google Flow, pe contul lui Google (credite gratuite zilnice de la Google; niciun ban din aplicație).',
        'Arată-i promptul șlefuit (promptFlow) și spune-i să-l copieze.',
        'Pașii lui: deschide labs.google/flow → New project → lipește promptul → Generate → descarcă clipul.',
        `Spune-i să salveze clipul cu numele sugestiv: ${nume}.mp4 (în folderul Download).`,
        'Când îl încarcă înapoi în Kelionai (butonul + de lângă chat), analizează-l (vede_video / monitor) și ajută-l la pasul următor (montaj, narare, YouTube privat prin youtube_urca).',
      ],
    }
  }
  return {
    reteta: r,
    cale,
    numeFisier: `${nume}.mp4`,
    promptVeo: prompt,
    pasi: [
      'Cheamă lista_tarife și spune-i omului prețul REAL în credite pentru calitatea activă (nu inventa cifre).',
      'Cere-i confirmarea EXPLICITĂ înainte de orice generare (costă bani).',
      `După confirmare: generate_video cu promptul pregătit (promptVeo). Un clip = maxim 8 secunde; pentru mai mult se generează mai multe clipuri, pe rând.`,
      `Clipul apare pe monitor cu numele sugestiv (${nume}) — butonul „Salvează" îl pune în Download.`,
      'Dacă vrea, urcă-l pe YouTube PRIVAT cu youtube_urca (cere-i întâi titlul).',
    ],
  }
}

// ── PROGRAMATORUL DE PROMOVARE (ordinul: „cu functie timer de promovare
// eventual la ore prestabilite") ─────────────────────────────────────────────
// Setările stau în kv (butonul e AL ownerului, ca la P29); IMPLICIT OPRIT —
// niciun ban nu curge nesupravegheat. Verdictul de rulare e PUR și testabil.
export const KV_STUDIO_PROMO = 'studio_promo'

export interface SetariPromo {
  pornit: boolean
  /** Orele (0-23, ora serverului) la care se generează clipul de promovare. */
  ore: number[]
  /** Plafonul zilnic în USD — peste el, timerul refuză (banii lui, limita lui). */
  plafonUsdZi: number
  /** Ideea clipului de promovare (textul ownerului). */
  idee: string
}

export function setariPromoDinKv(brut: string | null): SetariPromo {
  const implicit: SetariPromo = { pornit: false, ore: [], plafonUsdZi: 1, idee: '' }
  if (!brut) return implicit
  try {
    const j = JSON.parse(brut) as Partial<SetariPromo>
    return {
      pornit: j.pornit === true,
      ore: Array.isArray(j.ore) ? j.ore.map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23) : [],
      plafonUsdZi: Number.isFinite(Number(j.plafonUsdZi)) && Number(j.plafonUsdZi) >= 0 ? Number(j.plafonUsdZi) : 1,
      idee: typeof j.idee === 'string' ? j.idee.slice(0, 2000) : '',
    }
  } catch {
    return implicit
  }
}

/** De ce NU rulează timerul ACUM — sau null dacă drumul e liber. Fiecare
 *  refuz e PE NUME (nimic nu tace). Pur: toate intrările vin de la apelant. */
export function motivRefuzPromo(opts: {
  setari: SetariPromo
  oraAcum: number
  dejaRulatOraAsta: boolean
  videoPornit: boolean
  cheltuitAziUsd: number
  costClipUsd: number | null
}): string | null {
  const s = opts.setari
  if (!s.pornit) return 'promo_oprit (butonul ownerului)'
  if (!s.idee.trim()) return 'promo_fara_idee (ownerul nu a scris ideea clipului)'
  if (!s.ore.includes(opts.oraAcum)) return `ora_neprogramata (acum e ${opts.oraAcum}, orele alese: ${s.ore.join(',') || 'niciuna'})`
  if (opts.dejaRulatOraAsta) return 'deja_rulat_ora_asta (un singur clip pe oră programată)'
  if (!opts.videoPornit) return 'generarea_video_oprita (comutatorul 🎬 din tabul Bani e pe OPRIT)'
  if (opts.costClipUsd === null) return 'model_fara_pret_cunoscut (nu generez pe preț necunoscut)'
  if (opts.cheltuitAziUsd + opts.costClipUsd > s.plafonUsdZi)
    return `plafon_atins (azi: $${opts.cheltuitAziUsd.toFixed(2)} + clip $${opts.costClipUsd.toFixed(2)} > plafon $${s.plafonUsdZi.toFixed(2)})`
  return null
}
