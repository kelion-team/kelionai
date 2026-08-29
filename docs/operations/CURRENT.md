# Checkpoint operațional curent

Actualizat: `2026-08-29T01:34:37Z`

## Stare verificată

- Repo: `kelion-team/kelionai`; singura țintă de producție este `master`.
- Vârful `master` este
  `88e295581ee7f1508884d376c76f5eb968c17771` (PR `#1504`). CI exact
  `33225442208`, scanarea exactă `33225442237` și buildul OCI exact
  `33225642455` sunt verzi.
- PR `#1504` a eliminat byte-ul `CR` din unitatea sync și a mutat validarea
  strictă a celor opt surse systemd înainte de intentul durabil sau quiesce.
  Configurarea VPS `33226027350` a trecut `published-validation`, `commit` și
  contractul runtime live pe SHA-ul exact; cele cinci containere active au
  revenit healthy, iar Constructorul a rămas instalat fără markere de activare.
- Release-ul canonic `33225988793`, request
  `d7d324f8-0dfb-4413-b6b9-125b9defe9c1`, a eșuat inițial înaintea
  configurării pe `runtime.env` legacy. Retry-ul aceleiași cereri a trecut
  validarea runtime, manifestul și semnăturile, apoi s-a oprit fail-closed
  înainte de PONR în preflight-ul read-only al handoff-urilor Constructor.
- Cauza exactă a celui de-al doilea refuz este incompatibilitatea SQL cu schema
  Constructor v1: predicatul legacy folosea parametrii `$1,$2,$3,$4,$7`, dar
  trimitea șapte valori. PostgreSQL a refuzat parametrul nefolosit `$5` cu
  `42P18`, înainte ca query-ul de numărare să ruleze. Mesajul generic despre
  handoff-uri nedrenate nu dovedește existența unor joburi blocante.
- Remedierea curentă păstrează predicatele de ownership fail-closed, dar trimite
  exact cinci parametri contigui pe schema v1 și șapte pe schema v2. Regresia
  execută query-ul extras din deploy pe ambele scheme PGlite și verifică un
  handoff curent plus unul străin. Suita Constructor relevantă este verde
  `80/80`; `bash -n`, sintaxa Node și `git diff --check` sunt verzi.
- Recovery-ul pre-PONR a păstrat traficul și DB fără cutover. Producția este
  sănătoasă pe `baf00aee68206ebdf259143fd9b71813fd6a5c02`:
  `/api/version`, `/readyz`, `/livez` și `/health` răspund 200, readiness-ul și
  side effects sunt active, iar `/api/release-proof` rămâne 404.
- Avertismentele GitHub despre acțiuni Node.js 20 forțate pe Node.js 24 nu au
  cauzat refuzurile. Migrarea acțiunilor rămâne separată până când producția
  este stabilă pe noul vârf.

## Următorul pas sigur

1. Publică fixul parametrilor v1/v2 și regresia PGlite numai prin PR; cere
   toate check-urile protejate și merge prin rebase.
2. După merge, cere CI și build OCI verzi pentru noul vârf exact `master`, apoi
   rulează o singură configurare `configure-constructor` pe aceeași tuplă.
3. Rulează release-ul canonic pentru noul SHA și acceptă-l numai după dovada
   externă cu SHA integral, `/readyz=200` și side effects active.
4. Închide issue-urile verifierului numai după dovada exactă live; nu interpreta
   mesajul generic de drain ca inventar DB și nu ocoli preflight-ul.

## Legături canonice

- PR contract bytes systemd: <https://github.com/kelion-team/kelionai/pull/1504>
- Configurare exactă reușită: <https://github.com/kelion-team/kelionai/actions/runs/33226027350>
- CI exact `88e2955`: <https://github.com/kelion-team/kelionai/actions/runs/33225442208>
- Build OCI exact `88e2955`: <https://github.com/kelion-team/kelionai/actions/runs/33225642455>
- Release canonic refuzat pre-PONR: <https://github.com/kelion-team/kelionai/actions/runs/33225988793>
- Issue verifier curent: <https://github.com/kelion-team/kelionai/issues/1502>
