// U+001F (unit separator) brackets a JSON control frame the frontend strips out
// of the text stream (never shown, never spoken), e.g.
// \x1f{"monitor":{"url":"...","title":"..."}}\x1f
export const CTRL = String.fromCharCode(31)

// DID THE PERSON SEE ANYTHING? (Adrian, Jul 30: "reply = nothing")
//
// Two kinds of things go on the wire: visible text and control frames
// (`CTRL{...}CTRL`). Some frames are PURE protocol — {turn}, {heard}, {lang},
// {receipt}, {ping}, {desync} — and they leave on EVERY turn, including one in
// which the brain didn't utter a word. The rest (monitor, card, doc, app, image,
// build, nav, promo, gesture, audio, device, paywall) are surfaces or actions:
// the person really sees something happening.
//
// So "the turn produced something visible" = non-empty text OR at least one
// non-protocol frame.
// {executie} e PROGRES, nu răspuns: dacă ar conta ca „vizibil", o tură de
// execuție cu text final GOL ar trece de rotația mută și de plasa anti-tăcere
// exact ca ack-ul instant din 2 aug (vezi mai jos). Pașii se văd pe monitor,
// dar răspunsul tot trebuie să vină.
const CADRE_PROTOCOL = /"(turn|heard|lang|receipt|ping|desync|executie)"\s*:/
export function areCevaDeVazut(chunk: string): boolean {
  const cadru = new RegExp(`${CTRL}[^${CTRL}]*${CTRL}`, 'g')
  if (chunk.replace(cadru, '').trim() !== '') return true
  for (const f of chunk.match(cadru) ?? []) if (!CADRE_PROTOCOL.test(f)) return true
  return false
}

// THE INSTANT ACK IS NOT THE ANSWER (Adrian, Aug 2 — written localization
// request → „Am preluat sarcina" → then NOTHING).
//
// The admin's heavy-turn ack (below, "Am preluat sarcina. ") leaves BEFORE the
// brain runs — by design, so the first word is instant. But the write
// interceptor counted it as "something visible", and that single count killed
// TWO safety nets in the same turn:
//
//   1. THE SILENT ROTATION accepted an EMPTY brain answer as a successful turn
//      (`... || sawVisible` below — the ack had already "shown" something, so
//      an empty completion broke out of the rotation loop instead of moving
//      to the next model). Live proof in the server journal: `[tool]
//      lookup_address (admin)` fired for his request, the final text came
//      back empty, and the turn closed on the spot — while non-heavy turns
//      (where no ack had flowed) rotated correctly: `[CHAT MUTE] ... returned
//      empty — silent rotation`.
//   2. THE NEVER-SILENCE NET at the end of the turn stayed off (same poisoned
//      flag), so not even the honest "try again" reached him.
//
// The result looked EXACTLY like the message had been swallowed by a task
// queue: the pickup phrase, then the void. The ack is a receipt, not a reply
// — it never counts as visible content. Every taken-on turn must produce a
// real answer or an honest message; never silence after „am preluat".
export function conteazaCaVizibil(chunk: string, esteAckInstant: boolean): boolean {
  return !esteAckInstant && areCevaDeVazut(chunk)
}

// A SURFACE FRAME (Adrian, Aug 2 — "TOT pe monitor"): {monitor} with a real
// url, {doc}, {app}, {card} or {build} — what the end-of-turn auto-preview
// checks so it never duplicates a visual the tools already pushed. The empty
// {monitor:{url:''}} frame is a screen CLEAR, not a surface.
const CADRU_SUPRAFATA = /"(doc|app|card|build)"\s*:|"monitor"\s*:\s*\{[^{]*"url"\s*:\s*"[^"]/
export function eCadruDeSuprafata(chunk: string): boolean {
  const cadru = new RegExp(`${CTRL}[^${CTRL}]*${CTRL}`, 'g')
  for (const f of chunk.match(cadru) ?? []) if (CADRU_SUPRAFATA.test(f)) return true
  return false
}

