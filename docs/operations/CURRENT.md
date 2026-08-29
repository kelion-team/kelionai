# Checkpoint operațional curent

Actualizat: `2026-08-29T00:47:35Z`

## Stare verificată

- Repo: `kelion-team/kelionai`; singura țintă de producție este `master`.
- `origin/master` este
  `02d0835c8f1d823aa9bf9d0644bf8876da7f4e8a` (PR `#1501`). CI exact
  `33223120345`, scanarea exactă `33223120339`, buildul OCI exact
  `33223350633` și dispatch-ul release exact `33223716694` sunt verzi.
- Release-ul de producție `33223722912` pentru `02d0835` a validat
  candidatul, manifestul și semnăturile, apoi s-a oprit fail-closed înainte de
  cutover deoarece `runtime.env` live era încă legacy.
- Configurarea `33223739003` a migrat candidatul runtime la schema completă,
  a validat toate cele trei configuri Constructor și a publicat unitățile
  dezactivate. Cutover-ul mixt a fost refuzat după commitul fișierelor de
  validatorul contractului live; rollback-ul a restaurat configurația veche și
  a recreat backendul activ sănătos.
- Cauza exactă este un byte `CR` izolat la finalul fișierului
  `deploy/systemd/kelion-constructor-sync.service`, prezent în blobul Git încă
  din commitul inițial. `systemd-analyze` îl acceptă, dar
  `validate_text_file_bytes` îl respinge când
  `validate_live_constructor_sync_unit` închide contractul live. Este singurul
  caracter de control interzis din cele opt unități systemd canonice.
- Remedierea curentă elimină byte-ul `CR`, verifică același contract strict de
  bytes în installer înainte de publicare și rulează validatorii reali pe toate
  cele opt unități în regresie. PR `#1503` publică remedierea și adaugă exact
  unitatea sync în scope-ul VPS permis de merge-policy. Suita relevantă este verde `80/80`;
  `bash -n`, verificarea workflow-urilor, sintaxei, hardcodărilor și
  `git diff --check` sunt verzi.
- Diagnosticul read-only `33224149171` confirmă după rollback toate cele trei
  timere inactive, toți markerii dezactivați și autentificarea Codex încă
  necesară. Aplicația live este sănătoasă pe
  `baf00aee68206ebdf259143fd9b71813fd6a5c02`: `/api/version`,
  `/readyz`, `/livez` și `/health` răspund corect, iar candidatul și side
  effects sunt active.
- Avertismentele GitHub despre acțiuni Node.js 20 forțate pe Node.js 24 nu au
  cauzat refuzurile de deploy. Migrarea acțiunilor rămâne separată până când
  producția este stabilă pe vârful nou.

## Următorul pas sigur

1. Publică eliminarea `CR`, validarea fail-early și regresia numai prin PR;
   cere toate check-urile protejate și merge prin rebase.
2. După merge, cere CI și build OCI verzi pentru noul vârf exact `master`,
   apoi rulează o singură configurare `configure-constructor` pe acel SHA.
3. Numai după configurarea verde, rulează release-ul pentru aceeași tuplă și
   dovedește extern SHA-ul complet, readiness și side effects.
4. Închide issue-urile verifierului numai după dovada exactă live; nu închide
   incidentele istorice pe baza unui workflow verde fără probă externă.

## Legături canonice

- PR contract bytes systemd: <https://github.com/kelion-team/kelionai/pull/1503>
- PR migrare runtime: <https://github.com/kelion-team/kelionai/pull/1501>
- CI exact `02d0835`: <https://github.com/kelion-team/kelionai/actions/runs/33223120345>
- Build OCI exact `02d0835`: <https://github.com/kelion-team/kelionai/actions/runs/33223350633>
- Release refuzat înainte de cutover: <https://github.com/kelion-team/kelionai/actions/runs/33223722912>
- Configurare cu rollback sigur: <https://github.com/kelion-team/kelionai/actions/runs/33223739003>
- Diagnostic read-only după rollback: <https://github.com/kelion-team/kelionai/actions/runs/33224149171>
- Issue verifier curent: <https://github.com/kelion-team/kelionai/issues/1502>
