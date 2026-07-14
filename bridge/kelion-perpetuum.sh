#!/bin/bash
# PERPETUUM — impulsul propriu al lui Kelion (ordinul lui Adrian, 11 iul seara:
# „dacă nu primește nimic, nici nu întreprinde nimic... vreau soluții să-l
# activăm la 100%"). Rulat de timer-ul systemd kelion-perpetuum la 15 minute,
# DIN REPO (proaspăt prin repo-sync).
#
# PRINCIPIU: verificările sunt MECANICE și GRATUITE; munca scumpă (Kimi) se
# aprinde DOAR când există un semnal real. Un singur ordin per bătaie, dedup
# pe semnal — nu poate lua foc coada. Oprire de urgență: touch /root/kelion/perpetuum-off
#
# SEMNALELE (în ordinea priorității):
#   1. ERORI NOI în consola clienților (/api/bridge/client-errors) → ordin de
#      diagnostic+reparație cap-coadă, cu dovadă.
#   2. DIVERGENȚĂ cod-rulat vs repo (alerta din repo-sync.log) → DOAR-ALERTĂ
#      către Adrian în chat (repornirea serviciilor de producție rămâne
#      manuală — Adrian NU a autorizat repornire automată nesupravegheată).
#   3. RELEASE care AȘTEAPTĂ APROBAREA de peste 30 min → îi amintește lui
#      Adrian în chat (o dată pe oră, nu sâcâie) — nimic nu mai zace uitat.
#   4. SĂNĂTATEA DEPENDENȚELOR (kelion-doctor: app live, servicii, secret punte,
#      cheie GitHub, chei creier Kimi/GLM, cod-rulat-vs-repo) → SUPORT către
#      Adrian cu pașii EXACȚI. NU auto-fix credențiale (nu pot fi generate de un
#      AI — login+2FA) — Kelion detectează din timp și ghidează, ca să nu se mai
#      ajungă la un blocaj (bucla de publicare, munca moartă etc.).
set -u
[ -f /root/kelion/perpetuum-off ] && exit 0
SECRET=$(cat /root/kelion/bridge-secret.txt 2>/dev/null) || exit 0
[ -z "$SECRET" ] && exit 0
B=https://kelionai.app
H="x-bridge-secret: $SECRET"
STATE_ERR=/root/kelion/perpetuum-err-seen.txt
STATE_DIV=/root/kelion/perpetuum-div-seen.txt
STATE_NAG=/root/kelion/perpetuum-nag-at.txt
STATE_KEY=/root/kelion/perpetuum-key-seen.txt
STATE_KEY_AT=/root/kelion/perpetuum-key-at.txt

enqueue() { # un singur ordin per bătaie; serverul face și el dedup pe text
  jq -nc --arg t "$1" '{text:$t}' | curl -sS --max-time 15 -X POST -H "$H" \
    -H "Content-Type: application/json" -d @- "$B/api/bridge/workorders" >/dev/null 2>&1
}

# ── 1. Erori noi de consolă ──
ERRS=$(curl -sS --max-time 15 -H "$H" "$B/api/bridge/client-errors" 2>/dev/null)
if echo "$ERRS" | jq -e '.errors' >/dev/null 2>&1; then
  LASTE=$(cat "$STATE_ERR" 2>/dev/null || echo "1970-01-01T00:00:00.000Z")
  NEWE=$(echo "$ERRS" | jq --arg last "$LASTE" '[.errors[] | select(.at > $last)]')
  NE=$(echo "$NEWE" | jq 'length')
  if [ "${NE:-0}" -gt 0 ]; then
    echo "$ERRS" | jq -r '[.errors[].at] | max' > "$STATE_ERR"
    SAMPLE=$(echo "$NEWE" | jq -r '.[0:3][] | "\(.kind): \(.msg)"' | head -c 900)
    enqueue "PERPETUUM (semnal automat, fără ordin uman): $NE erori NOI în consola clienților. Mostre: $SAMPLE — Diagnostichează cauza în cod (frontend/src), repar-o la rădăcină (nu plasture), verifică cu build complet și raportează cu dovadă. Jurnalul complet: curl -H \"x-bridge-secret: \$(cat /root/kelion/bridge-secret.txt)\" $B/api/bridge/client-errors"
    exit 0
  fi
fi

# ── 2. Divergență cod-rulat vs repo — DOAR-ALERTĂ (granița lui Adrian:
#      repornirea automată nesupravegheată a serviciilor NU e autorizată;
#      i se spune LUI, iar el decide când rulează bridge-deploy). ──
if [ -f /root/kelion/repo-sync.log ]; then
  DIV=$(grep 'ATENȚIE' /root/kelion/repo-sync.log | tail -1)
  OLDDIV=$(cat "$STATE_DIV" 2>/dev/null || true)
  if [ -n "$DIV" ] && [ "$DIV" != "$OLDDIV" ]; then
    echo "$DIV" > "$STATE_DIV"
    jq -nc --arg t "⚠️ Perpetuum: serviciile de pe VPS rulează cod DIFERIT de repo — «$DIV». Repornirea rămâne decizia ta: rulează bridge-deploy când vrei să le aliniezi." '{text:$t}' | \
      curl -sS --max-time 15 -X POST -H "$H" -H "Content-Type: application/json" \
        -d @- "$B/api/bridge/say" >/dev/null 2>&1
    exit 0
  fi
fi

# ── 3. Release înțepenit la „aștept aprobarea" ──
ST=$(curl -sS --max-time 10 "$B/api/dev/status" 2>/dev/null)
LABEL=$(echo "$ST" | jq -r '.progress.label // ""' 2>/dev/null)
if echo "$LABEL" | grep -qi 'aprobarea'; then
  NOW=$(date +%s)
  LASTN=$(cat "$STATE_NAG" 2>/dev/null || echo 0)
  if [ $((NOW - LASTN)) -gt 3600 ]; then
    echo "$NOW" > "$STATE_NAG"
    jq -nc '{text:"⏰ Perpetuum: există un release GATA care așteaptă aprobarea ta de ceva vreme — spune «da» în chat ca să-l public, sau «respinge» dacă nu-l vrei."}' | \
      curl -sS --max-time 15 -X POST -H "$H" -H "Content-Type: application/json" \
        -d @- "$B/api/bridge/say" >/dev/null 2>&1
  fi
fi

# ── 4. Sănătatea dependențelor (kelion-doctor) → SUPORT către Adrian (NU auto-fix
#      credențiale: nu pot fi generate de un AI — login+2FA. Kelion DOAR detectează
#      din timp orice „blocaj din cauza unui X" — cheie GitHub, secret punte, chei
#      creier, servicii, cod-rulat-vs-repo — și îi dă pașii exacți). Dedup pe
#      conținut + max o dată pe oră, ca să nu sâcâie când e totul sănătos. ──
DOCTOR=/root/kelion/repo/bridge/kelion-doctor
if [ -f "$DOCTOR" ]; then
  KOUT=$(bash "$DOCTOR" --brief 2>/dev/null); KRC=$?
  if [ "$KRC" != 0 ] && [ -n "$KOUT" ]; then
    LASTK=$(cat "$STATE_KEY" 2>/dev/null || true)
    NOWK=$(date +%s); LASTKT=$(cat "$STATE_KEY_AT" 2>/dev/null || echo 0)
    if [ "$KOUT" != "$LASTK" ] || [ $((NOWK - LASTKT)) -gt 3600 ]; then
      echo "$KOUT" > "$STATE_KEY"; echo "$NOWK" > "$STATE_KEY_AT"
      SUP=${KOUT#DOCTOR_PROBLEM: }
      jq -nc --arg t "🩺 Perpetuum: am găsit ceva ce blochează munca — îl prind din timp ca să nu se repete. Ce nu pot repara singur (credențiale = login la tine) ți-l dau ca pași exacți: $SUP" '{text:$t}' | \
        curl -sS --max-time 15 -X POST -H "$H" -H "Content-Type: application/json" \
          -d @- "$B/api/bridge/say" >/dev/null 2>&1
    fi
  fi
fi
exit 0
