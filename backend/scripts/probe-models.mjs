// List Gemini models available to the prod key and flag image-capable ones.
const key = process.env.GEMINI_API_KEY ?? ''
if (!key) { console.log('NO_KEY'); process.exit(1) }
const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
  headers: { 'x-goog-api-key': key },
})
console.log('HTTP', res.status)
const j = await res.json()
const models = j.models ?? []
console.log('TOTAL', models.length)
for (const m of models) {
  const name = (m.name ?? '').replace('models/', '')
  const methods = (m.supportedGenerationMethods ?? []).join(',')
  if (/image|imagen/i.test(name) || /predict/i.test(methods)) {
    console.log('IMG?', name, '|', methods)
  }
}
