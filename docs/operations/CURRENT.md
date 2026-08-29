# Checkpoint operațional curent

Actualizat: `2026-08-29T20:18:21Z`

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
- O cheie OpenAI de proiect validă rămâne necesară pentru chatul și vocea
  online. Un avertisment pentru cheie revocată, credit insuficient, plată
  pending sau citire nereușită este un semnal real și nu trebuie ascuns.
- Nu există o dovadă nouă a versiunii live din această sesiune.

## Următorul pas sigur

1. Rulează porțile complete pentru candidatul curent și deschide/integrează
   release train-ul numai pe verde.
2. Confirmă release-ul automat pentru noul `master` cu health și
   `/api/release-proof`; acceptă deploy-ul numai dacă commitul live coincide.
3. Rotește cheia OpenAI project-scoped în secret store, fără a o introduce în
   cod sau documentație, apoi verifică chatul text, vocea live și starea
   OpenAI din admin.
4. După recovery reușit, reactivează Constructorul și acceptă starea numai
   după probele Codex, worker, publisher și release.
