#!/usr/bin/env bash
# ── VEGHEA PUBLICĂRII — cine se uită la cel care publică (7 aug 2026) ────────
#
# CE S-A ÎNTÂMPLAT, MĂSURAT: pe 7 aug, master a stat la `3be4a51` iar live a
# rămas la `ee283ef` (16:48Z) timp de PESTE ȘAPTE ORE. Trei PR-uri fuziona­te —
# printre ele un bug real de producție reparat — nu au ajuns niciodată la om.
# Nimeni n-a aflat. Nu exista niciun semnal.
#
# DE CE A TĂCUT: `auto-publicare.sh` face `flock -n 9 || exit 0`. Dacă lacătul
# rămâne ținut (proces agățat, oprit la jumătate, mașină repornită prost),
# cronul iese TĂCUT la fiecare minut, pentru totdeauna. Comportamentul e corect
# ca protecție împotriva suprapunerii — și complet orb ca stare a sistemului.
# Exact tiparul interzis de regula #1: o citire care nu s-a făcut, prezentată
# (prin tăcere) ca „totul e bine".
#
# CE FACE VEGHEA: se uită din AFARA lacătului. Compară ce e LIVE cu vârful lui
# master, ține minte de când diferă și, dacă trece pragul, DESCHIDE UN ISSUE pe
# GitHub cu diagnosticul strâns de pe mașină (cine ține lacătul, de cât timp,
# ultimele linii din log). Când publicarea se face, închide issue-ul singură și
# scrie cât a durat. Nu repară nimic de capul ei — un lacăt spart automat poate
# porni două publicări peste aceeași imagine; treaba ei e să nu mai lase
# defecțiunea să fie TĂCUTĂ.
#
# INSTALARE (o singură linie de cron, la 10 minute):
#   ( crontab -l 2>/dev/null | grep -v 'veghe-publicare' ; \
#     echo '*/10 * * * * /root/kelion/repo/deploy/veghe-publicare.sh >> /root/kelion/veghe-publicare.log 2>&1' ) | crontab -
#
# PROBĂ FĂRĂ SĂ ATINGĂ GITHUB (rulabilă oriunde):
#   VEGHE_USCAT=1 deploy/veghe-publicare.sh
set -u

USCAT=${VEGHE_USCAT:-}
PRAG=${VEGHE_PRAG_S:-900}          # 15 min de divergență = ceva chiar e stricat
ENVFILE=/root/kelion/kelionai.env
STARE=${VEGHE_STARE:-/root/kelion/veghe-publicare.stare}
GH=https://api.github.com/repos/kelion-team/kelionai
PUBLIC=https://kelionai.app/api/version

acum=$(date -u +%s)

# ── CE E LIVE ───────────────────────────────────────────────────────────────
# Se citește de pe adresa PUBLICĂ, nu de pe 127.0.0.1: dacă aplicația răspunde
# pe local dar nu prin proxy, pentru om tot e picată — veghea trebuie să vadă
# ce vede el.
# Intrări de probă: DOAR în modul uscat. În producție nu se pot falsifica —
# altfel „veghea" ar putea fi mințită chiar de cel pe care-l veghează.
if [ -n "$USCAT" ] && [ -n "${VEGHE_LIVE:-}" ]; then
  LIVE=$VEGHE_LIVE
else
  LIVE=$(curl -s -m 15 "$PUBLIC" | grep -o '"v":"[^"]*"' | cut -d'"' -f4 || true)
fi

TOKEN=$(grep '^GITHUB_TOKEN=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-)
gh() { curl -s -m 30 -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github+json' "$@"; }

MASTER=''
if [ -n "$USCAT" ] && [ -n "${VEGHE_MASTER:-}" ]; then
  MASTER=$VEGHE_MASTER
elif [ -n "$TOKEN" ]; then
  # CANAL GIT (ca auto-publicare): ls-remote nu e prins de rate-limit REST.
  # Fallback API doar daca git pica. (owner: master=live mereu; veghea nu mai tace pe API)
  ASKPASS="${TMPDIR:-/tmp}/kelion-veghe-git-askpass"
  cat > "$ASKPASS" <<'ASKPASS_SCRIPT'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *) printf '%s\n' "$GITHUB_TOKEN" ;;
esac
ASKPASS_SCRIPT
  chmod 700 "$ASKPASS"
  FULL=$(GITHUB_TOKEN="$TOKEN" GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0 \
    git ls-remote "https://github.com/kelion-team/kelionai.git" refs/heads/master 2>/dev/null | head -c 40)
  case "$FULL" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) MASTER=$(printf '%s' "$FULL" | cut -c1-7) ;;
    *)
      MASTER=$(curl -s -m 20 -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github.sha' \
        "$GH/commits/master" | head -c 40 | cut -c1-7)
      ;;
  esac
fi

# O citire care n-a reușit NU e o stare. Fără sha de master nu putem spune nici
# „e bine", nici „e stricat" — ieșim, revenim la următorul ciclu.
case "${MASTER:-}" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) : ;;
  *) echo "[veghe] $(date -u +%H:%M:%S) nu pot citi masterul — nu declar nimic"; exit 0 ;;
esac
if [ -z "$LIVE" ]; then
  echo "[veghe] $(date -u +%H:%M:%S) nu pot citi versiunea live — nu declar nimic"; exit 0
fi

# ── DIAGNOSTICUL, strâns de pe mașină ───────────────────────────────────────
diagnostic() {
  echo '```'
  echo "live=$LIVE  master=$MASTER"
  echo
  echo "--- lacătul publicării ---"
  if [ -e /root/kelion/auto-publicare.lock ]; then
    ls -l /root/kelion/auto-publicare.lock 2>/dev/null
    fuser /root/kelion/auto-publicare.lock 2>/dev/null && echo "(ținut de procesul de mai sus)" || echo "(nu-l ține niciun proces — lacăt fără stăpân)"
  else
    echo "nu există fișierul de lacăt"
  fi
  echo
  echo "--- procese de publicare ---"
  pgrep -af 'deploy\.sh|docker build|auto-publicare' 2>/dev/null | head -10 || echo "niciunul"
  echo
  echo "--- cron ---"
  crontab -l 2>/dev/null | grep -E 'auto-publicare|veghe-publicare' || echo "NICIO linie de cron pentru publicare (asta ar explica tăcerea)"
  echo
  echo "--- ultimele linii din auto-publicare.log ---"
  tail -15 /root/kelion/auto-publicare.log 2>/dev/null || echo "fără log"
  echo
  echo "--- încărcare ---"
  uptime
  echo '```'
}

citeste_stare() { [ -f "$STARE" ] && cat "$STARE" || echo ": :"; }
IFS=' ' read -r S_MASTER S_DIN S_ISSUE <<EOF
$(citeste_stare)
EOF

# ── SINCRON: totul e bine ───────────────────────────────────────────────────
if [ "$LIVE" = "$MASTER" ]; then
  if [ -n "${S_ISSUE:-}" ] && [ "$S_ISSUE" != ':' ]; then
    MINUTE=$(( (acum - ${S_DIN:-$acum}) / 60 ))
    if [ -z "$USCAT" ]; then
      gh -X POST -H 'content-type: application/json' \
        -d "$(printf '{"body":"Publicarea s-a făcut: live = `%s` = master. A stat blocată %s minute.\\n\\n---\\n_Generated by [Claude Code](https://claude.ai/code)_"}' "$LIVE" "$MINUTE")" \
        "$GH/issues/$S_ISSUE/comments" >/dev/null
      gh -X PATCH -H 'content-type: application/json' -d '{"state":"closed"}' "$GH/issues/$S_ISSUE" >/dev/null
    fi
    echo "[veghe] publicat ($LIVE) după $MINUTE min — issue #$S_ISSUE închis"
  fi
  : > "$STARE" 2>/dev/null || true
  exit 0
fi

# ── DIVERGENT ───────────────────────────────────────────────────────────────
# Prima dată când vedem divergența (sau un master nou) doar pornim ceasul:
# o publicare normală durează minute, nu e nimic de alarmat.
if [ "${S_MASTER:-}" != "$MASTER" ] || [ "${S_DIN:-}" = ':' ] || [ -z "${S_DIN:-}" ]; then
  echo "$MASTER $acum " > "$STARE"
  echo "[veghe] $(date -u +%H:%M:%S) live=$LIVE master=$MASTER — pornesc ceasul"
  exit 0
fi

DE_CAT=$(( acum - S_DIN ))
if [ "$DE_CAT" -lt "$PRAG" ]; then
  echo "[veghe] live=$LIVE master=$MASTER de $((DE_CAT/60)) min — încă sub prag ($((PRAG/60)) min)"
  exit 0
fi

if [ -n "${S_ISSUE:-}" ] && [ "$S_ISSUE" != ':' ]; then
  echo "[veghe] deja anunțat (issue #$S_ISSUE), blocat de $((DE_CAT/60)) min"
  exit 0
fi

MIN=$((DE_CAT/60))
CORP=$(printf 'Publicarea nu s-a mai făcut de **%s minute**.\n\n| | |\n|---|---|\n| live | `%s` |\n| master | `%s` |\n\nAplicația răspunde, dar servește cod vechi — deci tot ce s-a fuzionat între timp NU e la om.\n\n## Diagnostic de pe mașină\n\n%s\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_' \
  "$MIN" "$LIVE" "$MASTER" "$(diagnostic)")

if [ -n "$USCAT" ]; then
  echo "=== PROBĂ USCATĂ — issue-ul care s-ar deschide ==="
  echo "Titlu: Publicarea e oprită de $MIN minute (live $LIVE ≠ master $MASTER)"
  echo "$CORP"
  exit 0
fi

NUMAR=$(gh -X POST -H 'content-type: application/json' \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"title": sys.argv[1], "body": sys.stdin.read()}))' \
        "Publicarea e oprită de $MIN minute (live $LIVE ≠ master $MASTER)" <<<"$CORP")" \
  "$GH/issues" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("number",""))' 2>/dev/null || true)

if [ -n "$NUMAR" ]; then
  echo "$MASTER $S_DIN $NUMAR" > "$STARE"
  echo "[veghe] ALARMĂ: publicare oprită de $MIN min — issue #$NUMAR deschis"
else
  echo "[veghe] publicare oprită de $MIN min, dar NU am putut deschide issue-ul (token/API)"
fi
