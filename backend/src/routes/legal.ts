import type { FastifyInstance } from 'fastify'

// Public Privacy Policy + Terms of Service pages, served as plain crawler-
// friendly HTML (no JS) at stable URLs. These are exactly what the Google OAuth
// consent screen links to (App information → Privacy Policy URL / Terms of
// Service URL) and what Google's app-verification + GDPR require. The Privacy
// Policy includes the Google API Services "Limited Use" disclosure that
// restricted scopes (Gmail/Drive/Contacts) need for verification.

const UPDATED = '30 June 2026'
const CONTACT = 'adrianenc11@gmail.com'

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Kelionai</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0b0d12; color:#e7ecf4; font:16px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
  main { max-width:760px; margin:0 auto; padding:48px 22px 80px; }
  h1 { font-size:30px; margin:0 0 6px; }
  h2 { font-size:19px; margin:30px 0 8px; color:#cdd7ea; }
  a { color:#6ea8fe; }
  .muted { color:#93a0b5; font-size:14px; }
  .brand { font-weight:600; letter-spacing:-.3px; }
  ul { padding-left:20px; }
  li { margin:4px 0; }
  hr { border:0; border-top:1px solid #1e2430; margin:28px 0; }
  .nav a { margin-right:16px; }
</style></head><body><main>
<p class="brand">Kelionai</p>
<h1>${title}</h1>
<p class="muted">Last updated: ${UPDATED}</p>
${body}
<hr>
<p class="nav"><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="/delete-account">Delete Account</a><a href="/">Home</a></p>
<p class="muted">Contact: <a href="mailto:${CONTACT}">${CONTACT}</a></p>
</main></body></html>`
}

const PRIVACY = page(
  'Privacy Policy',
  `<p>Kelionai ("the app", "we") is a personal AI assistant available at
  <a href="https://kelionai.app">kelionai.app</a>. This policy explains what data
  we process, why, and your rights under the GDPR.</p>

  <h2>Data we process</h2>
  <ul>
    <li><strong>Google account</strong> — your email, name, profile picture and
      locale, received via "Sign in with Google" (we never see your password).</li>
    <li><strong>Conversation content</strong> — the messages you type or speak and
      Kelion's replies, so the assistant can respond and remember context.</li>
    <li><strong>Google Workspace data you ask Kelion to act on</strong> — e.g.
      Calendar, Gmail, Drive, Tasks, Contacts — accessed only with your explicit
      OAuth consent and only to fulfil your request.</li>
    <li><strong>Device signals</strong> — approximate location (GPS) and camera
      frames, used only when those features are enabled, to answer
      location/visual questions. Camera frames are sent per turn, not streamed.</li>
    <li><strong>Usage + cost metering</strong> — technical counts used to operate
      and bill the service.</li>
    <li><strong>Free-trial visitors</strong> — if you start a free trial without
      signing in, we record your IP address, approximate country/city and a device
      fingerprint. We use these only to run the trial, prevent repeat abuse and
      understand where interest comes from — never to identify you personally.</li>
  </ul>

  <h2>How we use it</h2>
  <ul>
    <li>To provide the assistant's replies, voice, vision and Google skills.</li>
    <li>To keep your conversation continuous across sessions (memory).</li>
    <li>To operate, secure and improve the service, and meter real cost.</li>
  </ul>

  <h2>Google API Services — Limited Use</h2>
  <p>Kelionai's use and transfer of information received from Google APIs adheres
  to the
  <a href="https://developers.google.com/terms/api-services-user-data-policy">Google
  API Services User Data Policy</a>, including the <strong>Limited Use</strong>
  requirements. We use Google user data only to provide and improve user-facing
  features you request; we do not sell it, use it for advertising, or allow humans
  to read it except where required for security, to comply with law, or with your
  consent. AI providers process the data solely to generate your response.
  Data obtained through <strong>restricted scopes</strong> (Gmail and Drive) is
  used only to provide the features you invoke and is <strong>never</strong> used
  to train, develop or improve generalized or non-personalized AI/ML models, nor
  transferred to any third party except the service providers strictly needed to
  operate the feature at your request.</p>

  <h2>Sub-processors</h2>
  <ul>
    <li><strong>Google (Gemini API)</strong> — processes conversation content (text, and any images/audio you send) to generate replies.</li>
    <li><strong>Google Cloud</strong> — speech-to-text and text-to-speech (voice), plus the Google skills you invoke.</li>
    <li><strong>Serper</strong> — processes your web-search queries to return live Google results.</li>
    <li><strong>Dedicated VPS server (EU)</strong> — hosting and database.</li>
  </ul>

  <h2>Retention</h2>
  <p>Conversation history, learned memory and metering are retained while your
  account is active. You can request deletion at any time and we will erase your
  data without undue delay.</p>

  <h2>Your rights (GDPR)</h2>
  <p>You may request access, correction, export or deletion of your data, and may
  withdraw OAuth consent at any time in your
  <a href="https://myaccount.google.com/permissions">Google Account</a>. To exercise
  any right, contact <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`,
)

const TERMS = page(
  'Terms of Service',
  `<p>By using Kelionai at <a href="https://kelionai.app">kelionai.app</a> you agree
  to these terms.</p>

  <h2>The service</h2>
  <p>Kelionai is a personal AI assistant (chat, voice, vision and Google skills).
  Access is currently restricted to invited accounts while the app is in testing.</p>

  <h2>Acceptable use</h2>
  <ul>
    <li>Use the assistant lawfully and do not attempt to abuse, overload or break it.</li>
    <li>You are responsible for the actions you ask Kelion to take on your accounts
      (e.g. sending an email or creating an event).</li>
  </ul>

  <h2>AI output</h2>
  <p>Responses are generated by AI and may be inaccurate. Verify important
  information; do not rely on the assistant for professional, legal, medical or
  financial advice.</p>

  <h2>Availability & changes</h2>
  <p>The service is provided "as is", without warranty, and may change or be
  unavailable. We may update these terms; continued use means acceptance.</p>

  <h2>Contact</h2>
  <p>Questions: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`,
)

// Account + data deletion page (Google Play Data safety requires a public URL
// that shows the steps to delete an account and what data is removed/kept).
const DELETE_ACCOUNT = page(
  'Delete your account',
  `<p>This page explains how to delete your <span class="brand">Kelionai</span>
  account and the data associated with it. Kelionai is a personal AI assistant
  available at <a href="https://kelionai.app">kelionai.app</a>.</p>

  <h2>How to request deletion</h2>
  <p>Email <a href="mailto:${CONTACT}">${CONTACT}</a> <strong>from the Google
  email address you sign in with</strong>, using the subject line
  <strong>"Delete my account"</strong>. That is all we need — sending from your
  own account lets us verify the request is really yours.</p>
  <p>We erase your data and reply to confirm once it is done. You do not need to
  be signed in, pay anything, or install anything to make the request.</p>

  <h2>What is deleted</h2>
  <ul>
    <li>Your profile — name, email, profile picture and locale.</li>
    <li>Your conversation history and the memory Kelion learned about you.</li>
    <li>Any stored Google OAuth tokens (your Calendar/Gmail/Drive access is revoked).</li>
    <li>Usage and cost-metering records tied to your account.</li>
  </ul>

  <h2>What is kept, and for how long</h2>
  <p>We delete your personal data without undue delay and, in any case, within
  <strong>30 days</strong> of your request. Residual copies inside encrypted
  backups are purged on our normal rotation, within <strong>90 days</strong>. We
  keep only the minimum records the law requires (for example billing/tax); all
  other personal data is removed.</p>

  <p>You can also revoke Kelionai's access to your Google account at any time in
  your <a href="https://myaccount.google.com/permissions">Google Account
  permissions</a>.</p>`,
)

export async function legalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/privacy', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(PRIVACY),
  )
  app.get('/terms', async (_req, reply) => reply.type('text/html; charset=utf-8').send(TERMS))
  app.get('/delete-account', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(DELETE_ACCOUNT),
  )
}
