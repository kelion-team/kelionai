# Explicit Constructor pause and Doctor capability fixture (2026-09-05)

## Scope and observed failures

This checkpoint concerns PR #1662, not completion of build job #666. All
changes and tests were performed on the isolated VPS candidate checkout.
No production service, database row, pause marker or GitHub run was mutated
by the implementing agent.

### P1: an inactive timer was being interpreted as operator intent

The reviewed upgrade accepted an enabled worker timer in the inactive state
while the canonical pause reader returned unpaused. Snapshot creation then
called capture-worker-pause unconditionally. The common capture helper could
turn the stopped timer into a persistent pause marker. Neither inactivity,
the ready stamp nor authentic legacy helper bytes prove why a timer stopped.

The earlier matrix covered crash recovery and unsafe journal/marker states,
but treated enabled/inactive as an authorized bootstrap input. It therefore
tested durability after that assumption, not whether the assumption proved
operator intent. The missing negative controls were inactive without a marker
and a timer that stops between validation and snapshot creation.

The correction uses the existing root-owned pause marker as the explicit
intent discriminator. A fresh bootstrap requires that valid marker before
allocating its journal. A retry may reconstruct it only from the strictly
validated journal of the same owner. Without either proof, an enabled worker
must be active; inactive or unreadable state fails closed without publishing a
marker, bootstrap journal or replacement helper.

Upgrade accepts an inactive enabled worker only when paused. It calls capture
only for an already paused vector and validates the live vector again before
allocating its snapshot. Tests inject a timer stop between observations and
loss of the marker during capture. Publisher/release activation rules and
journal ownership checks are unchanged.

For #666 the operator explicitly stopped the timer at 11:29:33 UTC, but the
legacy installation still had no pause marker at the read-only preflight.
The release coordinator must record that independently authorized intent and
install the exact root-owned marker under the publication lock before the
new deploy/bootstrap. The timer's state is not substituted for that evidence.

Important legacy boundary: the a32 helper and units do not understand the new
pause marker by itself before the bootstrap publishes its schema-2 pending
journal. Tests do not claim reboot protection before that durable barrier.
After the barrier, the authentic a32 helper fails closed; owner retry preserves
the marker and publishes the pause-aware helper in the existing order.

### CI: Doctor runtime capability fixture failed with EPERM

Run 33969440486, job 101315620540, head
9891437718107d17ca784a60ba70e167dc2afaef passed the 15 Doctor scope tests,
then failed all five runtime-capability tests while copying the guard into
the private /opt tmpfs.

The previous VPS probe mounted root-owned sources. Repeating the entire
two-command Doctor step with a read-only source snapshot owned by UID/GID
1001 reproduced scope 15/15 followed by capability 0/5 and the same EPERM.
An independent control reproduced the ownership dependency with a source
created inside tmpfs too; it is not specific to the read-only mount. The
exact internal failing syscall was not claimed because strace is absent.

Only fixture staging changed: read the authentic source bytes and create
the destination exclusively (wx) as container root with mode 0444. Assert
root ownership, nlink, mode and byte hash. A regression supplies a foreign-owned
read-only source and verifies it is unchanged. Production measurement guards,
the unsafe ownership/symlink/hardlink cases and container capabilities are
unchanged. No CAP_FOWNER or DAC override was introduced.

## Executed evidence

- Initial real-filesystem P1 control: 27 pass / 1 fail / zero skip.
- New pause tests against authentic old 98914377 sources in a private container
  volume: 28 pass / 5 fail / zero skip, including the actual snapshot race.
- Corrected pause plus upgrade-cleanup suites: 36/36 pass, zero skip.
- Corrected bootstrap matrix: 52/52 pass, zero skip. This includes all 28
  effective SIGKILL cutpoints, 19 foreign/unsafe states and no-intent controls.
  There are four fewer cutpoints because an existing marker is no longer
  newly written/renamed; no failure window was silently skipped.
- Final combined pause, bootstrap and upgrade-cleanup run: 88/88 pass, zero
  fail, zero skip, exit 0; elapsed 56.901229 seconds.
- Doctor sequential red: scope 15/15, capability 0/5.
- Doctor sequential green with the same foreign-owned read-only snapshot and
  security options: scope 15/15, capability 6/6, zero skip.

The Doctor commands used the existing test gates image
3f1da7febc6966571fbafa3d7c870b223ec35c41d53a5108e33900bac519437e,
with the workflow's users, tmpfs paths, resource limits, no-network/read-only
flags and capability set. The source snapshot was 98914377 plus only the
capability fixture correction. This does not replace a green required CI
suite on the newly published head or certify a new release image.

Logs are retained at /var/tmp/kelion-upgrade-intent-proof.1aslhLOA:
red.log, old-control-red.log, green-final.log, combined-final.log,
doctor-sequence-red.log and doctor-sequence-green.log. The first attempted
combined green log (green.log) contains three harness failures caused by Bash
dynamic-scope variable shadowing; the fixture arrays were renamed and the
strict stderr assertions retained before green-final.log. It is not reported
as a passing run.

Final log SHA-256:

- combined-final.log:
  271a4ddaf71e53509d3ef7c0d54df4afeb2497efd7b37626c17a6129f9414e1f
- doctor-sequence-green.log:
  f439a9245b12f4f302f7911463342c0ab77fbaf0779265956434be90ec0d0c81

## Responsibility and closure

The implementing agent owns the pause discriminator/upgrade race correction,
the foreign-owner fixture regression and this before/after evidence. The peer
reviewer independently checked bootstrap cutpoints and the ownership control.
The release coordinator owns final integration, new required CI, recording
the independently authorized #666 pause intent, and the locked deployment.
No timer state, locally passing test or review resolution substitutes for
that authorization or for the required CI and deployment receipt.

At this checkpoint the code and isolated regressions are fixed and frozen.
Operational closure remains conditional on the published-head required CI,
verified release/upgrade receipts, and explicit safe resumption of #666.
This document does not assert that deployment, upgrade or job #666 completed.

## Frozen source SHA-256

- deploy/upgrade-constructor.sh:
  1e42a5b4772598990180367c0bf4e6c9f89b02fc30f111b3363fd7fb244d0899
- deploy/lib/runtime-config-cutover.sh:
  ebc12ea5dc03064778a281f65e04e8cf5631841caaaf53bb4ab97af56a99c95e
- deploy/lib/constructor-pause.test.mjs:
  6fd5f10969e02e1828bb3bb0717eeef689cfa995b1a0f15cd6c4d27d7a3e7bc3
- deploy/lib/constructor-pause-bootstrap.test.mjs:
  2c721fce30cc51eaa162ce9c7bb3f181e345691566ce25322abd9e4fed1e712e
- deploy/lib/doctor-runtime-capability.test.mjs:
  8958d9f0fba37546862b6fbf45b9e03d513b948135def602731f9b8adad4873c

The new helper/upgrade hashes must be used by the final canonical release
bundle. The Doctor guard and worker/publisher source bytes were not changed
by these corrections, so their capability tuple was not weakened or replaced.
