#!/usr/bin/env bash
set -euo pipefail

VERSIUNE=8.30.1
SHA_LINUX_X64=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
SHA_WINDOWS_X64=d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e
RADACINA=$(cd "$(dirname "$0")/.." && pwd)
SUPRAFATA=worktree
INCLUDE_DIST=0

for ARG in "$@"; do
  case "$ARG" in
    --git-head) SUPRAFATA=git-head ;;
    --worktree) SUPRAFATA=worktree ;;
    --history) SUPRAFATA=history ;;
    --dist) INCLUDE_DIST=1 ;;
    *) echo "Argument necunoscut: $ARG" >&2; exit 2 ;;
  esac
done

LUCRU=""
cleanup() {
  [ -n "$LUCRU" ] || return 0
  case "$LUCRU" in
    "${TMPDIR:-/tmp}"/kelion-gitleaks.*) rm -rf -- "$LUCRU" ;;
    *) echo "Refuz curățare cale temporară neașteptată: $LUCRU" >&2 ;;
  esac
}
trap cleanup EXIT

if [ -n "${GITLEAKS_BIN:-}" ]; then
  BIN=$GITLEAKS_BIN
  [ -x "$BIN" ] || { echo "GITLEAKS_BIN nu este executabil: $BIN" >&2; exit 2; }
else
  LUCRU=$(mktemp -d "${TMPDIR:-/tmp}/kelion-gitleaks.XXXXXX")
  [ "$(uname -m)" = x86_64 ] || { echo "Platformă nesuportată; setează GITLEAKS_BIN explicit" >&2; exit 2; }
  case "$(uname -s)" in
    Linux*)
      NUME="gitleaks_${VERSIUNE}_linux_x64.tar.gz"
      ARHIVA_SHA256=$SHA_LINUX_X64
      BIN="$LUCRU/gitleaks"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      NUME="gitleaks_${VERSIUNE}_windows_x64.zip"
      ARHIVA_SHA256=$SHA_WINDOWS_X64
      BIN="$LUCRU/gitleaks.exe"
      ;;
    *) echo "Sistem nesuportat; setează GITLEAKS_BIN explicit" >&2; exit 2 ;;
  esac
  ARHIVA="$LUCRU/$NUME"
  URL="https://github.com/gitleaks/gitleaks/releases/download/v${VERSIUNE}/${NUME}"
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
    --retry 3 --connect-timeout 20 --max-time 180 "$URL" -o "$ARHIVA"
  printf '%s  %s\n' "$ARHIVA_SHA256" "$ARHIVA" | sha256sum --check --status \
    || { echo "Arhiva Gitleaks nu corespunde SHA256 pin-uit" >&2; exit 3; }
  case "$NUME" in
    *.zip) unzip -qq "$ARHIVA" gitleaks.exe -d "$LUCRU" ;;
    *) tar -xzf "$ARHIVA" -C "$LUCRU" gitleaks ;;
  esac
  chmod 700 "$BIN"
fi

cd "$RADACINA"
if [ -z "$LUCRU" ]; then
  LUCRU=$(mktemp -d "${TMPDIR:-/tmp}/kelion-gitleaks.XXXXXX")
fi

if [ "$SUPRAFATA" = history ]; then
  [ "$INCLUDE_DIST" = 0 ] || { echo "--dist nu se combină cu --history" >&2; exit 2; }
  "$BIN" git --no-banner --redact --config "$RADACINA/.gitleaks.toml" --log-opts="--all" .
  exit
fi

SNAPSHOT="$LUCRU/snapshot"
mkdir -p "$SNAPSHOT"

# Nu scanăm recursiv worktree-ul brut: acolo există node_modules, cache-uri și
# artefacte neurmărite fără legătură cu commitul. CI scanează exact HEAD; modul
# worktree copiază numai fișierele urmărite plus fișierele noi neignorate.
if [ "$SUPRAFATA" = git-head ]; then
  git archive --format=tar HEAD | tar -xf - -C "$SNAPSHOT"
else
  tar --null -T <(
    while IFS= read -r -d '' FISIER; do
      [ -f "$FISIER" ] && printf '%s\0' "$FISIER"
    done < <(git ls-files -z --cached --others --exclude-standard)
  ) -cf - | tar -xf - -C "$SNAPSHOT"
fi

if [ "$INCLUDE_DIST" = 1 ]; then
  [ -d frontend/dist ] || { echo "frontend/dist lipsește; construiește frontend-ul înainte" >&2; exit 4; }
  mkdir -p "$SNAPSHOT/frontend"
  cp -a frontend/dist "$SNAPSHOT/frontend/dist"
fi

(
  cd "$SNAPSHOT"
  "$BIN" dir --no-banner --redact --config "$RADACINA/.gitleaks.toml" .
)
