#!/usr/bin/env bash
# Oglindă read-only a porților PR. Citește PR-uri, verifică SHA-ul exact și
# scrie verdictul numai în jurnalul local; nu comentează, nu publică și nu
# modifică GitHub.
# Probă locală:
#   PORTI_PR_USCAT=1 PORTI_PR_LOCAL=/cale/spre/repo deploy/porti-pr.sh
set -u
umask 077

USCAT=${PORTI_PR_USCAT:-}      # 1 = nu comenta, doar tipărește
LOCAL=${PORTI_PR_LOCAL:-}      # cale de repo gata pregătit (probă); gol = pe VPS

REPO=/root/kelion/repo
LUCRU=/root/kelion/porti-pr
STARE=/root/kelion/porti-pr.vazute
LACAT=/root/kelion/porti-pr.lock
ENVFILE=/root/kelion/kelionai.env
HOST_ENVFILE=/root/kelion/host.env

# Procesele de probă au grup propriu și nu moștenesc descriptorul lacătului.
GRUPURI_ACTIVE=()
ULTIMUL_GRUP=''
ASKPASS=''

uita_grup() {
  local cautat=$1 p
  local ramase=()
  for p in "${GRUPURI_ACTIVE[@]}"; do
    [ "$p" = "$cautat" ] || ramase+=("$p")
  done
  GRUPURI_ACTIVE=("${ramase[@]}")
}

opreste_grup() {
  local pid=${1:-} i stare
  case "$pid" in ''|*[!0-9]*) return 0 ;; esac

  # PID-ul setsid este PGID; se oprește întregul arbore de procese.
  kill -TERM -- "-$pid" >/dev/null 2>&1 || true
  for i in $(seq 1 25); do
    [ -r "/proc/$pid/stat" ] || break
    stare=$(awk '{print $3}' "/proc/$pid/stat" 2>/dev/null || true)
    [ "$stare" = Z ] && break
    sleep 0.2
  done
  kill -KILL -- "-$pid" >/dev/null 2>&1 || true
  wait "$pid" >/dev/null 2>&1 || true
  uita_grup "$pid"
}

curata_procese() {
  local p
  local copie=("${GRUPURI_ACTIVE[@]}")
  for p in "${copie[@]}"; do opreste_grup "$p"; done
}

curata_la_iesire() {
  local cod=$?
  trap - EXIT INT TERM
  curata_procese
  [ -n "${ASKPASS:-}" ] && rm -f -- "$ASKPASS"
  exit "$cod"
}

trap curata_la_iesire EXIT
trap 'exit 130' INT TERM

porneste_grup() {
  local cwd=$1 log=$2
  shift 2
  : > "$log"
  # Închiderea pe setsid se propagă întregului arbore.
  setsid bash -c 'cd "$1" || exit 111; shift; exec "$@"' _ "$cwd" "$@" \
    > "$log" 2>&1 9>&- &
  ULTIMUL_GRUP=$!
  GRUPURI_ACTIVE+=("$ULTIMUL_GRUP")
}

asteapta_boot() {
  local pid=$1 log=$2 secunde=$3 i
  for i in $(seq 1 "$secunde"); do
    grep -q 'Server listening' "$log" 2>/dev/null && return 0
    kill -0 "$pid" >/dev/null 2>&1 || break
    sleep 1
  done
  grep -q 'Server listening' "$log" 2>/dev/null
}

# Probă izolată: PORTI_PR_TEST_PROCESE=1 bash porti-pr.sh
if [ "${PORTI_PR_TEST_PROCESE:-}" = 1 ]; then
  _test_dir=$(mktemp -d /tmp/porti-pr-procese.XXXXXX)
  _test_lock="$_test_dir/lock"
  exec 9>"$_test_lock"
  flock -n 9
  porneste_grup "$_test_dir" "$_test_dir/proces.log" bash -c 'sleep 300 & wait'
  _test_pid=$ULTIMUL_GRUP
  sleep 0.2
  _test_esec=0
  for _test_copil in $(pgrep -g "$_test_pid" 2>/dev/null || true); do
    [ "$(readlink "/proc/$_test_copil/fd/9" 2>/dev/null || true)" = "$_test_lock" ] && _test_esec=1
  done
  opreste_grup "$_test_pid"
  kill -0 -- "-$_test_pid" >/dev/null 2>&1 && _test_esec=1
  rm -f -- "$_test_dir/proces.log" "$_test_lock"
  rmdir -- "$_test_dir"
  [ "$_test_esec" = 0 ] || { echo "PICĂ: fd9 moștenit sau grup rămas viu"; exit 1; }
  echo "TRECE: fd9 nu este moștenit și întregul grup este curățat"
  exit 0
fi

# Porțile rămân identice cu workflow-ul canonic pr-verify.
ruleaza_portile() {
  local dir=$1
  R_TIPURI=PICĂ; R_TESTE=PICĂ; R_BUILD=PICĂ; R_LINT=PICĂ
  R_DUP=PICĂ; R_UNIT=PICĂ; R_EXP=PICĂ; R_MOARTE=PICĂ; R_SINT=PICĂ; R_HARD=PICĂ; R_AI=PICĂ; R_WF=PICĂ; R_MIG=PICĂ; R_INV=PICĂ; R_DEPLOY=PICĂ; R_NATIV=PICĂ; R_SEC=PICĂ; R_BOOT=PICĂ; R_BUT=PICĂ; R_FRONT_TEST=PICĂ; DETALII=''

  ( exec 9>&-; cd "$dir/backend" && npm ci --no-audit --no-fund ) >/dev/null 2>&1
  ( exec 9>&-; cd "$dir/backend" && npx tsc --noEmit ) >/dev/null 2>&1 && R_TIPURI=TRECE

  local ies
  # Verdictul Vitest cere sumar parsat fără ANSI și zero teste eșuate.
  ies=$( exec 9>&-; cd "$dir/backend" && npx vitest run 2>&1 | tail -30 | sed 's/\x1b\[[0-9;]*m//g' )
  if echo "$ies" | grep -qE '^\s*Tests +[0-9]+ passed' && ! echo "$ies" | grep -qiE '[0-9]+ failed'; then
    R_TESTE=TRECE
  fi
  DETALII=$(echo "$ies" | grep -E 'Test Files|Tests ' | sed 's/  */ /g; s/^ //' | tr '\n' ' ')

  ( exec 9>&-; cd "$dir/frontend" && npm ci --no-audit --no-fund ) >/dev/null 2>&1
  ( exec 9>&-; cd "$dir/frontend" && npm run build ) >/dev/null 2>&1 && R_BUILD=TRECE
  ( exec 9>&-; cd "$dir/frontend" && npm run lint ) >/dev/null 2>&1 && R_LINT=TRECE
  ( exec 9>&-; cd "$dir/frontend" && npm test ) >/dev/null 2>&1 && R_FRONT_TEST=TRECE

  ( exec 9>&-; cd "$dir" && npx --yes jscpd@5.0.16 --config .jscpd.json --threshold 0 --cross-formats js-ts ) >/dev/null 2>&1 && R_DUP=TRECE
  ( exec 9>&-; cd "$dir" && node --test scripts/verifica-butoane.test.mjs scripts/verifica-exporturi.test.mjs scripts/verifica-hardcodari.test.mjs scripts/verifica-migrari.test.mjs scripts/inventar-audit.test.mjs scripts/verifica-contract-deploy.test.mjs ios/appstore-build.test.mjs deploy/lib/create-migration-proof.test.mjs deploy/lib/restore-verified-backup.test.mjs deploy/lib/caddy-security.test.mjs deploy/lib/codex-boundary.test.mjs deploy/lib/constructor-publication.test.mjs deploy/lib/network-config.test.mjs deploy/lib/compose-security.test.mjs deploy/lib/security-policy.test.mjs ) >/dev/null 2>&1 && R_UNIT=TRECE
  ( exec 9>&-; cd "$dir" && node scripts/verifica-exporturi.mjs ) >/dev/null 2>&1 && R_EXP=TRECE
  ( exec 9>&-; cd "$dir" && node scripts/identifica-teste-moarte.mjs ) >/dev/null 2>&1 && R_MOARTE=TRECE
  ( exec 9>&-; cd "$dir" && node scripts/verifica-sintaxa.mjs ) >/dev/null 2>&1 && R_SINT=TRECE
  ( exec 9>&-; cd "$dir" && node scripts/verifica-hardcodari.mjs ) >/dev/null 2>&1 && R_HARD=TRECE
  ( exec 9>&-; cd "$dir" && node scripts/verifica-creier-unic.mjs ) >/dev/null 2>&1 && R_AI=TRECE
  ( exec 9>&-; cd "$dir" && node scripts/verifica-workflow-uri-sigure.mjs ) >/dev/null 2>&1 && R_WF=TRECE
  ( exec 9>&-; cd "$dir" && node scripts/verifica-migrari.mjs ) >/dev/null 2>&1 && R_MIG=TRECE
  ( exec 9>&-; cd "$dir" && node scripts/inventar-audit.mjs ) >/dev/null 2>&1 && R_INV=TRECE
  ( exec 9>&-; cd "$dir" && node scripts/verifica-contract-deploy.mjs ) >/dev/null 2>&1 && R_DEPLOY=TRECE
  ( exec 9>&-; cd "$dir" && node scripts/verifica-clienti-nativi.mjs ) >/dev/null 2>&1 && R_NATIV=TRECE
  ( exec 9>&-; cd "$dir" && bash scripts/verifica-secrete.sh --worktree --dist ) >/dev/null 2>&1 && R_SEC=TRECE
  ( exec 9>&-; cd "$dir" && node scripts/verifica-butoane.mjs ) >/dev/null 2>&1 && R_BUT=TRECE

  # Boot real pe dist, într-un grup de procese curățat la fiecare încercare.
  R_BOOT=PICĂ
  if ( exec 9>&-; cd "$dir/backend" && npm run build ) >/dev/null 2>&1; then
    local _boot_log="$dir/boot-poarta.log" _boot_pid
    for _incercare in 1 2 3; do
      porneste_grup "$dir/backend" "$_boot_log" env PORT=18099 node dist/index.js
      _boot_pid=$ULTIMUL_GRUP
      if asteapta_boot "$_boot_pid" "$_boot_log" 45; then R_BOOT=TRECE; fi
      opreste_grup "$_boot_pid"
      [ "$R_BOOT" = TRECE ] && break
    done
  fi

  # Browserul trebuie să dovedească randarea; lipsa lui este eșec fail-closed.
  R_E2E=PICĂ
  if [ "$R_BOOT" = 'TRECE' ]; then
    local _e2e_server _e2e_smoke cod_e2e
    porneste_grup "$dir/backend" "$dir/e2e-boot.log" \
      env SERVESTE_FRONTEND=1 PORT=18099 FRONTEND_DIST="$dir/frontend/dist" node dist/index.js
    _e2e_server=$ULTIMUL_GRUP
    if asteapta_boot "$_e2e_server" "$dir/e2e-boot.log" 30; then
      porneste_grup "$dir/backend" "$dir/e2e.log" \
        env SMOKE_URL=http://127.0.0.1:18099 timeout 90 node e2e-smoke.mjs
      _e2e_smoke=$ULTIMUL_GRUP
      wait "$_e2e_smoke"; cod_e2e=$?
      opreste_grup "$_e2e_smoke"
      if [ "$cod_e2e" -eq 0 ]; then R_E2E=TRECE
      else R_E2E=PICĂ; fi
    fi
    opreste_grup "$_e2e_server"
  fi

  VERDICT=TRECE
  local r
  for r in "$R_TIPURI" "$R_TESTE" "$R_BUILD" "$R_LINT" "$R_FRONT_TEST" "$R_DUP" "$R_UNIT" "$R_EXP" "$R_MOARTE" "$R_SINT" "$R_HARD" "$R_AI" "$R_WF" "$R_MIG" "$R_INV" "$R_DEPLOY" "$R_NATIV" "$R_SEC" "$R_BOOT" "$R_BUT" "$R_E2E"; do
    [ "$r" = 'PICĂ' ] && VERDICT=PICĂ
  done
}

# Raportul numește fiecare măsurătoare și SHA-ul verificat.
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
| frontend — \`npm run lint\` | $(ico "$R_LINT") $R_LINT |
| frontend — \`npm test\` | $(ico "$R_FRONT_TEST") $R_FRONT_TEST |
| cod duplicat (jscpd) | $(ico "$R_DUP") $R_DUP |
| teste pentru porțile statice | $(ico "$R_UNIT") $R_UNIT |
| exporturi fără utilizator | $(ico "$R_EXP") $R_EXP |
| teste moarte | $(ico "$R_MOARTE") $R_MOARTE |
| sintaxă CSS + JSON | $(ico "$R_SINT") $R_SINT |
| hardcodări negăzduite | $(ico "$R_HARD") $R_HARD |
| creier online unic — OpenAI | $(ico "$R_AI") $R_AI |
| workflow-uri fără inputuri sensibile/comenzi libere | $(ico "$R_WF") $R_WF |
| migrări versionate și fail-closed | $(ico "$R_MIG") $R_MIG |
| inventar complet (teste + clasificare) | $(ico "$R_INV") $R_INV |
| contract config/provision/compose | $(ico "$R_DEPLOY") $R_DEPLOY |
| clienți nativi (bundle/CSP/OAuth/TWA) | $(ico "$R_NATIV") $R_NATIV |
| secrete în snapshot + bundle frontend | $(ico "$R_SEC") $R_SEC |
| butoane ↔ rute (frontend ↔ backend) | $(ico "$R_BUT") $R_BUT |
| se deschide în browser (E2E Chromium) | $(ico "$R_E2E") $R_E2E |

**VERDICT: $VERDICT**

<sub>$DETALII</sub>

---

Rulat pe VPS-ul propriu ca rezervă independentă. Workflow-ul GitHub este
canonic atunci când platforma alocă un runner; ambele execută aceleași porți.

---
_Generat automat de poarta Kelion CI._
RAPORT
}

# Proba uscată nu accesează GitHub și nu publică.
if [ -n "$USCAT" ]; then
  [ -z "$LOCAL" ] && { echo "PORTI_PR_USCAT cere și PORTI_PR_LOCAL=/cale/spre/repo"; exit 2; }
  ruleaza_portile "$LOCAL"
  scrie_raportul "$(git -C "$LOCAL" rev-parse HEAD 2>/dev/null || echo 0000000)"
  exit 0
fi

TOKEN=$(grep '^GITHUB_TOKEN=' "$HOST_ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-)
[ -z "$TOKEN" ] && { echo "fără GITHUB_TOKEN în $HOST_ENVFILE — nu pot citi PR-urile"; exit 0; }
GITHUB_REPOSITORY=$(grep '^KELION_GITHUB_REPOSITORY=' "$HOST_ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-)
case "$GITHUB_REPOSITORY" in
  ''|/*|*/|*/*/*|*[!A-Za-z0-9_.\/-]*) echo 'KELION_GITHUB_REPOSITORY invalid'; exit 1 ;;
  */*) ;;
  *) echo 'KELION_GITHUB_REPOSITORY invalid'; exit 1 ;;
esac
GH="https://api.github.com/repos/$GITHUB_REPOSITORY"

# Lacăt neblocant: maximum o verificare simultană.
exec 9>"$LACAT"
flock -n 9 || { echo "rulează deja o verificare — ies"; exit 0; }

# Sarcina mare amână verificarea până la următorul ciclu.
NUCLEE=$(nproc 2>/dev/null || echo 1)
INCARCARE=$(awk -v n="$NUCLEE" '{printf "%d", ($3/n)*100}' /proc/loadavg 2>/dev/null || echo 0)
if [ "${INCARCARE:-0}" -ge 200 ]; then
  echo "VPS încărcat ${INCARCARE}% — amân, revin la următorul cron"
  exit 0
fi

gh() { curl -s -m 30 -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github+json' "$@"; }

# JSON-ul este parsat structural pentru număr, SHA și ref head.
PRURI=$(GITHUB_TOKEN="$TOKEN" gh "$GH/pulls?state=open&per_page=20" | python3 -c '
import json, sys
try:
    prs = list(json.load(sys.stdin))
    for p in prs:
        print(p["number"], p["head"]["sha"], p["head"]["ref"])
except Exception:
    pass
')
[ -z "$PRURI" ] && { echo "niciun PR deschis"; exit 0; }

touch "$STARE"
ASKPASS="${STARE}.askpass"
cat > "$ASKPASS" <<'ASKPASS_SCRIPT'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *) printf '%s\n' "$GITHUB_TOKEN" ;;
esac
ASKPASS_SCRIPT
chmod 700 "$ASKPASS"

while read -r NUMAR SHA REF; do
  [ -z "${NUMAR:-}" ] && continue
  # Un SHA este verificat o singură dată.
  grep -qx "$SHA" "$STARE" && continue

  echo "── PR #$NUMAR @ ${SHA:0:7} ──"
  rm -rf "$LUCRU"; mkdir -p "$LUCRU"
  git -C "$LUCRU" init --quiet
  git -C "$LUCRU" remote add origin "https://github.com/$GITHUB_REPOSITORY.git"
  # Ref-ul pull head funcționează și pentru fork-uri.
  if ! GITHUB_TOKEN="$TOKEN" GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0 \
    git -C "$LUCRU" fetch --quiet --depth 1 origin "refs/pull/$NUMAR/head"; then
    echo "nu pot aduce PR #$NUMAR"; continue
  fi
  git -C "$LUCRU" checkout --quiet FETCH_HEAD

  # Un push concurent invalidează această rundă.
  ADUS=$(git -C "$LUCRU" rev-parse HEAD)
  if [ "$ADUS" != "$SHA" ]; then
    echo "PR #$NUMAR s-a mișcat ($SHA → $ADUS) — îl las pe următorul cron"; continue
  fi

  ruleaza_portile "$LUCRU"
  scrie_raportul "$SHA"
  echo "$SHA" >> "$STARE"
  echo "PR #$NUMAR: $VERDICT (audit local; fără comentariu, status, push sau merge)"
done <<<"$PRURI"

# Păstrează numai ultimele 200 de SHA-uri verificate.
tail -200 "$STARE" > "$STARE.tmp" 2>/dev/null && mv "$STARE.tmp" "$STARE"
rm -rf "$LUCRU"
