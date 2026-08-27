const cfg = require('/app/backend/dist/config.js');
const key = cfg.config.openai.key;
const base = cfg.config.openai.apiBaseUrl;
const model = cfg.config.openai.luna;

(async () => {
  if (!key) { console.error('Cheia OpenAI lipsește din config'); process.exit(1) }
  console.log('Model configurat (luna):', model);
  console.log('Endpoint:', base);
  const r = await fetch(`${base}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, input: 'hi', max_output_tokens: 8 }),
    signal: AbortSignal.timeout(10000),
  });
  console.log('Status:', r.status);
  const body = await r.text();
  console.log('Body:', body.slice(0, 800));
})().catch(e => console.log('ERR:', e.message));
