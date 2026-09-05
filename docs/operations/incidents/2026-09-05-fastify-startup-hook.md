# Fastify startup hook registration incident (2026-09-05)

## Observed failure and exact cause

PR #1662 review PRRT_kwDOTNNplc6fjw3p identified a startup blocker in
backend/src/index.ts. The application first awaited app.listen(), then
startBackgroundWork() attempted to register the Constructor monitor onClose
hook. The real installed Fastify rejects addHook after listening with
FST_ERR_INSTANCE_ALREADY_LISTENING.

A full application process reproduced this, not merely a standalone Fastify
example: the socket opened, the mailbox reported its deliberately unconfigured
state, then normal startup exited with code 1 at the monitor hook. A candidate
booted successfully while inactive, but its first exact activation started the
same code and terminated the process, making HTTP unavailable.

## Why earlier checks missed this

The service/unit suites exercised monitor behavior and activation helpers
without importing the complete application entrypoint through listen and
background initialization. Passing those tests did not prove server startup.

The container-isolation workflow also sets RELEASE_CANDIDATE_MODE=1 and writes
an inactive activation marker before its readiness probe. That cold candidate
path deliberately does not execute startBackgroundWork. The new regression's
inactive-candidate control passed even against the broken source, while normal
startup and actual activation failed. Thus readiness alone could not cover
this lifecycle transition. Earlier baseline-image probes are not evidence for
the modified entrypoint.

## Minimal correction

The nullable Constructor monitor timer and its onClose hook are declared
immediately after creation of the Fastify app, before plugin registration or
listen. Background initialization only assigns the interval and unrefs it.
The close hook clears the interval when present and resets the reference.

No activation condition, watchdog, Doctor scope, callback interval, service
policy, provider configuration or readiness guard changed. No production
service, database, credential, pause marker or workflow run was mutated by
the implementing agent.

## Real lifecycle regression and method

backend/src/startupLifecycle.test.ts starts a separate Node process importing
the complete index entrypoint and all its real Fastify plugins and routes.
It does not replace imported application modules or mock Fastify. The official
fastify.initialization diagnostic channel captures the real instance and adds
a close observer before startup. Transparent interval observers delegate to
the original timer functions and callbacks; time is not faked.

Each child receives an explicit environment whitelist, a private temporary
HOME/TMPDIR, an absent dotenv path, no configured DB/mail/provider credentials,
loopback binding and an ephemeral port. HTTP requests use the actual listening
socket. The exact RELEASE_ID and RELEASE_ACTIVATION_FILE contract is exercised:

1. Normal startup initializes background work once, serves HTTP, then completes
   app.close with the monitor interval cleared and exit code 0.
2. An inactive candidate serves HTTP without starting the monitor; explicit
   app.close succeeds while the nullable timer was never allocated.
3. Missing and mismatched markers do not activate. An atomically published
   exact marker starts background once; another real polling interval does
   not duplicate it. Removing the marker drives the real deactivation path,
   onClose, interval cleanup and exit code 0 before the 10-second fallback.

The tests assert /api/release-proof remains 503 and ready=false without the
required database and worker sockets. Active/candidate state is checked
independently. NODE_ENV=test does not certify full production configuration,
external services, release readiness or live behavior.

## Executed red and green evidence

All executions used private VPS containers, source mounted read-only, writable
copies and marker fixtures in tmpfs, network none, user 1000:1000, cap-drop ALL,
no-new-privileges, 2 CPUs, 1536 MiB and PID limit 128. No host fixture paths or
production ports were used.

Test image ID:
3f1da7febc6966571fbafa3d7c870b223ec35c41d53a5108e33900bac519437e
(localhost/kelion-gates-test:20260905-1208-29fb004f). This is a test dependency
cache, not a claim that a new release image has already passed CI.

- Before correction: complete application regression 1 pass / 2 fail / zero
  skip, 21.65 seconds. Normal startup recorded the exact Fastify exception and
  code 1. Candidate activation subsequently refused HTTP after termination.
- After correction, final source: startup, release activation and Constructor
  monitor suites 41/41 pass, zero skip, 29.81 seconds.
- npm run build passed, including the canonical Doctor capability generator.
- The same lifecycle tests then imported the generated dist/index.js:
  3/3 pass, zero skip, 13.75 seconds.
- Separate typecheck passed. Final lint of both changed code/test files:
  zero warnings and zero errors. git diff --check passed.
- Independent peer review inspected the real-app/observer boundary and found
  no blocker. No production execution was part of this proof.

Canonical test commands inside the private writable source copy:

    cd backend
    ./node_modules/.bin/vitest run src/startupLifecycle.test.ts src/services/releaseActivation.test.ts src/constructorMonitor.test.ts src/constructorMonitorRoutes.test.ts
    npm run build
    KELION_STARTUP_COMPILED=1 ./node_modules/.bin/vitest run src/startupLifecycle.test.ts
    ./node_modules/.bin/oxlint src/index.ts src/startupLifecycle.test.ts

The source lifecycle regression is discovered by the existing backend npm test
gate. It is not gated behind an optional flag. The flag only selects the
additional compiled-entrypoint proof after build.

## Frozen sources and logs

- backend/src/index.ts SHA-256:
  6254e6843f43a970c0aeeac56c47fd615284640b4e1454ee9a98311ae8eaabd6
- backend/src/startupLifecycle.test.ts SHA-256:
  933164f8640c7f3473cfed01e5174032676b5b2b78601ee985c8fc85521259cb

Private evidence directory: /var/tmp/kelion-startup-proof.L5sag9tF

- red.log SHA-256:
  e8c98e979e4f55bed9331c860d159c9c2dc67915fb9d948ae9b40595c0d840e9
- green-final.log SHA-256:
  377d68d2a06486f507c0795962168580c21c597bd4b8d1d763af666cf02ada9e

## Responsibility and closure

The implementing agent owns the minimal entrypoint change, real startup
regression and this red/green evidence; the peer reviewer owns the independent
read-only check. The release coordinator owns final integration, required CI
on the new exact head, deployment and live verification.

The candidate code defect is corrected and verified in isolated source and
compiled executions. Operational closure still requires published-head gates,
the exact live release/upgrade receipts and safe continuation of #666. These
tests are not a statement that release, upgrade or #666 has completed.
