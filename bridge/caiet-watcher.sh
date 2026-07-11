#!/bin/bash
# VEGHEA CAIETULUI — soneria de 1 minut (ordinul lui Adrian, 11 iul:
# „monitorizare a caietului la 1 min automat, și intervii imediat fără să
# cer eu"). Rulat de timer-ul systemd kelion-caiet-watch la fiecare minut,
# DIN REPO (deci mereu proaspăt prin repo-sync).
#
# Ce face: citește caietul comun; dacă a apărut o notă NOUĂ care nu e de la
# claude-cloud (adică de la Kelion/constructor/laptop), o postează ca și
# comentariu pe PR-ul-canal #110 — comentariul îl TREZEȘTE pe Claude
# (sesiunea lui e abonată la PR) și intervine pe loc. Zero parole, zero
# tokeni pe gol: costul apare doar când chiar există ceva de citit.
set -u
PR_CANAL=110
SECRET=$(cat /root/kelion/bridge-secret.txt 2>/dev/null) || exit 0
TOKEN=$(cat /root/kelion/github-token.txt 2>/dev/null) || exit 0
[ -z "$SECRET" ] || [ -z "$TOKEN" ] && exit 0
STATE=/root/kelion/caiet-last-seen.txt

MEM=$(curl -sS --max-time 15 -H "x-bridge-secret: $SECRET" https://kelionai.app/api/bridge/memory) || exit 0
echo "$MEM" | jq -e '.memory' >/dev/null 2>&1 || exit 0

# Prima rulare fără stare: ancorează-te la ACUM (nu retrimite toată istoria).
if [ ! -s "$STATE" ]; then
  echo "$MEM" | jq -r '[.memory[]? | (.created_at // .at // "")] | max // "1970-01-01T00:00:00.000Z"' > "$STATE"
  exit 0
fi
LAST=$(cat "$STATE")

NEW=$(echo "$MEM" | jq --arg last "$LAST" \
  '[.memory[]? | select(((.created_at // .at // "") > $last) and ((.source // "") != "claude-cloud"))]')
COUNT=$(echo "$NEW" | jq 'length')

# Avansează reperul la cel mai nou timbru VĂZUT (inclusiv notele claude-cloud,
# ca să nu le refiltrăm veșnic), dar DOAR după ce am calculat noutățile.
NEWEST=$(echo "$MEM" | jq -r '[.memory[]? | (.created_at // .at // "")] | max // empty')
[ -n "$NEWEST" ] && echo "$NEWEST" > "$STATE"

[ "$COUNT" -eq 0 ] && exit 0

BODY=$(echo "$NEW" | jq -r '.[] | "**[\(.created_at // .at // "?")] \(.source // "?")**: \(.content // "")\n"' | head -c 6000)
jq -nc --arg b "🔔 VEGHEA CAIETULUI (noutăți de la Kelion/constructor):

$BODY" '{body:$b}' | curl -sS --max-time 20 -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  -d @- "https://api.github.com/repos/kelion-team/kelionai/issues/$PR_CANAL/comments" >/dev/null 2>&1
exit 0
