#!/usr/bin/env bash
# ── OPS LOCAL pe VPS (owner 17 aug QA) ───────────────────────────────────────
# GitHub Actions e mort pe org (billing) — butonul Reset VPS nu mai poate
# trece prin workflow_dispatch. Cererea vine din container (scriere în
# /root/kelion/ops-inbox), iar AICI pe gazdă se execută comanda permisă.
# Doar comenzi din lista albă — fără shell liber din panou.
set -u
INBOX=/root/kelion/ops-inbox
mkdir -p "$INBOX"
shopt -s nullglob
for f in "$INBOX"/*.req; do
  [ -f "$f" ] || continue
  base=${f%.req}
  # o singură prelucrare
  if [ -f "$base.lock" ] || [ -f "$base.done" ]; then continue; fi
  : >"$base.lock"
  name=$(basename "$f" .req)
  cmd=$(tr -d '\r' <"$f" | head -1)
  ok=0
  out=""
  case "$cmd" in
    restart-app)
      out=$(docker restart kelionai-app 2>&1; sleep 4; curl -s -m 8 http://127.0.0.1:8080/api/version 2>&1) && ok=1
      ;;
    restart-caddy)
      out=$(docker restart kelion-caddy 2>&1; docker ps --format '{{.Names}} {{.Status}}' 2>&1 | head -5) && ok=1
      ;;
    *)
      out="cmd_nepermisa: $cmd"
      ok=0
      ;;
  esac
  {
    echo "ok=$ok"
    echo "cmd=$cmd"
    echo "at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "---"
    printf '%s\n' "$out"
  } >"$base.done"
  rm -f "$base.lock" "$f"
  echo "[ops-worker] $name cmd=$cmd ok=$ok" >>/root/kelion/ops-worker.log
done
