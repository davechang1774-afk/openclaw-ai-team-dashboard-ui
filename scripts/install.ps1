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
New-Item -ItemType Directory -Path $stockDir -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $templateDir "index.html") -Destination (Join-Path $targetDir "index.html") -Force
Copy-Item -LiteralPath (Join-Path $templateDir "dashboard.js") -Destination (Join-Path $targetDir "dashboard.js") -Force
Copy-Item -LiteralPath (Join-Path $templateDir "dashboard.css") -Destination (Join-Path $targetDir "dashboard.css") -Force

if (Test-Path -LiteralPath $assetsDir) {
  Remove-Item -LiteralPath $assetsDir -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $officialUi "assets") -Destination $assetsDir -Recurse -Force

foreach ($file in @("favicon.svg", "favicon-32.png", "apple-touch-icon.png", "favicon.ico")) {
  $source = Join-Path $officialUi $file
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $stockDir $file) -Force
  }
}

$jsAsset = Get-ChildItem -LiteralPath $assetsDir -Filter "index-*.js" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$cssAsset = Get-ChildItem -LiteralPath $assetsDir -Filter "index-*.css" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $jsAsset -or -not $cssAsset) {
  throw "未能在 OpenClaw 官方 assets 中找到 index-*.js / index-*.css"
}

$stockIndex = @"
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenClaw Control</title>
    <meta name="color-scheme" content="dark light" />
    <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
    <link rel="icon" type="image/png" sizes="32x32" href="./favicon-32.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png" />
    <script>
      (() => {
        const pathname = window.location.pathname.replace(/\/stock\/index\.html$/i, "");
        window.__OPENCLAW_CONTROL_UI_BASE_PATH__ = pathname === "/" ? "" : pathname;
        try {
          const key = "openclaw.control.settings.v1";
          const raw = window.localStorage.getItem(key);
          const current = raw ? JSON.parse(raw) : {};
          const session = new URL(window.location.href).searchParams.get("session");
          const next = { ...current, chatFocusMode: true, navCollapsed: true };
          if (session) {
            next.sessionKey = session;
            next.lastActiveSessionKey = session;
          }
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
        }
      })();
    </script>
    <script type="module" crossorigin src="../assets/$($jsAsset.Name)"></script>
    <link rel="stylesheet" crossorigin href="../assets/$($cssAsset.Name)" />
  </head>
  <body>
    <openclaw-app></openclaw-app>
  </body>
</html>
"@
Set-Content -LiteralPath (Join-Path $stockDir "index.html") -Value $stockIndex -Encoding UTF8

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
  previousRoot = $previousRoot
  backupTarget = $backupTarget
  backupConfig = $backupConfig
}
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $targetDir ".openclaw-ai-team-dashboard-install.json") -Encoding UTF8

try {
  $validation = & openclaw config validate 2>&1
} catch {
  $validation = $_.Exception.Message
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
