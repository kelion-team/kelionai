# Kelionai — Status

> **Sursa de adevăr:** `AI-HANDOFF.md` (rădăcina proiectului). Acest fișier reflectă starea curentă a deploy-ului și a infrastructurii.

_Last updated: 2026-07-25_

## ⚠️ Probleme active GitHub (iulie 2026)

- **GitHub Actions Blocat** — Toate workflow-urile (`vps-diag`, `deploy`, `sentinel`) eșuează instant (durată ≤ 20s, eroare log 404). Aceasta indică depășirea limitei de minute gratuite sau un blocaj de facturare (billing) la nivelul organizației `kelion-team` pe GitHub. Necesită rezolvare din setările de billing ale organizației GitHub de către owner.

## 🚀 Stabilizare completă (16 iul 2026)

- **Deploy curat** — Ultimul build (`85ef61fb`) trece fără erori TypeScript.
- **Curățare Antropic** — Scan complet: 0 referințe `antropic` / `claude` / `CLAUDE` / `Anthropic` în repo. Codul rulează exclusiv pe Kimi 2.7 + GLM 5.2.
- **Backend TypeScript** — Curat, zero erori de compilare.
- **VPS Linux** — Bridge (`kelion-bridge`) activ pe `164.68.120.87`. LiveKit self-hostat.
- **Aider** — Instalat și configurat (`23c83508`) cu Kimi/GLM keys.

## ✅ Live on kelionai.app

- **Auth** — Google login, admin `adrianenc11@gmail.com`.
- **Creier** — Kimi 2.7 principal, GLM 5.2 failover. Quota bar + failover implementat (ordin #6C).
- **Voice** — Web Speech API (Google) STT + Google Chirp 3 HD TTS. Full-duplex în progres.
- **Stripe** — Sistem credite 75/25, top-up funcțional.
- **Admin panel** — Scroll, butoane, toate câmpurile active.
- **Memorie** — Cross-session prin `memories` table.

## 🔑 Credentials (configurate)

- `KIMI_API_KEY` / `GLM_API_KEY` — active în Railway.
- `GOOGLE_SERVICE_ACCOUNT_JSON` — set (Chirp 3 HD).
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — set.
- `BRIDGE_SECRET` — set, puntea VPS conectată.
- LiveKit (`LIVEKIT_URL/API_KEY/API_SECRET`) — set pe VPS.

## 🚧 Next (ordin #7)

- React hydration #418/#423 — fix final server/client mismatch.
- Voce full-duplex sub 1s — VAD + filtre zgomot, bufferSize 128.
- Memorie universală + auto-evaluare.
- Securitate: auto-backup zilnic, rollback 1-click, criptare credențiale.
- Tests CI gate — build blocat la erori TS/ESLint.

## ⚠️ Verificări post-deploy

- `curl -s https://kelionai.app/health` → `{"ok":true}`
- `journalctl -u kelion-bridge -n 20 --no-pager` → fără erori 403/Quota
- `git log --oneline -5` → master curat, fără commit-uri de diagnostic
