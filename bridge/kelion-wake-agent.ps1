# AGENTUL KELION (v-final) — REPARAT, nu sters. Ce face:
#   - O SINGURA instanta (mutex). Ruleaza ASCUNS (fara nicio fereastra).
#   - Cand Adrian deschide aplicatia (wake) trage ordinele de lucru si le EXECUTA
#     headless cu `claude -p` (Read/Edit/Write/Bash) — INVIZIBIL, zero popup.
#   - Raporteaza pe monitor fiecare pas (heartbeat) ca Adrian sa vada live.
#   - NU publica singur: dupa ce construieste, STAGEAZA un release; Adrian aproba
#     din tab-ul Admin "Release-uri" -> abia atunci se face deploy.
# Astfel: invizibil + chiar lucreaza + sigur (poarta de aprobare).
$ErrorActionPreference = 'SilentlyContinue'
$mutex = New-Object System.Threading.Mutex($false, 'Global\KelionWakeAgent')
if (-not $mutex.WaitOne(0)) { exit 0 }

$repo = 'C:\Users\adria\Kelionai'
$base = 'https://kelionai.app'
$secretFile = 'C:\Users\adria\Kelionai-secrets\bridge-secret.txt'
function Get-Secret {
  if (Test-Path $secretFile) { return (Get-Content $secretFile -Raw).Trim() }
  Push-Location $repo; try { $v = railway variables --json | ConvertFrom-Json; return ('' + $v.BRIDGE_SECRET).Trim() } finally { Pop-Location }
}
$sec = Get-Secret
if (-not $sec) { $mutex.ReleaseMutex(); exit 1 }
$H = @{ 'x-bridge-secret' = $sec }

function Find-Claude {
  $root = Join-Path $env:APPDATA 'Claude\claude-code'
  if (Test-Path $root) {
    foreach ($v in (Get-ChildItem $root | Sort-Object Name -Descending)) {
      $exe = Join-Path $v.FullName 'claude.exe'; if (Test-Path $exe) { return $exe }
    }
  }
  $c = (Get-Command claude -ErrorAction SilentlyContinue); if ($c) { return $c.Source }
  return $null
}
function Beat($line) {
  try { Invoke-RestMethod -Uri "$base/api/dev/heartbeat" -Method Post -Headers $H -ContentType 'application/json' -Body (@{ activity = @($line) } | ConvertTo-Json -Compress) -TimeoutSec 8 | Out-Null } catch {}
}

while ($true) {
  try {
    $wo = Invoke-RestMethod -Uri "$base/api/bridge/workorders" -Headers $H -TimeoutSec 15
    foreach ($o in @($wo.orders)) {
      $t = $o.text
      Beat("In executie: " + $t.Substring(0, [Math]::Min(120, $t.Length)))
      $claude = Find-Claude
      if (-not $claude) { Beat('claude.exe negasit — deschide aplicatia Claude o data'); continue }
      $prompt = "Esti constructorul Kelionai, in repo-ul $repo. Sarcina lui Adrian: `"$t`". Rezolv-o: editeaza codul, compileaza (npm run build in backend SI frontend) pana trece. NU face deploy, NU rula railway up. La final scrie dupa 'SUMAR:' pe o linie ce ai schimbat."
      # HEADLESS: ruleaza in consola ascunsa a acestui proces -> fara fereastra.
      Push-Location $repo
      $model = if ($env:KELION_TOP_MODEL) { $env:KELION_TOP_MODEL } else { 'claude-opus-4-8' }
      $out = & $claude -p $prompt --model $model --allowedTools 'Read,Edit,Write,Bash' 2>&1 | Out-String
      $diff = (& git diff --stat 2>&1 | Out-String)
      Pop-Location
      $sumMatch = [regex]::Match($out, 'SUMAR:\s*(.+)')
      $title = if ($sumMatch.Success) { $sumMatch.Groups[1].Value.Trim() } else { $t }
      $detail = "Ordin: $t`n`n--- ce s-a schimbat ---`n$diff`n`n--- note ---`n" + $out.Substring([Math]::Max(0, $out.Length - 2000))
      try { Invoke-RestMethod -Uri "$base/api/bridge/stage-release" -Method Post -Headers $H -ContentType 'application/json' -Body (@{ title = $title.Substring(0,[Math]::Min(180,$title.Length)); detail = $detail } | ConvertTo-Json -Compress) -TimeoutSec 15 | Out-Null } catch {}
      Beat("Gata (asteapta aprobare in Release-uri): " + $title.Substring(0, [Math]::Min(100, $title.Length)))
    }
  } catch {}
  Start-Sleep -Seconds 12
}
