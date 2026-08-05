// ── URECHEA GEMINI — auzul de rezervă FĂRĂ cont de serviciu (3 aug 2026) ─────
//
// Adrian: „auzul trebuie să fie pe Gemini". Contextul real al serii: urechile
// Chirp au căzut cu PERMISSION_DENIED pe `speech.recognizers.recognize`
// (rol IAM pierdut la editarea rolurilor în Console), iar rezerva OpenAI nu
// mai există (extirpat). De aici încolo, când Chirp e jos, auzul NU mai moare:
// cade pe Gemini (generativelanguage, cheia GEMINI_API_KEY) — care nu depinde
// de niciun rol IAM, doar de cheia deja dovedită live pe creier.
//
// Limite spuse cinstit: calea Gemini e în RAFALE (bucăți de ~3s transcrise pe
// rând), nu streaming cu parțiale — auz degradat, dar auz. Chirp rămâne calea
// întâi; Gemini intră doar când Chirp refuză.

import { config } from '../config.js'

// Modelul urechii: implicit modelul GREU (Gemini 3 Pro) — Adrian, 5 aug: „pune
// modelul scump pe ureche", pentru precizie maximă la dictare („ca la Google,
// fără erori"). Suprascriibil prin MODEL_URECHE, fără să atingem creierul.
const MODEL_URECHE = process.env.MODEL_URECHE || config.geminiModelGreu

/** Îmbracă PCM16 mono într-un antet WAV minim — Gemini acceptă audio/wav, nu
 *  PCM gol. Funcție pură (testată în urecheGemini.test.ts). */
export function pcm16InWav(pcm: Buffer, sampleRateHertz: number, canale = 1): Buffer {
  const byteRate = sampleRateHertz * canale * 2
  const antet = Buffer.alloc(44)
  antet.write('RIFF', 0)
  antet.writeUInt32LE(36 + pcm.length, 4)
  antet.write('WAVE', 8)
  antet.write('fmt ', 12)
  antet.writeUInt32LE(16, 16) // mărimea blocului fmt
  antet.writeUInt16LE(1, 20) // PCM liniar
  antet.writeUInt16LE(canale, 22)
  antet.writeUInt32LE(sampleRateHertz, 24)
  antet.writeUInt32LE(byteRate, 28)
  antet.writeUInt16LE(canale * 2, 32) // aliniere bloc
  antet.writeUInt16LE(16, 34) // biți per eșantion
  antet.write('data', 36)
  antet.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([antet, pcm])
}

export type UrecheGeminiResult = { ok: true; transcript: string } | { ok: false; error: string }

/** Transcrie audio (base64 + mime) cu Gemini. Răspuns gol legitim (liniște) =
 *  transcript ''. Orice refuz = eroare NUMITĂ, niciodată '' prefăcut. */
export async function transcrieGemini(audioBase64: string, mime: string, limba?: string): Promise<UrecheGeminiResult> {
  if (!config.geminiKey) return { ok: false, error: 'gemini_neconfigurat' }
  const instructiune =
    'Transcribe the speech in this audio EXACTLY as spoken' +
    (limba ? ` (language: ${limba})` : '') +
    // BIASING (Adrian, 5 aug — „Kelion" a fost auzit „te rugăm"): numim explicit
    // vocabularul așteptat, ca modelul să nu stâlcească numele asistentului.
    '. The AI assistant is named "Kelion" (a proper noun) — whenever you hear that name, write it EXACTLY as "Kelion", never as similar-sounding words. ' +
    'Return ONLY the transcribed words, no quotes, no commentary. If there is no speech, return an empty string.'
  // Gemini 3.x: gândirea consumă din maxOutputTokens → fără plafon + podea de
  // output, transcrierea vine GOALĂ (aceeași capcană ca pe creier). La transcriere
  // nu ne trebuie gândire: o ținem la minim și dăm podeaua de output.
  const este3x = /gemini-3/.test(MODEL_URECHE)
  const generationConfig: Record<string, unknown> = este3x
    ? { temperature: 0, thinkingConfig: { thinkingLevel: 'low' }, maxOutputTokens: 2048 }
    : { temperature: 0 }
  let r: Response
  try {
    r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_URECHE}:generateContent?key=${config.geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: instructiune }, { inlineData: { mimeType: mime, data: audioBase64 } }],
            },
          ],
          generationConfig,
        }),
        signal: AbortSignal.timeout(20_000),
      },
    )
  } catch (e) {
    return { ok: false, error: `rețea: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    return { ok: false, error: `gemini_${r.status}: ${text.slice(0, 160)}` }
  }
  const j = (await r.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const transcript = (j.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim()
  return { ok: true, transcript }
}
