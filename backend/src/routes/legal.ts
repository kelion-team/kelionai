import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'

const esc = (value: unknown): string => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const contact = esc(config.product.supportEmail)
const appOrigin = esc(config.product.publicAppOrigin)
const appName = esc(config.product.appName)
const controller = esc(config.privacy.controllerName || config.product.appName)
const updated = esc(config.privacy.policyUpdated || 'development')

function page(title: string, body: string): string {
  const safeTitle = esc(title)
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
<title>${safeTitle} — ${appName}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0b0d12; color:#e7ecf4; font:16px/1.65 system-ui,sans-serif; }
  main { max-width:780px; margin:0 auto; padding:48px 22px 80px; }
  h1 { font-size:30px; margin:0 0 6px; } h2 { font-size:19px; margin:30px 0 8px; color:#cdd7ea; }
  a { color:#8ab4ff; } .muted { color:#93a0b5; font-size:14px; } ul { padding-left:20px; }
  hr { border:0; border-top:1px solid #1e2430; margin:28px 0; } .nav a { margin-right:16px; }
</style></head><body><main>
<p><strong>${appName}</strong></p><h1>${safeTitle}</h1>
<p class="muted">Policy version/date: ${updated}</p>
${body}
<hr><p class="nav"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/delete-account">Delete account</a><a href="/">Home</a></p>
<p class="muted">Data controller: ${controller}. Contact: <a href="mailto:${contact}">${contact}</a>.</p>
</main></body></html>`
}

function privacyPage(): string {
  return page('Privacy Policy', `
  <p>${controller} operates Kelionai at <a href="${appOrigin}">${appOrigin}</a>. This notice describes the current product implementation; it does not grant hidden collection rights.</p>

  <h2>Data and purposes</h2>
  <ul>
    <li><strong>Identity and session:</strong> verified account email, display name, picture, locale and an opaque revocable session handle, used to authenticate and provide the service. Google OAuth credentials are encrypted server-side and never placed in the browser cookie.</li>
    <li><strong>Conversations and memory:</strong> content you submit and assistant replies, plus memories or notes needed for cross-session continuity.</li>
    <li><strong>Optional microphone, camera, location and voice personalisation:</strong> processed only after the relevant permission or explicit request. A camera image is sent only with a visual turn and is not retained as sensor history or visitor analytics. Ambient-audio hints contain bounded spectral metadata, not a raw recording, and expire after at most ten minutes. An optional spectral voice profile persists only when you explicitly enrol it and can be revoked in Settings. The current product does not enrol new facial biometric profiles; any legacy facial reference is covered by authenticated revocation and account deletion. Neither voice nor face grants administrator access.</li>
    <li><strong>Google capabilities:</strong> only data needed for the capability you explicitly connect and invoke. Login itself requests identity scopes only.</li>
    <li><strong>Product billing and provider metering:</strong> GBP minor-unit wallet/ledger entries and provider usage identifiers/token counts. Provider expense is accounted separately in USD micros and never treated as your wallet currency.</li>
    <li><strong>Minimal analytics and security:</strong> anonymous visits are aggregate daily counters by safe page and coarse country code. We do not create a persistent visitor or device profile, photograph, full-IP record, city/ISP record or advertising profile.</li>
  </ul>

  <h2>Legal bases</h2>
  <p>We use contract necessity to provide requested account features; consent for optional sensors, biometric personalisation and incremental Google connections; legitimate interests for proportionate service security and reliability; and legal obligation or legal claims for the minimum accounting/audit evidence that must survive account deletion.</p>

  <h2>Processors and transfers</h2>
  <ul>
    <li><strong>OpenAI API:</strong> online language, realtime voice, transcription, speech and media functions. Requests explicitly use <code>store:false</code> where supported. API data is not used for model training by default; OpenAI may keep limited abuse-monitoring data under its published endpoint policy.</li>
    <li><strong>Google:</strong> sign-in and the Workspace capability you separately connect. Google data is not sold, used for advertising or used to train a general model. Use follows the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including Limited Use.</li>
    <li><strong>Serper:</strong> receives a search query only when web search is invoked.</li>
    <li><strong>Dedicated application/DB infrastructure:</strong> hosts encrypted account data and operational records. Offline models run locally on your device and do not require an online AI provider.</li>
  </ul>

  <h2>Retention and deletion</h2>
  <p>Account content is retained while the account is active or until you delete it. Anonymous aggregate visit counters are retained for ${config.visitor.analyticsRetentionDays} days. On self-service deletion, sessions and provider credentials are revoked, messages, memories, profiles, biometrics, sensor/presence history and pending work are erased. Financial/security rows are pseudonymised under a random, non-reversible erasure id and retained only for legal obligation/claims for up to ${config.privacy.financialRetentionYears} years. Backups are placed beyond use and rotate within ${config.privacy.backupRetentionDays} days; they are not restored to reactivate a deleted account.</p>

  <h2>Your rights</h2>
  <p>You may request access, correction, portability, restriction, objection or erasure, and withdraw consent without affecting earlier lawful processing. Delete your account in-app as described at <a href="/delete-account">Delete account</a>. You may also contact <a href="mailto:${contact}">${contact}</a> and complain to your supervisory authority. Google access can also be revoked from <a href="https://myaccount.google.com/permissions">Google Account permissions</a>.</p>`)
}

function termsPage(): string {
  return page('Terms of Service', `
  <p>By using Kelionai you ask an AI-assisted service to process your prompts and, when separately authorised, act on connected services.</p>
  <h2>Acceptable use</h2><p>Use the service lawfully; do not abuse access controls, overload paid services or submit content you have no right to process.</p>
  <h2>AI output</h2><p>AI output can be inaccurate. Verify high-impact medical, legal, financial or safety decisions with a qualified person.</p>
  <h2>Payments</h2><p>Product credits and provider expenses are separate. An administrator account has zero Kelion product debit, while actual provider usage remains internally metered. A payment is credited only after an authoritative, verified settlement; a static payment link is not automatic settlement.</p>
  <h2>Availability</h2><p>The service may change or be unavailable. Material policy changes will receive a new policy version/date.</p>`)
}

function deletionPage(): string {
  return page('Delete your account', `
  <p>Kelionai provides authenticated self-service account deletion.</p>
  <h2>Steps</h2>
  <ol><li>Sign in and, if requested, sign in again so the confirmation is recent.</li><li>Open Settings → Privacy → Delete account.</li><li>Enter the exact confirmation word <strong>DELETE</strong> and confirm.</li></ol>
  <p>The server immediately revokes application sessions, attempts Google OAuth revocation, removes the local credential, and performs one transactional erase/pseudonymisation workflow. The response is a receipt listing deleted categories, any records retained with reason/expiry, provider-revocation status and the backup purge date.</p>
  <h2>Retained minimum</h2><p>Settled financial and necessary security/audit evidence is not represented as fully erased. It is detached from your email under a random erasure id and retained only for the legal period shown in the receipt (up to ${config.privacy.financialRetentionYears} years). Encrypted backup copies remain beyond use only until the configured ${config.privacy.backupRetentionDays}-day rotation.</p>
  <p>If Google could not confirm remote revocation during the request, the receipt says <code>manual_required</code>; revoke Kelionai from <a href="https://myaccount.google.com/permissions">Google Account permissions</a>. Local access is removed regardless.</p>`)
}

export async function legalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/privacy', async (_req, reply) => reply.type('text/html; charset=utf-8').send(privacyPage()))
  app.get('/terms', async (_req, reply) => reply.type('text/html; charset=utf-8').send(termsPage()))
  app.get('/delete-account', async (_req, reply) => reply.type('text/html; charset=utf-8').send(deletionPage()))
}
