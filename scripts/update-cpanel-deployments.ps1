param(
  [string]$Inventory = 'deploy/deployments.csv',
  [switch]$CheckOnly,
  [switch]$InvokeRemote,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$inventoryPath = Join-Path $repoRoot $Inventory

if (-not (Test-Path $inventoryPath)) {
  throw "Deployment inventory not found: $inventoryPath. Copy deploy/deployments.example.csv to deploy/deployments.csv and fill it in."
}

$deployments = Import-Csv $inventoryPath | Where-Object {
  $_.enabled -ne $null -and $_.enabled.ToString().Trim() -ne '' -and $_.enabled.ToString().Trim() -ne '0' -and $_.enabled.ToString().Trim().ToLower() -ne 'false'
}

if ($deployments.Count -eq 0) {
  Write-Host 'No enabled deployments found.'
  exit 0
}

foreach ($deployment in $deployments) {
  $appRoot = $deployment.app_root
  $serverHost = $deployment.host
  $user = $deployment.user

  if ([string]::IsNullOrWhiteSpace($appRoot)) {
    Write-Host "[$($deployment.id)] $($deployment.name): skipped because app_root is empty." -ForegroundColor Yellow
    continue
  }

  $remoteCommand = "cd '$appRoot' && php backend/bin/update.php"
  if ($CheckOnly) {
    $remoteCommand += ' --check'
  }

  $target = if ([string]::IsNullOrWhiteSpace($serverHost) -or [string]::IsNullOrWhiteSpace($user)) {
    'local/manual'
  } else {
    "$user@$serverHost"
  }

  Write-Host ''
  Write-Host "[$($deployment.id)] $($deployment.name) -> $target" -ForegroundColor Cyan
  Write-Host "Command: $remoteCommand"

  if ($WhatIf) {
    Write-Host '[what-if] Not executing command.' -ForegroundColor Yellow
    continue
  }

  if ($InvokeRemote) {
    if ([string]::IsNullOrWhiteSpace($serverHost) -or [string]::IsNullOrWhiteSpace($user)) {
      Write-Host 'Skipped remote execution because host or user is empty.' -ForegroundColor Yellow
      continue
    }

    ssh "$user@$serverHost" $remoteCommand
    if ($LASTEXITCODE -ne 0) {
      Write-Host "[$($deployment.id)] Command failed with exit code $LASTEXITCODE." -ForegroundColor Red
    }
  } else {
    Write-Host 'Run with -InvokeRemote to execute through SSH, or copy the command manually.'
  }
}
