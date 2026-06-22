param(
  [ValidateSet('patch', 'minor', 'major')][string]$Part = 'patch'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$versionPath = Join-Path $repoRoot 'VERSION'
$packagePath = Join-Path $repoRoot 'package.json'

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

Write-Host "Bumped version from $currentVersion to $newVersion"
