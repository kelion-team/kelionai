const cfg = await import('/app/backend/dist/config.js')
const key = cfg.config.openai.key
const base = cfg.config.openai.apiBaseUrl
if (!key) { console.error('Cheia OpenAI lipsește din config'); process.exit(1) }
const r = await fetch(`${base}/models`, {
  headers: { Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(10000),
})
if (!r.ok) { console.error('Status:', r.status); const t = await r.text(); console.error(t.slice(0, 400)); process.exit(1) }
const j = await r.json()
const models = (j.data || []).filter(x => /image|dall|gpt-image/i.test(x.id))
for (const m of models) console.log(m.id)
if (!models.length) console.log('Niciun model de imagine găsit în catalogul cheii.')
