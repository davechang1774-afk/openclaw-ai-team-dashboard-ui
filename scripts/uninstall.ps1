param(
  [string]$OpenClawHome = (Join-Path $env:USERPROFILE ".openclaw")
)

$ErrorActionPreference = "Stop"

function Ensure-ObjectProperty {
  param(
    [Parameter(Mandatory = $true)]$Object,
    [Parameter(Mandatory = $true)][string]$Name
  )
  if (-not ($Object.PSObject.Properties.Name -contains $Name)) {
    $Object | Add-Member -MemberType NoteProperty -Name $Name -Value ([pscustomobject]@{})
  } elseif ($null -eq $Object.$Name) {
    $Object.$Name = [pscustomobject]@{}
  }
}

$targetDir = Join-Path $OpenClawHome "control-ui-dashboard"
$configPath = Join-Path $OpenClawHome "openclaw.json"
$manifestPath = Join-Path $targetDir ".openclaw-ai-team-dashboard-install.json"

$manifest = $null
if (Test-Path -LiteralPath $manifestPath) {
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
}

if (Test-Path -LiteralPath $configPath) {
  $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  Ensure-ObjectProperty -Object $cfg -Name "gateway"
  Ensure-ObjectProperty -Object $cfg.gateway -Name "controlUi"
  if ($cfg.gateway.controlUi.root -eq $targetDir) {
    if ($manifest -and $manifest.previousRoot) {
      $cfg.gateway.controlUi.root = $manifest.previousRoot
    } else {
      $cfg.gateway.controlUi.PSObject.Properties.Remove("root")
    }
    $cfg | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $configPath -Encoding UTF8
  }
}

if (Test-Path -LiteralPath $targetDir) {
  Remove-Item -LiteralPath $targetDir -Recurse -Force
}

if ($manifest -and $manifest.backupTarget -and (Test-Path -LiteralPath $manifest.backupTarget)) {
  Move-Item -LiteralPath $manifest.backupTarget -Destination $targetDir
}

Write-Host ""
Write-Host "卸载完成。" -ForegroundColor Green
Write-Host "如有需要，请重启 OpenClaw gateway。" -ForegroundColor Yellow
