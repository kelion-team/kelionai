// Confirm gemini-2.5-flash-image returns inline image bytes for a prompt.
const key = process.env.GEMINI_API_KEY ?? ''
const model = 'gemini-2.5-flash-image'
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'A cute robot mascot waving, flat vector logo, white background' }] }],
  }),
})
console.log('HTTP', res.status)
const j = await res.json()
if (!res.ok) { console.log('ERR', JSON.stringify(j).slice(0, 400)); process.exit(2) }
const parts = j.candidates?.[0]?.content?.parts ?? []
for (const p of parts) {
  if (p.inlineData) console.log('IMAGE_OK mime=', p.inlineData.mimeType, 'bytes(b64)=', p.inlineData.data.length)
  else if (p.text) console.log('TEXT:', p.text.slice(0, 120))
}
