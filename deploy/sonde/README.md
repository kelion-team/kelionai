# Sonde de diagnostic (rulate pe VPS, FĂRĂ base64)

**De ce există (5 aug 2026):** probele de stare (autonomie, consolă, joburi) erau
trimise ca **base64 lung** în `inputs.cmd` al `vps-run.yml`. De câteva ori, un
bloc lung s-a **corupt în transmisie** (un caracter chirilic `Б`/`С` intra peste
2 caractere base64 → decodarea pica). Lecția: **nu mai transmite blob-uri lungi.**

**Regula:** orice sondă repetabilă stă AICI, ca fișier comis în repo. Se sincronizează
pe VPS (`/root/kelion/repo`, timer la 5 min) și se rulează **pe cale**, nu pe base64:

```bash
# în vps-run.yml (inputs.cmd) — scurt, zero base64.
# ATENȚIE: copiază fișierul ÎN /app/backend (unde e node_modules), NU în /tmp —
# Node ESM rezolvă `import pg` din folderul FIȘIERULUI, nu din `-w`. Din /tmp dă
# ERR_MODULE_NOT_FOUND.
docker cp /root/kelion/repo/deploy/sonde/autonomie.mjs kelionai-app:/app/backend/s.mjs \
  && docker exec -w /app/backend kelionai-app node s.mjs 2>&1 \
  ; docker exec kelionai-app rm -f /app/backend/s.mjs
```

Scriptul citește secretele din env-ul containerului (DATABASE_URL etc.) — la fel
ca `config.ts`. **Fișierul NU conține niciun secret**, doar interoghează.

## Sonde
- `autonomie.mjs` — pașii misiunii (`autonomie:pas:*`), ultima trecere, pașii
  parcați, joburile buclei (`build_jobs`), starea Enterprise.
- `consola.mjs` — câți agenți în consola Gemini Enterprise (JWT service-account)
  + jurnalul cotei.
