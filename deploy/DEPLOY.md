# Deploy Kelionai pe VPS propriu

Producția se mută de pe originea veche (fantomă, în spatele Cloudflare) pe **VPS-ul
propriu** (164.68.120.87), sursa unică fiind acest repo. Postgres, LiveKit și boții
rulează deja pe VPS; aici adăugăm containerul **aplicației** + Caddy.

## Pași

1. **Completează env-ul** pe VPS: copiază `deploy/kelionai.env.example` în
   `/root/kelion/kelionai.env` și umple valorile. Cele marcate `[AM]`
   (OpenRouter/OpenAI/Stripe) le pune Claude; cele marcate `[ADRIAN]` le pui tu:
   - **Google OAuth** (`GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`) — din Google Cloud Console.
   - **`SESSION_SECRET`** — `openssl rand -hex 32`.
   - **`DATABASE_URL`** — user/parolă/nume ale Postgres-ului de pe VPS.
   - **`STRIPE_WEBHOOK_SECRET`** — din Stripe → Webhooks (endpoint `https://kelionai.app/api/stripe/webhook`).
   - opțional: LiveKit, Google TTS/Serper/Maps/Gemini, Mail.

2. **Rulează deploy-ul** — calea canonică (25 iul): GitHub → Actions → workflow
   **`deploy`** → Run workflow (rulează și AUTOMAT la fiecare push pe master).
   Face totul singur prin SSH + verifică anti-fantoma (live `v` == sha master).
   Manual, prin SSH: vezi `deploy/RUNBOOKS.md` („Publicare manuală") — nu rula
   `deploy.sh` direct din clonă, folosește forma cu copia din `/tmp`.

3. **Repointează Cloudflare**: în panoul Cloudflare, recordul A/AAAA pentru
   `kelionai.app` → **164.68.120.87**. Până atunci domeniul lovește originea veche.

4. **Verifică live**: `curl https://kelionai.app/api/version` (versiune nouă),
   login Google, o plată de test, microfonul (voce OpenAI), un model selectat.

## Note
- Fără `OPENROUTER_API_KEY` creierul nu pornește (0 Kimi/GLM, fără fallback).
- Fără Google OAuth login-ul nu merge — e obligatoriu.
- Baza de date: dacă folosești o bază NOUĂ, schema se creează la pornire; userii/
  wallet-urile vechi (din originea live) NU se transferă automat.
