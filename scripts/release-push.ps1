param(
  [ValidateSet('patch', 'minor', 'major')][string]$Part = 'patch',
  [string]$Message = '',
  [switch]$NoPush
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$versionPath = Join-Path $repoRoot 'VERSION'
$packagePath = Join-Path $repoRoot 'package.json'
$schemaPath = Join-Path $repoRoot 'backend\database\schema.sql'
$seedPath = Join-Path $repoRoot 'backend\database\seed.sql'
$schemaOnlyPath = Join-Path $repoRoot 'backend\database\schema-only.sql'

if (-not (Test-Path $versionPath)) {
  throw "VERSION file not found: $versionPath"
}
if (-not (Test-Path $packagePath)) {
  throw "package.json not found: $packagePath"
}

$currentVersion = (Get-Content $versionPath -Raw).Trim()
if ($currentVersion -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') {
  throw "Invalid VERSION value: $currentVersion"
}

$baseVersion = $currentVersion -replace '[-+].*$', ''
$parts = $baseVersion -split '\.' | ForEach-Object { [int]$_ }
if ($parts.Count -ne 3) {
  throw "VERSION must be semantic version format MAJOR.MINOR.PATCH: $currentVersion"
}

switch ($Part) {
  'major' { $parts[0]++; $parts[1] = 0; $parts[2] = 0 }
  'minor' { $parts[1]++; $parts[2] = 0 }
  'patch' { $parts[2]++ }
}

$newVersion = '{0}.{1}.{2}' -f $parts[0], $parts[1], $parts[2]
Set-Content -Path $versionPath -Value "$newVersion`n" -Encoding utf8

$packageJson = Get-Content $packagePath -Raw
$packageJson = $packageJson -replace '"version"\s*:\s*"[^"]*"', "`"version`": `"$newVersion`""
Set-Content -Path $packagePath -Value $packageJson -Encoding utf8

Write-Host 'Building frontend before release...'
Push-Location $repoRoot
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }
}
finally {
  Pop-Location
}

Push-Location $repoRoot
try {
  & powershell.exe -ExecutionPolicy Bypass -File '.\scripts\sync-schema-only.ps1'
  if ($LASTEXITCODE -ne 0) { throw "sync-schema-only.ps1 failed with exit code $LASTEXITCODE" }

  git add VERSION package.json
  if (Test-Path (Join-Path $repoRoot 'dist')) { git add dist }
  if (Test-Path $schemaPath) { git add backend/database/schema.sql }
  if (Test-Path $seedPath) { git add backend/database/seed.sql }
  if (Test-Path $schemaOnlyPath) { git add backend/database/schema-only.sql }
  if (Test-Path (Join-Path $repoRoot 'docs\AUTOMATIC_DEPLOYMENTS.md')) { git add docs/AUTOMATIC_DEPLOYMENTS.md }
  if (Test-Path (Join-Path $repoRoot 'CPANEL_DEPLOYMENT_GUIDE.md')) { git add CPANEL_DEPLOYMENT_GUIDE.md }
  if (Test-Path (Join-Path $repoRoot '.env.example')) { git add .env.example }
  git add scripts/release-push.ps1 scripts/sync-schema-only.ps1

  $commitMessage = if ($Message.Trim() -ne '') { $Message.Trim() } else { "Release v$newVersion" }
  git commit -m $commitMessage
  if (-not $NoPush) { git push }
}
finally {
  Pop-Location
}

Write-Host "Released v$newVersion"
