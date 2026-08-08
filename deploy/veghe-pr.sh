#!/usr/bin/env bash
# ── VEGHEA PR-URILOR — niciunul nu mai putrezește deschis (8 aug 2026) ───────
#
# Adrian: „ai multe PR vechi în git, închide-le fără să afecteze platforma" +
# „creează un sistem să nu mai rămână PR nerezolvate".
#
# CE S-A ÎNTÂMPLAT: 26 de PR-uri deschise, din 3-6 august, toate ale
# constructorului. Niciunul nu era în master. Majoritatea modificau
# `AI-HANDOFF.md` și `RAMAS-DE-FACUT.md` așa cum arătau acum trei zile — a le
# îmbina ar fi dat documentele înapoi cu trei zile și ar fi șters tot ce s-a
# scris între timp. Trei conțineau cod real; DOUĂ din cele trei erau deja
# rezolvate altfel în master (ceasul există ca WorkClock.tsx; ScriptProcessor
# funcționează). Adică 25 din 26 erau zgomot — dar zgomotul ăsta ascundea al
# 26-lea, care chiar lipsea (scope-urile de YouTube).
#
# ASTA E PROBLEMA REALĂ: un teanc de PR-uri vechi nu e doar dezordine, e un loc
# unde se PIERDE lucrul care conta.
#
# CE FACE VEGHEA: un PR care stă neatins mai mult decât pragul se ÎNCHIDE — dar
# NICIODATĂ tăcut. Înainte să-l închidă, scrie în el CE conținea, separat pe
# „cod real" și „doar documentație", ca nimic să nu dispară fără să fi fost
# numit. Ramura rămâne în git: închis ≠ șters, se poate redeschide oricând.
#
# CE NU FACE, INTENȚIONAT: nu îmbină nimic. Un merge automat schimbă produsul
# care merge; o închidere nu atinge nici o linie din el. Ownerul îmbină ce vrea,
# veghea doar nu-l lasă să se adune.
#
# INSTALARE (o linie de cron, zilnic la 05:00 UTC):
#   ( crontab -l 2>/dev/null | grep -v 'veghe-pr' ; \
#     echo '0 5 * * * /root/kelion/repo/deploy/veghe-pr.sh >> /root/kelion/veghe-pr.log 2>&1' ) | crontab -
#
# PROBĂ FĂRĂ SĂ ATINGĂ GITHUB:
#   VEGHE_PR_USCAT=1 deploy/veghe-pr.sh
set -u

USCAT=${VEGHE_PR_USCAT:-}
PRAG_ZILE=${VEGHE_PR_ZILE:-3}
# Ramurile de lucru ale sesiunii curente NU se ating: acolo se lucrează ACUM.
SCUTITE=${VEGHE_PR_SCUTITE:-claude/}
ENVFILE=/root/kelion/kelionai.env
REPO=${VEGHE_PR_REPO:-/root/kelion/repo}
GH=https://api.github.com/repos/kelion-team/kelionai

TOKEN=$(grep '^GITHUB_TOKEN=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-)
if [ -z "${TOKEN:-}" ] && [ -z "$USCAT" ]; then
  echo "[veghe-pr] fără GITHUB_TOKEN — nu declar nimic despre PR-uri"; exit 0
fi
gh() { curl -s -m 30 -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github+json' "$@"; }

# ── CE CONȚINE UN PR, PE BUNE ───────────────────────────────────────────────
# Separat pe „cod" și „documentație": un PR care schimbă doar documente vechi e
# zgomot, unul care aduce cod poate fi lucru pierdut. Distincția se face din
# fișiere, nu din titlu — titlurile mint, fișierele nu.
continut() {
  local sha=$1
  git -C "$REPO" cat-file -e "${sha}^{commit}" 2>/dev/null || { echo "  (commit indisponibil local — nu pot spune ce conține)"; return; }
  local cod doc
  cod=$(git -C "$REPO" diff origin/master..."$sha" --name-only 2>/dev/null | grep -vE '\.md$' | head -20)
  doc=$(git -C "$REPO" diff origin/master..."$sha" --name-only 2>/dev/null | grep -E '\.md$' | head -20)
  if [ -n "$cod" ]; then
    echo "  COD (verifică dacă mai e nevoie de el):"
    echo "$cod" | sed 's/^/    - /'
  else
    echo "  COD: niciun fișier de cod — doar documentație."
  fi
  [ -n "$doc" ] && { echo "  DOCUMENTAȚIE (probabil depășită):"; echo "$doc" | sed 's/^/    - /'; }
}

# PR-urile deschise: „număr sha zile_de_la_ultima_atingere ramură" pe linie.
# Parsat cu python3, nu cu grep: în JSON-ul unui PR sunt mai multe câmpuri `sha`.
if [ -n "$USCAT" ] && [ -n "${VEGHE_PR_INTRARE:-}" ]; then
  PRURI=$(cat "$VEGHE_PR_INTRARE")   # probă: fișier cu aceleași coloane
else
  PRURI=$(gh "$GH/pulls?state=open&per_page=100" | python3 -c '
import json,sys,datetime
try: prs=json.load(sys.stdin)
except Exception: sys.exit(0)
acum=datetime.datetime.now(datetime.timezone.utc)
for p in prs if isinstance(prs,list) else []:
    at=datetime.datetime.fromisoformat(p["updated_at"].replace("Z","+00:00"))
    print(p["number"], p["head"]["sha"], (acum-at).days, p["head"]["ref"])
')
fi

[ -z "${PRURI:-}" ] && { echo "[veghe-pr] niciun PR deschis — curat."; exit 0; }

INCHISE=0; LASATE=0
while read -r NUMAR SHA ZILE RAMURA; do
  [ -z "${NUMAR:-}" ] && continue
  case "$RAMURA" in
    "$SCUTITE"*) echo "[veghe-pr] #$NUMAR ($RAMURA) — ramură de lucru curentă, NU o ating"; LASATE=$((LASATE+1)); continue ;;
  esac
  if [ "${ZILE:-0}" -lt "$PRAG_ZILE" ]; then
    echo "[veghe-pr] #$NUMAR — atins acum $ZILE zile (prag $PRAG_ZILE), îl las"
    LASATE=$((LASATE+1)); continue
  fi

  MOTIV=$(printf 'Închis automat de veghea PR-urilor: a stat **%s zile** fără nicio atingere (pragul e %s).\n\nÎnchis NU înseamnă șters — ramura `%s` rămâne în git și PR-ul se poate redeschide oricând. Se închide ca teancul de PR-uri vechi să nu mai ascundă lucrul care chiar contează.\n\n## Ce conținea, ca să nu dispară nenumit\n\n```\n%s\n```\n\nDacă vreunul din fișierele de cod de mai sus e încă necesar, se reia pe o ramură nouă, peste master-ul de azi — nu prin îmbinarea acestuia, care ar da documentele înapoi cu zile întregi.\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_' \
    "$ZILE" "$PRAG_ZILE" "$RAMURA" "$(continut "$SHA")")

  if [ -n "$USCAT" ]; then
    echo "=== PROBĂ USCATĂ — #$NUMAR ($ZILE zile, $RAMURA) s-ar închide cu: ==="
    echo "$MOTIV"; echo
  else
    gh -X POST -H 'content-type: application/json' \
      -d "$(python3 -c 'import json,sys; print(json.dumps({"body": sys.stdin.read()}))' <<<"$MOTIV")" \
      "$GH/issues/$NUMAR/comments" >/dev/null
    gh -X PATCH -H 'content-type: application/json' -d '{"state":"closed"}' "$GH/pulls/$NUMAR" >/dev/null
    echo "[veghe-pr] #$NUMAR ÎNCHIS (stătea de $ZILE zile)"
  fi
  INCHISE=$((INCHISE+1))
done <<<"$PRURI"

echo "[veghe-pr] gata: $INCHISE închise, $LASATE lăsate."
