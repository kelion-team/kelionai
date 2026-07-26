#!/usr/bin/env bash
# AUTO-PUBLICAREA DE PE SERVER (Adrian, 26 iul: „de ce nu le publici? de ce
# trebuie să-ți zic eu de fiecare dată?" — în plină pană GitHub Actions, când
# TOATE drumurile spre VPS treceau prin Actions și totul stătea nepublicat).
#
# Regula casei: PRODUCTION = MASTER, 100%, MEREU. Scriptul ăsta o face fizic:
# la fiecare rulare (cron, 3 min) întreabă GitHub CE e pe master (un apel de
# API — NU depinde de runnerii Actions) și, dacă live-ul e în urmă, rulează
# ACELAȘI deploy.sh de la publicarea normală, cu aceeași verificare anti-
# fantomă (v == sha). Nu poate publica NICIODATĂ cod mai vechi decât master —
# publică exact vârful lui master, sau nimic.
#
# NU e vectorul „phantom deploy" de demult (kelion-repo-sync sincroniza clona
# INDEPENDENT de publicare → nepotriviri): aici sincronizarea și publicarea
# sunt UN SINGUR pas atomic, cel oficial.
#
# Token: GITHUB_TOKEN din kelionai.env (fin-granulat, doar repo-ul kelionai).
# flock: o singură instanță; dacă deploy-ul din Actions rulează în paralel,
# lock-ul de aici previne măcar dublarea auto-publicării.
set -u
ENVFILE=/root/kelion/kelionai.env
REPO=/root/kelion/repo
LOCK=/root/kelion/auto-publicare.lock

exec 9>"$LOCK"
flock -n 9 || exit 0   # altă publicare e în curs — nu ne suprapunem

TOKEN=$(grep '^GITHUB_TOKEN=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-)
[ -n "$TOKEN" ] || exit 0   # fără token nu putem întreba GitHub — ieșim tăcut

# 1. Vârful lui master — prin API (auth cu token; merge și când Actions e mort).
MASTER=$(curl -s -m 20 -H "Authorization: Bearer $TOKEN" \
  -H 'Accept: application/vnd.github.sha' \
  https://api.github.com/repos/kelion-team/kelionai/commits/master | head -c 40)
case "$MASTER" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) : ;;
  *) exit 0 ;;   # răspuns invalid (rate-limit/pană API) — încercăm la următorul ciclu
esac
SHORT=$(printf '%s' "$MASTER" | cut -c1-7)

# 2. Ce e LIVE acum.
LIVE=$(curl -s -m 8 http://127.0.0.1:8080/api/version | grep -o '"v":"[^"]*"' | cut -d'"' -f4 || true)
[ "$LIVE" = "$SHORT" ] && exit 0   # sincron — nimic de făcut

# 3. Live ≠ master → publicăm exact master, cu pipeline-ul OFICIAL: deploy.sh
# face singur fetch + checkout origin/master + build + restart + verificarea
# anti-fantomă (v == sha), și rulează din copia lui din /tmp (garda proprie).
echo "[auto-publicare] $(date -u +%H:%M:%S) live=$LIVE master=$SHORT — public"
bash "$REPO/deploy/deploy.sh" >> /root/kelion/auto-publicare.log 2>&1
