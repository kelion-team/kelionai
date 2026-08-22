// ── RUTA AUDIO: e vreun dispozitiv Bluetooth în joc? (owner, 22 aug) ─────────
//
// Ordinul: „identifica toate optiunile de device si modurile posibile de
// folosire" — regula anulării de ecou se alege după ruta audio REALĂ:
//   · difuzor telefon / desktop  → procesarea WebRTC (AEC/AGC) AJUTĂ (ecoul
//     vocii lui Kelion intră înapoi în microfon);
//   · Bluetooth (căști/boxă/mașină) → procesarea STRICĂ: pe Android, un
//     microfon deschis CU procesare ține telefonul în MODE_IN_COMMUNICATION
//     și ieșirea NU mai ajunge pe A2DP — bugul măsurat de owner pe 11 aug
//     („nu funcționează ieșirea pe bluetooth").
//
// De-asta detecția e construită să GREȘEASCĂ ÎN DIRECȚIA SIGURĂ (Legea #1):
// procesarea pe mobil se pornește DOAR când citirea listei de dispozitive a
// REUȘIT și niciun nume nu pare Bluetooth. Orice îndoială (citire picată,
// nume goale fără permisiune, etichetă necunoscută) = rămâne comportamentul
// de azi (procesare oprită pe mobil) — adică zero regresie pe cazul care l-a
// durut pe owner, câștig doar pe cazul cert (difuzorul telefonului).

/** Numele dispozitivului pare de Bluetooth? Funcție PURĂ — probată în teste.
 *  Etichetele reale văzute în browsere: „… (Bluetooth)", „AirPods…",
 *  „Galaxy Buds…", „… Hands-Free", „… A2DP", „… SCO". Lista e best-effort,
 *  declarat: un BT cu nume atipic scapă detecției → direcția de eroare e cea
 *  SIGURĂ abia prin regula „doar când niciun nume nu pare BT" + citire
 *  reușită — nu prin exhaustivitatea listei. */
export function pareBluetooth(label: string): boolean {
  return /bluetooth|air\s?pods?|galaxy buds|\bbuds\b|hands-?free|\ba2dp\b|\bsco\b|\bble\b/i.test(String(label ?? ''))
}

/** SUNTEM SIGURI că nu e niciun dispozitiv Bluetooth? `true` DOAR când:
 *  enumerarea a reușit, există măcar un nume necenzurat (permisiunea dată) și
 *  niciunul nu pare Bluetooth. Orice altceva → `false` (nesigur ≠ „nu e BT"). */
export async function faraBluetoothSigur(): Promise<boolean> {
  try {
    const dispozitive = await navigator.mediaDevices.enumerateDevices()
    const audio = dispozitive.filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
    if (audio.length === 0) return false
    const nume = audio.map((d) => d.label).filter((l) => l && l.trim().length > 0)
    // Fără nicio etichetă lizibilă (permisiune nedată încă) nu putem ști → nesigur.
    if (nume.length === 0) return false
    return nume.every((l) => !pareBluetooth(l))
  } catch {
    return false
  }
}
