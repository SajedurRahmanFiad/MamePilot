<?php

declare(strict_types=1);

// Security tombstone for deployments that previously published an
// unauthenticated background update trigger. Keep this file in release and git
// artifacts so the unsafe legacy endpoint is overwritten during upgrades.
http_response_code(410);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo json_encode([
    'error' => 'This legacy update endpoint is disabled.',
    'message' => 'Use the scheduled CLI updater or the secret-protected api/update.php endpoint.',
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
