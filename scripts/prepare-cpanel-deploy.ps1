param(
  [string]$DocumentRootFolder = 'public_html',
  [string]$BackendFolder = 'mamepilot_backend',
  [string]$PackageName = 'cpanel-mamepilot-package',
  [switch]$SkipBuild,
  [switch]$NoZip
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$deployRoot = Join-Path $repoRoot 'deploy'
$templateRoot = Join-Path $deployRoot 'cpanel-template'
$packageRoot = Join-Path $deployRoot $PackageName
$publicRoot = Join-Path $packageRoot $DocumentRootFolder
$appRoot = Join-Path $packageRoot $BackendFolder
$zipPath = Join-Path $deployRoot ($PackageName + '.zip')

if (-not $SkipBuild) {
  Write-Host 'Building frontend...'
  Push-Location $repoRoot
  try {
    npm run build
  }
  finally {
    Pop-Location
  }
}

if (Test-Path $packageRoot) {
  Remove-Item $packageRoot -Recurse -Force
}

if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

New-Item -ItemType Directory -Path $publicRoot -Force | Out-Null
New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $publicRoot 'api') -Force | Out-Null

Write-Host 'Copying frontend build...'
Copy-Item -Path (Join-Path $repoRoot 'dist\*') -Destination $publicRoot -Recurse -Force

Write-Host 'Copying cPanel frontend template...'
Copy-Item -LiteralPath (Join-Path $templateRoot 'public_html\.htaccess') -Destination (Join-Path $publicRoot '.htaccess') -Force
Copy-Item -LiteralPath (Join-Path $templateRoot 'public_html\api\.htaccess') -Destination (Join-Path $publicRoot 'api\.htaccess') -Force
Copy-Item -LiteralPath (Join-Path $templateRoot 'public_html\api\index.php') -Destination (Join-Path $publicRoot 'api\index.php') -Force
Copy-Item -LiteralPath (Join-Path $templateRoot 'public_html\api\update.php') -Destination (Join-Path $publicRoot 'api\update.php') -Force

Write-Host 'Copying backend app...'
Copy-Item -Path (Join-Path $repoRoot 'backend') -Destination (Join-Path $appRoot 'backend') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repoRoot '.env.example') -Destination (Join-Path $appRoot '.env.example') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'VERSION') -Destination (Join-Path $appRoot 'VERSION') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'VERSION') -Destination (Join-Path $packageRoot 'VERSION') -Force
foreach ($guideName in @('CPANEL_DEPLOYMENT_GUIDE.md', 'CPANEL_DEPLOYMENT.md', 'SUPABASE_TO_MARIADB_REFRESH.md')) {
  $guidePath = Join-Path $repoRoot $guideName
  if (Test-Path $guidePath) {
    Copy-Item -LiteralPath $guidePath -Destination (Join-Path $packageRoot $guideName) -Force
  }
}
$autoDeployGuide = Join-Path $repoRoot 'docs\AUTOMATIC_DEPLOYMENTS.md'
if (Test-Path $autoDeployGuide) {
  $docsDir = Join-Path $packageRoot 'docs'
  if (-not (Test-Path $docsDir)) { New-Item -ItemType Directory -Path $docsDir -Force | Out-Null }
  Copy-Item -LiteralPath $autoDeployGuide -Destination (Join-Path $docsDir 'AUTOMATIC_DEPLOYMENTS.md') -Force
}
$serverOpsGuide = Join-Path $repoRoot 'SERVER_OPS_ACTION_GUIDE.md'
if (Test-Path $serverOpsGuide) {
  Copy-Item -LiteralPath $serverOpsGuide -Destination (Join-Path $packageRoot 'SERVER_OPS_ACTION_GUIDE.md') -Force
}

$backendEnv = Join-Path $appRoot 'backend\.env'
$backendEnvLocal = Join-Path $appRoot 'backend\.env.local'
if (Test-Path $backendEnv) { Remove-Item $backendEnv -Force }
if (Test-Path $backendEnvLocal) { Remove-Item $backendEnvLocal -Force }

if (-not $NoZip) {
  Write-Host 'Creating ZIP package...'
  $zipCreated = $false
  for ($attempt = 1; $attempt -le 3 -and -not $zipCreated; $attempt++) {
    try {
      if ($attempt -gt 1) {
        Write-Host "Retrying ZIP creation (attempt $attempt of 3)..."
        Start-Sleep -Seconds 2
      }

      Compress-Archive -Path (Join-Path $packageRoot '*') -DestinationPath $zipPath -Force
      $zipCreated = $true
    }
    catch {
      if ($attempt -eq 3) {
        throw
      }
    }
  }
}

Write-Host ''
Write-Host 'cPanel package is ready.'
Write-Host "Docroot: $DocumentRootFolder"
Write-Host "Backend: $BackendFolder"
Write-Host "Folder: $packageRoot"
if (-not $NoZip) {
  Write-Host "Zip:    $zipPath"
}
