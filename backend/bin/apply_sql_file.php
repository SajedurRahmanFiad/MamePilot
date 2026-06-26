<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/bootstrap.php';

use App\Config;
use App\Database;

if ($argc < 2) {
    fwrite(STDERR, "Usage: php apply_sql_file.php path/to/file.sql\n");
    exit(2);
}

$path = $argv[1];
if (!is_file($path)) {
    fwrite(STDERR, "SQL file not found: {$path}\n");
    exit(2);
}

$config = Config::load(dirname(__DIR__, 2));
$db = new Database($config);
$pdo = $db->connect();

$sql = file_get_contents($path);
if ($sql === false) {
    fwrite(STDERR, "Failed to read SQL file: {$path}\n");
    exit(2);
}

$statements = preg_split('/;\s*(?:\r?\n|$)/', $sql) ?: [];
$executed = 0;

foreach ($statements as $statement) {
    $trim = trim($statement);
    if ($trim === '') continue;
    try {
        $pdo->exec($trim);
        $executed++;
    } catch (Throwable $e) {
        fwrite(STDERR, "Failed to execute statement: " . $e->getMessage() . "\nStatement: " . substr($trim, 0, 200) . "\n");
        exit(1);
    }
}

echo "Executed {$executed} statements from {$path}\n";
exit(0);
