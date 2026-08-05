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
  // Engleză — aceleași forme.
  /i\s+(?:do\s*n[o']t|don't|cannot|can't)\s+have\s+(?:any\s+)?(?:tools|access\s+to\s+the\s+internet|access\s+to\s+tools|browsing)/i,
  /i\s+(?:cannot|can't)\s+(?:browse|search)\s+the\s+(?:internet|web)/i,
  /as\s+an?\s+(?:ai|artificial\s+intelligence|language\s+model)\b[^.]{0,60}(?:cannot|can't|don't|do\s+not)/i,
]

/** `true` = răspunsul NEAGĂ uneltele (marfă stricată — nu pleacă la om). */
export function neagaUneltele(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  return TIPARE_NEGARE.some((re) => re.test(t))
}
