# Checkpoint operațional curent

Actualizat: `2026-08-29T19:49:00Z`

## Stare verificată

- Repo: `kelion-team/kelionai`; singura țintă de producție este `master`.
  Vârful remote și release-ul activ sunt
  `ff6d2e30991b4f35adaf68f4b3a88ada8504d350`.
- Diagnoza VPS a confirmat containerele slotului verde sănătoase și
  răspuns `200` pentru `/livez`, `/readyz` și `/api/version`. Interfața
  publică rămâne disponibilă.
- Remedierea ACL pentru Codex CLI este inclusă în release-ul curent, dar
  activarea Constructorului nu ajunge încă la proba CLI.
- `vps-constructor-control` run `33254987691`, inclusiv relansarea
  controlată, și recovery-ul generic run `33255194656` se opresc
  fail-closed cu mesajul că snapshoturile de activare orfane nu pot fi
  curățate sigur.
- Cauza este deterministă în `runtime-config-cutover.sh`:
  `garbage_collect_activations` iterează globul `constructor-activation.*`,
  care include și fișierul legitim `constructor-activation.journal`.
  Recovery-ul quiesced păstrează intenționat jurnalul, apoi garbage
  collectorul îl respinge fiindcă nu este director.
- Toate cele trei timere Constructor sunt inactive, iar stamp-ul de
  execuție este retras. Constructorul rămâne fail-closed fără să oprească
  release-ul web activ.
- Cheia OpenAI API de producție rămâne revocată; chatul și vocea online
  nu sunt declarate funcționale până la configurarea explicită a unei
  chei valide sau a modului suportat „API dezactivat”.
- Remedierea este pregătită pe ramura
  `fix/constructor-activation-journal-gc-20260829`: exclude numai calea
  exactă a jurnalului înainte de validarea directoarelor, păstrează
  refuzul pentru orice alt nod neașteptat, actualizează pinul SHA-256 al
  helperului compatibil și adaugă regresia în suita Constructor deja
  obligatorie în CI.

## Următorul pas sigur

1. Deschide PR-ul unic pentru remedierea garbage collectorului și lasă
   `verify` plus `container-isolation` să treacă integral.
2. Îmbină prin rebase numai pe verde și confirmă deploy-ul noului `master`.
3. Rulează recovery-ul Constructor, apoi `activate-worker-publisher`;
   acceptă rezultatul numai după proba `codex --version` ca
   `kelion-codex` și starea activă a celor două timere.
4. Rulează ceremonia oficială `VPS Codex Login Bridge`, verifică
   `codex login status`, apoi activează și probează release-ul Constructor.
5. Separat, repară modul explicit „OpenAI API dezactivat” sau rotește o
   cheie validă înainte de a relua testarea chatului și vocii online.

## Legături canonice

- Workflow control Constructor: <https://github.com/kelion-team/kelionai/actions/workflows/vps-run.yml>
- Activare/retry eșuat: <https://github.com/kelion-team/kelionai/actions/runs/33254987691>
- Recovery eșuat: <https://github.com/kelion-team/kelionai/actions/runs/33255194656>
- Versiune live: <https://kelionai.app/api/release-proof>
