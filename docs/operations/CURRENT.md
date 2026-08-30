# Checkpoint operațional curent

Actualizat: `2026-08-30T10:00:00Z`

## Stare verificată

- `origin/master` și producția rulează commitul
  `2c60f84d63fc6353b4e8b614fbb29b4fe110160f`.
- `/readyz` este verde pentru configurare, bază de date, migrații,
  browser-worker și converter-worker. `/api/release-proof` confirmă
  `candidate:false` și `sideEffectsActive:true`.
- Workflow-ul `provision-production-secrets` #216 a terminat cu succes și a
  repornit backendul cu secretul OpenAI din mediul GitHub `production`.
- O probă autentificată în interfața live a trimis mesajul până la backend,
  însă răspunsul OpenAI a fost refuzat cu HTTP `429`; interfața a afișat
  `Încearcă din nou în câteva secunde.`. Ruta admin pentru chei confirmă
  `fail_429`, nu `not_configured` și nu `401`.
- Proba de sănătate curentă folosește doar opt tokeni de ieșire. Modelele cu
  raționament pot întoarce un răspuns 2xx `incomplete`, pe care versiunea live
  îl reclasifică fals drept `400 bad_request`; astfel nu distinge codul real
  al refuzului `429`.
- Cheia expusă anterior trebuie revocată după proba finală. Copia criptată din
  `Environment secrets` există; copia plaintext din `Environment variables`
  nu este considerată eliminată până la o confirmare GitHub verificabilă.

## Următorul pas sigur

1. Publică schimbarea minimă care ridică bugetul probei la 64 de tokeni și
   expune numai `error.code` dintr-o listă închisă pentru administrator.
2. După toate porțile și merge prin PR, deployează exact SHA-ul din `master`.
3. Citește `providerCode`: pentru `rate_limit_exceeded` redu ritmul și repetă o
   singură probă; pentru un cod de credit/spend/usage, accesul API trebuie
   restabilit în proiectul OpenAI înainte ca un alt deploy să poată face chatul
   funcțional.
4. Confirmă succesul numai printr-un răspuns text real și o sesiune Realtime
   reală în browser, apoi elimină variabila plaintext și rotește cheia expusă.

## Legături canonice

- Workflow secret production: <https://github.com/kelion-team/kelionai/actions/runs/33299775151>
- Workflow release: <https://github.com/kelion-team/kelionai/actions/workflows/release.yml>
- Versiune live: <https://kelionai.app/api/release-proof>
- Diagnostic OpenAI admin: <https://kelionai.app/api/admin/brain-credit>
