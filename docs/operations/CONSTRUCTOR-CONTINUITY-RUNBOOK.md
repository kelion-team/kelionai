# Constructor continuity runbook

Every product request is one durable `build_jobs` record. It is not complete
because a worker says so: the terminal proof is the matching master commit,
green gate receipt, and verified live version recorded by the release service.

## What Admin and chat must show

`continuity` is the canonical read-only projection on the Constructor Admin
list, the live monitor, and the `constructor_status` chat tool. It shows the
current checkpoint, every ordered step, last heartbeat/staleness, retry budget,
structured escalation, and terminal proof. A stale heartbeat is a measured
warning; it is never represented as success or silently dropped.

## Recovery rules

1. A worker/publisher/release worker renews its lease or writes progress. A
   silent Constructor worker is requeued by the server watchdog after fifteen
   minutes; leases make retry/resume idempotent.
2. A failed execution creates or reopens a `constructor_incidents` record with
   cause, evidence, responsible actor, next action and, after a verified fix, a
   regression lesson.
3. Retry resumes the same durable order. Do not create a duplicate order for a
   retry. At three exhausted attempts it stays blocked with its escalation.
4. `done` is valid only at `deployed` with a commit, green CI and live version.
   Otherwise it remains in progress or blocked and must not be described as
   published.

## Operational response

Read `continuity.escalation` first. Execute its `nextAction`, preserve the
evidence, then retry only when the root cause is changed. Verify the final
`proof` in production before reporting completion to a customer.
