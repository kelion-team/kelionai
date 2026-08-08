// Generate a few Kelion logo options for the Google consent screen, using the
// same image path the app uses (service account + gemini image). Saves PNGs.
import { GoogleAuth } from 'google-auth-library'
import { writeFileSync, mkdirSync } from 'node:fs'

const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '{}')
const project = creds.project_id
const auth = new GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/generative-language'] })
const tok = (await (await auth.getClient()).getAccessToken()).token
const outDir = 'C:/Users/adria/Kelionai/docs/logo'
mkdirSync(outDir, { recursive: true })

const prompts = [
  "A minimalist app icon: a smooth glowing sphere with a soft blue-to-violet gradient, representing a calm AI assistant, centered on a pure white background, modern flat design, crisp, 1:1 square, no text, no letters",
  "A minimalist app icon: a bold geometric letter K built from clean rounded shapes in a blue-violet gradient, centered on a pure white background, modern flat vector, 1:1 square, no other text",
  "A minimalist app icon for an AI assistant named Kelion: a simple circular emblem with concentric rings and a subtle glowing core suggesting intelligence, blue and violet accents, pure white background, flat modern, 1:1 square, no text",
]

let i = 0
for (const p of prompts) {
  i++
  const r = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', 'x-goog-user-project': project },
      body: JSON.stringify({ contents: [{ parts: [{ text: p }] }] }),
    },
  )
  if (!r.ok) { console.log(i, 'HTTP', r.status, (await r.text()).slice(0, 120)); continue }
  const j = await r.json()
  const part = (j.candidates?.[0]?.content?.parts ?? []).find((pp) => pp.inlineData)
  if (!part) { console.log(i, 'no_image'); continue }
  const buf = Buffer.from(part.inlineData.data, 'base64')
  const file = `${outDir}/kelion-logo-${i}.png`
  writeFileSync(file, buf)
  console.log(i, '->', file, `(${buf.length} bytes, ${part.inlineData.mimeType})`)
}
