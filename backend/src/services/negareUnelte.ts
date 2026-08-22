// ── GARDUL DETERMINIST ANTI-NEGARE (Adrian, 5 aug) ───────────────────────────
//
// „kelion îmi zice că nu are unelte" + corecția lui de inginerie: „asta e un
// soft — ce scrii, ce aloci, aia fac". O regulă scrisă în prompt e o rugăminte,
// nu o garanție: modelul slab tot poate scoate „nu am unelte" deși are ~76
// active. Gardul ăsta e CABLAJ, nu predică: un răspuns care neagă uneltele
// (când tura chiar le-a oferit) e un răspuns STRICAT — chat.ts îl aruncă și
// rotește, exact cum garda de alfabet aruncă transcrierea greșită a urechii.
// Pur și testat: fraza-negare → true; „n-am găsit pe web" (folosire cinstită)
// → false.

const TIPARE_NEGARE: RegExp[] = [
  // Română — negarea uneltelor / accesului / naturii de „doar un model".
  /nu\s+(?:am|dispun\s+de|dețin|detin)\s+(?:nicio\s+|niciun\s+)?(?:unelte|unealtă|unealta|instrumente|acces\s+la\s+(?:internet|web|unelte|instrumente))/i,
  /nu\s+am\s+(?:capacitatea|posibilitatea)\s+(?:de\s+)?(?:a|să|sa)\s+(?:c[ăa]ut\w*|navig\w*|acces\w*)/i,
  /nu\s+pot\s+(?:să\s+|sa\s+)?(?:c[ăa]ut\w*|navig\w*|acces\w*)\s+(?:pe\s+)?(?:internet|web|online)/i,
  /(?:sunt|ca)\s+(?:doar\s+)?un\s+model\s+de\s+limbaj/i,
  // Negarea CONTROLULUI DE ECRAN + prescripția „închide-l tu manual"
  // (vânătorul din 22 aug, măsurat pe captura ownerului: „Trebuie să-l
  // oprești manual" trecea nesancționat — goleste_monitorul există și merge).
  /nu\s+(?:pot|am\s+(?:acces|control))[^.]{0,50}(?:monitor|ecran\w*|tab\w*)/i,
  /trebuie\s+s[ăa][- ]?(?:[îi]l|o|l|le)?\s*(?:închizi|inchizi|opre[șs]ti|gole[șs]ti)\s+(?:tu\s+)?manual/i,
  // Îngust pe FALSUL măsurat (captura: „Devin nu face parte din uneltele
  // noastre") — nu pe orice „X nu face parte…", care poate fi un adevăr.
  /devin\s+nu\s+face\s+parte\s+din\s+unelte/i,
  // Engleză — aceleași forme.
  /i\s+(?:do\s*n[o']t|don't|cannot|can't)\s+have\s+(?:any\s+)?(?:tools|access\s+to\s+the\s+internet|access\s+to\s+tools|browsing)/i,
  /i\s+(?:cannot|can't)\s+(?:browse|search)\s+the\s+(?:internet|web)/i,
  /i\s+(?:cannot|can't|don't\s+have)\s+(?:close|control)[^.]{0,40}(?:screen|monitor|tab)/i,
  /as\s+an?\s+(?:ai|artificial\s+intelligence|language\s+model)\b[^.]{0,60}(?:cannot|can't|don't|do\s+not)/i,
]

/** `true` = răspunsul NEAGĂ uneltele (marfă stricată — nu pleacă la om). */
export function neagaUneltele(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  return TIPARE_NEGARE.some((re) => re.test(t))
}
