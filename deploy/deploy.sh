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
#      SESSION_SECRET, DATABASE_URL. Cheile OpenRouter/OpenAI/Stripe le pune
#      scriptul de bootstrap (deploy/set-keys.sh) sau se adaugă manual în env.
#   2. Adrian repointează Cloudflare (A/AAAA kelionai.app) pe 164.68.120.87.
#
# Idempotent: rerulabil oricând (reconstruiește + repornește curat).
set -euo pipefail

REPO=/root/kelion/repo
ENVFILE=/root/kelion/kelionai.env
BRANCH="${1:-master}"
CADDY_DIR=/root/kelion-caddy

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
for s in kelion-bridge kelion-builder kelion-paznic kelion-deployer; do
  systemctl stop "$s" 2>/dev/null || true
  systemctl disable "$s" 2>/dev/null || true
  mv "/etc/systemd/system/$s.service" /root/kelion/dead-units/ 2>/dev/null || true
done
systemctl daemon-reload 2>/dev/null || true
for s in kelion-bridge kelion-builder kelion-paznic kelion-deployer; do
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
pkill -9 -f 'kelion-repairer-pool|kelion-builder-server|kelion-bridge-linux' 2>/dev/null || true

echo "== 1. Aduc codul ($BRANCH) =="
cd "$REPO"
git fetch origin --prune
git checkout -B deploy "origin/$BRANCH"
git log --oneline -1

echo "== 2. Verific env-ul =="
for v in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SESSION_SECRET DATABASE_URL OPENROUTER_API_KEY OPENAI_API_KEY; do
  if ! grep -q "^$v=" "$ENVFILE" 2>/dev/null; then
    echo "❌ LIPSEȘTE $v din $ENVFILE — completează-l înainte de deploy."; MISS=1
  fi
done
[ "${MISS:-0}" = 1 ] && { echo "Opresc: env incomplet."; exit 1; }

echo "== 3. Construiesc imaginea =="
docker build -t kelionai:latest "$REPO"

echo "== 4. Pornesc aplicația (:8080, network host, env-file) =="
docker rm -f kelionai-app 2>/dev/null || true
docker run -d --name kelionai-app --restart unless-stopped \
  --network host --env-file "$ENVFILE" \
  -e PORT=8080 -e NODE_ENV=production \
  kelionai:latest

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

echo "== 7. Verific LIVE (versiunea trebuie să răspundă) =="
sleep 6
curl -s -m 8 http://127.0.0.1:8080/api/version || echo "(încă pornește — verifică 'docker logs kelionai-app')"
echo; echo "✅ Deploy rulat. Verifică kelionai.app după ce Cloudflare pointează pe VPS."
