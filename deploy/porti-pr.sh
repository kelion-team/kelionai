#!/usr/bin/env bash
# PORȚILE PE VPS — verificarea PR-urilor pe fierul lui Adrian.
#
# Adrian, 31 iul: „nu poți corecta modul de lucru, pică de fiecare dată" și
# „adică ce să fac, ce să primesc?".
#   Ce face el: nimic.
#   Ce primește: pe fiecare PR, un comentariu cu verdictul porților, scris de
#   mașina lui, care chiar a rulat testele.
#
# DE CE EXISTĂ: `pr-verify.yml` a picat de 31 de ori la rând, în 3-11 secunde,
# cu `runner_id: 0` și loguri 404 — GitHub Actions e blocat pe factura
# organizației. A picat pe cod, pe un fișier de configurare și pe un fișier de
# text deopotrivă. Roșul ăla nu spune nimic despre lucrare. Până se deblochează
# factura, singura dovadă că o lucrare e bună stă într-un mesaj de chat de la un
# AI, pe care Adrian trebuie să-l creadă pe cuvânt. Ăsta e modul de lucru defect,
# și el are dreptate să-l reproșeze.
#
# Tiparul e cel deja dovedit în casa asta: publicarea merge printr-un cron pe
# VPS care întreabă GitHub de sha-ul lui master — COMPLET independentă de
# Actions, motiv pentru care aplicația s-a publicat azi în timp ce CI-ul era
# mort. Aceeași idee, mutată de pe publicare pe verificare.
#
# Cost: zero. Mașina e plătită oricum, porțile nu cheamă niciun model AI.
#
# PROBĂ FĂRĂ SĂ PUBLICE NIMIC (rulabil oriunde, nu doar pe VPS):
#   PORTI_PR_USCAT=1 PORTI_PR_LOCAL=/cale/spre/repo deploy/porti-pr.sh
# Rulează porțile pe copia locală și tipărește raportul în loc să comenteze.
set -u

USCAT=${PORTI_PR_USCAT:-}      # 1 = nu comenta, doar tipărește
LOCAL=${PORTI_PR_LOCAL:-}      # cale de repo gata pregătit (probă); gol = pe VPS

REPO=/root/kelion/repo
LUCRU=/root/kelion/porti-pr
STARE=/root/kelion/porti-pr.vazute
LACAT=/root/kelion/porti-pr.lock
ENVFILE=/root/kelion/kelionai.env
GH=https://api.github.com/repos/kelion-team/kelionai

# ── PORȚILE ─────────────────────────────────────────────────────────────────
# Aceleași ca în .github/workflows/pr-verify.yml. Dacă acolo se adaugă una nouă,
# se adaugă și aici — altfel „TRECE" de pe VPS începe să mintă, iar un verdict
# care minte e mai rău decât niciun verdict.
ruleaza_portile() {
  local dir=$1
  R_TIPURI=PICĂ; R_TESTE=PICĂ; R_BUILD=PICĂ
  R_DUP=PICĂ; R_EXP=PICĂ; R_SINT=PICĂ; R_BOOT=PICĂ; DETALII=''

  ( cd "$dir/backend" && { npm ci --no-audit --no-fund || npm install --no-audit --no-fund; } ) >/dev/null 2>&1
  ( cd "$dir/backend" && npx tsc --noEmit ) >/dev/null 2>&1 && R_TIPURI=TRECE

  local ies
  # Culorile ANSI se CURĂȚĂ înainte de orice verdict. Dovadă (2 aug, PR #661,
  # sha 47b70eb): vitest a scris „Tests 844 passed (844)" — dar colorat,
  # adică „Tests \e[22m \e[1m\e[32m844 passed", iar grep-ul de mai jos nu
  # vedea numărul după „Tests" prin coduri. Condiția de TRECE nu se putea
  # împlini NICIODATĂ pe ieșire colorată; doar cea de PICĂ trecea prin coduri.
  # Exact regula 1: o citire picată (sumar de neparsat) dădea verdict „PICĂ".
  ies=$( cd "$dir/backend" && npx vitest run 2>&1 | tail -30 | sed 's/\x1b\[[0-9;]*m//g' )
  # „passed" ȘI zero „failed": un fișier picat printre 40 verzi tot e PICĂ.
  if echo "$ies" | grep -qE '^\s*Tests +[0-9]+ passed' && ! echo "$ies" | grep -qiE '[0-9]+ failed'; then
    R_TESTE=TRECE
  fi
  DETALII=$(echo "$ies" | grep -E 'Test Files|Tests ' | sed 's/  */ /g; s/^ //' | tr '\n' ' ')

  ( cd "$dir/frontend" && npm install --no-audit --no-fund ) >/dev/null 2>&1
  ( cd "$dir/frontend" && npm run build ) >/dev/null 2>&1 && R_BUILD=TRECE

  ( cd "$dir" && npx --yes jscpd --threshold 0.0001 ) >/dev/null 2>&1 && R_DUP=TRECE
  ( cd "$dir" && node scripts/verifica-exporturi.mjs ) >/dev/null 2>&1 && R_EXP=TRECE
  ( cd "$dir" && node scripts/verifica-sintaxa.mjs ) >/dev/null 2>&1 && R_SINT=TRECE

  # BOOTUL PE DIST, CU NODE CURAT — poarta care lipsea când a căzut producția
  # (2 aug, 93be3a6): un ciclu de importuri a omorât bootul cu ReferenceError,
  # iar tsc + vitest + build erau TOATE verzi — transformele lor de module nu
  # sunt Node-ul containerului. Singura dovadă că aplicația chiar pornește e
  # să o pornești: build de emisie + `node dist/index.js` pe un port liber;
  # „Server listening" în 20s = TRECE. Fără env — aplicația pornește și goală
  # (dovedit), iar poarta măsoară BOOTUL, nu configurarea.
  R_BOOT=PICĂ
  if ( cd "$dir/backend" && npm run build ) >/dev/null 2>&1; then
    ( cd "$dir/backend" && PORT=18099 timeout 20 node dist/index.js 2>&1 | grep -qm1 'Server listening' ) && R_BOOT=TRECE
  fi

  VERDICT=TRECE
  local r
  for r in "$R_TIPURI" "$R_TESTE" "$R_BUILD" "$R_DUP" "$R_EXP" "$R_SINT" "$R_BOOT"; do
    [ "$r" = 'PICĂ' ] && VERDICT=PICĂ
  done
}

# ── RAPORTUL ────────────────────────────────────────────────────────────────
# Scrie CE s-a măsurat și DE UNDE vine verdictul. Un „TRECE" care nu spune pe ce
# mașină a rulat e exact genul de verdict nemăsurat care ne-a costat (regula 1).
scrie_raportul() {
  local sha=$1
  ico() { [ "$1" = 'TRECE' ] && printf '✅' || printf '❌'; }
  cat <<RAPORT
## Porți rulate pe VPS — \`${sha:0:7}\`

| poartă | rezultat |
|---|---|
| backend — \`tsc --noEmit\` | $(ico "$R_TIPURI") $R_TIPURI |
| backend — \`vitest run\` | $(ico "$R_TESTE") $R_TESTE |
| backend — bootul pe \`dist\` (Node curat) | $(ico "$R_BOOT") $R_BOOT |
| frontend — \`npm run build\` | $(ico "$R_BUILD") $R_BUILD |
| cod duplicat (jscpd) | $(ico "$R_DUP") $R_DUP |
| exporturi fără utilizator | $(ico "$R_EXP") $R_EXP |
| sintaxă CSS + JSON | $(ico "$R_SINT") $R_SINT |

**VERDICT: $VERDICT**

<sub>$DETALII</sub>

---

Rulat pe VPS-ul propriu, nu pe GitHub Actions — acolo jobul moare în 3-11
secunde cu \`runner_id: 0\` și loguri 404, fiindcă facturarea organizației e
blocată. Verificarea asta nu depinde de ea și nu costă nimic în plus.

---
_Generated by [Claude Code](https://claude.ai/code)_
RAPORT
}

# ── PROBĂ USCATĂ ────────────────────────────────────────────────────────────
# Rulează porțile pe o copie locală și tipărește raportul. Nu atinge GitHub, nu
# atinge VPS-ul. Există ca scriptul să poată fi DOVEDIT, nu doar scris.
if [ -n "$USCAT" ]; then
  [ -z "$LOCAL" ] && { echo "PORTI_PR_USCAT cere și PORTI_PR_LOCAL=/cale/spre/repo"; exit 2; }
  ruleaza_portile "$LOCAL"
  scrie_raportul "$(git -C "$LOCAL" rev-parse HEAD 2>/dev/null || echo 0000000)"
  exit 0
fi

TOKEN=$(grep '^GITHUB_TOKEN=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-)
[ -z "$TOKEN" ] && { echo "fără GITHUB_TOKEN în $ENVFILE — nu pot citi PR-urile"; exit 0; }

# ── SINGUR PE RÂND ──────────────────────────────────────────────────────────
# `npm ci` + teste + build durează minute; cronul bate la 10. Fără lacăt, două
# rulări s-ar suprapune pe mașina care ține și producția.
exec 9>"$LACAT"
flock -n 9 || { echo "rulează deja o verificare — ies"; exit 0; }

# ── NU CĂLCĂM PRODUCȚIA ─────────────────────────────────────────────────────
# Verificarea e utilă, dar niciodată mai importantă decât aplicația care
# răspunde clienților. Mașină deja încărcată → amânăm; cronul revine.
# Pragul e pe media de 15 min, ca la services/resurse.ts și din același motiv:
# pe 1 minut ar sări la fiecare build și n-ar rula niciodată.
NUCLEE=$(nproc 2>/dev/null || echo 1)
INCARCARE=$(awk -v n="$NUCLEE" '{printf "%d", ($3/n)*100}' /proc/loadavg 2>/dev/null || echo 0)
if [ "${INCARCARE:-0}" -ge 200 ]; then
  echo "VPS încărcat ${INCARCARE}% — amân, revin la următorul cron"
  exit 0
fi

gh() { curl -s -m 30 -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github+json' "$@"; }

# PR-urile deschise, „număr sha" pe linie. Parsat cu python3, NU cu grep: în
# JSON-ul unui PR sunt mai multe câmpuri `sha` (head, base, _links), iar un
# grep le-ar amesteca și am verifica alt commit decât cel din PR.
PRURI=$(gh "$GH/pulls?state=open&per_page=20" | python3 -c '
import json, sys
try:
    for p in json.load(sys.stdin):
        print(p["number"], p["head"]["sha"])
except Exception:
    pass
')
[ -z "$PRURI" ] && { echo "niciun PR deschis"; exit 0; }

touch "$STARE"

while read -r NUMAR SHA; do
  [ -z "${NUMAR:-}" ] && continue
  # Un sha se verifică o SINGURĂ dată. Altfel cronul ar comenta la fiecare 10
  # minute pe același commit — zgomot peste zgomot, exact ce-i reproșează
  # Adrian X-ului roșu.
  grep -qx "$SHA" "$STARE" && continue

  echo "── PR #$NUMAR @ ${SHA:0:7} ──"
  rm -rf "$LUCRU"; mkdir -p "$LUCRU"
  git -C "$LUCRU" init --quiet
  git -C "$LUCRU" remote add origin "https://x-access-token:$TOKEN@github.com/kelion-team/kelionai.git"
  # refs/pull/N/head e calea canonică: merge și dacă PR-ul vine din fork.
  if ! git -C "$LUCRU" fetch --quiet --depth 1 origin "refs/pull/$NUMAR/head"; then
    echo "nu pot aduce PR #$NUMAR"; continue
  fi
  git -C "$LUCRU" checkout --quiet FETCH_HEAD

  # Ce am adus chiar e ce credeam? Între listare și fetch poate apărea un push.
  ADUS=$(git -C "$LUCRU" rev-parse HEAD)
  if [ "$ADUS" != "$SHA" ]; then
    echo "PR #$NUMAR s-a mișcat ($SHA → $ADUS) — îl las pe următorul cron"; continue
  fi

  ruleaza_portile "$LUCRU"
  PAYLOAD=$(scrie_raportul "$SHA" | python3 -c 'import json,sys; print(json.dumps({"body": sys.stdin.read()}))')
  gh -X POST -H 'content-type: application/json' -d "$PAYLOAD" "$GH/issues/$NUMAR/comments" >/dev/null

  echo "$SHA" >> "$STARE"
  echo "PR #$NUMAR: $VERDICT (comentat)"
done <<<"$PRURI"

# Fișierul de stare rămâne mic: ultimele 200 de sha-uri sunt mai mult decât destul.
tail -200 "$STARE" > "$STARE.tmp" 2>/dev/null && mv "$STARE.tmp" "$STARE"
rm -rf "$LUCRU"
