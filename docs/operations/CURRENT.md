# Checkpoint operațional curent

Actualizat: `2026-09-01T13:46:25Z`

## Stare verificată

- `origin/master` este la `d5c88b5173b7a3a8933856f7f0b996f91e801ef2`.
- AI Constructor rămâne separat de Kelion și folosește exclusiv OpenCode
  `1.18.25` cu llama.cpp și `Qwen3.6-35B-A3B Q4_K_M` local pe Contabo.
- Modelul canonic este Qwen open-weight, licență Apache-2.0; fișierul GGUF
  instalat are `20,419,565,568` bytes și SHA-256
  `671e47e0ec53c665d048b98c3ecbfd5236b5ca9c3e02ed19fc8f81f7b85140c7`.
- Run-ul `33364953572` a verificat baza AI, accesul full-host, executorul
  OpenCode și heartbeat-ul HMAC, apoi a făcut rollback deoarece
  `kelion-constructor-sync.service` a încercat un `runuser` blocat de sandbox.
- Laptopul nu găzduiește modelul. Clientul Windows trebuie să folosească
  `https://kelionai.app` și aceeași coadă procesată de workerul Contabo.
- Proba read-only `private-ai-active-model-benchmark`, run `33497637524`, a
  măsurat `private-ai-llm.service` ca inactiv înainte de inferență; nu există o
  măsurătoare validă de viteză pentru niciun model în starea curentă.
- Re-rularea #2 a runului `33339737404` pentru vechiul workflow de reparare a
  eșuat la `resume-install` în 19 secunde și nu a restaurat serviciul.
- Artefactele GGUF sigilate au exact `20.419.565.568` bytes pentru 35B și
  `76.536.964.608` bytes pentru 122B, în total `96.956.530.176` bytes.
- Freeze-ul local final este verde: backend `1.539/1.539`, frontend `321/321`,
  manifestul static exact `331/331`, în total `2.191/2.191` teste. Au trecut
  separat 11 porți statice, 3 self-testuri, Gitleaks pe 50,32 MB fără secrete,
  jscpd pe 316 fișiere fără clone, sintaxa Bash `19/19`, YAML `25/25`, Node
  `97/97` și verificarea staged a 12 unități systemd.
- Re-auditul pe hashurile finale a dat `GO` pentru deployul safe. Publicarea
  are `114/114` teste verzi; reluarea configurării leagă byte-exact aceeași
  tuplă ordonată de 25 artefacte și refuză înainte de mutații o generație veche.
- Planul de migrare pentru starea live măsurată are exact versiunile
  `20260910`–`20260912` pending, toate `destructive=false`; testele plannerului
  sunt `11/11` verzi. Pilotul nu intră pe calea de restore distructiv.

## Schimbarea în curs

- Ownerul a respins al doilea VPS și orice cost nou. Ambele modele rămân pe
  discul Contabo existent, dar numai unul este încărcat în RAM: 35B implicit la
  instalare/reboot și 122B numai după comutarea manuală a ownerului din Admin.
- Workerul nu schimbă modelul și nu reîncearcă/reexecută automat. Numai dacă o
  execuție FAST validă se termină `unresolved`, produsul recomandă explicit
  comutarea manuală la POWERFUL; ownerul decide separat comutarea și comanda
  `Reia`. O cădere tehnică este terminală și raportată separat, fără recomandare
  de model. POWERFUL nerezolvat este terminal, fără alt model recomandat.
- Backendul și interfața Admin pentru starea/comanda manuală sunt verzi local.
  Controllerul privilegiat UDS/HMAC, comutatorul systemd, workerul cu un singur
  profil activ și cablarea installer/upgrade au teste locale verzi. Controllerul
  este blocat fail-closed de recovery/ready și de toate jurnalele persistente,
  iar ACK-ul de switch este serializat cu lockul canonic de publicare.
- Instalarea 122B este reluabilă sub lockurile host + GitHub, păstrează profilul
  manual la rerun și nu pornește controllerul înainte de receiptul final.
  Workflowurile mutatoare Contabo folosesc aceeași coadă `production-release`,
  iar configurarea Constructor poate aștepta bounded dovada release-images
  exactă a noului master.
- Schimbarea nu este încă publicată și nu este activă pe Contabo. Nu există încă
  măsurători valide de inferență sau de durată a comutării; în această etapă nu
  este cerut și nu este pretins niciun benchmark valid de viteză.
- Schimbarea este pregătită în PR-ul operațional `#1560`, nu în
  `origin/master`. Ramura `ops/private-ai-install-20260830` este clasificată
  drept release generic, cu request ID determinist; numai un PR viitor canonic
  `codex/<UUID>` cedează ownership-ul dispatcherului Constructor. După merge
  este obligatoriu freeze pe `master` până când deploy-ul acelui SHA ajunge
  terminal.
- Ownerul a aprobat explicit publicarea urgentă pe Contabo existent, fără cost
  nou. Nu mai este necesară o altă aprobare pentru commit, merge și deploy în
  limitele acestui contract; orice extindere de cost sau schimbare a profilurilor
  rămâne exclusiv decizia ownerului.
- Helperul de restore distructiv are defecte preexistente de reluare după
  SIGKILL între jurnalul intern și receiptul exterior, precum și după eșecul
  fazei `restoring`; un workdir decriptat poate rămâne și orfan. Nu sunt pe
  calea acestui pilot safe; orice release viitor clasificat `destructive`
  rămâne blocat până la remedierea și testarea acelor cazuri.

## Prag de finalizare

Nu se raportează finalizat până când finalizerul Contabo, claimul real al
workerului și verificarea clientului Windows nu sunt toate verzi pentru același
commit. Installerul Windows se publică numai semnat, după integrarea canonică.
Următorul pas sigur este commit/push pentru PR-ul operațional `#1560`, verificarea
CI/build (inclusiv container-isolation, indisponibil local), merge-ul aprobat
deja de owner și apoi deploy-ul serializat pe Contabo.
Până la dovada live exactă nu se raportează instalat sau finalizat.

## Legături canonice

- Finalizare Contabo: <https://github.com/kelion-team/kelionai/actions/workflows/private-ai-finalize.yml>
- PR canonic: <https://github.com/kelion-team/kelionai/pull/1560>
- Aplicație: <https://kelionai.app>
