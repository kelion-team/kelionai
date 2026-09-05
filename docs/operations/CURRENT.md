# Checkpoint operațional curent

Actualizat: `2026-09-05T15:00:00Z` (16:00 Londra) — executor: Claude (Opus 5)

## Coordonare Claude ↔ GPT/Codex — răspunde tot aici

Am preluat pentru **citire și analiză** la `14:45 UTC`. **Nu am modificat niciun
fișier de cod, nu am pornit niciun deploy și nu am atins ordinul
`constructor:666`.** Singura mea scriere este acest checkpoint.

Motivul: PR **#1662** (`fix/doctor-vps-live-20260905`) a fost deschis la
`14:45:45 UTC`, cu trei minute înainte să încep, cu verificările în curs. Am
confirmat independent că tratează exact cauza pe care am măsurat-o, deci a
lucra în paralel ar însemna doi executori pe același ordin.

**Întrebare:** duci tu #1662 până la capăt, sau predai? Dacă îl duci tu,
actualizează checkpointul la progres și ignoră pașii de mai jos. Dacă predai,
scrie aici ce rămâne și preiau de la pasul următor.

## PROBLEMĂ ACTIVĂ pe #1662 — `container-isolation` a picat

Rularea `33972768310`, jobul `container-isolation`, pasul **«Doctor scope,
semantic AST și capabilitate instalată»**: `5 tests, 0 pass, 5 fail`.

Toate cele cinci eșecuri din `deploy/lib/doctor-runtime-capability.test.mjs`
au aceeași cauză:

```
EPERM: operation not permitted, copyfile
  '/proof/deploy/lib/doctor-repair-scope.mjs'
  -> '/opt/kelion-codex/lib/doctor-repair-scope.mjs'
```

Subteste căzute: `both installed guard copies measure the exact root-owned
supervisor tuple` (`:41`), `semantic parser runtime is non-root, offline,
readonly and mounts no host credentials or parser from the worktree` (`:45`),
`a running old process cannot advertise replacement bytes as the new
capability`, plus încă două.

**Ipoteză, marcată explicit ca ipoteză, nu cauză demonstrată:** containerul
rulează `--user 0:0` cu `--cap-drop ALL --cap-add CHOWN`, deci root este fără
`CAP_DAC_OVERRIDE`. Dacă testul creează tupla instalată root-owned fără bit de
scriere și apoi copiază în ea, root nu mai poate ocoli permisiunea și primește
EPERM. Montarea nu este cauza: `/opt` este tmpfs
`rw,nosuid,nodev,noexec,mode=0755,size=8m`, deci permite scrierea. Nu am
verificat testul în cod; verificarea îți revine.

## Stare verificată de mine (măsurători directe, 14:47–14:52 UTC)

Checkpointul anterior, `07:39:02Z`, era depășit: indica master/live `c3ae5b6e`.

- **Master și aplicația live: `a32bab142cc2cf1eca2b514c92732308232155b2`**,
  identice. `/api/release-proof` la `14:47 UTC`: `ready=true`,
  `candidate=false`, `sideEffectsActive=true`, `activeCommit` exact a32.
  **Nu există nimic gata de publicat peste a32**: master este deja live, iar
  #1662 nu a trecut verificările.
- PR #1658 este **îmbinat**, head `847312f2`, toate verificările obligatorii
  verzi.
- **Infrastructura Constructorului este recuperată.** Citire read-only pe VPS:
  `kelion-codex-worker`, `kelion-constructor-publisher` și
  `kelion-constructor-release` au timer **enabled** și ultimul rezultat
  **success**; `kelion-constructor-model-control` este **active**;
  `/run/kelion/runtime-config-recovery.ready` este **prezent**; niciun marker
  blocant — doar `constructor-unit-migration.pending.abandoned*`, în afara
  globului `constructor-*`. Recuperarea a fost făcută de `vps-run`
  **33954585185**, `08:11:30`, success.

## Cauza blocajului lui `constructor:666` — demonstrată

Ordinul rămâne `queued`, cycle0, attempts2, fără pipeline/PR/deploy. Din
jurnalul workerului, ultima rulare, `13:41:30 CEST`:

```
codex-gates: VERDICT schema=1 exit=1
codex-gates: worktree-ul conține node_modules backend necontrolat
```

Poarta respinge worktree-ul poluat cu `node_modules` necontrolat. Imaginea
gate are `org.opencontainers.image.revision = a32bab14`, adică exact masterul
activ — **nu este o nepotrivire de versiune**.

**Cauza istorică din checkpointul de la 07:04 — oprirea la capturarea stării
serviciilor înainte de înlocuirea fișierelor — NU mai este cauza curentă.**
Verificată și exclusă: serviciile sunt sănătoase, journalele s-au încheiat,
ACL-ul runtime este canonic.

Confirmat că #1662 acoperă această cauză: diff-ul conține fixture care creează
`node_modules` pe secțiuni și asertează worktree-ul poluat
(`?? backend/node_modules`, `?? frontend/node_modules`) plus curățarea lui.

## Ce rămâne pentru acceptare

Constructorul **nu** este funcțional capăt-la-capăt. Lipsește proba completă:
o cerere reală din chat/Admin care produce o modificare, trece verificările,
ajunge prin fluxul protejat în master, este publicată automat și are
rezultatul confirmat live. Niciun ordin nu a parcurs încă acest traseu.

## Următorii pași, în ordine

1. Repară eșecul `container-isolation` de mai sus; #1662 trece verificările și
   este îmbinat prin fluxul protejat, fără ocolire.
2. Deploy automat pe noul master; se confirmă `activeCommit` pe
   `/api/release-proof`, nu doar rularea verde.
3. Dispatch **nou** `operation=upgrade-constructor` din `vps-run.yml`, de pe
   noul master, după release. Se verifică hashes, controller/socket,
   heartbeats și încheierea journalelor.
4. **Reia explicit** același `constructor:666` — fără ordin nou, fără
   reexecuție automată a unui ordin deja revendicat.
5. Se urmărește ordinul până la teste, PR, merge, deploy și rezultat vizibil
   live. Abia atunci Constructorul poate fi declarat gata.

## Blockers / owner action

Nicio acțiune cerută ownerului. Singura decizie deschisă este cea de
coordonare din capul documentului.

## Regulă permanentă de continuitate: Claude ↔ GPT/Codex

Continuitatea este obligatorie în ambele sensuri și folosește **acest** fișier
ca unic checkpoint canonic, nu jurnale paralele cu stări concurente. Fiecare
executor îl actualizează după progres semnificativ, la eșec sau blocaj și
înainte de predare ori încheiere — nu doar la final, pentru ca o întrerupere
sau o limită atinsă să lase un punct recent de reluare.

Handofful conține: obiectivul și ultimele decizii ale utilizatorului;
checkoutul, ramura, commitul și modificările necomise; ce este verificat, cu
dovezi și momentul verificării; ce a eșuat, cu cauza demonstrată sau ipoteza
marcată ca atare; operațiile încă active și cum se verifică; lucrul rămas și
pașii următori în ordine; deciziile cerute utilizatorului; legăturile canonice.
Fără secrete și fără loguri sensibile.

Executorul care preia citește întâi acest checkpoint, verifică starea actuală
și continuă fără să ceară utilizatorului să reconstruiască discuția. Nu se
presupune acces la conversațiile celuilalt și nu se presupune că o operație în
desfășurare a reușit.

## Prioritate imediat după finalizarea Constructorului

Prima prioritate devine **«Apelarea asistentului prin Kelion»**. Definiția
integrării se recuperează din documentația existentă; mecanismul tehnic nu a
fost clarificat și nu se presupune un anumit API sau mod vocal. Nu se începe
implementarea înaintea finalizării Constructorului.

Asistenții interconectați și celelalte funcții noi rămân pentru etape
ulterioare.

La orice schimbare de model, modalitate voce/text, sesiune sau executor, se
recitesc obligatoriu acest checkpoint și regulile de livrare, se identifică ce
este verificat, ce a eșuat și pasul următor, și se verifică operațiile active
înainte de reluare.

## Canonical links

- PR în lucru: https://github.com/kelion-team/kelionai/pull/1662
- Verificarea căzută: https://github.com/kelion-team/kelionai/actions/runs/33972768310
- PR îmbinat anterior: https://github.com/kelion-team/kelionai/pull/1658
- Recuperare Constructor: https://github.com/kelion-team/kelionai/actions/runs/33954585185
- Live: https://kelionai.app/
- Proba exactă: https://kelionai.app/api/release-proof

## Limite obligatorii

VPS-ul existent, OpenCode și Big Pickle rămân soluția autorizată. Nu se adaugă
modele, provideri, costuri sau privilegii. Nu se rescrie software-ul, nu se
schimbă arhitectura, stackul, motorul Constructorului sau configurația
aprobată. Testele cu layout de host rulează numai în containere izolate,
niciodată asupra directoarelor hostului. Nu se șterg markere sau jurnale
pentru a afișa succes și nu se declară funcțional ce este doar planificat.
Scanarea snapshot+dist este separată de istoria Git, care păstrează 11
constatări preexistente; nu se declară istoricul curat.
