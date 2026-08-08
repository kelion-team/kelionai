// Diagnose which Google-backed services still work with the prod env, after a
// billing/key change. Checks: Gemini API key (text) and Cloud Text-to-Speech
// (the voice, via the service account). Prints HTTP status + error snippet.
import { GoogleAuth } from 'google-auth-library'
const out = {}

// 1. Gemini API key — text generateContent (used by translate + search fallback).
const gk = process.env.GEMINI_API_KEY ?? ''
out.gemini_key_len = gk.length
try {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'}:generateContent`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': gk },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }) },
  )
  out.gemini = `HTTP ${r.status}` + (r.ok ? ' OK' : ' ' + (await r.text()).slice(0, 200))
} catch (e) { out.gemini = 'ERR ' + String(e).slice(0, 120) }

// 2. Cloud Text-to-Speech via the service account (the voice). Needs billing.
const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? ''
out.sa_present = raw.length > 0
try {
  const creds = JSON.parse(raw)
  const auth = new GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
  const tok = (await (await auth.getClient()).getAccessToken()).token
  const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text: 'salut' },
      voice: { languageCode: 'ro-RO', name: 'ro-RO-Chirp3-HD-Charon' },
      audioConfig: { audioEncoding: 'MP3' },
    }),
  })
  out.tts = `HTTP ${r.status}` + (r.ok ? ' OK audio' : ' ' + (await r.text()).slice(0, 240))
} catch (e) { out.tts = 'ERR ' + String(e).slice(0, 160) }

console.log(JSON.stringify(out, null, 2))
