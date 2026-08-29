# Checkpoint operațional curent

Actualizat: `2026-08-29T00:08:49Z`

## Stare verificată

- Repo: `kelion-team/kelionai`; singura țintă de producție este `master`.
- `origin/master` este `b71164d221ad46d443256d84b100497499fd79ad`
  (PR `#1499`). CI exact `33221295251`, buildul OCI exact `33221524501`
  și dispatch-ul release `33221901572` sunt verzi.
- Aplicația live este încă versiunea sănătoasă `baf00ae`. La
  `2026-08-29T00:08Z`, `/api/version`, `/readyz`, `/livez` și `/health` au
  răspuns 200; readiness este adevărat, candidatul este activ și side
  effects sunt active.
- Release-ul exact `33221905633` pentru `b71164d`, CI `33221295251` și build
  `33221524501` a validat manifestul și semnăturile, apoi s-a oprit
  fail-closed înainte de cutover deoarece `runtime.env` live este legacy.
- Configurarea `33221936123` a trecut installerul, identitățile GitHub,
  pull-urile Podman rootless și generarea configurațiilor Constructor. A fost
  refuzată atomic în staging la validarea `runtime.env`; serviciile au rămas
  dezactivate și aplicația live nu s-a schimbat.
- Ultima provisionare reușită a runtime-ului este `32906659924` pe `baf00ae`.
  Față de schema curentă, acel producător nu emite șase chei. Configurarea
  Constructor adăuga patru, dar omitea încă
  `GITHUB_RELEASE_OAUTH_TOKEN_FILE` și `GOOGLE_TTS_VOICE`.
- Provisionarea canonică `33222453204` a reconstruit candidatul runtime cu
  schema completă, apoi s-a oprit fail-closed la
  `constructor-config.constructor-publisher.env`. Workflow-ul păstrează
  configurația Constructor live, care este legacy, iar validatorul curent cere
  schema publisher completă. Tranzacția nu a făcut cutover.
- Remedierea curentă completează cele două constante canonice în migrarea
  `runtime.env` din `configure-constructor`; același cutover generează deja de
  la zero toate cele trei configurații Constructor în schema curentă. Regresia
  execută migrarea pornind din fixture-ul legacy și validează rezultatul cu
  validatorul runtime real. Suita relevantă este verde `79/79`, iar verificarea
  workflow-urilor, sintaxei și hardcodărilor este verde.
- Avertismentele GitHub despre acțiuni Node.js 20 forțate pe Node.js 24 nu au
  cauzat aceste refuzuri. Migrarea acțiunilor rămâne separată de release-ul de
  producție.

## Următorul pas sigur

1. Publică migrarea runtime și regresia numai prin PR, fără bypass sau push
   direct în `master`; cere toate check-urile protejate.
2. După merge, cere CI și build OCI verzi pentru noul vârf exact `master`, apoi
   rulează o singură configurare `configure-constructor` pe acel SHA.
3. Numai după configurarea verde, reia release-ul pentru aceeași tuplă nouă și
   dovedește extern SHA-ul complet, readiness și side effects înainte de a
   declara deploy-ul reușit sau de a închide incidentele verifierului.

## Legături canonice

- PR contract runtime/release: <https://github.com/kelion-team/kelionai/pull/1499>
- CI exact `b71164d`: <https://github.com/kelion-team/kelionai/actions/runs/33221295251>
- Build OCI exact `b71164d`: <https://github.com/kelion-team/kelionai/actions/runs/33221524501>
- Release refuzat înainte de cutover: <https://github.com/kelion-team/kelionai/actions/runs/33221905633>
- Configurare refuzată la runtime legacy: <https://github.com/kelion-team/kelionai/actions/runs/33221936123>
- Provisionare refuzată la publisher legacy: <https://github.com/kelion-team/kelionai/actions/runs/33222453204>
