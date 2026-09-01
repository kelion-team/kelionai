# Request: Credit adjustment for billing caused by software bug (idle voice sessions, £419.91)

## Summary

I am requesting a credit adjustment for Gemini API charges caused by a software bug in my application. The bug kept Gemini Live voice sessions open indefinitely during silence, billing ~£7/hour of idle audio with no user interaction. The bug has been fixed and sealed with a test. The charges (~£419.91 in August 2026) were entirely unintended and caused by a missing idle timeout in my code.

## Billing account

- **Account**: My Billing Account (Paid Tier 1)
- **Tier cap**: £188.02/month ($250)
- **Spent Aug 1-23**: £419.91
- **Project**: Kelion
- **Status**: Service paused (tier cap exceeded)

## The bug

My application (Kelion — a live AI assistant at kelionai.app) uses Gemini Live for real-time voice. The voice session opens a WebSocket to Gemini Live and bills per-minute for audio input/output.

**The bug**: The session had NO idle timeout. When a user stopped talking, the session stayed open indefinitely — Gemini Live continued billing ~$0.1167/minute of silence ($7/hour) even with no speech, no interaction, and no user present.

**Measured impact** (from our internal cost_events database):
- Aug 23: 1009 minutes (16.8 hours) billed on voice — impossible for a human to talk 16.8h/day
- Aug 22: 741 minutes (12.3 hours) — $163.84
- Aug 20: 462 minutes (7.7 hours) — $91.19
- August total: 2869 voice minutes, ~$588 estimated (~93% of total API spend)
- Sessions ran overnight (22:00 → 12:15 next day = 14 hours of idle billing)

The user did NOT use voice for 16 hours. The session was left open and billed silence.

## The fix (implemented and deployed)

- Added idle timeout: 15 seconds of silence → session auto-closes
- Sealed with a unit test that fails the build if the timeout value changes without owner approval
- Deployed to production on Aug 23, 2026
- Commit: https://github.com/kelion-team/kelionai (master branch, commits a2b1df78, cd85e89d, d4a6feca, 5433dc5d)

## Why this qualifies for credit adjustment

1. **Unintended usage**: The charges were caused by a software bug, not by actual usage. No human can talk 16.8 hours/day — the sessions were idle and billing silence.

2. **Bug fixed**: The root cause is identified, fixed, tested, and deployed. It will not recur.

3. **Precedent**: This forum has documented similar cases (infinite loop bugs, runaway sessions) where Google issued credits for unintended charges caused by software bugs.

4. **Good faith**: I am reporting this transparently with full technical evidence, not disputing legitimate usage.

## Request

I request a credit adjustment for the portion of August 2026 charges caused by the idle voice session bug (~£390 of the £419.91 total, based on 93% of spend being idle voice billing). I am not requesting adjustment for legitimate chat/image/search usage (~£30).

The tier cap pause is currently blocking my application entirely. If a credit adjustment is possible, it would also restore service.

Thank you for your time.
