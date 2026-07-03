// Try the Gemini image model using the SERVICE ACCOUNT OAuth token (which bills
// the billing-enabled project) instead of the free-tier API key. If this returns
// 200 we can switch image generation to the SA and it works with no extra setup.
import { GoogleAuth } from 'google-auth-library'
const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '{}')
const project = creds.project_id
const auth = new GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
const tok = (await (await auth.getClient()).getAccessToken()).token

for (const model of ['gemini-2.5-flash-image', 'imagen-4.0-fast-generate-001']) {
  const isImagen = model.startsWith('imagen')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${isImagen ? 'predict' : 'generateContent'}`
  const body = isImagen
    ? JSON.stringify({ instances: [{ prompt: 'a cute robot logo, flat vector' }], parameters: { sampleCount: 1 } })
    : JSON.stringify({ contents: [{ parts: [{ text: 'a cute robot logo, flat vector' }] }] })
  try {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', 'x-goog-user-project': project }, body })
    const txt = await r.text()
    const hasImg = /inlineData|bytesBase64Encoded|"data"/.test(txt)
    console.log(model, '=> HTTP', r.status, hasImg ? 'IMAGE_OK' : txt.slice(0, 160).replace(/\s+/g, ' '))
  } catch (e) { console.log(model, '=> ERR', String(e).slice(0, 120)) }
}
