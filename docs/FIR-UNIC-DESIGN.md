# FIR UNIC — design complet (Kelion, o singură minte continuă)

Ordinul lui Adrian (5 iul 2026): un singur fir continuu, legat permanent la caiet+memorii,
care vorbește ȘI lucrează el însuși — ca Claude Code, dar pe server. Fir + ajutoare la
paralel; poartă umană doar la publicare; ZERO dublură (înlocuiește serviciile vechi).

## 0. Arhitectura de azi (ce se rescrie)
- `kelion-bridge.mjs` (498 l) = VOCEA: `claude -p` streaming, `--resume` (memorie 40 ture/12h),
  DINADINS fără unelte; deleagă la 7 agenți interni prin `[AGENT id: task]`.
- `kelion-builder.mjs` (225 l) = CONSTRUCTORUL: polează ordine la 20s, worktree izolat per job
  din `origin/master`, `claude --permission-mode acceptEdits`, comite pe `vps-<id>`, push,
  `ready-deploy`. CAP=3 paralel.
- `kelion-deployer.mjs` (94 l) = publică (`railway up`) la „da". `kelion-paznic` = watchdog.
- Backend (chat.ts): admin → [EXECUT] → work order → builder. Predarea = unde se pierde firul.

## 1. Arhitectura FIRULUI UNIC
- UN serviciu nou: **`kelion-agent.mjs`** înlocuiește `kelion-bridge` + `kelion-builder`.
- `kelion-deployer` + `kelion-paznic` RĂMÂN (execuția deploy la „da"; repornirea).
- Firul principal = o sesiune Claude continuă (memorie), cu UNELTE (allow-list) — vocea +
  dirijorul într-o singură minte. Munca grea → ajutoare temporare (sub-agenți), apoi dispar.

## 2. Cele 10 goluri — rezolvate

### G1. Separarea VOCE ↔ MUNCĂ (miezul)
Agentul are DOUĂ canale de ieșire, niciodată amestecate:
- **Voce la Adrian (chat):** DOAR replici scurte, calde, persona Kelion. Mecanism curat:
  agentul rostește către Adrian NUMAI printr-o unealtă dedicată `say_to_adrian(text)` (sau
  eticheta `[SPUN: ...]`); TOT restul (raționament, tool-use) NU ajunge în chat.
- **Muncă pe monitor:** fiecare tool_use (Edit/Bash/Read) → `/api/bridge/activity` (consola
  live), ca acum la builder. Persona impune: „replica vorbită = 1-3 fraze calde; toată munca
  tehnică prin unelte (pe monitor), niciodată în replica vorbită".

### G2. Responsivitate (fir principal = voce+dirijor; muncă grea = ajutoare)
- Firul principal citește mesajul, decide. Lucru UȘOR/scurt → inline. Lucru GREU/lung →
  **spawn ajutor** (sub-agent în worktree izolat) care duce munca streamând pe monitor, iar
  firul principal răspunde imediat lui Adrian („mă ocup, urmărește monitorul") și rămâne LIBER
  pentru mesajul următor. Chatul nu așteaptă niciodată după o compilare de minute.

### G3. Atașamente
- Fișierele lui Adrian (base64) vin cu mesajul → scrise pe disc → agentul le citește (Read).
  Se păstrează mecanismul `saveFiles` actual.

### G4. Memoria firului
- Memorie scurtă = sesiunea continuă (ca `--resume`, refresh 40 ture/12h).
- Memorie durabilă+comună = **caiet + memorii, injectate la FIECARE tură** (nu doar la start) și
  SCRISE după fiecare pas. Caietul = adevărul persistent; sesiunea = firul viu.

### G5. Izolare la paralel
- Fiecare ajutor lucrează în propriul `git worktree` (`/root/kelion/work/<id>` din
  `origin/master`) + ramură — ca acum. Paralel fără coliziune.

### G6. Reziliență + paznic
- Agentul e imun la crash (try/catch, bucla nu moare). systemd repornește. **Paznicul RĂMÂNE**
  și-l repornește dacă se blochează (fără puls). La repornire: reîncarcă caietul → continuă
  firul. Starea (cerințe deschise, id sesiune) persistată (Postgres/fișier).

### G7. Ce servicii rămân
- RĂMÂN: `kelion-deployer` (deploy la „da"), `kelion-paznic` (watchdog).
- ÎNLOCUITE: `kelion-bridge` + `kelion-builder` → `kelion-agent`. Șterse (zero dublură).

### G8. Calea [EXECUT] din backend
- Acum: chat.ts → [EXECUT] → work order → builder. La fir unic: agentul lucrează DIRECT.
- Backend păstrează: puntea WS (chat↔agent), poarta de deploy (`ready-deploy`/`deploy-pending`/
  `triggerDeploy`), endpointurile de monitor. SCOATE: dispecerizarea [EXECUT]/work-order
  (agentul decide+acționează). Migrare atentă, nu bruscă.

### G9. Securitate/scop
- Allow-list SCOPAT pe comenzi sigure, nu blanket: `Bash(git:*)`, `Bash(npm:*)`, `Bash(node:*)`,
  `Bash(cd:*)`, `Read`, `Edit`, `Write`, `Grep`, `Glob`. Comenzi distructive (rm -rf /, systemctl,
  dd, mkfs, chown pe sistem) — NEPERMISE fără confirmare. Lucrul limitat la `/root/kelion/repo`,
  `/root/kelion/work/*`, `sandbox`. Conținut neîncredere (web/fișiere/email) nu poate declanșa
  distrugere (scop + poarta la publicare = rază de explozie mică).

### G10. Test izolat + cost
- Test: `kelion-agent-test` cu secret/coadă de TEST, NU chatul live al lui Adrian. Îi dau mesaje
  de probă, verific: vorbește cald? lucrează? ține minte? — izolat. Doar după PASS → cutover.
- Cost: monitorizez consumul abonamentului (sesiune + ajutoare = tokeni). Plafon: nu spawna
  ajutoare la nesfârșit (max N paralel, ca CAP=3 acum).

## 3. Plan pe faze (cutover fără rupere)
- **Faza 1:** designul ăsta (revizuit de Adrian). ← acum
- **Faza 2:** scriu `kelion-agent.mjs` (fișier nou, NU atinge serviciile live).
- **Faza 3:** test izolat (`kelion-agent-test`, secret de test) — vorbește+lucrează+ține minte.
- **Faza 4:** cutover — opresc `kelion-bridge`+`kelion-builder`, pornesc `kelion-agent`; fereastră
  de rollback 24h (backup-2026-07-05_14h13); apoi șterg vechiturile (zero dublură).

## 4. ANALIZA ATENTĂ DUPĂ SCRIERE (riscuri găsite recitind designul)

### R1. NECUNOSCUTA CRITICĂ: Agent SDK + abonament
Designul presupune „sesiune continuă". Dar Claude **Agent SDK** merge pe cheie API, iar Adrian
vrea EXCLUSIV abonamentul (`CLAUDE_CODE_OAUTH_TOKEN`, zero cost API). **De verificat înainte de
Faza 2.** Dacă SDK cere cheie API → designul se schimbă la varianta (b):
- (b) `claude -p --resume` per tură DAR CU UNELTE + munca în aceeași sesiune. Memoria e continuă
  (ca acum), procesul e per-tură. Mai mic, DEJA compatibil cu abonamentul (bridge-ul face deja
  `--resume`). Practic: dai chatului-creier unelte + îl lași să lucreze direct, fără builder
  separat. **Recomand să pornim de la (b) — risc mic, refolosește ce merge.**

### R2. Riscul de SCURGERE voce↔muncă
Un agent care lucrează „gândește cu voce" („let me check X"). Dacă scapă în chat, Adrian vede
tehnică, nu voce. Mitigare: separare STRICTĂ prin unealtă dedicată de vorbire (`say_to_adrian`),
tot restul = doar monitor. E un risc real de implementare — trebuie testat dur (G10).

### R3. Responsivitate pe model per-tură
Dacă mergem pe (b), o tură care lucrează greu BLOCHEAZĂ sesiunea (sessionBusy) → mesajul următor
așteaptă. De-aia munca grea → ajutor (G2), iar firul principal rămâne pentru chat. Corect, dar
trebuie respectat strict.

### R4. Fereastra de cutover
Înlocuirea a 2 servicii live cu 1 + schimbarea backendului = risc. Plasa: test izolat complet
(Faza 3) + rollback 24h. Există o fereastră scurtă la cutover unde chatul poate clipi.

### R5. Backendul se schimbă și el
Scoaterea [EXECUT]/work-order din chat.ts atinge cod LIVE. De făcut cu grijă, în același lot,
verificat, cu poarta de deploy intactă.

## 5. Concluzia analizei
Designul e acum COMPLET la nivel de arhitectură. **Dar R1 (SDK vs abonament) e blocant** — se
verifică ÎNAINTE de a scrie cod, altfel construim pe nisip. Recomand: pornim de la varianta (b)
(claude -p --resume + unelte), care e sigură și mică, și escaladăm la SDK doar dacă merge pe
abonament. Cutover doar după test izolat + cu rollback pregătit.
