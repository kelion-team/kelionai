# Kelionai — one-command release. Rebuilds every distributable and deploys:
#   .\release.ps1            → web only (frontend+backend → Railway)
#   .\release.ps1 desktop    → + Windows installer  → /downloads/Kelionai-Setup.exe
#   .\release.ps1 android    → + Android APK (signed) → /downloads/Kelionai.apk  (+ AAB for Play)
#   .\release.ps1 all        → everything
# The web app is the product — desktop/android are thin shells around it, so a
# plain web release updates EVERY platform instantly; rebuild the shells only
# when the shell itself (icon, window, permissions) changes.
param([string]$What = 'web')

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-21.0.10.7-hotspot'
$env:ANDROID_HOME = 'C:\Users\adria\.bubblewrap\android_sdk'
$secrets = 'C:\Users\adria\Kelionai-secrets'
$buildTools = "$env:ANDROID_HOME\build-tools\34.0.0"

function Step($name, $script) {
  Write-Host "== $name ==" -ForegroundColor Cyan
  & $script
  if ($LASTEXITCODE -ne 0) { throw "$name failed (exit $LASTEXITCODE)" }
}

if ($What -eq 'desktop' -or $What -eq 'all') {
  # Updater artifacts are signed with OUR key (minisign) — installed apps verify
  # and self-update from /downloads/desktop-update.json on every launch.
  $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$secrets\tauri-updater.key" -Raw)
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
  Step 'Desktop (Tauri .exe)' {
    Set-Location "$root\desktop"
    npx tauri build
  }
  Copy-Item "$root\desktop\src-tauri\target\release\bundle\nsis\Kelionai_*_x64-setup.exe" `
    "$root\frontend\public\downloads\Kelionai-Setup.exe" -Force
  # Authenticode: as soon as the code-signing certificate exists (codesign.pfx +
  # codesign-password.txt in Kelionai-secrets), every installer is signed and
  # timestamped automatically — no SmartScreen "unknown publisher".
  $pfx = "$secrets\codesign.pfx"
  if (Test-Path $pfx) {
    $signtool = (Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe' |
      Sort-Object FullName | Select-Object -Last 1).FullName
    $certPass = (Get-Content "$secrets\codesign-password.txt" -Raw).Trim()
    Step 'Desktop (semnare Authenticode)' {
      & $signtool sign /f $pfx /p $certPass /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 `
        "$root\frontend\public\downloads\Kelionai-Setup.exe"
    }
  } else {
    Write-Host 'certificat absent — installer nesemnat (SmartScreen warning)' -ForegroundColor Yellow
  }
  # Self-update manifest: every installed desktop app checks this JSON on launch
  # and silently installs the new signed shell — permanent updates for everyone
  # who ever downloaded the .exe.
  $ver = (Get-Content "$root\desktop\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json).version
  $sig = (Get-Content "$root\desktop\src-tauri\target\release\bundle\nsis\Kelionai_${ver}_x64-setup.exe.sig" -Raw).Trim()
  @{
    version = $ver
    pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    platforms = @{ 'windows-x86_64' = @{
      signature = $sig
      url = 'https://kelionai.app/dl/Kelionai-Setup.exe'
    } }
  } | ConvertTo-Json -Depth 4 | Out-File "$root\frontend\public\downloads\desktop-update.json" -Encoding utf8
  Write-Host "installer v$ver + manifest update → frontend/public/downloads/"
}

if ($What -eq 'android' -or $What -eq 'all') {
  $pass = (Get-Content "$secrets\android-keystore-password.txt" -Raw).Trim()
  Step 'Android (gradle APK+AAB)' {
    Set-Location "$root\android"
    .\gradlew.bat assembleRelease bundleRelease
  }
  Step 'Android (align + sign APK)' {
    Set-Location "$root\android"
    & "$buildTools\zipalign.exe" -f -p 4 `
      app\build\outputs\apk\release\app-release-unsigned.apk app\build\outputs\apk\release\app-aligned.apk
    & "$buildTools\apksigner.bat" sign --ks "$secrets\android.keystore" --ks-key-alias kelionai `
      --ks-pass "pass:$pass" --key-pass "pass:$pass" `
      --out app\build\outputs\apk\release\Kelionai.apk app\build\outputs\apk\release\app-aligned.apk
  }
  Step 'Android (sign AAB for Play)' {
    & "$env:JAVA_HOME\bin\jarsigner.exe" -keystore "$secrets\android.keystore" `
      -storepass $pass -keypass $pass `
      "$root\android\app\build\outputs\bundle\release\app-release.aab" kelionai
  }
  Copy-Item "$root\android\app\build\outputs\apk\release\Kelionai.apk" `
    "$root\frontend\public\downloads\Kelionai.apk" -Force
  Write-Host 'APK → frontend/public/downloads/Kelionai.apk'
  # Automatic Play publish — runs when the service-account key exists (see
  # android/PLAY-UPLOAD.md); otherwise prints the manual path and moves on.
  Step 'Android (publicare Play)' {
    Set-Location "$root\android"
    node publish-play.mjs
  }
}

Step 'Frontend build' {
  Set-Location "$root\frontend"
  npm run build
}
Step 'Backend build' {
  Set-Location "$root\backend"
  npm run build
}
Step 'Deploy (Railway)' {
  Set-Location $root
  railway up --detach
}

# Wait until the new bundle is actually served, then confirm health.
$bundle = (Select-String -Path "$root\frontend\dist\index.html" -Pattern 'index-[A-Za-z0-9_-]+\.js').Matches[0].Value
for ($i = 0; $i -lt 70; $i++) {
  Start-Sleep -Seconds 8
  try { $live = (Invoke-WebRequest -Uri 'https://kelionai.app/' -UseBasicParsing).Content } catch { continue }
  if ($live.Contains($bundle)) { Write-Host "LIVE: $bundle" -ForegroundColor Green; break }
}
$health = (Invoke-WebRequest -Uri 'https://kelionai.app/health' -UseBasicParsing).StatusCode
Write-Host "health: $health"
