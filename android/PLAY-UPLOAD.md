# Urcarea Kelionai pe Google Play — pașii tăi (o singură dată)

Tot ce se putea pregăti automat E pregătit. Mai jos e partea care cere contul TĂU
de Play Console (eu nu pot loga/publica în locul tău).

## Fișierele gata de urcat
| Fișier | Rol |
|---|---|
| `android/app/build/outputs/bundle/release/app-release.aab` | **AAB-ul semnat** — ăsta se urcă în Play |
| `android/store_icon.png` | Iconița 512×512 pentru listare |
| `android/play-feature-graphic.png` | Graficul de antet 1024×500 |
| `C:\Users\adria\Kelionai-secrets\android.keystore` (+ parola alături) | Cheia de semnare — **FĂ-I BACKUP** (fără ea nu mai poți publica update-uri) |

## Pașii în Play Console (play.google.com/console)
1. **Create app** → nume `Kelionai`, App (nu Game), Free.
2. La întrebarea de semnare acceptă **Play App Signing** (recomandat — Google păstrează cheia finală, AAB-ul tău e „upload key").
3. **Production → Create new release** → trage `app-release.aab` → Next.
4. **Store listing**:
   - Short description (max 80): `Your brilliant AI assistant — it sees, hears and speaks.`
   - Full description: descrie funcțiile (poți copia manualul de pe landing).
   - Icon: `store_icon.png`; Feature graphic: `play-feature-graphic.png`.
   - Screenshots telefon (min 2): fă 2–4 capturi de pe telefonul tău cu app-ul deschis.
5. **App content** (chestionarele obligatorii): Privacy policy = `https://kelionai.app/privacy`; Data safety (colectăm: email la logare, audio pentru procesare vocală — nu se vând); Content rating (Everyone); Target audience 18+ recomandat (are plăți).
6. Submit → prima recenzie durează de obicei 1–7 zile.

## Varianta din CLOUD (fără PC-ul tău) — recomandată, ca la iOS
Din 11 aug există și workflow-ul `.github/workflows/android-release.yml`: construiește
AAB-ul semnat și îl urcă singur în Play. Tu pui O SINGURĂ DATĂ secretele în repo
(Settings → Secrets and variables → Actions):

| Secret | Ce e |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `android.keystore` codat base64 (`[Convert]::ToBase64String([IO.File]::ReadAllBytes("android.keystore"))`) |
| `ANDROID_KEYSTORE_PASSWORD` | parola keystore-ului |
| `ANDROID_KEY_ALIAS` | alias (ex. `kelionai`) |
| `ANDROID_KEY_PASSWORD` | parola cheii |
| `PLAY_SERVICE_ACCOUNT_JSON` | conținutul JSON al contului de serviciu Play |

Apoi: Actions → **android-release** → *Run workflow*. (Prima urcare tot manuală trebuie,
politica Google; după aia, workflow-ul publică singur.)

## Update-uri viitoare — automate
- **Conținutul aplicației** vine din web: orice deploy pe kelionai.app ajunge INSTANT
  în app-ul din Play, fără re-upload (asta e natura TWA). Re-upload trebuie DOAR
  când se schimbă învelișul (icoană, permisiuni) — rar.
- Când vrei re-upload: `.\release.ps1 android` produce AAB-ul nou (versionCode se
  incrementează în `android/twa-manifest.json` → rebuild).
- **Urcarea automată e DEJA construită** (`android/publish-play.mjs`, legată în
  `release.ps1 android`). Ca s-o activezi: Play Console → Setup → API access →
  creează un Service Account cu rol „Release manager" → descarcă JSON-ul în
  `C:\Users\adria\Kelionai-secrets\play-service-account.json`. Din acel moment,
  fiecare `.\release.ps1 android` urcă și publică singur în Play (după prima
  urcare manuală, cerută de politica Google).
