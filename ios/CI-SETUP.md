# iOS .ipa — build automat prin GitHub Actions (fără Mac)

Tot lanțul de semnare e DEJA pregătit local (2 iul 2026):

| Artefact | Unde e |
|---|---|
| Cheie privată RSA | `Kelionai-secrets/ios-dist.key` |
| Certificat Apple Distribution (exp. 2027/07/02) | `Kelionai-secrets/ios-dist.cer` (+ `.pem`) |
| P12 pentru CI (parolă în `ios-dist-p12-password.txt`) | `Kelionai-secrets/ios-dist.p12` |
| Profil provizionare „Kelionai App Store" | `Kelionai-secrets/Kelionai_App_Store.mobileprovision` |
| Team ID | `982XP625JT` · Bundle: `app.kelionai.ios` · App ID ASC: `6786766714` |

## Pași rămași (o singură dată, ~10 min cu Adrian)

1. **Cheie API App Store Connect** — App Store Connect → Users and Access →
   Integrations → App Store Connect API → *Request Access* (checkbox de acord —
   îl bifează Adrian) → *Generate API Key*, rol **App Manager**, nume „Kelionai CI".
   Se notează **Key ID** + **Issuer ID** și se descarcă `AuthKey_XXXX.p8`
   (o singură dată!) → mutat în `Kelionai-secrets/`.
2. **Repo GitHub privat** — `gh repo create kelionai --private` (sau din UI),
   apoi push. `Kelionai-secrets/` NU e în repo (e în afara folderului).
3. **Secrets în repo** (Settings → Secrets and variables → Actions):
   ```powershell
   $sec="C:\Users\adria\Kelionai-secrets"
   gh secret set IOS_DIST_P12_BASE64   -b ([Convert]::ToBase64String([IO.File]::ReadAllBytes("$sec\ios-dist.p12")))
   gh secret set IOS_DIST_P12_PASSWORD -b (Get-Content "$sec\ios-dist-p12-password.txt" -Raw)
   gh secret set IOS_PROFILE_BASE64    -b ([Convert]::ToBase64String([IO.File]::ReadAllBytes("$sec\Kelionai_App_Store.mobileprovision")))
   gh secret set ASC_API_KEY_ID        -b "KEY_ID_AICI"
   gh secret set ASC_API_ISSUER_ID     -b "ISSUER_ID_AICI"
   gh secret set ASC_API_KEY_P8_BASE64 -b ([Convert]::ToBase64String([IO.File]::ReadAllBytes("$sec\AuthKey_XXXX.p8")))
   ```
4. **Rulare**: Actions → `ios-release` → Run workflow. Build-ul apare în
   App Store Connect → TestFlight în ~15 min, apoi se atașează versiunii 1.0.

## De ce așa
- macOS runner-ul GitHub are Xcode; nu e nevoie de Mac fizic/MacinCloud.
- Aceeași cheie API ASC va putea urca AUTOMAT screenshots/metadata la fiecare
  versiune (cerința „orice update se propagă automat în store-uri").
- `ITSAppUsesNonExemptEncryption=false` e deja în Info.plist → fără întrebări
  de export compliance la fiecare build.
