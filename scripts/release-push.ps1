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

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

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
  'patch' { 
    if ($parts[2] -ge 99) {
      $parts[1]++
      $parts[2] = 0
    } else {
      $parts[2]++
    }
  }
}

$newVersion = '{0}.{1}.{2}' -f $parts[0], $parts[1], $parts[2]
Write-Utf8NoBom -Path $versionPath -Value "$newVersion`n"

$packageJson = Get-Content $packagePath -Raw
$packageJson = $packageJson.TrimStart([char]0xFEFF)
$packageJson = $packageJson -replace '"version"\s*:\s*"[^"]*"', "`"version`": `"$newVersion`""
Write-Utf8NoBom -Path $packagePath -Value $packageJson

Write-Host 'Building frontend before release...'
Push-Location $repoRoot
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }
}
finally {
  Pop-Location
}

Write-Host 'Synchronizing production-safe schema-only artifact...'
Push-Location $repoRoot
try {
  & powershell.exe -ExecutionPolicy Bypass -File '.\scripts\sync-schema-only.ps1'
  if ($LASTEXITCODE -ne 0) { throw "sync-schema-only.ps1 failed with exit code $LASTEXITCODE" }
}
finally {
  Pop-Location
}

Write-Host 'Preparing cPanel auto-update release package...'
Push-Location $repoRoot
try {
  & powershell.exe -ExecutionPolicy Bypass -File '.\scripts\publish-cpanel-release.ps1' -SkipBuild
  if ($LASTEXITCODE -ne 0) { throw "publish-cpanel-release.ps1 failed with exit code $LASTEXITCODE" }
}
finally {
  Pop-Location
}

Push-Location $repoRoot
try {
  git add .

  $commitMessage = if ($Message.Trim() -ne '') { $Message.Trim() } else { "Release v$newVersion" }
  git commit -m $commitMessage
  if (-not $NoPush) { git push }
}
finally {
  Pop-Location
}

Write-Host "Released v$newVersion"
