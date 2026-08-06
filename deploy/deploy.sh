#!/usr/bin/env bash
# ── DEPLOY Kelionai pe VPS propriu (Docker + Caddy) ──────────────────────────
# Construiește imaginea din repo, pornește containerul aplicației pe :8080 și
# configurează Caddy să servească kelionai.app → app (+ LiveKit pe sslip).
# Postgres rulează pe host (127.0.0.1:5432); containerul folosește --network host
# ca să-l atingă și să asculte pe 8080.
#
# Cerințe ÎNAINTE de rulare:
#   1. /root/kelion/kelionai.env completat (vezi deploy/kelionai.env.example).
#      OBLIGATORII care NU sunt încă pe VPS: GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI,
#      SESSION_SECRET, DATABASE_URL, GEMINI_API_KEY (creierul unic — OpenRouter/
#      OpenAI/Stripe au fost extirpate; cheile lor nu mai sunt citite de nimeni).
#   2. Adrian repointează Cloudflare (A/AAAA kelionai.app) pe 164.68.120.87.
#
# Idempotent: rerulabil oricând (reconstruiește + repornește curat).
set -euo pipefail

# GARDĂ ANTI-AUTO-RESCRIERE: pasul 1 face `git checkout` peste ACEST fișier în
# timp ce bash îl citește progresiv — dacă master aduce un deploy.sh diferit,
# execuția continuă din mijlocul fișierului NOU (corupție). De aceea scriptul
# se rulează întotdeauna dintr-o COPIE în /tmp, niciodată din clonă.
if [ "${KELION_DEPLOY_COPY:-0}" != 1 ]; then
  cp "$0" /tmp/kelion-deploy-run.sh
  KELION_DEPLOY_COPY=1 exec bash /tmp/kelion-deploy-run.sh "$@"
fi

REPO=/root/kelion/repo
ENVFILE=/root/kelion/kelionai.env
BRANCH="${1:-master}"
CADDY_DIR=/root/kelion-caddy

# LACĂT GLOBAL DE PUBLICARE (27 iul: deploy #493 roșu pe „container name already
# in use" — Actions și auto-publicarea rulau deploy.sh ÎN PARALEL pe același
# master; al doilea `docker run` lovea containerul tocmai pornit de primul).
# O singură publicare odată: al doilea AȘTEAPTĂ aici, apoi (pasul 1) iese
# devreme dacă exact sha-ul țintă e deja live — verde, fără muncă dublă.
exec 8>/root/kelion/publicare.lock
flock 8

echo "== 0. Blochez ecosistemul-zombie (puntea/constructorul, șters din cod pe 23 iul) =="
# Lanț complet descoperit la audit (24 iul): serviciile kelion-bridge/builder/
# paznic/deployer loveau endpointuri șterse și ardeau abonamentul cu procese
# claude; watchdog.sh + paznic-chat.sh (cron, la fiecare minut) le REPORNEAU
# la orice oprire; timerele caiet-watch/perpetuum/qa-patrol arătau spre
# scripturi care nu mai există. Idempotent la FIECARE deploy, în 3 straturi:
# 1) resuscitatorii afară din crontab (backupurile rămân);
crontab -l 2>/dev/null | grep -vE 'watchdog\.sh|paznic-chat\.sh' | crontab - 2>/dev/null || true
# 2) serviciile: stop + disable + unit-file mutat + mask (mask-ul eșuează cât
#    timp unit-file-ul real există — de-aia întâi îl mutăm în dead-units/);
mkdir -p /root/kelion/dead-units
# kelion-repairer-pool + kelion-voice adăugate 25 iul: scăpaseră din prima listă
# și rămăseseră în buclă „activating auto-restart" (scripturile lor din bridge/
# sunt șterse din 23 iul — systemd reîncerca la nesfârșit un fișier inexistent).
for s in kelion-bridge kelion-builder kelion-paznic kelion-deployer kelion-repairer-pool kelion-voice; do
  systemctl stop "$s" 2>/dev/null || true
  systemctl disable "$s" 2>/dev/null || true
  mv "/etc/systemd/system/$s.service" /root/kelion/dead-units/ 2>/dev/null || true
done
systemctl daemon-reload 2>/dev/null || true
for s in kelion-bridge kelion-builder kelion-paznic kelion-deployer kelion-repairer-pool kelion-voice; do
  systemctl mask "$s" 2>/dev/null || true
done
# 3) timerele moarte (scripturile lor au dispărut din repo). kelion-repo-sync
#    e AICI din 25 iul: scăpase din prima listă și sincroniza clona la 5 min —
#    exact vectorul „phantom deploy".
for t in kelion-caiet-watch kelion-perpetuum kelion-qa-patrol kelion-repo-sync; do
  systemctl stop "$t.timer" 2>/dev/null || true
  systemctl disable "$t.timer" 2>/dev/null || true
  mv "/etc/systemd/system/$t.timer" "/etc/systemd/system/$t.service" /root/kelion/dead-units/ 2>/dev/null || true
done
systemctl daemon-reload 2>/dev/null || true
# 4) PROCESELE deja pornite (lecția din 25 iul: mask-ul oprește doar REÎNVIEREA;
#    repairer-pool + builder-server rulau NEÎNTRERUPT din 20 iul și unul din ele
#    trimitea alertele-fantomă de la alerts@ — buclă cu auto-reply-ul din contact@).
pkill -9 -f 'kelion-repairer-pool|kelion-builder-server|kelion-bridge-linux|kelion-voice-agent' 2>/dev/null || true

echo "== 1. Aduc codul ($BRANCH) =="
cd "$REPO"
git fetch origin --prune
git checkout -B deploy "origin/$BRANCH"
git log --oneline -1
# Ieșire devreme sub lacăt: dacă alt publicator tocmai a dus live EXACT sha-ul
# țintă cât am așteptat la flock, nu mai reconstruim nimic — verde, gata.
# KELION_DEPLOY_FORCE=1 sare peste scurtătură (27 iul, cazul real BRIDGE_SECRET:
# schimbare DOAR de env, același sha — containerul trebuie repornit ca s-o ia,
# altfel scurtătura ar declara „deja publicat" și env-ul nou n-ar intra nicicând).
TARGET=$(git rev-parse HEAD | cut -c1-7)
LIVE_NOW=$(curl -s -m 8 http://127.0.0.1:8080/api/version | grep -o '"v":"[^"]*"' | cut -d'"' -f4 || true)
if [ "${KELION_DEPLOY_FORCE:-0}" != 1 ] && [ "$LIVE_NOW" = "$TARGET" ]; then
  echo "== Deja publicat exact $TARGET (alt publicator a terminat primul) — nimic de făcut =="
  echo "   (pentru repornire forțată la același sha — ex. env schimbat — rulează cu KELION_DEPLOY_FORCE=1)"
  exit 0
fi

echo "== 2. Verific env-ul =="
for v in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SESSION_SECRET DATABASE_URL GEMINI_API_KEY; do
  if ! grep -q "^$v=" "$ENVFILE" 2>/dev/null; then
    echo "❌ LIPSEȘTE $v din $ENVFILE — completează-l înainte de deploy."; MISS=1
  fi
done
[ "${MISS:-0}" = 1 ] && { echo "Opresc: env incomplet."; exit 1; }

echo "== 2b. Canalul de update al lui Kelion (ce primește la ACEST deploy) =="
# Adrian, 25 iul: „canal de informare a lui cu tot ce primește ca update".
# Scriem git log-ul recent în contextul de build; Dockerfile îl copiază în
# imagine (COPY . .), iar backend-ul (services/updates.ts) îl servește lui
# Kelion în prompt + prin unealta list_updates. Fișierul e în .gitignore.
{
  echo "# Update-urile lui Kelion — generat la deploy ($(TZ=Europe/London date +'%Y-%m-%d %H:%M %Z')), cele mai noi primele"
  git -C "$REPO" log -40 --date=format:'%Y-%m-%d %H:%M' --pretty='%h | %ad | %s'
} > "$REPO/deploy/last-updates.txt"

echo "== 3. Construiesc imaginea =="
docker build -t kelionai:latest "$REPO"

echo "== 4. Pornesc aplicația (:8080, network host, env-file) =="
docker rm -f kelionai-app 2>/dev/null || true
# GIT_COMMIT_SHA intră în container ca /api/version să întoarcă EXACT sha-ul
# publicat (backend/src/index.ts îl suportă deja) — verificarea anti-fantomă
# devine „live == master", nu doar „s-a schimbat ceva".
# Volumul pw-cache ține Chromium-ul DESCĂRCAT peste publicări (containerul e
# nou la fiecare deploy; fără volum, browserul mâinilor murea la fiecare
# publicare — măsurat 3 aug: /root/.cache/ms-playwright inexistent, deci
# browser_open crăpa pe „Executable doesn't exist", iar comentariul din
# Dockerfile promitea un „check la startup" pe care nu-l făcea nimeni).
docker run -d --name kelionai-app --restart unless-stopped \
  --network host --env-file "$ENVFILE" \
  -e PORT=8080 -e NODE_ENV=production \
  -e GIT_COMMIT_SHA="$(git -C "$REPO" rev-parse HEAD)" \
  -v /root/kelion/pw-cache:/root/.cache/ms-playwright \
  kelionai:latest

echo "== 4b. Browserul mâinilor (Chromium) — prezent, nu promis =="
# Idempotent: cu volumul plin, descărcarea se sare; rămân doar bibliotecile
# de sistem (apt), care se pierd cu containerul vechi. Eșecul NU oprește
# publicarea — dar se spune, nu se tace.
docker exec kelionai-app sh -c 'cd /app/backend && npx playwright install --with-deps chromium >/dev/null 2>&1' \
  && echo "Chromium prezent — browserul mâinilor e viu" \
  || echo "AVERTISMENT: instalarea Chromium a picat — pașii pe mâini cu browser vor pica până la următoarea publicare"

echo "== 5. (Re)pornesc Caddy cu Caddyfile-ul aplicației =="
install -D -m 644 "$REPO/deploy/Caddyfile" "$CADDY_DIR/Caddyfile"
docker rm -f kelion-caddy 2>/dev/null || true
docker run -d --name kelion-caddy --restart unless-stopped --network host \
  -v "$CADDY_DIR/Caddyfile:/etc/caddy/Caddyfile" \
  -v "$CADDY_DIR/data:/data" -v "$CADDY_DIR/config:/config" \
  caddy:2 caddy run --config /etc/caddy/Caddyfile --adapter caddyfile

echo "== 6. Backup criptat zilnic (cron) =="
# Instalează/actualizează IDEMPOTENT cronul de backup criptat al DB-ului
# (Adrian, 24 iul: „salvări periodice în zona criptată"). Zilnic la 03:15 UTC.
install -m 700 "$REPO/deploy/backup.sh" /root/kelion/backup.sh
( crontab -l 2>/dev/null | grep -v '/root/kelion/backup.sh' ; echo '15 3 * * * /root/kelion/backup.sh >> /root/kelion/backup.log 2>&1' ) | crontab -

echo "== 6c. Auto-publicarea de pe server (cron la 1 min — master ajunge live SINGUR) =="
# Adrian, 26 iul („de ce nu le publici? de ce trebuie să-ți zic eu?"), în plină
# pană GitHub Actions: serverul își compară singur live-ul cu vârful lui master
# (API GitHub, nu runneri) și, dacă e în urmă, rulează CHIAR acest deploy.sh.
# GitHub Actions nu mai e pe drumul critic al publicării.
# CRON LA 1 MINUT (Adrian, 6 aug: „5 minute e maximul, oricât de mare ar fi").
# Era la 3 min → până la 3 min pierdute DOAR pe așteptarea tick-ului. flock-ul din
# auto-publicare.sh + publicare.lock previn suprapunerea, deci 1 min e sigur:
# un ciclu care prinde un deploy în curs iese imediat pe flock, fără muncă dublă.
install -m 700 "$REPO/deploy/auto-publicare.sh" /root/kelion/auto-publicare.sh
( crontab -l 2>/dev/null | grep -v '/root/kelion/auto-publicare.sh' ; echo '* * * * * /root/kelion/auto-publicare.sh >> /root/kelion/auto-publicare.log 2>&1' ) | crontab -

echo "== 6f. Materializarea punctelor de recuperare pe VPS (cron la 10 min) =="
# Adrian, 27 iul: „salvarea trebuie pe serverul Linux". Fiecare tag backup-*
# (creat din meniul Recovery al adminului) primește o copie fizică pe VPS
# (.bundle + .tar.gz), ca recuperarea să nu depindă doar de GitHub. Idempotent.
install -m 700 "$REPO/deploy/backup-versiuni.sh" /root/kelion/backup-versiuni.sh
( crontab -l 2>/dev/null | grep -v '/root/kelion/backup-versiuni.sh' ; echo '*/10 * * * * /root/kelion/backup-versiuni.sh >> /root/kelion/backup-versiuni.log 2>&1' ) | crontab -

echo "== 6d. Constructorul (cron la 2 min — Kelion construiește soft la ordin) =="
# Adrian, 27 iul: „Kelion trebuie să poată crea orice soft îi cere admin".
# Job-uri scurte cu flock + timeout (NU demonii vechi care ardeau abonamentul):
# agentul ia ordinul din coadă (API), construiește în atelier cu build+teste,
# deschide PR-ul; merge-ul rămâne la Adrian. Idempotent, ca backup-ul.
install -m 700 "$REPO/deploy/constructor-worker.sh" /root/kelion/constructor-worker.sh
install -m 700 "$REPO/deploy/constructor-agent.mjs" /root/kelion/constructor-agent.mjs
( crontab -l 2>/dev/null | grep -v '/root/kelion/constructor-worker.sh' ; echo '*/2 * * * * /root/kelion/constructor-worker.sh >> /root/kelion/constructor.log 2>&1' ) | crontab -

echo "== 6e. Vindecătorul de rulări roșii (cron la 10 min — roșu → verde singur) =="
# Adrian, 27 iul: „dacă are ceva roșu să escaladeze și să repare până ajunge
# verde". Determinist: rulările de deploy eșuate se rerulează automat (max 2)
# DOAR când live == master (publicarea reală e sănătoasă); altfel email.
install -m 700 "$REPO/deploy/vindecator-rulari.sh" /root/kelion/vindecator-rulari.sh
( crontab -l 2>/dev/null | grep -v '/root/kelion/vindecator-rulari.sh' ; echo '*/10 * * * * /root/kelion/vindecator-rulari.sh >> /root/kelion/vindecator.log 2>&1' ) | crontab -

echo "== 6b. Sentinela locală (cron la 3 min — pulsul lui Kelion, zero cost) =="
# Adrian, 26 iul: „verificare automată dar să nu coste". Determinist, fără AI:
# repornește containerul mort (2 ratări la rând) + pulsul intern (DB/disc/erori)
# cu email DOAR la anomalie. Idempotent, ca backup-ul de mai sus.
install -m 700 "$REPO/deploy/sentinela-locala.sh" /root/kelion/sentinela-locala.sh
( crontab -l 2>/dev/null | grep -v '/root/kelion/sentinela-locala.sh' ; echo '*/3 * * * * /root/kelion/sentinela-locala.sh >> /root/kelion/sentinela.log 2>&1' ) | crontab -

echo "== 6f. Porțile pe VPS (cron la 10 min — verdictul PR-urilor, zero cost) =="
# Adrian, 31 iul: „nu poți corecta modul de lucru, pică de fiecare dată" —
# `pr-verify.yml` a picat de 31 de ori la rând, în 3-11 secunde, cu runner_id 0
# și loguri 404 (facturare GitHub blocată la nivel de organizație). A picat pe
# cod, pe configurare și pe un fișier de text deopotrivă, deci roșul ăla nu
# spune nimic despre lucrare. Aceleași porți rulate aici, pe fierul deja plătit,
# cu verdictul scris ca un comentariu pe PR. Zero AI, zero minute GitHub.
# Sare peste rulare dacă VPS-ul e deja încărcat — producția are prioritate.
install -m 700 "$REPO/deploy/porti-pr.sh" /root/kelion/porti-pr.sh
( crontab -l 2>/dev/null | grep -v '/root/kelion/porti-pr.sh' ; echo '*/10 * * * * /root/kelion/porti-pr.sh >> /root/kelion/porti-pr.log 2>&1' ) | crontab -

# (Pasul 6g — „proba modelelor free" prin curl direct la OpenRouter — a fost
# EXTIRPAT pe 3 aug împreună cu furnizorul: creierul e Gemini-only, nu mai
# există pool de modele free de probat.)

echo "== 7. Verific LIVE (anti-fantomă: versiunea trebuie să fie chiar sha-ul publicat) =="
SHA=$(git -C "$REPO" rev-parse HEAD | cut -c1-7)   # exact ca .slice(0,7) din backend
V=""
for _ in $(seq 1 12); do
  sleep 5
  V=$(curl -s -m 8 http://127.0.0.1:8080/api/version | grep -o '"v":"[^"]*"' | cut -d'"' -f4 || true)
  [ "$V" = "$SHA" ] && break
done
if [ "$V" = "$SHA" ]; then
  echo "✅ LIVE = $SHA (anti-fantomă TRECE). Verifică și https://kelionai.app/api/version."
else
  echo "❌ ANTI-FANTOMĂ PICĂ: local v='$V', așteptat '$SHA' — vezi 'docker logs kelionai-app'."
  exit 1
fi
