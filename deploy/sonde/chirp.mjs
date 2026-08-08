// Sondă CHIRP — e urechea gratuită (Speech-to-Text v2, cont de serviciu) VIE?
// Rulare (pe VPS, din /app/backend unde e node_modules):
//   docker cp .../chirp.mjs kelionai-app:/app/backend/s.mjs
//   && docker exec -w /app/backend kelionai-app node s.mjs
// Citește GOOGLE_SERVICE_ACCOUNT_JSON din env-ul containerului. Zero secrete în fișier.
//
// Ce dovedește: proiectul CONTULUI DE SERVICIU e alt proiect decât cheia
// GEMINI_API_KEY. Dacă recognizerul întoarce 200 pe o liniște scurtă, Chirp are
// auth + facturare/free-tier OK → e o ureche de rezervă REALĂ când Gemini e la
// zero. 401/403 = rol/cont; 429 = și el fără cotă (rezervă moartă).
import { GoogleAuth } from 'google-auth-library'

const REGION = 'eu'
const MODEL = 'chirp_3'

const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || ''
if (!raw) {
  console.log('CHIRP: GOOGLE_SERVICE_ACCOUNT_JSON LIPSEȘTE din container → Chirp NU e configurat')
  process.exit(0)
}
let creds
try {
  creds = JSON.parse(raw)
} catch (e) {
  console.log('CHIRP: GOOGLE_SERVICE_ACCOUNT_JSON nu e JSON valid:', String(e).slice(0, 120))
  process.exit(0)
}
const projectId = creds.project_id || ''
console.log('CHIRP: cont de serviciu prezent, project_id =', JSON.stringify(projectId), '(alt proiect decât cheia Gemini)')

const auth = new GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })

// 0.2s de liniște LINEAR16 16kHz mono = 3200 esantioane pe 0 → base64. O
// generăm AICI (fără transmisie), ca să nu depindem de vreun fișier audio.
const silence = Buffer.alloc(3200 * 2) // 3200 esantioane × 2 octeți (int16)
const content = silence.toString('base64')

try {
  const client = await auth.getClient()
  const tok = await client.getAccessToken()
  const token = typeof tok === 'string' ? tok : tok?.token
  if (!token) {
    console.log('CHIRP: getAccessToken a întors gol → auth PICAT')
    process.exit(0)
  }
  console.log('CHIRP: token obținut (auth OK, len=' + token.length + ')')
  const url = `https://${REGION}-speech.googleapis.com/v2/projects/${projectId}/locations/${REGION}/recognizers/_:recognize`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: {
        model: MODEL,
        languageCodes: ['ro-RO'],
        explicitDecodingConfig: { encoding: 'LINEAR16', sampleRateHertz: 16000, audioChannelCount: 1 },
        features: { enableAutomaticPunctuation: true },
      },
      content,
    }),
  })
  const body = (await res.text()).slice(0, 300)
  console.log('CHIRP: HTTP', res.status, res.ok ? '→ Chirp VIU (rezervă reală)' : '→ Chirp REFUZĂ', '| body:', body.replace(/\s+/g, ' '))
} catch (e) {
  console.log('CHIRP: excepție:', String(e).slice(0, 200))
}
