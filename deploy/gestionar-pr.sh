#!/usr/bin/env bash
# GESTIONARUL DE PR — autonomia își gestionează SINGURĂ PR-urile (Adrian, 5 aug:
# „pune-i toate uneltele să fie real autonom"). Trei lucruri care lipseau și de
# care s-au strâns 27 de PR-uri deschise + s-a rupt masterul o dată:
#
#   1. MERGE cu JUDECATĂ — merge-uiește un PR DOAR când porțile = TRECE (verdictul
#      scris de porti-pr.sh pe COMMIT-ul curent) ȘI e mergeable curat (fără
#      conflict). Merge-ul ORB, fără poarta asta, a băgat `gemini-1.5-flash` în
#      master pe 5 aug și a rupt urechea live. Poarta e diferența dintre „autonom"
#      și „autodistrugere".
#   2. CURĂȚENIE — închide PR-urile MOARTE: pe model scos (rup aplicația dacă se
#      merge-uiesc), sau cu CONFLICT (masterul a trecut peste ele = depășite).
#   3. (DEDUP la CREARE e în constructor-agent.mjs — nu deschide un al doilea PR
#      pentru aceeași lucrare.)
#
# Rulează pe VPS din cron (frate cu porti-pr.sh + auto-publicare.sh). NU re-rulează
# testele: ia verdictul din ULTIMUL comentariu de porți al lui porti-pr.sh, pe
# sha-ul curent. Zero cost AI. NU atinge branch-urile `claude/` (munca lui Claude
# în curs) — doar pe ale autonomiei.
#
# PROBĂ FĂRĂ SĂ ATINGĂ NIMIC:  GESTIONAR_PR_USCAT=1 deploy/gestionar-pr.sh
set -u

USCAT=${GESTIONAR_PR_USCAT:-}          # 1 = doar tipărește deciziile, nu acționează
ENVFILE=/root/kelion/kelionai.env
LOCK=/root/kelion/gestionar-pr.lock
GH=https://api.github.com/repos/kelion-team/kelionai

# Model(e) scoase de furnizor — un PR care le readuce RUPE aplicația live. Se
# închide, nu se merge-uiește. (Lecția din 5 aug: #794–#801, `gemini-1.5-flash`.)
MODELE_MOARTE='gemini-1\.5|gemini-1_5|1\.5-flash-latest'

exec 9>"$LOCK"
flock -n 9 || exit 0                   # altă rulare în curs — nu ne suprapunem

TOKEN=$(grep '^GITHUB_TOKEN=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-)
[ -n "$TOKEN" ] || { echo "fără GITHUB_TOKEN în $ENVFILE — nu pot gestiona PR-urile"; exit 0; }

gh() { curl -s -m 30 -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github+json' "$@"; }

actioneaza() {  # tip mesaj-json url-api  — nu atinge nimic în modul uscat
  local metoda=$1 url=$2 corp=${3:-}
  if [ -n "$USCAT" ]; then echo "   [USCAT] $metoda $url ${corp:+($corp)}"; return 0; fi
  if [ -n "$corp" ]; then
    gh -X "$metoda" -H 'content-type: application/json' -d "$corp" "$url" >/dev/null
  else
    gh -X "$metoda" "$url" >/dev/null
  fi
}

inchide() {  # numar motiv
  local n=$1 motiv=$2
  local corp; corp=$(printf '%s' "$motiv" | python3 -c 'import json,sys; print(json.dumps({"body": sys.stdin.read()+"\n\n---\n_Închis automat de gestionarul de PR al autonomiei._"}))')
  actioneaza POST "$GH/issues/$n/comments" "$corp"
  actioneaza PATCH "$GH/pulls/$n" '{"state":"closed"}'
  echo "   → ÎNCHIS #$n: $motiv"
}

merge_uieste() {  # numar sha
  local n=$1 sha=$2
  actioneaza PUT "$GH/pulls/$n/merge" "$(printf '{"merge_method":"squash","sha":"%s"}' "$sha")"
  echo "   → MERGE #$n (@${sha:0:7}) — porți TRECE + mergeable"
}

# Verdictul porților pe sha-ul curent: caută ÎN comentarii ultimul raport
# porti-pr („## Porți rulate pe VPS — \`<sha7>\`" + „VERDICT: TRECE/PICĂ") care
# se potrivește cu sha-ul HEAD al PR-ului. Fără potrivire pe sha = „necunoscut"
# (porti-pr n-a apucat încă — îl lăsăm pe rundă viitoare, nu ghicim).
verdict_pe_sha() {  # numar sha7  → TRECE | PICĂ | necunoscut
  local n=$1 sha7=$2
  gh "$GH/issues/$n/comments?per_page=100" | python3 -c '
import json,sys,re
sha=sys.argv[1]
try: cs=json.load(sys.stdin)
except Exception: cs=[]
verdict="necunoscut"
for c in cs:  # în ordine cronologică → ultimul care se potrivește câștigă
    b=c.get("body","") or ""
    if ("Porți rulate pe VPS" in b) and (sha in b):
        m=re.search(r"VERDICT:\s*(TRECE|PICĂ)", b)
        if m: verdict=m.group(1)
print(verdict)
' "$sha7"
}

echo "── gestionar-pr $(date -u +%H:%M:%S)${USCAT:+ [USCAT]} ──"

# PR-urile deschise: number, head_ref, mergeable_state, head_sha, title.
# Parsat cu python3 (JSON are mai multe câmpuri `sha`; grep le-ar amesteca).
gh "$GH/pulls?state=open&per_page=100" | python3 -c '
import json,sys
try: prs=json.load(sys.stdin)
except Exception: prs=[]
for p in prs:
    t=(p.get("title") or "").replace("\t"," ").replace("\n"," ")
    print("\t".join([str(p["number"]), p["head"]["ref"], p.get("mergeable_state","unknown"), p["head"]["sha"], t]))
' | while IFS=$'\t' read -r NUMAR REF MSTATE SHA TITLU; do
  [ -z "${NUMAR:-}" ] && continue
  echo "PR #$NUMAR [$REF] stare=$MSTATE — ${TITLU:0:60}"

  # NU atingem munca lui Claude în curs.
  case "$REF" in claude/*) echo "   (branch claude/ — îl las)"; continue ;; esac

  # 1) MODEL SCOS → închide (readuce un model mort = rupe aplicația).
  if printf '%s' "$TITLU" | grep -qiE "$MODELE_MOARTE"; then
    inchide "$NUMAR" "Model scos de furnizor (\`gemini-1.5-*\`) — dacă s-ar merge-ui, rupe urechea live (dovadă 5 aug). Depășit de urechea pe native-audio Live + rezervă flash."
    continue
  fi

  # 2) CONFLICT (masterul a trecut peste el) → depășit, se închide.
  if [ "$MSTATE" = 'dirty' ]; then
    inchide "$NUMAR" "Conflict cu master (masterul a avansat peste această ramură) — lucrarea e depășită. Dacă mai e nevoie, se redeschide de la master curat."
    continue
  fi

  # 3) MERGE cu JUDECATĂ: porți TRECE pe sha-ul curent + mergeable curat.
  V=$(verdict_pe_sha "$NUMAR" "${SHA:0:7}")
  if [ "$V" = 'TRECE' ] && { [ "$MSTATE" = 'clean' ] || [ "$MSTATE" = 'unstable' ]; }; then
    merge_uieste "$NUMAR" "$SHA"
    continue
  fi

  echo "   (las: verdict=$V, stare=$MSTATE — nu TRECE+curat, nu mort, nu conflict)"
done

echo "── gestionar-pr gata ──"
