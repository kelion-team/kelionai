import { GoogleAuth } from 'google-auth-library'
const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '{}')
const project = creds.project_id
for (const scope of [
  'https://www.googleapis.com/auth/generative-language',
  'https://www.googleapis.com/auth/cloud-platform',
]) {
  try {
    const auth = new GoogleAuth({ credentials: creds, scopes: [scope] })
    const tok = (await (await auth.getClient()).getAccessToken()).token
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
      { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', 'x-goog-user-project': project }, body: JSON.stringify({ contents: [{ parts: [{ text: 'red circle' }] }] }) },
    )
    const t = await r.text()
    console.log(scope.split('/').pop(), '=> HTTP', r.status, /inlineData|"data"/.test(t) ? 'IMAGE_OK' : t.slice(0, 150).replace(/\s+/g, ' '))
  } catch (e) { console.log(scope.split('/').pop(), 'ERR', String(e).slice(0, 110)) }
}
