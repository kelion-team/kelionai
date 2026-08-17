# Deploy Kelionai pe VPS propriu

Producția se mută de pe originea veche (fantomă, în spatele Cloudflare) pe **VPS-ul
propriu** (164.68.120.87), sursa unică fiind acest repo. Postgres, LiveKit și boții
rulează deja pe VPS; aici adăugăm containerul **aplicației** + Caddy.

## Pași

1. **Completează env-ul** pe VPS: copiază `deploy/kelionai.env.example` în
   `/root/kelion/kelionai.env` și umple valorile. (OpenRouter/OpenAI/Stripe au
   fost EXTIRPATE — 3 aug; creierul e Gemini.) Cele marcate `[ADRIAN]` le pui tu:
   - **Google OAuth** (`GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`) — din Google Cloud Console.
   - **`SESSION_SECRET`** — `openssl rand -hex 32`.
   - **`DATABASE_URL`** — user/parolă/nume ale Postgres-ului de pe VPS.
   - **`GEMINI_API_KEY`** — creierul unic (AI Studio, cheia ta Tier 2).
   - opțional: LiveKit, Google TTS/Serper/Maps, Mail.

2. **Rulează deploy-ul** — calea canonică (25 iul): GitHub → Actions → workflow
   **`deploy`** → Run workflow (rulează și AUTOMAT la fiecare push pe master).
   Face totul singur prin SSH + verifică anti-fantoma (live `v` == sha master).
   Manual, prin SSH: vezi `deploy/RUNBOOKS.md` („Publicare manuală") — nu rula
   `deploy.sh` direct din clonă, folosește forma cu copia din `/tmp`.

3. **Repointează Cloudflare**: în panoul Cloudflare, recordul A/AAAA pentru
   `kelionai.app` → **164.68.120.87**. Până atunci domeniul lovește originea veche.

4. **Verifică live**: `curl https://kelionai.app/api/version` (versiune nouă),
   login Google, o plată de test, microfonul (auz Chirp), o tură de chat (Gemini).

## Note
- Fără `GEMINI_API_KEY` creierul nu pornește (Gemini-only, fără fallback — OpenRouter/OpenAI extirpate, 3 aug).
- Fără Google OAuth login-ul nu merge — e obligatoriu.
- Baza de date: dacă folosești o bază NOUĂ, schema se creează la pornire; userii/
  wallet-urile vechi (din originea live) NU se transferă automat.
