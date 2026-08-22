// THE "IS ANYONE DOING SOMETHING RIGHT NOW" SIGNAL — one shared place.
//
// Why it exists (Adrian, Aug 1: "the deploy didn't take everything" — his tab
// was open and VISIBLE, so the old interface kept running for an hour after
// the publish): the new-version bar waited for a click or for a hidden tab.
// Now the version applies BY ITSELF — but never over live work. The chat
// reports here three flags; the update countdown in App.tsx ticks only while
// everything is calm:
//   voice  — a microphone/voice session is open (a reset would cut it mid-word)
//   busy   — a request to the brain is in flight
//   draft  — there is unsent text in the composer

let voice = false
let busy = false
let draft = false

export function reportActivity(p: { voice?: boolean; busy?: boolean; draft?: boolean }): void {
  if (p.voice !== undefined) voice = p.voice
  if (p.busy !== undefined) busy = p.busy
  if (p.draft !== undefined) draft = p.draft
}

/** True only when nothing live would be cut by a hard reset. Read by the
 *  auto-update watcher (updateCheck.ts): the new version applies BY ITSELF,
 *  but never over an open voice session, an in-flight request, or unsent text. */
export function isCalm(): boolean {
  return !voice && !busy && !draft
}
