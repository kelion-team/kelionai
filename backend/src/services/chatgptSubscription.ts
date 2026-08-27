// ── ABONAMENT CHATGPT PRO: token OAuth din ~/.codex/auth.json ────────────────
//
// Owner (27 aug): „tot ce se face în aplicație se folosește ab de 200" —
// abonamentul ChatGPT Pro ($200/lună) include acces la modele prin endpoint-ul
// `chatgpt.com/backend-api/codex`, autentificat cu tokenul OAuth din Codex CLI.
// Acest modul citește auth.json, reîmprospătează tokenul când expiră și expune
// credențialele pentru openaiResponses.ts.
//
// Endpoint: https://chatgpt.com/backend-api/codex/responses
// Auth: Bearer <access_token> (JWT din OAuth, NU cheie API)
// Headers: ChatGPT-Account-ID, originator, OpenAI-Beta
// Constrângeri: store=false, stream=true, instructions non-empty,
//   fără max_output_tokens, fără safety_identifier, fără temperature pe gpt-5

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { config } from '../config.js'

interface CodexAuthJson {
  auth_mode: string
  OPENAI_API_KEY: string | null
  tokens: {
    id_token: string
    access_token: string
    refresh_token: string
    account_id: string
  }
  last_refresh: string
}

interface TokenRefreshResponse {
  access_token: string
  refresh_token: string
  id_token: string
  expires_in: number
}

const CODEX_AUTH_PATH = path.join(os.homedir(), '.codex', 'auth.json')
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

let cached: { auth: CodexAuthJson; loadedAt: number } | null = null
const CACHE_TTL_MS = 60_000 // 1 minut

function readAuthJson(): CodexAuthJson | null {
  try {
    const raw = fs.readFileSync(CODEX_AUTH_PATH, 'utf8')
    const parsed = JSON.parse(raw) as CodexAuthJson
    if (parsed.auth_mode !== 'chatgpt' || !parsed.tokens?.access_token) return null
    return parsed
  } catch {
    return null
  }
}

/** Încearcă să reîmprospăteze access_token-ul cu refresh_token-ul. */
async function refreshToken(refreshToken: string): Promise<TokenRefreshResponse | null> {
  try {
    const r = await fetch(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CODEX_CLIENT_ID,
      }),
    })
    if (!r.ok) return null
    return (await r.json()) as TokenRefreshResponse
  } catch {
    return null
  }
}

/** Salvează auth.json cu tokenurile reîmprospătate. */
function saveAuthJson(auth: CodexAuthJson, refreshed: TokenRefreshResponse): void {
  auth.tokens.access_token = refreshed.access_token
  auth.tokens.refresh_token = refreshed.refresh_token
  auth.tokens.id_token = refreshed.id_token
  auth.last_refresh = new Date().toISOString()
  try {
    fs.writeFileSync(CODEX_AUTH_PATH, JSON.stringify(auth, null, 2), 'utf8')
  } catch {
    // best-effort — nu blocăm dacă nu putem scrie
  }
}

export interface SubscriptionCredentials {
  accessToken: string
  accountId: string
  baseUrl: string
}

/** Numele header-ului HTTP pentru identificarea contului ChatGPT.
 *  Constantă tehnică imuabilă — nume header standard OpenAI Codex. */
export const CHATGPT_ACCOUNT_ID_HEADER = 'ChatGPT-Account-ID' // hardcod-permis: nume header HTTP standard OpenAI Codex, imuabil tehnic

/** Returnează credențialele de abonament ChatGPT, sau null dacă nu există. */
export async function getSubscriptionCredentials(): Promise<SubscriptionCredentials | null> {
  // Cache scurt ca să nu citim auth.json de 100x pe secundă
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return {
      accessToken: cached.auth.tokens.access_token,
      accountId: cached.auth.tokens.account_id,
      baseUrl: 'https://chatgpt.com/backend-api/codex',
    }
  }

  const auth = readAuthJson()
  if (!auth) return null
  cached = { auth, loadedAt: Date.now() }

  // Verifică dacă access_token-ul e expirat (decodifică JWT exp)
  try {
    const payload = JSON.parse(
      Buffer.from(auth.tokens.access_token.split('.')[1], 'base64').toString('utf8'),
    )
    const exp = payload.exp as number
    if (exp && exp * 1000 < Date.now() + 60_000) {
      // Token expirat sau pe punctul să expire — reîmprospătează
      const refreshed = await refreshToken(auth.tokens.refresh_token)
      if (refreshed) {
        saveAuthJson(auth, refreshed)
        cached = { auth, loadedAt: Date.now() }
      }
    }
  } catch {
    // JWT invalid — nu putem verifica, încercăm să-l folosim oricum
  }

  return {
    accessToken: auth.tokens.access_token,
    accountId: auth.tokens.account_id,
    baseUrl: 'https://chatgpt.com/backend-api/codex',
  }
}

/** True dacă există auth.json cu token OAuth ChatGPT. */
export function hasChatGptSubscription(): boolean {
  return readAuthJson() !== null
}

/** True dacă modul abonament e activ (fără cheie API, cu auth.json). */
export function isSubscriptionMode(): boolean {
  return !config.openai?.key && hasChatGptSubscription()
}
