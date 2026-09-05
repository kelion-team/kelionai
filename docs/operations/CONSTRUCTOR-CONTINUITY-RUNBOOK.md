# Constructor continuity runbook

Every product request is one durable `build_jobs` record. It is not complete
because a worker says so: the resolved live proof is the same commit on
`master`, independent GitHub CI recorded as `green`, and the verified live
version persisted by the release service. A `local_gates` receipt proves only
that the isolated local checks passed; it is not GitHub CI and cannot close the
request.

## What Admin and chat must show

`continuity` is the canonical read-only projection on the Constructor Admin
list, the live monitor, and the `constructor_status` chat tool. Its current
contract is `state`, `checkpoint`, `message`, `nextAction`,
`retry: { mode: 'automatic', attempts }`, `finalProof`, plus the persisted
`progress` and `activity` projection returned by the observability service.
`attempts` is an observed counter, not a retry budget or a terminal threshold.
`nextAction` is populated only while `state` is `waiting_external`; internal
recovery must not manufacture a manual action.

Heartbeat, plan, acceptance criteria, risks, dependencies, escalation
condition and evidence belong to the separate canonical work card. Worker
readiness and its last heartbeat belong to the worker summary. Admin may render
those objects next to `continuity`, but they are not fields of `continuity`.

## Recovery rules

1. A worker, publisher or release worker renews its lease or writes progress.
   A silent Constructor worker is requeued by the server watchdog; the retry
   deadline and exponential backoff are persisted, so restart or refresh does
   not lose the schedule and lease-based resume remains idempotent.
2. A failed execution creates or reopens a `constructor_incidents` record with
   cause, evidence, responsible actor, next action and, after a verified fix, a
   regression lesson.
3. Retry resumes the same durable order. Do not create a duplicate order for a
   retry. Recoverable worker, publisher and release failures continue
   automatically with persisted backoff and no internal attempt count that
   turns them into a terminal failure. The attempt counter remains diagnostic.
4. Execution may pause only for a real external-authority prerequisite, such
   as interactive provider login, OAuth consent or branch-policy authority.
   Persist `external_action_required`, expose one exact `nextAction`, keep the
   same order, and resume it automatically when readiness returns.
5. `local_gates` and GitHub CI are separate checkpoints. Local gates authorize
   the signed handoff; only the authoritative GitHub result may set CI to
   `green` and allow the protected merge/release path to advance.
6. Administrator cancellation is persisted as status/stage `cancelled` with
   progress `cancelled_by_admin`. It is a resolved terminal outcome, distinct
   from failure and from deployed completion, and it must not be retried
   automatically.
7. `done` is valid only at `deployed`, after the green-CI merge/release chain,
   with both commit and live version persisted. Otherwise the request remains
   active, recovering or waiting for external authority and must not be
   described as published.

## Operational response

### Pinned e65 upgrade recovery

The current armed journal owns release
`e65f0112aa2265fea12bfd248b8da645b428017a`. Do not delete the journal or
rewrite its activation snapshot. The reviewed master workflow applies only
two digest-pinned installer corrections: the systemd count is nine, and
`staging` is provisioned as `root:kelion-handoff 2770` under a parent kept at
`0750`. It does not replace any of the 23 e65 runtime artefacts. The temporary
installer must match the original and corrected hashes recorded in
`CURRENT.md`; executor provenance names both corrections separately.

Use a new `upgrade-constructor` dispatch after the hotfix is merged, not a
rerun of the old workflow. Before recovery, verify the queue read-only:
queued/running must be absent, including archived and backoff candidates.
The saved activation vector restores all three services' markers and timers.
After e65 recovery completes, deploy the hotfix application and perform the
canonical upgrade again for its full worker/publisher tuple. Do not create
or resume a pilot between these two upgrades: the original e65 worker does
not preserve the handoff child setgid. Publication is fully automatic under
the owner's explicit instruction: there is no internal administrator approval
route or pilot approval click. The publisher must still verify green checks
for the exact head and the actual GitHub protection; the current zero-review
policy is not permission to bypass failing checks or modify branch protection.

For a standalone spool repair, `repair-spool-layout` requires inactive
Constructor services and no pending upgrade. It validates the parent and
children, provisions missing `retired`/`staging` directories, rejects links
and non-directories, keeps the parent non-group-writable, and preserves all
existing handoff contents. Do not repair this by making the parent writable.

Read `continuity.state`, `message` and the persisted activity first. For
`recovering`, preserve evidence and let the scheduled retry advance the same
order; a routine manual retry is a contract violation. For `waiting_external`,
execute only the single `nextAction` shown, then verify that readiness causes
automatic resume. For `cancelled`, report the cancellation without presenting
it as a failure or deployment. Report completion only when
`finalProof.complete` is true and its commit/live version match production.
