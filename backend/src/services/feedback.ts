// ══════════════════════════════════════════════════════════════════════════
// FEEDBACK CĂTRE CREIER (Adrian, 5 iul: „kelion nu primește niciodată în chat")
// ──────────────────────────────────────────────────────────────────────────
// Problema depistată: rezultatul agenților (constructor/tester) ajungea DOAR pe
// ecran (sayQueue → poll), ca text gata-făcut. Creierul (Kelion) NU-l primea —
// deci nu-l putea verifica, confirma sau discuta. Era dispecer orb: „aloca" și
// atât.
//
// Fixul: când vine un rezultat de la agent, RE-CHEMĂM creierul cu el, ca să
// raporteze cu VOCEA lui, verificat, cu dovada — exact ca un om care-ți spune
// „am făcut X, l-am testat, uite proba, aștept «da»". Modulul ăsta e partea
// PURĂ (fără efecte): construiește promptul pentru creier și mesajul de rezervă
// (dacă creierul e ocupat/offline, tot primești notificarea — nu se pierde).
// ══════════════════════════════════════════════════════════════════════════

export type FeedbackKind =
  | 'ready' // constructorul a terminat o lucrare, gata de publicat (așteaptă „da")
  | 'pass' // testerul a certificat o cerință pe comportament live (PASS)
  | 'fail' // testerul a picat cerința — plecată automat la reparat

export interface AgentOutcome {
  kind: FeedbackKind
  summary: string // ce s-a făcut / numele cerinței
  proof?: string // dovada reală: ieșirea build-ului / verdictul testerului
  detail?: string // detaliu suplimentar (ex: motivul unui FAIL)
  queued?: number // câte mai stau la rând de publicat (doar pentru „ready")
}

const clip = (s: string, n: number): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

// Promptul cu care RE-CHEMĂM creierul. Îi dăm faptele + dovada și îi cerem să
// raporteze cu vocea lui. GARDĂ IMPORTANTĂ: „doar raportează" — creierul NU
// trebuie să dispecerizeze altă lucrare sau să execute ceva pe baza asta
// (altfel un rezultat ar declanșa la nesfârșit lucrări noi).
export function buildBrainReport(o: AgentOutcome): string {
  const summary = clip(o.summary, 400) || 'o modificare'
  const proof = clip(o.proof ?? '', 500)
  const detail = clip(o.detail ?? '', 300)
  const head = '[REZULTAT DE LA CONSTRUCTORUL TĂU — raportează-i lui Adrian, NU executa și NU dispeceriza nimic pe baza asta, doar spune-i rezultatul verificat, scurt, cu vocea ta:]'
  if (o.kind === 'pass') {
    return (
      `${head}\n` +
      `Cerința „${summary}" a trecut verificarea pe comportament live: tester PASS.` +
      (detail ? ` Detaliu: ${detail}.` : '') +
      (proof ? ` Dovada: ${proof}.` : '') +
      `\nConfirmă-i lui Adrian, verificat, că e certificată și gata — pe scurt.`
    )
  }
  if (o.kind === 'fail') {
    return (
      `${head}\n` +
      `Cerința „${summary}" a PICAT verificarea${detail ? `: ${detail}` : ''}.` +
      ` A plecat automat la reparat și rămâne deschisă.` +
      `\nSpune-i lui Adrian cinstit că a picat, de ce, și că se reia automat — pe scurt.`
    )
  }
  // ready
  const pos = o.queued && o.queued > 1 ? ` (mai sunt ${o.queued} la rând)` : ''
  return (
    `${head}\n` +
    `Agenții au terminat o lucrare și au trecut-o prin tester (PASS).\n` +
    `Ce s-a făcut: ${summary}${pos}.\n` +
    `Dovada de build/test: ${proof || 'build curat, tester PASS (fără ieșire atașată)'}.\n` +
    `Spune-i lui Adrian, verificat și pe scurt: ce s-a făcut, că testerul a dat PASS (cu dovada), ` +
    `și că aștepți „da" ca să publici. Doar raportează.`
  )
}

// Mesajul de REZERVĂ (păstrează comportamentul de azi): folosit când creierul e
// offline sau nu răspunde la timp — ca notificarea să NU se piardă niciodată.
export function fallbackLine(o: AgentOutcome): string {
  const summary = clip(o.summary, 400) || 'modificarea'
  const proof = clip(o.proof ?? '', 300)
  const detail = clip(o.detail ?? '', 300)
  if (o.kind === 'pass') {
    return `✅ CERTIFICAT: „${summary}" verificată pe comportament (tester PASS)${detail ? ` — ${detail}` : ''}.`
  }
  if (o.kind === 'fail') {
    return `❌ „${summary}" a picat verificarea pe comportament (${detail || 'fără detaliu'}) — am trimis-o automat la reparat. Rămâne deschisă.`
  }
  const pos = o.queued && o.queued > 1 ? ` (la rând: ${o.queued})` : ''
  const proofLine = proof
    ? ` Dovada: ${proof}.`
    : ' (fără dovadă de build atașată — cere-o dacă vrei să vezi ce s-a schimbat).'
  return `Am reparat: ${summary}.${proofLine} Aprobi deploy?${pos} Scrie „da" și public pe loc.`
}
