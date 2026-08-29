# Checkpoint operațional curent

Actualizat: `2026-08-29T12:42:25Z`

## Stare verificată

- Repo: `kelion-team/kelionai`; singura țintă de producție este `master`.
  Vârful remote și versiunea live sunt
  `3d89f0377ab94f39dae337ea6480a65431f8433d`.
- CI `33250460773`, buildul OCI `33250661678`, dispatcherul `33250963252`
  și deploy-ul `33250967273` sunt verzi. Trei probe live consecutive au
  confirmat același SHA, `candidate=false`, `sideEffectsActive=true` și toate
  porțile de release active.
- Testarea funcțională în browser a început pe producția autentificată. Chatul
  text nu a produs răspuns, iar vocea Realtime a raportat eroare de conexiune.
  Endpointurile live au clasificat cauza ca `invalid_key` pentru cheia OpenAI.
- În organizația OpenAI `AE1968`, cheia de proiect și cheia de administrare au
  fost revocate, planul API a fost anulat și metoda de plată API a fost
  eliminată. Abonamentul ChatGPT Pro al ownerului a rămas activ. Copia veche
  de pe VPS este revocată și nu mai poate produce consum.
- Secretul GitHub `OPENAI_API_KEY` există încă la nivel repository. Nu se
  rulează încă provisionarea fără el: placeholderul este tratat corect ca
  lipsă de cheie, dar `/readyz` cere în prezent OpenAI configurat, astfel că
  rotația ar eșua și ar face rollback.
- Contractul Constructorului este separat de OpenAI API. Workerul Codex folosește
  exclusiv sesiunea oficială `codex login` a contului ChatGPT Pro; publisherul
  și release-ul folosesc identități GitHub dedicate. Nicio parolă personală nu
  intră în aplicația web, GitHub Actions sau mediul workerului.
- Diagnoza live `/api/admin/constructor/diagnostic` raportează lanțul offline:
  worker, publisher și release fără heartbeat recent; două ordine sunt în coadă.
- Ceremonia `VPS Codex Login Bridge` run `33252437641` a eșuat înainte de
  autentificare, cu exit `126`: utilizatorul `kelion-codex` nu putea executa
  `/opt/kelion-codex/bin/codex`.
- Cauza este deterministă: configurarea Constructorului rulează cu `umask 077`,
  iar instalarea npm moștenea ACL-uri root-only. Remedierea locală pornește din
  `3d89f037...`, validează layoutul canonic înainte de mutații, instalează cu
  `umask 022`, refuză owner/group/symlink necanonic, normalizează numai fișierele
  și directoarele de pe același filesystem și probează CLI-ul ca utilizatorul
  real `kelion-codex` într-un mediu gol.
- Porțile locale sunt verzi: Constructor `85/85`, Codex boundary `7/7`, backend
  `1437/1437`, typecheck, frontend build și lint, YAML/Bash, toate cele șapte
  audituri statice, exporturi și duplicare `0`. Două review-uri independente nu
  mai raportează P0/P1; `git diff --check` este curat.

## Următorul pas sigur

1. Publică PR-ul unic pentru ACL-ul CLI Codex și lasă toate porțile obligatorii
   să treacă înainte de merge prin rebase.
2. Rulează `vps-constructor-control` pe noul `master` ca să reinstaleze CLI-ul
   cu ACL-ul verificat; dovedește `codex --version` ca `kelion-codex`.
3. Rulează din nou `VPS Codex Login Bridge`, autorizează o singură dată contul
   `ae1968` Pro prin fluxul oficial și verifică `codex login status`.
4. Activează și probează în ordine workerul, publisherul și release-ul; acceptă
   rezultatul numai când diagnoza live raportează întreg lanțul `ready`.
5. Separat, repară modul explicit „OpenAI API dezactivat”, apoi elimină secretul
   GitHub și înlocuiește atomic copia VPS cu `disabled-placeholder-*`. Chatul și
   vocea online nu pot fi declarate funcționale fără o cheie API validă.
6. Reia matricea browser pentru fiecare buton și funcție; livrează loturi de
   maximum cinci defecte, cu regresie, SHA live și dovadă vizibilă.

## Legături canonice

- Versiune live: <https://kelionai.app/api/release-proof>
- Deploy live: <https://github.com/kelion-team/kelionai/actions/runs/33250967273>
- Login Constructor eșuat: <https://github.com/kelion-team/kelionai/actions/runs/33252437641>
- Workflow login: <https://github.com/kelion-team/kelionai/actions/workflows/vps-codex-login.yml>
