<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\ExternalDataApi;

function externalApiRouteAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

externalApiRouteAssert(ExternalDataApi::matchesPath('/api/v1/orders'), 'Deployed REST paths should match.');
externalApiRouteAssert(ExternalDataApi::matchesPath('/v1/orders'), 'Local proxied REST paths should match.');
externalApiRouteAssert(!ExternalDataApi::matchesPath('/api/index.php'), 'Legacy action routes should not match REST routing.');
externalApiRouteAssert(!ExternalDataApi::matchesPath('/api/v1-old/orders'), 'Lookalike version paths should not match.');

echo "External API routing tests passed.\n";