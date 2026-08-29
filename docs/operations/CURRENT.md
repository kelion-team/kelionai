# Checkpoint operațional curent

Actualizat: `2026-08-29T20:25:53Z`

## Stare verificată

- Ținta unică de producție este `master`, la
  `4687c7f2a57b17f2f3a1e8ca5b1a9bcb2583e907`.
- Release-ul de producție `33272696377` a eșuat înainte de schimbarea
  versiunii live: helperul persistent vechi a refuzat jurnalul legitim de
  activare înainte să poată instala helperul corect din bundle.
- Candidatul `93f3b4103b2542b96db484d3dda3f2b0e02abb04` instalează atomic
  helperul candidat, după validarea unității, numai când există un jurnal de
  recovery; apoi rulează recovery-ul sub lock. Hosturile fără jurnal păstrează
  ordinea normală de bootstrap.
- Același candidat închide corect o tură de chat fără cheie OpenAI cu
  `503 brain_not_configured`, înainte de debitare și SSE. Replay-urile
  finalizate și vocea ambientală își păstrează căile fail-closed existente.
- Validările locale ale candidatului au trecut: backend (typecheck, lint și
  1.438 teste), frontend (build, lint și 306 teste), porțile statice, testele
  worker/Constructor, preflight-ul release train și CodeQL.
- Scanul Gitleaks al arborelui/bundle-ului și al diferenței
  `origin/master..HEAD` este curat. Scanul întregului istoric încă detectează
  două credentiale legacy Kimi/GLM, cu entropie ridicată, în documente deja
  șterse; ele trebuie revocate de operator înainte de release. Nu se rescrie
  istoria și nu se adaugă excepții care ar ascunde problema.
- Reluarea validării Docker/container-isolation este în curs. `VPS release
  verifier` pentru `master` a rămas fail-closed după release-ul eșuat, fără
  dovezi pentru branch protection, deploy și verificarea live.
- O cheie OpenAI de proiect validă rămâne necesară pentru chatul și vocea
  online. Un avertisment pentru cheie revocată, credit insuficient, plată
  pending sau citire nereușită este un semnal real și nu trebuie ascuns.
- Nu există o dovadă nouă a versiunii live din această sesiune.

## Următorul pas sigur

1. Revocă credentialele Kimi/GLM istorice în secret store-ul furnizorilor și
   păstrează dovada de revocare în canalul securizat, nu în repository.
2. Colectează rezultatul container-isolation; dacă trece, deschide și
   integrează release train-ul numai pe verde.
3. Confirmă release-ul automat pentru noul `master` cu health și
   `/api/release-proof`; acceptă deploy-ul numai dacă commitul live coincide.
4. Rotește cheia OpenAI project-scoped în secret store, fără a o introduce în
   cod sau documentație, apoi verifică chatul text, vocea live și starea
   OpenAI din admin.
5. După recovery reușit, reactivează Constructorul și acceptă starea numai
   după probele Codex, worker, publisher și release.
