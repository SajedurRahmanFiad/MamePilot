param(
  [string]$SchemaFile = 'backend/database/schema.sql',
  [string]$MigrationsDirectory = 'migrations',
  [string]$OutputFile = 'backend/database/schema-only.sql'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$schemaPath = Join-Path $repoRoot $SchemaFile
$migrationsPath = Join-Path $repoRoot $MigrationsDirectory
$outputPath = Join-Path $repoRoot $OutputFile

if (-not (Test-Path -LiteralPath $schemaPath)) { throw "Schema file not found: $schemaPath" }
if (-not (Test-Path -LiteralPath $migrationsPath)) { throw "Migrations directory not found: $migrationsPath" }

function Split-SqlStatements([string]$Sql) {
  $statements = New-Object System.Collections.Generic.List[string]
  $buffer = New-Object System.Text.StringBuilder
  $quote = [char]0

  for ($i = 0; $i -lt $Sql.Length; $i++) {
    $char = $Sql[$i]
    if ($quote -ne [char]0) {
      [void]$buffer.Append($char)
      if ($char -eq $quote) {
        if ($i + 1 -lt $Sql.Length -and $Sql[$i + 1] -eq $quote) {
          [void]$buffer.Append($Sql[$i + 1])
          $i++
        } else {
          $quote = [char]0
        }
      }
      continue
    }
    if ($char -eq "'" -or $char -eq '"' -or $char -eq '`') {
      $quote = $char
      [void]$buffer.Append($char)
      continue
    }
    if ($char -eq ';') {
      $statement = $buffer.ToString().Trim()
      if ($statement) { $statements.Add($statement) }
      [void]$buffer.Clear()
      continue
    }
    [void]$buffer.Append($char)
  }

  $last = $buffer.ToString().Trim()
  if ($last) { $statements.Add($last) }
  return $statements
}

function Split-TopLevelComma([string]$Text) {
  $parts = New-Object System.Collections.Generic.List[string]
  $buffer = New-Object System.Text.StringBuilder
  $quote = [char]0
  $depth = 0

  for ($i = 0; $i -lt $Text.Length; $i++) {
    $char = $Text[$i]
    if ($quote -ne [char]0) {
      [void]$buffer.Append($char)
      if ($char -eq $quote) {
        if ($i + 1 -lt $Text.Length -and $Text[$i + 1] -eq $quote) {
          [void]$buffer.Append($Text[$i + 1])
          $i++
        } else {
          $quote = [char]0
        }
      }
      continue
    }
    if ($char -eq "'" -or $char -eq '"' -or $char -eq '`') {
      $quote = $char
      [void]$buffer.Append($char)
      continue
    }
    if ($char -eq '(') { $depth++ }
    if ($char -eq ')') { $depth-- }
    if ($char -eq ',' -and $depth -eq 0) {
      $parts.Add($buffer.ToString().Trim())
      [void]$buffer.Clear()
      continue
    }
    [void]$buffer.Append($char)
  }

  $last = $buffer.ToString().Trim()
  if ($last) { $parts.Add($last) }
  return $parts
}

function Quote-SqlLiteral([string]$Value) {
  return $Value.Replace("'", "''")
}

function Convert-AlterTable([string]$Statement, [string]$SourceName) {
  $match = [regex]::Match($Statement, '(?is)^\s*ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?\s+(.+)$')
  if (-not $match.Success) { throw "Could not parse ALTER TABLE in $SourceName" }
  $table = $match.Groups[1].Value
  $clauses = Split-TopLevelComma $match.Groups[2].Value
  $output = New-Object System.Collections.Generic.List[string]

  foreach ($clause in $clauses) {
    $column = [regex]::Match($clause, '(?is)^\s*ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?\s+(.+)$')
    if ($column.Success) {
      $definition = Quote-SqlLiteral $column.Groups[2].Value.Trim()
      $output.Add("CALL sp_add_col('$table', '$($column.Groups[1].Value)', '$definition');")
      continue
    }

    $index = [regex]::Match($clause, '(?is)^\s*ADD\s+(?:KEY|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?\s*\((.+)\)$')
    if ($index.Success) {
      $columns = Quote-SqlLiteral $index.Groups[2].Value.Trim()
      $output.Add("CALL sp_create_idx('$table', '$($index.Groups[1].Value)', '$columns');")
      continue
    }

    throw "Unsupported ALTER TABLE clause in ${SourceName}: $clause"
  }
  return ($output -join "`r`n")
}

function Convert-SchemaSource([string]$Sql, [string]$SourceName) {
  $output = New-Object System.Collections.Generic.List[string]
  foreach ($statement in (Split-SqlStatements $Sql)) {
    $core = ([regex]::Replace($statement, '(?m)^\s*--[^\r\n]*(?:\r?\n|$)', '')).Trim()
    if (-not $core) { continue }

    if ($core -match '(?is)^(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE)\b') {
      $output.Add("-- Skipped data-mutating statement from $SourceName.")
      continue
    }
    if ($core -match '(?is)^ALTER\s+TABLE\b') {
      $output.Add((Convert-AlterTable $core $SourceName))
      continue
    }

    $createIndex = [regex]::Match($core, '(?is)^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?\s+ON\s+`?([A-Za-z0-9_]+)`?\s*\((.+)\)$')
    if ($createIndex.Success) {
      $columns = Quote-SqlLiteral $createIndex.Groups[3].Value.Trim()
      $output.Add("CALL sp_create_idx('$($createIndex.Groups[2].Value)', '$($createIndex.Groups[1].Value)', '$columns');")
      continue
    }

    $output.Add($statement.Trim() + ';')
  }
  return ($output -join "`r`n`r`n")
}

$helpers = @'
-- Helper procedures make additive column and index upgrades idempotent on
-- MariaDB and MySQL versions that do not support every IF NOT EXISTS form.
DROP PROCEDURE IF EXISTS sp_add_col;
DELIMITER $$
CREATE PROCEDURE sp_add_col(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_create_idx;
DELIMITER $$
CREATE PROCEDURE sp_create_idx(IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_columns TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND INDEX_NAME = p_index
  ) THEN
    SET @sql = CONCAT('CREATE INDEX `', p_index, '` ON `', p_table, '` (', p_columns, ')');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END $$
DELIMITER ;
'@

$sections = New-Object System.Collections.Generic.List[string]
$sections.Add('-- MamePilot production-safe schema-only migration.')
$sections.Add('-- Generated from backend/database/schema.sql plus migrations/*.sql.')
$sections.Add('-- Contains additive DDL only: no seed inserts and no business-row updates.')
$sections.Add($helpers.Trim())
$schema = Get-Content -LiteralPath $schemaPath -Raw -Encoding UTF8
$sections.Add((Convert-SchemaSource $schema $SchemaFile))

foreach ($migration in (Get-ChildItem -LiteralPath $migrationsPath -File -Filter '*.sql' | Sort-Object Name)) {
  $migrationSql = Get-Content -LiteralPath $migration.FullName -Raw -Encoding UTF8
  $sections.Add("-- Migration: $($migration.Name)`r`n" + (Convert-SchemaSource $migrationSql $migration.Name))
}

$sections.Add("DROP PROCEDURE IF EXISTS sp_add_col;`r`nDROP PROCEDURE IF EXISTS sp_create_idx;")
$content = ($sections -join "`r`n`r`n").TrimEnd() + "`r`n"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outputPath, $content, $utf8NoBom)
Write-Host "Synced $OutputFile from schema plus additive migration DDL"
