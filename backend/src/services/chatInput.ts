export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface Coords {
  lat: number
  lon: number
}

// ── THE LOCATION TRUTH, ONE SOURCE (the "câte grade sunt în locația mea → 27°
// fără GPS" incident) ────────────────────────────────────────────────────────
// The owner asked for the weather "in my location" and got 27° for a place the
// model had INVENTED: on a turn with no device GPS and the IP-geo cache still
// cold, NOTHING in the context said "you have no location" — the get_weather
// description only said "pass the user's lat/lon (given in your context)", so
// the model filled the hole from its own memory and quoted live weather for a
// guessed city as if it were the user's. Resolved ONCE here, then read by BOTH
// consumers: the system-prompt block below (what the brain knows) and the
// get_weather guard in runTool (what the tool is allowed to run with).
export interface DeviceLocation {
  /** Exact coordinates from the device GPS (req.body.coords), null when absent/invalid. */
  gps: { lat: number; lon: number } | null
  /** City-level "City, Region, Country" from the request IP ('' when unknown). */
  approxPlace: string
}

export function resolveDeviceLocation(
  coords: Coords | undefined,
  geo: { city?: string; region?: string; country?: string } | null,
): DeviceLocation {
  const gps =
    coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)
      ? { lat: coords.lat, lon: coords.lon }
      : null
  const approxPlace = gps
    ? ''
    : [geo?.city, geo?.region, geo?.country].filter(Boolean).join(', ')
  return { gps, approxPlace }
}

// The honest void, DECLARED. When neither GPS nor the IP estimate exists, the
// brain must KNOW it has no location — otherwise it manufactures one (that is
// exactly where the 27° came from). No invented default, ever.
export const LOCATION_NONE_PROMPT =
  `\n\nLOCATION: you do NOT have the user's location on this turn — the device did not share its GPS and no network estimate exists. ` +
  `For "my location" / "here" / local-weather questions, say honestly that you don't have their location and ask them to allow location access on the device. ` +
  `NEVER guess a city, place or coordinates, and NEVER quote weather, distances or "near me" results for an invented spot.`

// THE get_weather GUARD (deterministic — the model's good will is not enough):
// a location-less call is filled from the DEVICE GPS first, then from the
// IP-level approximation; with neither, the tool REFUSES and tells the model to
// answer honestly instead of geocoding a hallucinated place name.
export function weatherArgsWithLocation(
  input: unknown,
  loc: DeviceLocation,
): { input: Record<string, unknown> } | { errorJson: string } {
  const a = (input ?? {}) as Record<string, unknown>
  const hasCoords =
    a.lat !== undefined &&
    a.lon !== undefined &&
    Number.isFinite(Number(a.lat)) &&
    Number.isFinite(Number(a.lon))
  const hasPlace = typeof a.location === 'string' && a.location.trim().length > 0
  if (hasCoords || hasPlace) return { input: a }
  // "Locația mea" → the device GPS, exactly as the owner asked.
  if (loc.gps) return { input: { ...a, lat: loc.gps.lat, lon: loc.gps.lon } }
  // Rough IP fallback — labelled approximate in the prompt, better than nothing.
  if (loc.approxPlace) return { input: { ...a, location: loc.approxPlace } }
  return {
    errorJson: JSON.stringify({
      error: 'location_unavailable',
      message:
        "The user's location is not available on this turn: the device did not share GPS and no network estimate exists. Answer honestly that you don't have their location and ask them to allow location access — never guess a city or coordinates, never quote weather for an invented spot.",
    }),
  }
}

// The brain API rejects empty-content messages and non-alternating roles, and the
// first message must be a user turn. The client can produce all three: a
// monitor-only / tool-only reply leaves an empty assistant turn, and a local
// camera "ack" injects an assistant turn with no matching user turn (two
// assistants in a row, or a leading assistant). Any of these poisons the
// history and makes every later turn 400. Clean it here, centrally: drop empty
// turns, merge consecutive same-role turns, and drop leading assistant turns.
export function sanitizeHistory(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of messages) {
    const content = (m.content ?? '').trim()
    if (!content) continue
    const prev = out.at(-1)
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n${content}`
    else out.push({ role: m.role, content })
  }
  while (out.length > 0 && out[0].role !== 'user') out.shift()
  return out
}

// TURA VOCALĂ = AUDIO cu text GOL (voce unificată, 6 aug — „urechea o scoți
// total, creierul unic aude"). Fraza vocală vine în câmpul `audio`, iar mesajul
// user are text '' — sanitizeHistory tocmai l-a scos. FĂRĂ o tură user la coadă
// care să poarte fraza, o tură vocală pica: pe istoric gol → 400 „no usable
// messages" (iar clientul arată ORICE 400 ca „Eroare la creier"), cu istoric →
// audio-ul se lipea de o tură user VECHE și conversația se termina cu assistant,
// deci creierul eșua. Garantăm purtătorul: creierul AUDE fraza (blocul audio_url
// se atașează pe ultima tură user), iar textul e legitim gol. Exportat = testabil.
export function asiguraPurtatorAudio(messages: ChatMessage[], audioPrezent: boolean): ChatMessage[] {
  if (!audioPrezent) return messages
  const ultim = messages.at(-1)
  if (!ultim || ultim.role !== 'user') return [...messages, { role: 'user', content: '' }]
  return messages
}

