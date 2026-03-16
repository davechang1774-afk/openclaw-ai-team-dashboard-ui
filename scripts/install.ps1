param(
  [string]$OpenClawHome = (Join-Path $env:USERPROFILE ".openclaw")
)

$ErrorActionPreference = "Stop"

function Get-OpenClawControlUiPath {
  $candidates = @()
  try {
    $npmRoot = (& npm root -g 2>$null | Select-Object -First 1)
    if ($npmRoot) {
      $candidates += (Join-Path $npmRoot "openclaw\\dist\\control-ui")
    }
  } catch {
  }
  if ($env:APPDATA) {
    $candidates += (Join-Path $env:APPDATA "npm\\node_modules\\openclaw\\dist\\control-ui")
  }
  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }
  throw "未找到 OpenClaw 官方 control-ui 目录。请先确认 openclaw 已通过 npm 全局安装。"
}

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

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$templateDir = Join-Path $repoRoot "template"
$targetDir = Join-Path $OpenClawHome "control-ui-dashboard"
$stockDir = Join-Path $targetDir "stock"
$assetsDir = Join-Path $targetDir "assets"
$officialIndexFile = Join-Path $targetDir "official-index-current.txt"
$configPath = Join-Path $OpenClawHome "openclaw.json"
$officialUi = Get-OpenClawControlUiPath
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

if (-not (Test-Path -LiteralPath $configPath)) {
  throw "未找到 OpenClaw 配置文件：$configPath"
}

$backupTarget = $null
if (Test-Path -LiteralPath $targetDir) {
  $backupTarget = Join-Path $OpenClawHome "control-ui-dashboard.backup_$timestamp"
  Move-Item -LiteralPath $targetDir -Destination $backupTarget
}

$backupConfig = Join-Path $OpenClawHome "openclaw.json.backup_${timestamp}_ui_installer"
Copy-Item -LiteralPath $configPath -Destination $backupConfig -Force

New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $templateDir "index.html") -Destination (Join-Path $targetDir "index.html") -Force
Copy-Item -LiteralPath (Join-Path $templateDir "bootstrap.js") -Destination (Join-Path $targetDir "bootstrap.js") -Force
Copy-Item -LiteralPath (Join-Path $templateDir "dashboard.js") -Destination (Join-Path $targetDir "dashboard.js") -Force
Copy-Item -LiteralPath (Join-Path $templateDir "dashboard.css") -Destination (Join-Path $targetDir "dashboard.css") -Force

foreach ($path in @($stockDir, $assetsDir, $officialIndexFile)) {
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}

foreach ($file in @("favicon.svg", "favicon-32.png", "apple-touch-icon.png", "favicon.ico")) {
  $source = Join-Path $officialUi $file
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $targetDir $file) -Force
  }
}

$assetsLinkOutput = & cmd /c "mklink /J `"$assetsDir`" `"$($officialUi)\assets`"" 2>&1
if (-not (Test-Path -LiteralPath $assetsDir)) {
  throw "未能创建 assets 联接目录：$assetsLinkOutput"
}

Copy-Item -LiteralPath (Join-Path $officialUi "index.html") -Destination $officialIndexFile -Force

$cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
Ensure-ObjectProperty -Object $cfg -Name "gateway"
Ensure-ObjectProperty -Object $cfg.gateway -Name "controlUi"
$previousRoot = $cfg.gateway.controlUi.root
$cfg.gateway.controlUi.root = $targetDir
$cfg | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $configPath -Encoding UTF8

$manifest = [pscustomobject]@{
  installedAt = (Get-Date).ToString("s")
  openClawHome = $OpenClawHome
  targetDir = $targetDir
  officialUi = $officialUi
  stockMode = "root-loader"
  previousRoot = $previousRoot
  backupTarget = $backupTarget
  backupConfig = $backupConfig
}
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $targetDir ".openclaw-ai-team-dashboard-install.json") -Encoding UTF8

$defaultHome = Join-Path $env:USERPROFILE ".openclaw"
$resolvedOpenClawHome = [System.IO.Path]::GetFullPath($OpenClawHome)
$resolvedDefaultHome = [System.IO.Path]::GetFullPath($defaultHome)

if ($resolvedOpenClawHome -ieq $resolvedDefaultHome) {
  try {
    $validation = & openclaw config validate 2>&1
  } catch {
    $validation = $_.Exception.Message
  }
} else {
  $validation = "已跳过 OpenClaw CLI 验证：当前安装目标不是默认 ~/.openclaw。OpenClaw 目前不支持对自定义 OpenClawHome 直接执行 config validate，但文件复制和配置写入已完成。"
}

Write-Host ""
Write-Host "安装完成。" -ForegroundColor Green
Write-Host "UI 目录: $targetDir"
Write-Host "配置备份: $backupConfig"
if ($backupTarget) {
  Write-Host "旧 UI 备份: $backupTarget"
}
Write-Host ""
Write-Host "配置校验结果:"
Write-Host $validation
Write-Host ""
Write-Host "请重启 OpenClaw gateway 以应用新 UI。" -ForegroundColor Yellow
