param(
  [string]$ReleaseRoot = 'deploy/releases',
  [string]$PackageName = 'cpanel-mamepilot-package',
  [string]$VersionFile = 'VERSION',
  [switch]$SkipBuild,
  [switch]$NoZip
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$releaseRoot = Join-Path $repoRoot $ReleaseRoot
$packageZip = Join-Path $repoRoot "deploy/$PackageName.zip"
$versionSource = Join-Path $repoRoot $VersionFile
$versionTarget = Join-Path $releaseRoot 'VERSION'

if (-not (Test-Path $versionSource)) {
  throw "VERSION file not found: $versionSource"
}

Write-Host 'Preparing cPanel release package...'
Push-Location $repoRoot
try {
  $prepareArgs = @(
    '-ExecutionPolicy', 'Bypass',
    '-File', '.\scripts\prepare-cpanel-deploy.ps1'
  )
  if ($SkipBuild) { $prepareArgs += '-SkipBuild' }
  if ($NoZip) { $prepareArgs += '-NoZip' }
  $prepareArgs += @(
    '-PackageName', $PackageName
  )

  & powershell.exe @prepareArgs
  if ($LASTEXITCODE -ne 0) {
    throw "prepare-cpanel-deploy.ps1 failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}

if (-not $NoZip -and -not (Test-Path $packageZip)) {
  throw "Release ZIP was not created: $packageZip"
}

if (-not (Test-Path $releaseRoot)) {
  New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
}

Copy-Item -LiteralPath $versionSource -Destination $versionTarget -Force
if (-not $NoZip) {
  Copy-Item -LiteralPath $packageZip -Destination (Join-Path $releaseRoot "$PackageName.zip") -Force
}

Write-Host ''
Write-Host 'Central release package is ready.'
Write-Host "Release folder: $releaseRoot"
Write-Host "Version file: $versionTarget"
if (-not $NoZip) {
  Write-Host "Package ZIP: $(Join-Path $releaseRoot "$PackageName.zip")"
}
Write-Host ''
Write-Host 'Upload this folder to your central hosting location, then point UPDATE_VERSION_URL and UPDATE_RELEASE_URL to these files.'
