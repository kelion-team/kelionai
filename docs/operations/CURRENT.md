# Checkpoint operațional curent

Actualizat: `2026-08-29T20:39:18Z`

## Stare verificată

- `master` este `154de473b27b760d8bdf6a503850a8018e862f7e`; toate cele trei
  joburi `pr-verify`, inclusiv `container-isolation`, au trecut.
- Release run `33272696377` a validat candidatul și semnăturile, dar s-a
  oprit înainte de point-of-no-return. Release-ul public anterior a rămas
  activ.
- Cauza confirmată este un bootstrap deadlock în `deploy.sh`: înainte să
  instaleze helperul reparat, deploy-ul cere helperului live vechi să
  recupereze `constructor-activation.journal`. Generația veche include
  jurnalul în globul `constructor-activation.*` și refuză recovery-ul.
- `master` conține remedierea one-shot, dublu pin-uită, pentru acel deadlock.
  Ea acceptă numai helperul live și candidatul cunoscute, un jurnal schema 2
  pentru `activate-worker-publisher` și absența jurnalelor concurente.
  Migrarea rulează helperul candidat numai dintr-o copie temporară
  root-only, reia explicit operația jurnalizată, dovedește ștergerea
  jurnalului/pendingului/snapshotului, apoi quiesce din nou Constructorul.
  Helperul live nu este înlocuit înaintea dovezii.
- Candidatul curent păstrează remedierea upstream pentru recovery și adaugă
  `503 brain_not_configured` înainte de SSE și debitare pentru chatul fără
  cheie OpenAI; replay-urile terminale și vocea ambientală își păstrează
  căile fail-closed.
- Backendul (typecheck, lint, 1.438 teste), frontendul (build, lint, 306
  teste), porțile statice, worker/Constructor, preflightul și testele de
  recovery (113) au trecut pentru trainul sincronizat.
- `container-isolation` oficial pentru baza anterioară a trecut. Reproducerea
  locală este blocată de un certificat TLS extern, auto-semnat, în container;
  verificarea TLS nu va fi slăbită.
- Gitleaks pentru arbore/bundle și diferența candidatului este curat.
  Istoricul complet conține două credentiale legacy Kimi/GLM în documente
  șterse; operatorul trebuie să le revoce înainte de release. Istoria nu se
  rescrie și nu se introduc excepții care ar ascunde problema.
- Constructorul rămâne fail-closed; timerele sunt inactive până la
  recovery/deploy reușit și la probele Codex CLI.
- Cheia OpenAI API de producție rămâne revocată; aceasta este o problemă
  separată de release și Constructor.
- Nu există o dovadă nouă a versiunii live în această sesiune.

## Următorul pas sigur

1. Revocă credentialele Kimi/GLM istorice în secret store-urile furnizorilor;
   păstrează dovada numai în canalul securizat.
2. Deschide trainul ca PR, rulează o singură dată poarta completă pentru
   candidatul exact și îmbină prin rebase numai pe verde.
3. Confirmă release proof pentru SHA-ul nou și apoi rulează controlul
   Constructor pentru starea timerelor și proba `codex --version`.
4. Activează release-ul Constructor numai după worker/publisher sănătoase și
   rotește cheia OpenAI în secret store înainte de verificarea chatului/voce.

## Legături canonice

- Workflow control Constructor: <https://github.com/kelion-team/kelionai/actions/workflows/vps-run.yml>
- Release eșuat pre-PONR: <https://github.com/kelion-team/kelionai/actions/runs/33272696377>
- Versiune live: <https://kelionai.app/api/release-proof>
