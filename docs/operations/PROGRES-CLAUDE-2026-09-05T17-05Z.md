# Progres verificat — executor Claude, 2026-09-05T17:05Z

Adaugă la checkpointul canonic; nu îl înlocuiește. Toate afirmațiile de mai jos
sunt măsurate direct, cu ora măsurării.

## Deblocare: lucrarea pregătită era necomisă pe VPS

Executorul GPT/Codex a atins limita Spark (100% consumat, resetare ~20:03
Londra) înainte să comită. În repo-ul autoritativ
`/var/tmp/kelion-maintenance.yQKdV92n/repo` erau **29 de fișiere necomise** cu
cele patru corecții deja raportate ca pregătite. Le-am publicat prin fluxul
protejat, fără să rescriu nimic, rebazate curat peste ce era deja împins.

- fixture capabilitate: scrie octeții din conținut în loc de `copyFileSync`,
  deci nu mai moștenește proprietarul `runner` și nu mai pică `EPERM`;
  verifică explicit uid, gid, mod, `nlink` și hash;
- Fastify P0: `onClose` înregistrat înainte de `listen`, ceea ce elimină
  `FST_ERR_INSTANCE_ALREADY_LISTENING`;
- granița de înregistrare pentru statisticile admin, cu migrare și teste;
- patru fișe de incident și trasabilitatea cerințelor aprobate.

## Defect găsit și reparat de mine

Modificarea legitimă din `deploy/lib/runtime-config-cutover.sh` — verificarea
inline a stării de pauză înlocuită cu `worker_pause_state` — a schimbat octeții
helperului, dar amprenta `sha256` fixată rămăsese cea veche în `deploy.sh` și
`deploy/instaleaza-constructor.sh`. Două teste de contract picau în `verify`:
`bootstrapul recovery acceptă numai helperul b911 și candidatul compatibil
pin-uit` și `deploy-ul migrează one-shot numai deadlockul GC al activării`.

Am recalculat amprenta în ambele fișiere. Controlul nu este slăbit: acceptă în
continuare exact un singur helper, acum cel real. Ambele teste trec.

## Verificat după merge și deploy

- PR #1662 îmbinat. Toate verificările obligatorii verzi, inclusiv
  `container-isolation`, care picase toată ziua.
- **master = live = `2949de2af154`**, confirmat pe `/api/release-proof`:
  `ready=true`, `candidate=false`, `sideEffectsActive=true`.
- `upgrade-constructor`, run `33976606380`: **success**. Cele trei binare de pe
  VPS sunt acum identice cu masterul, verificat prin sha256:
  `codex-worker`, `constructor-publisher`, `constructor-release`.
  Timerul workerului este `enabled`; zero marcaje de pauză rămase.
- Worker viu: `self-test: TRECE`, iar claim-ul întoarce `no_claimable_job` —
  comportamentul corect după migrarea terminală, fără reluare automată.
- Alarmă falsă exclusă: două răspunsuri `522` la `/api/release-proof` au fost o
  pană trecătoare Cloudflare→origine. Prin proxy-ul local originea răspundea
  `HTTP 200 în 0,010 s`, iar din exterior trei încercări consecutive au dat
  `200` sub 0,3 s. Serverul era sănătos: încărcare 0,26, 78 GB liberi, toate
  containerele `healthy`.

## Ce rămâne — singurul pas până la proba completă

`constructor:666` cere **Reia explicit** din Admin, pe același ordin. Regula
canonică interzice reluarea automată a unui ordin deja revendicat, iar ruta
este autentificată ca admin, deci acțiunea aparține ownerului.

După Reia, urmărirea până la capăt: execuție, teste, PR propriu al ordinului,
merge, deploy automat și rezultat vizibil în aplicația live. Abia acel traseu
complet permite declararea Constructorului ca funcțional. Până atunci nu este.

## Limite respectate

Nu am rescris software, nu am schimbat arhitectura, stackul, motorul sau
configurația. Nu am adăugat modele, provideri sau costuri. Nu am șters markere
ori jurnale. Nu am ocolit protecțiile: tot ce a intrat a trecut prin PR și
verificări. Nu am lucrat într-un worktree Windows: modificările au fost făcute
și publicate din repo-ul autoritativ de pe VPS.
