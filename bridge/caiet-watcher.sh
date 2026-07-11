#!/bin/bash
# VEGHEA CAIETULUI — soneria de 1 minut, ÎN AMBELE DIRECȚII (ordinele lui
# Adrian, 11 iul: „monitorizare a caietului la 1 min automat, și intervii
# imediat fără să cer eu" + „implementează și lui Kelion sistemul — să se
# uite dacă a primit de la tine ceva"). Rulat de timer-ul systemd
# kelion-caiet-watch la fiecare minut, DIN REPO (mereu proaspăt prin repo-sync).
#
# Direcția 1 (Kelion → Claude): notele noi care NU sunt de la claude-cloud se
#   postează comentariu pe PR-ul-canal #110 — comentariul TREZEȘTE sesiunea lui
#   Claude (abonată la PR) și Claude intervine pe loc.
# Direcția 2 (Claude → Kelion): notele noi DE LA claude-cloud se trimit la
#   POST /api/bridge/caiet-alert — serverul RE-CHEAMĂ creierul cu ele, deci
#   Kelion le primește în același minut, nu abia când scrie Adrian.
# Ambele: zero parole, zero tokeni pe gol — costul apare doar la eveniment.
set -u
PR_CANAL=110
SECRET=$(cat /root/kelion/bridge-secret.txt 2>/dev/null) || exit 0
TOKEN=$(cat /root/kelion/github-token.txt 2>/dev/null) || exit 0
[ -z "$SECRET" ] || [ -z "$TOKEN" ] && exit 0
STATE=/root/kelion/caiet-last-seen.txt          # reper direcția Kelion→Claude
STATE2=/root/kelion/caiet-last-seen-claude.txt  # reper direcția Claude→Kelion

MEM=$(curl -sS --max-time 15 -H "x-bridge-secret: $SECRET" https://kelionai.app/api/bridge/memory) || exit 0
echo "$MEM" | jq -e '.memory' >/dev/null 2>&1 || exit 0
NEWEST=$(echo "$MEM" | jq -r '[.memory[]? | (.created_at // .at // "")] | max // empty')

# Prima rulare fără stare: ancorează reperele la ACUM (nu retrimite istoria).
if [ ! -s "$STATE" ]; then echo "${NEWEST:-1970-01-01T00:00:00.000Z}" > "$STATE"; fi
if [ ! -s "$STATE2" ]; then echo "${NEWEST:-1970-01-01T00:00:00.000Z}" > "$STATE2"; exit 0; fi
LAST=$(cat "$STATE")
LAST2=$(cat "$STATE2")

# ── Direcția 1: Kelion/constructor → Claude (sonerie pe PR #110) ──
NEW=$(echo "$MEM" | jq --arg last "$LAST" \
  '[.memory[]? | select(((.created_at // .at // "") > $last) and ((.source // "") != "claude-cloud"))]')
COUNT=$(echo "$NEW" | jq 'length')
# Reperul 1 avansează la tot ce am văzut (notele claude nu sună soneria asta).
[ -n "$NEWEST" ] && echo "$NEWEST" > "$STATE"
if [ "$COUNT" -gt 0 ]; then
  BODY=$(echo "$NEW" | jq -r '.[] | "**[\(.created_at // .at // "?")] \(.source // "?")**: \(.content // "")\n"' | head -c 6000)
  jq -nc --arg b "🔔 VEGHEA CAIETULUI (noutăți de la Kelion/constructor):

$BODY" '{body:$b}' | curl -sS --max-time 20 -X POST \
    -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
    -d @- "https://api.github.com/repos/kelion-team/kelionai/issues/$PR_CANAL/comments" >/dev/null 2>&1
fi

# ── Direcția 2: Claude → Kelion (re-cheamă creierul prin caiet-alert) ──
NEW2=$(echo "$MEM" | jq --arg last "$LAST2" \
  '[.memory[]? | select(((.created_at // .at // "") > $last) and ((.source // "") == "claude-cloud"))]')
COUNT2=$(echo "$NEW2" | jq 'length')
[ "$COUNT2" -eq 0 ] && exit 0
NOTES=$(echo "$NEW2" | jq -r '.[] | "[\(.created_at // .at // "?")] \(.content // "")\n"' | head -c 3900)
RESP=$(jq -nc --arg n "$NOTES" '{notes:$n}' | curl -sS --max-time 20 -X POST \
  -H "x-bridge-secret: $SECRET" -H "Content-Type: application/json" \
  -d @- https://kelionai.app/api/bridge/caiet-alert)
# Reperul 2 avansează DOAR la livrare confirmată (ok:true) — altfel puntea era
# offline / serverul vechi, iar veghea reîncearcă la minutul următor.
if echo "$RESP" | jq -e '.ok == true' >/dev/null 2>&1; then
  NEWEST2=$(echo "$NEW2" | jq -r '[.[] | (.created_at // .at // "")] | max // empty')
  [ -n "$NEWEST2" ] && echo "$NEWEST2" > "$STATE2"
fi
exit 0
