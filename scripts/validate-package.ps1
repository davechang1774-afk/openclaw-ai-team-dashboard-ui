param()

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$requiredFiles = @(
  "README.md",
  "NOTICE.md",
  "CHANGELOG.md",
  "LICENSE-STATUS.md",
  "template\\index.html",
  "template\\dashboard.js",
  "template\\dashboard.css",
  "scripts\\install.ps1",
  "scripts\\uninstall.ps1",
  "scripts\\install.cmd",
  "scripts\\uninstall.cmd",
  "docs\\TROUBLESHOOTING.md",
  ".github\\workflows\\validate-package.yml"
)

$missing = @()
foreach ($relativePath in $requiredFiles) {
  $absolutePath = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $absolutePath)) {
    $missing += $relativePath
  }
}

if ($missing.Count -gt 0) {
  Write-Host "缺少以下文件：" -ForegroundColor Red
  $missing | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}

foreach ($scriptName in @("install.ps1", "uninstall.ps1", "validate-package.ps1")) {
  $scriptPath = Join-Path $repoRoot ("scripts\\" + $scriptName)
  $null = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$errors) | Out-Null
  if ($errors.Count -gt 0) {
    Write-Host "PowerShell 语法错误：$scriptName" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host $_.Message -ForegroundColor Red }
    exit 1
  }
}

Write-Host "包体检查通过。" -ForegroundColor Green
Write-Host "模板、脚本、文档与工作流均存在。"
