#!/usr/bin/env bash
# MATERIALIZAREA PUNCTELOR DE RECUPERARE PE SERVERUL LINUX (Adrian, 27 iul:
# „salvarea trebuie pe serverul Linux"). Meniul Recovery din admin creează
# tag-uri git `backup-*` (prin API GitHub). Cronul ăsta (la 10 min) aduce
# tag-urile și, pentru fiecare fără copie fizică locală, creează .bundle
# (clonă integrală recuperabilă) + .tar.gz (sursă). Astfel ORICE versiune
# salvată din admin ajunge garantat și fizic pe VPS, nu doar pe GitHub.
set -u
REPO=/root/kelion/repo
DIR=/root/kelion/backups
LOCK=/root/kelion/backup-versiuni.lock
exec 9>"$LOCK"
flock -n 9 || exit 0
mkdir -p "$DIR"
cd "$REPO" || exit 0
git fetch --tags --force origin >/dev/null 2>&1 || exit 0

for TAG in $(git tag -l 'backup-*'); do
  SHA=$(git rev-list -n1 "$TAG" 2>/dev/null) || continue
  [ -n "$SHA" ] || continue
  if [ ! -f "$DIR/$TAG.bundle" ]; then
    git bundle create "$DIR/$TAG.bundle" "$SHA" >/dev/null 2>&1 \
      && echo "[backup-versiuni] $(date -u +%H:%M) bundle nou: $TAG"
  fi
  if [ ! -f "$DIR/$TAG.tar.gz" ]; then
    git archive --format=tar.gz -o "$DIR/$TAG.tar.gz" "$SHA" >/dev/null 2>&1 || true
  fi
done

# Igienă: păstrăm ultimele 30 de puncte fizice (după dată), ca discul să nu crească
# la nesfârșit. Tag-urile pe GitHub rămân toate (recuperabile oricând prin fetch).
ls -1t "$DIR"/backup-*.bundle 2>/dev/null | tail -n +31 | while read -r f; do
  base="${f%.bundle}"
  rm -f "$f" "$base.tar.gz" 2>/dev/null || true
done
