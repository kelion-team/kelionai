#!/usr/bin/env bash
set -euo pipefail

SOURCE=/source
WORK=/work/repo

# Markerul este emis de entrypointul fixat în imagine, nu de worktree-ul
# verificat. Workerul acceptă un verdict de cod/test numai dacă vede și markerul
# final cu exact codul de ieșire al containerului; un podman 125/126/127, OOM sau
# proces omorât nu îl poate fabrica.
gate_verdict() {
  local status=$?
  trap - EXIT
  printf 'codex-gates: VERDICT schema=1 exit=%s\n' "$status"
  exit "$status"
}
trap gate_verdict EXIT
printf 'codex-gates: START schema=1\n'

die() {
  printf 'codex-gates: %s\n' "$1" >&2
  exit 1
}

[ -f "$SOURCE/AGENTS.md" ] || die 'sursa montată lipsește'
[ -f "$SOURCE/backend/package-lock.json" ] || die 'lockfile-ul backend lipsește'
[ -f "$SOURCE/frontend/package-lock.json" ] || die 'lockfile-ul frontend lipsește'
[ -f "$SOURCE/.git" ] || die 'sursa nu este worktree Git dedicat'
[ ! -e "$SOURCE/backend/node_modules" ] || die 'worktree-ul conține node_modules backend necontrolat'
[ ! -e "$SOURCE/frontend/node_modules" ] || die 'worktree-ul conține node_modules frontend necontrolat'

cmp -s "$SOURCE/backend/package.json" /opt/kelion/locks/backend-package.json \
  && cmp -s "$SOURCE/backend/package-lock.json" /opt/kelion/locks/backend-package-lock.json \
  || die 'dependințele backend diferă de imaginea gate'
cmp -s "$SOURCE/frontend/package.json" /opt/kelion/locks/frontend-package.json \
  && cmp -s "$SOURCE/frontend/package-lock.json" /opt/kelion/locks/frontend-package-lock.json \
  || die 'dependințele frontend diferă de imaginea gate'

mkdir -p /work/tmp "$WORK"
cp -a --no-preserve=ownership "$SOURCE/." "$WORK/"
ln -s /opt/kelion/backend/node_modules "$WORK/backend/node_modules"
ln -s /opt/kelion/frontend/node_modules "$WORK/frontend/node_modules"

export CI=1
export HOME=/nonexistent
export GITLEAKS_BIN=/usr/local/bin/gitleaks
# Sursa este copiată fără ownerul hostului într-un tmpfs controlat și devine
# worktree-ul exact verificat de porți. Git 2.35+ îl refuză altfel ca „dubious
# ownership”. Configurația process-locală autorizează numai acest path; nu scrie
# config în imagine și nu autorizează global alte directoare.
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=safe.directory
export GIT_CONFIG_VALUE_0="$WORK"
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export NO_COLOR=1
export npm_config_audit=false
export npm_config_fund=false
export npm_config_offline=true
export npm_config_update_notifier=false
export TMPDIR=/work/tmp

cd "$WORK"
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix frontend run build
npm --prefix frontend run lint
npm --prefix frontend test
node --test \
  .github/private-ai/benchmark-active-model.test.mjs \
  .github/private-ai/finalize-private-ai-constructor.test.mjs \
  .github/private-ai/install-private-ai.test.mjs \
  .github/private-ai/upgrade-private-ai-max-model.test.mjs \
  scripts/verifica-butoane.test.mjs \
  scripts/verifica-exporturi.test.mjs \
  scripts/verifica-hardcodari.test.mjs \
  scripts/verifica-migrari.test.mjs \
  scripts/inventar-audit.test.mjs \
  scripts/verifica-contract-deploy.test.mjs \
  scripts/release-train-preflight.test.mjs \
  scripts/release-train-workflow.test.mjs \
  scripts/vps-recovery-workflow.test.mjs \
  scripts/vps-pr-remediator.test.mjs \
  scripts/vps-release-verifier.test.mjs \
  ios/appstore-build.test.mjs \
  deploy/constructor-model-control.test.mjs \
  deploy/constructor-model-switch.test.mjs \
  deploy/lib/create-migration-proof.test.mjs \
  deploy/lib/backup-schedule.test.mjs \
  deploy/lib/restore-verified-backup.test.mjs \
  deploy/lib/caddy-security.test.mjs \
  deploy/lib/codex-boundary.test.mjs \
  deploy/lib/constructor-publication.test.mjs \
  deploy/lib/network-config.test.mjs \
  deploy/lib/compose-security.test.mjs \
  deploy/lib/release-rollback.test.mjs \
  deploy/lib/security-policy.test.mjs
node scripts/identifica-teste-moarte.mjs
node scripts/verifica-exporturi.mjs
node scripts/verifica-sintaxa.mjs
node scripts/verifica-hardcodari.mjs
node scripts/verifica-creier-unic.mjs
node scripts/verifica-workflow-uri-sigure.mjs
node scripts/verifica-migrari.mjs
node scripts/inventar-audit.mjs
node scripts/verifica-contract-deploy.mjs
node deploy/codex-worker.mjs --self-test
node deploy/constructor-publisher.mjs --self-test
node deploy/constructor-release.mjs --self-test
node scripts/verifica-clienti-nativi.mjs
node scripts/verifica-butoane.mjs
bash scripts/verifica-secrete.sh --worktree --dist
/opt/kelion/gates/node_modules/.bin/jscpd --config .jscpd.json --threshold 0 --cross-formats js-ts

printf 'codex-gates: TRECE\n'
