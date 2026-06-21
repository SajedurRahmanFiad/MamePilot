param(
  [string]$OutputFolder = 'central-license-api-package',
  [string]$DatabaseDsn = '',
  [string]$DatabaseUser = '',
  [string]$DatabasePass = '',
  [string]$OwnerToken = '',
  [string]$SigningSecret = '',
  [switch]$NoZip
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$deployRoot = Join-Path $repoRoot 'deploy'
$templatePath = Join-Path $deployRoot 'central-license-api-template.php'
$packageRoot = Join-Path $deployRoot $OutputFolder
$apiPath = Join-Path $packageRoot 'api.php'
$zipPath = Join-Path $deployRoot ($OutputFolder + '.zip')

if (-not (Test-Path $templatePath)) {
  throw "Central license template not found: $templatePath"
}

if (Test-Path $packageRoot) {
  $resolvedPackageRoot = (Resolve-Path $packageRoot).Path
  $resolvedDeployRoot = (Resolve-Path $deployRoot).Path
  if (-not $resolvedPackageRoot.StartsWith($resolvedDeployRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove path outside deploy folder: $resolvedPackageRoot"
  }
  Remove-Item -LiteralPath $resolvedPackageRoot -Recurse -Force
}

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

function ConvertTo-PhpSingleQuotedValue {
  param([string]$Value)
  return $Value.Replace('\', '\\').Replace("'", "\'")
}

function Set-PhpConst {
  param(
    [string]$Content,
    [string]$Name,
    [string]$Value
  )

  if ($Value -eq '') {
    return $Content
  }

  $escaped = ConvertTo-PhpSingleQuotedValue $Value
  return [regex]::Replace($Content, "const\s+$Name\s*=\s*'[^']*';", "const $Name = '$escaped';")
}

$content = Get-Content -Raw -LiteralPath $templatePath
$content = Set-PhpConst $content 'LICENSE_DB_DSN' $DatabaseDsn
$content = Set-PhpConst $content 'LICENSE_DB_USER' $DatabaseUser
$content = Set-PhpConst $content 'LICENSE_DB_PASS' $DatabasePass
$content = Set-PhpConst $content 'CENTRAL_OWNER_TOKEN' $OwnerToken
$content = Set-PhpConst $content 'RESPONSE_SIGNING_SECRET' $SigningSecret
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($apiPath, $content, $utf8NoBom)

if (-not $NoZip) {
  Compress-Archive -Path $apiPath -DestinationPath $zipPath -Force
}

Write-Host ''
Write-Host 'Central license API package is ready.'
Write-Host "Upload: $apiPath"
Write-Host 'cPanel target filename: api.php'
if (-not $NoZip) {
  Write-Host "Zip:    $zipPath"
}
