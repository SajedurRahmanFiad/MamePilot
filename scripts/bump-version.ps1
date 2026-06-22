param(
  [ValidateSet('patch', 'minor', 'major')][string]$Part = 'patch'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$versionPath = Join-Path $repoRoot 'VERSION'
$packagePath = Join-Path $repoRoot 'package.json'

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
  'patch' { $parts[2]++ }
}

$newVersion = '{0}.{1}.{2}' -f $parts[0], $parts[1], $parts[2]
Write-Utf8NoBom -Path $versionPath -Value "$newVersion`n"

$packageJson = Get-Content $packagePath -Raw
$packageJson = $packageJson.TrimStart([char]0xFEFF)
$packageJson = $packageJson -replace '"version"\s*:\s*"[^"]*"', "`"version`": `"$newVersion`""
Write-Utf8NoBom -Path $packagePath -Value $packageJson

Write-Host "Bumped version from $currentVersion to $newVersion"
