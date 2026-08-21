# Kelionai — project guide for Claude (auto-loaded)

You are working on **Kelionai**, a live AI assistant (3D avatar, voice, vision,
Google skills) deployed at **kelionai.app**. This file is your standing context.

## READ THIS FIRST, ALWAYS
**On a fresh session, read `AI-HANDOFF.md` in this folder BEFORE doing anything
else.** It is the single, actively-maintained source of truth: full architecture,
every route/service/component, the brain-routing rules, the database schema, all
env vars, the money flows, the "phantom deploy" postmortem + permanent fixes, CI
workflows, what's dead code vs. live code, and the current state of the project.
`HANDOFF.md` and `STATUS.md` in this folder are OLDER and PARTLY OUTDATED —
`AI-HANDOFF.md` supersedes them; don't treat them as current without checking.

**Then read `RAMAS-DE-FACUT.md`** — the owner's single list of what is NOT done
and what does NOT work, with the evidence for each row (30 iul: „pune pe listă
tot ce nu ai făcut din proiect, tot ce nu merge, că mă ia capul"). Cross off a
row only with a PR *and* a live check; add new rows the moment you find them;
write „nu pot verifica" rather than „e ok" when you cannot prove it.

## THE DOCUMENT IS LIVE — YOU MUST KEEP IT CURRENT
If you change code, architecture, rules, or the project's state, **update the
relevant section of `AI-HANDOFF.md` (and its §13 "Starea") before you finish
your session/PR.** There is no other auto-update mechanism — this convention is
the mechanism. A stale handoff doc is worse than none: it misleads the next AI.

## THE FOUR RULES THAT COST THE OWNER A WHOLE DAY (30 iul 2026)

Every one of these is written from a real failure of that day, not from theory.
He asked, at the end: „se poate să schimbi modul ăsta de lucru defectuos?" These
are the answer. Read them before you report anything to him.

1. **A value that did not come from a successful measurement is „nu pot
   verifica" — never a number, never a verdict.** Three times in one day the
   panel *asserted* a state it had never measured: „Cardul Kelion AI: necreat"
   (the code had never looked for cards), „£0.00" (the field started at 0 and
   stayed 0 when the request failed), and three red ❌ produced by one failed
   call. Same shape every time: **a failed read presented as an established
   fact.** If you cannot measure it, say so.

2. **When the owner contradicts a report of yours, the FIRST place you look is
   your own code that produced that report.** He said „toate cheile au fost
   scrise de zeci de ori" — twice. The first time I built a diagnostic tool
   (i.e. „go check again"). Only the second time did I open `config.ts`, where
   the answer had been all along: three keys had name aliases, the three that
   failed had none. He was right both times. He is usually right about his own
   system — he is the one looking at it.

3. **Never run a bulk operation on something you have not looked at.**
   `git add -A` on a conflicted merge committed `<<<<<<<` markers into five
   files, including running code. A reused CSS class name tore a live page
   apart. Both were „quick". Both cost more than looking would have.
   `scripts/verifica-sintaxa.mjs` now fails the build on committed conflict
   markers in **every** file type — but the rule is the point, the gate is only
   the net.

4. **Before asking him to do anything by hand, prove from code or from live that
   it is actually needed.** I sent him hunting through Stripe's permission list
   for `Account: Read` — then discovered the app never needed it, because the
   real blocker was my own `if` around the card lookup. His time is not the
   place to test a hypothesis.

## Working rules (non-negotiable) — full detail in AI-HANDOFF.md §1
- **Reply to the owner in Romanian.** Owner = adrianenc11@gmail.com, sole admin.
- The owner **tests live** on kelionai.app, not locally. After each fixed
  requirement: **build → deploy → VERIFY LIVE with real proof** (curl, decode,
  measurement) — never declare something "done" without evidence.
- **Production = master, 100% in sync, always.** Nothing may ever publish code
  older than `origin/master` (see the "phantom deploy" lesson, AI-HANDOFF.md §6).
- Keep the chat/voice path **low-latency** (target: first word under 1s).
- Fix by rewriting the small responsible module — no band-aid patches.
- Don't touch `C:\Users\adria\Downloads\k` — that's the OLD archived project.


## LEGEA ANTI-HARDCODARE (owner, 16 aug 2026 — LEGE pentru ORICE AI care lucrează aici)
Ordinul verbatim: „creiaza legi si mecanisme automate de cautare a hardocodului
pe aplicatie, si explicat oricarui ai vine foarte clare ca nu e admis hardcodat
pe aplicatie".
- **NU e admis hardcodat pe aplicație**: nicio cifră de bani, prag, tarif, nume
  de model AI sau stare arătată omului nu se scrie de mână în cod — totul vine
  dintr-o sursă VIE (config/env/kv/DB/server/unealtă). O cifră scrisă de mână
  minte în ziua în care realitatea se schimbă (măsurat: tarife inventate
  24/48/200 vs realele 6/12/50; modelul pensionat care a tăcut zile întregi).
- **Poarta automată**: `node scripts/verifica-hardcodari.mjs` — pică build-ul
  pe hardcod negăzduit. O rulezi la fiecare livrare, ca pe tsc.
- **Excepția se declară PE LINIE, cu motiv**: `// hardcod-permis: <motivul>`.
  Fără motiv scris lângă faptă, poarta pică. Nu există listă ascunsă.
- În creierele live, legea e în promptul de sistem (LEGILE ADMINULUI, chat.ts):
  LEGEA FAPTEI + LEGEA MĂSURĂTORII + LEGEA ANTI-HARDCODARE — plus POARTA
  FAPTELOR care demască automat pretențiile fără unealtă executată.

## Layout (see AI-HANDOFF.md §2 for the complete file-by-file map)
- `backend/` — Node + Fastify + TS. Routes in `src/routes/`, services in `src/services/`.
- `frontend/` — React + Vite + TS. `src/pages/Stage.tsx`, `src/components/ChatPanel.tsx`.
- `bridge/` — the VPS worker (`kelion-bridge-linux.mjs`) + autonomous repair/deploy scripts.
- `Dockerfile` — imaginea aplicației (gazda: VPS propriu).

## Build & deploy
```bash
# from the repo root, on a branch:
# edit → commit → push → PR → merge to master → publicare pe gazdă (VPS) → VERIFY LIVE
```
Full CI/workflow list, env vars, DB schema, brain-routing rules, and current
project state: **`AI-HANDOFF.md`**.
