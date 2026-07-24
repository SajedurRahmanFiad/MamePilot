<?php

declare(strict_types=1);

require_once __DIR__ . '/../backend/src/AgentModelProtocol.php';
require_once __DIR__ . '/../backend/src/AgentSqlGuard.php';
require_once __DIR__ . '/../backend/src/AgentActionBundle.php';
require_once __DIR__ . '/../backend/src/AgentLanguagePolicy.php';
require_once __DIR__ . '/../backend/src/AgentToolRegistry.php';

use App\AgentActionBundle;
use App\AgentLanguagePolicy;
use App\AgentModelProtocol;
use App\AgentSqlGuard;
use App\AgentToolRegistry;

$checks = 0;

$assert = static function (bool $condition, string $message) use (&$checks): void {
    $checks++;
    if (!$condition) throw new RuntimeException($message);
};

$assertSame = static function (mixed $expected, mixed $actual, string $message) use ($assert): void {
    $assert($expected === $actual, $message . ' Expected ' . var_export($expected, true) . ', got ' . var_export($actual, true) . '.');
};

$expectFailure = static function (callable $callback, string $messagePart) use ($assert): void {
    try {
        $callback();
    } catch (Throwable $exception) {
        $assert(str_contains(strtolower($exception->getMessage()), strtolower($messagePart)), 'Unexpected error: ' . $exception->getMessage());
        return;
    }
    throw new RuntimeException('Expected failure containing: ' . $messagePart);
};

$assertSame(AgentLanguagePolicy::ENGLISH, AgentLanguagePolicy::preferredFor('Who are you?'), 'English questions should receive English responses.');
$assertSame(AgentLanguagePolicy::BENGALI, AgentLanguagePolicy::preferredFor('Oi'), 'Ambiguous Bangladeshi Romanized greetings should default to Bengali.');
$assertSame(AgentLanguagePolicy::BENGALI, AgentLanguagePolicy::preferredFor('Tumi ke?'), 'Romanized Bengali questions should receive Bengali responses.');
$englishIdentity = AgentLanguagePolicy::directDecision('Who are you?');
$assertSame('direct', $englishIdentity['route'] ?? '', 'Identity questions should use the safe direct route.');
$assert(str_contains((string) ($englishIdentity['answer'] ?? ''), 'MamePilot') && !str_contains((string) ($englishIdentity['answer'] ?? ''), 'Gemini'), 'Mame should identify as Mame without exposing its provider.');
$bengaliGreeting = AgentLanguagePolicy::directDecision('Oi');
$assert(preg_match('/[\x{0980}-\x{09FF}]/u', (string) ($bengaliGreeting['answer'] ?? '')) === 1, 'Romanized Bengali greetings should produce Bengali script.');
$assert(AgentLanguagePolicy::isAllowedPublicOutput('Hello! How can I help you?', AgentLanguagePolicy::ENGLISH), 'English output should be allowed.');
$assert(AgentLanguagePolicy::isAllowedPublicOutput('হ্যালো! কীভাবে সাহায্য করতে পারি?', AgentLanguagePolicy::BENGALI), 'Bengali output should be allowed.');
$assert(!AgentLanguagePolicy::isAllowedPublicOutput('Olá! Como posso ajudar você hoje?', AgentLanguagePolicy::BENGALI), 'Portuguese output should be rejected.');
$assert(!AgentLanguagePolicy::isAllowedPublicOutput('Ola! Como posso ajudar voce hoje?', AgentLanguagePolicy::ENGLISH), 'ASCII-only Portuguese output should be rejected.');

$google = AgentModelProtocol::parseResponse('google', [
    'responseId' => 'google-response-1',
    'candidates' => [[
        'finishReason' => 'STOP',
        'content' => ['parts' => [
            ['text' => 'Checking two records.'],
            ['functionCall' => ['name' => 'sales_fetch_order_by_number', 'args' => ['orderNumber' => 'ORD-1']], 'thoughtSignature' => 'google-thought-signature-1'],
            ['functionCall' => ['id' => 'google-call-2', 'name' => 'inventory_fetch_products_search', 'args' => ['search' => 'Shirt']]],
        ]],
    ]],
    'usageMetadata' => ['promptTokenCount' => 12, 'candidatesTokenCount' => 7],
]);
$assertSame(2, count($google['toolCalls']), 'Google should parse multiple function calls.');
$assert(str_starts_with($google['toolCalls'][0]['id'], 'google-'), 'Google should generate a stable call id when one is omitted.');
$assertSame('google-thought-signature-1', $google['toolCalls'][0]['thoughtSignature'] ?? '', 'Google thought signatures should be preserved with tool calls.');
$assertSame('google-call-2', $google['toolCalls'][1]['id'], 'Google should preserve a provider call id.');
$assertSame(12, $google['usage']['inputTokens'] ?? 0, 'Google input usage should be normalized.');

$anthropic = AgentModelProtocol::parseResponse('anthropic', [
    'id' => 'msg_123', 'stop_reason' => 'tool_use',
    'content' => [
        ['type' => 'text', 'text' => 'I will check.'],
        ['type' => 'tool_use', 'id' => 'toolu_1', 'name' => 'sales_fetch_orders_page', 'input' => ['page' => 1]],
        ['type' => 'tool_use', 'id' => 'toolu_2', 'name' => 'sales_fetch_customers_page', 'input' => ['search' => 'Rahim']],
    ],
    'usage' => ['input_tokens' => 9, 'output_tokens' => 5],
]);
$assertSame(['toolu_1', 'toolu_2'], array_column($anthropic['toolCalls'], 'id'), 'Anthropic tool ids should be preserved.');
$assertSame('msg_123', $anthropic['providerRequestId'] ?? '', 'Anthropic request id should be recorded.');

foreach (['openai', 'openrouter', 'groq', 'deepseek'] as $provider) {
    $turn = AgentModelProtocol::parseResponse($provider, [
        'id' => $provider . '-request',
        'choices' => [[
            'finish_reason' => 'tool_calls',
            'message' => ['content' => '', 'tool_calls' => [[
                'id' => 'call_1', 'type' => 'function',
                'function' => ['name' => 'dashboard_fetch_dashboard_snapshot', 'arguments' => '{"filterRange":"This Month"}'],
            ]]],
        ]],
        'usage' => ['prompt_tokens' => 4, 'completion_tokens' => 3],
    ]);
    $assertSame('dashboard_fetch_dashboard_snapshot', $turn['toolCalls'][0]['name'] ?? '', ucfirst($provider) . ' should parse OpenAI-compatible tool calls.');
    $assertSame('This Month', $turn['toolCalls'][0]['arguments']['filterRange'] ?? '', ucfirst($provider) . ' should decode JSON arguments.');
}

$expectFailure(static fn() => AgentModelProtocol::parseResponse('openai', [
    'choices' => [['message' => ['tool_calls' => [['id' => 'bad', 'function' => ['name' => 'x', 'arguments' => '{bad']]]]]],
]), 'malformed json');
$expectFailure(static fn() => AgentModelProtocol::parseResponse('anthropic', [
    'content' => [
        ['type' => 'tool_use', 'id' => 'same', 'name' => 'x', 'input' => []],
        ['type' => 'tool_use', 'id' => 'same', 'name' => 'y', 'input' => []],
    ],
]), 'duplicate');
$expectFailure(static fn() => AgentModelProtocol::parseResponse('openai', ['choices' => [['message' => ['content' => '']]]]), 'empty response');
$expectFailure(static fn() => AgentModelProtocol::parseResponse('openai', [
    'choices' => [['message' => ['tool_calls' => [['id' => 'list', 'function' => ['name' => 'x', 'arguments' => '[1,2]']]]]]],
]), 'object');

$messages = [
    ['role' => 'assistant', 'content' => 'Checking.', 'toolCalls' => [
        ['id' => 'call-a', 'name' => 'tool_a', 'arguments' => ['id' => '1'], 'thoughtSignature' => 'google-thought-signature-a'],
        ['id' => 'call-b', 'name' => 'tool_b', 'arguments' => ['id' => '2']],
    ]],
    ['role' => 'tool', 'toolCallId' => 'call-a', 'name' => 'tool_a', 'content' => ['ok' => true]],
    ['role' => 'tool', 'toolCallId' => 'call-b', 'name' => 'tool_b', 'content' => ['ok' => true]],
];
$toolDefinition = [['name' => 'tool_a', 'description' => 'A', 'inputSchema' => ['type' => 'object', 'properties' => ['id' => ['type' => 'string']]]]];
$baseConfig = ['apiKey' => 'test-key', 'model' => 'test-model'];

$openAiRequest = AgentModelProtocol::buildRequest('openai', $baseConfig + ['baseUrl' => 'https://api.openai.com/v1'], 'System', $messages, $toolDefinition);
$assertSame(['call-a', 'call-b'], array_column(array_slice($openAiRequest['body']['messages'], -2), 'tool_call_id'), 'OpenAI tool results should preserve both call ids.');

$anthropicRequest = AgentModelProtocol::buildRequest('anthropic', $baseConfig + ['baseUrl' => 'https://api.anthropic.com'], 'System', $messages, $toolDefinition);
$anthropicResults = $anthropicRequest['body']['messages'][1]['content'] ?? [];
$assertSame(['call-a', 'call-b'], array_column($anthropicResults, 'tool_use_id'), 'Anthropic tool results should be grouped and preserve ids.');

$googleRequest = AgentModelProtocol::buildRequest('google', $baseConfig + ['baseUrl' => 'https://generativelanguage.googleapis.com'], 'System', $messages, $toolDefinition);
$googleResponses = $googleRequest['body']['contents'][1]['parts'] ?? [];
$assertSame('google-thought-signature-a', $googleRequest['body']['contents'][0]['parts'][1]['thoughtSignature'] ?? '', 'Google requests should replay thought signatures on assistant function-call parts.');
$assertSame('call-a', $googleResponses[0]['functionResponse']['id'] ?? '', 'Google should preserve the first function response id.');
$assertSame('call-b', $googleResponses[1]['functionResponse']['id'] ?? '', 'Google should group multiple function responses.');
$googleSchemaRequest = AgentModelProtocol::buildRequest('google', $baseConfig + ['baseUrl' => 'https://generativelanguage.googleapis.com'], 'System', [['role' => 'user', 'content' => 'Test']], [[
    'name' => 'no_arguments', 'description' => 'No arguments.',
    'inputSchema' => ['type' => 'object', 'properties' => [], 'required' => [], 'additionalProperties' => false],
], [
    'name' => 'positive_amount', 'description' => 'Positive amount.',
    'inputSchema' => ['type' => 'object', 'properties' => [
        'amount' => ['type' => 'number', 'exclusiveMinimum' => 0],
    ], 'required' => ['amount'], 'additionalProperties' => false],
]]);
$googleDeclarations = $googleSchemaRequest['body']['tools'][0]['functionDeclarations'] ?? [];
$assert(is_object($googleDeclarations[0]['parameters']['properties'] ?? null), 'Google empty schema properties should serialize as a JSON map.');
$googleSchemaJson = json_encode($googleDeclarations, JSON_UNESCAPED_SLASHES) ?: '';
$assert(str_contains($googleSchemaJson, '"properties":{}'), 'Google no-argument tools should encode properties as an object.');
$assert(!str_contains($googleSchemaJson, 'exclusiveMinimum') && !str_contains($googleSchemaJson, 'additionalProperties'), 'Google tool declarations should omit unsupported JSON Schema keywords.');
$assertSame('NUMBER', $googleDeclarations[1]['parameters']['properties']['amount']['type'] ?? '', 'Google nested schema types should use provider enum casing.');

$registryReflection = new ReflectionClass(AgentToolRegistry::class);
$registryWithoutServices = $registryReflection->newInstanceWithoutConstructor();
$allRegistryDefinitions = [];
foreach (['metaDefinitions', 'catalog'] as $methodName) {
    $method = $registryReflection->getMethod($methodName);
    $method->setAccessible(true);
    $allRegistryDefinitions = array_merge($allRegistryDefinitions, $method->invoke($registryWithoutServices));
}
$allRegistryTools = array_map(static fn(array $definition): array => [
    'name' => $definition['name'],
    'description' => $definition['description'],
    'inputSchema' => $definition['inputSchema'],
], $allRegistryDefinitions);
$allGoogleTools = AgentModelProtocol::buildRequest('google', $baseConfig + ['baseUrl' => 'https://generativelanguage.googleapis.com'], 'System', [['role' => 'user', 'content' => 'Test']], $allRegistryTools);
$allGoogleToolsJson = json_encode($allGoogleTools['body']['tools'] ?? [], JSON_UNESCAPED_SLASHES) ?: '';
$assert(!str_contains($allGoogleToolsJson, '"properties":[]'), 'Every registered Google tool should encode properties as a map.');
$assert(!preg_match('/"(?:exclusiveMinimum|exclusiveMaximum|additionalProperties|\$ref|oneOf|allOf)"/', $allGoogleToolsJson), 'Every registered Google tool should use only the supported schema subset.');

$datasets = [
    'orders' => ['id', 'order_number', 'status', 'total', 'order_date', 'customer_id'],
    'customers' => ['id', 'name', 'phone'],
];
$valid = AgentSqlGuard::validate('SELECT o.order_number, o.total FROM orders o WHERE o.status = \'Completed\'', $datasets, 25);
$assert(str_ends_with($valid['normalizedSql'], 'LIMIT 25'), 'SQL guard should add the server row limit.');
$cte = AgentSqlGuard::validate('WITH completed AS (SELECT id, customer_id FROM orders WHERE status = \'Completed\') SELECT c.name FROM completed x JOIN customers c ON c.id = x.customer_id', $datasets, 10);
$assertSame(['orders', 'customers'], $cte['tables'], 'SQL guard should validate CTE base datasets.');
$limited = AgentSqlGuard::validate('SELECT order_number FROM orders LIMIT 999', $datasets, 20);
$assert(str_ends_with($limited['normalizedSql'], 'LIMIT 20'), 'SQL guard should clamp an excessive limit.');

$rejections = [
    ['SELECT order_number FROM orders -- comment', 'comments'],
    ['SELECT order_number FROM orders; SELECT name FROM customers', 'one sql'],
    ['UPDATE orders SET status = \'Completed\'', 'only select'],
    ['SELECT SLEEP(2) FROM orders', 'unsafe sql'],
    ['SELECT table_name FROM information_schema.tables', 'system schemas'],
    ['SELECT * FROM orders', 'wildcard'],
    ['SELECT o.password_hash FROM orders o', 'private'],
    ['SELECT o.not_permitted FROM orders o', 'column'],
    ['SELECT name FROM llm_configurations', 'cannot access'],
];
foreach ($rejections as [$sql, $label]) {
    try {
        AgentSqlGuard::validate($sql, $datasets, 10);
        throw new RuntimeException('SQL guard accepted ' . $label . '.');
    } catch (Throwable $exception) {
        $assert(!str_starts_with($exception->getMessage(), 'SQL guard accepted'), 'SQL guard should reject ' . $label . '.');
    }
}

$itemsA = [[
    'toolName' => 'sales_create_customer', 'toolVersion' => '1.0.0',
    'arguments' => ['phone' => '01700000000', 'name' => 'Rahim'], 'dependencies' => [], 'idempotencyKey' => 'one',
]];
$itemsB = [[
    'idempotencyKey' => 'one', 'dependencies' => [], 'arguments' => ['name' => 'Rahim', 'phone' => '01700000000'],
    'toolVersion' => '1.0.0', 'toolName' => 'sales_create_customer',
]];
$hash = AgentActionBundle::immutableHash('run-1', 'user-1', $itemsA);
$assertSame($hash, AgentActionBundle::immutableHash('run-1', 'user-1', $itemsB), 'Bundle hashes should be key-order independent.');
$assert($hash !== AgentActionBundle::immutableHash('run-1', 'user-1', array_replace_recursive($itemsA, [0 => ['arguments' => ['name' => 'Karim']]])), 'Bundle hashes should detect argument tampering.');
$assert($hash !== AgentActionBundle::immutableHash('run-1', 'user-2', $itemsA), 'Bundle hashes should bind the actor.');
$resolved = AgentActionBundle::resolveReferences([
    'customerId' => '{{step:1:result.id}}',
    'orderId' => ['$fromStep' => 2, 'path' => 'order.id'],
], [1 => ['id' => 'customer-1'], 2 => ['order' => ['id' => 'order-1']]]);
$assertSame('customer-1', $resolved['customerId'] ?? '', 'String dependency references should resolve.');
$assertSame('order-1', $resolved['orderId'] ?? '', 'Object dependency references should resolve.');
$expectFailure(static fn() => AgentActionBundle::resolveReferences('{{step:1:result.missing}}', [1 => ['id' => 'x']]), 'dependency');
$token = AgentActionBundle::confirmationToken();
$assert(strlen($token) >= 40 && hash_equals(AgentActionBundle::confirmationTokenHash($token), hash('sha256', $token)), 'Confirmation tokens should be random and stored by hash.');

$executorSource = file_get_contents(__DIR__ . '/../backend/src/AgentExecutor.php') ?: '';
$registrySource = file_get_contents(__DIR__ . '/../backend/src/AgentToolRegistry.php') ?: '';
$protocolSource = file_get_contents(__DIR__ . '/../backend/src/AgentModelProtocol.php') ?: '';
$migrationSource = file_get_contents(__DIR__ . '/../migrations/2026-07-24_mame_ai_agent_runtime.sql') ?: '';
$chatSource = file_get_contents(__DIR__ . '/../components/MameChat.tsx') ?: '';
$masterSource = file_get_contents(__DIR__ . '/../backend/src/MasterDataApi.php') ?: '';
$leadSource = file_get_contents(__DIR__ . '/../backend/src/LeadApi.php') ?: '';
$metaSource = file_get_contents(__DIR__ . '/../backend/src/MetaAdsApi.php') ?: '';
$dispatcherSource = file_get_contents(__DIR__ . '/../backend/src/BusinessActionDispatcher.php') ?: '';
$operationsSource = file_get_contents(__DIR__ . '/../backend/src/OperationsApi.php') ?: '';

$duplicateNamedPlaceholders = static function (string $source): array {
    $duplicates = [];
    foreach (token_get_all($source) as $token) {
        if (!is_array($token) || $token[0] !== T_CONSTANT_ENCAPSED_STRING) continue;
        preg_match_all('/:([A-Za-z_][A-Za-z0-9_]*)/', $token[1], $matches);
        $counts = array_count_values($matches[1] ?? []);
        $repeated = array_keys(array_filter($counts, static fn(int $count): bool => $count > 1));
        if ($repeated !== []) $duplicates[] = ['line' => $token[2], 'placeholders' => $repeated];
    }
    return $duplicates;
};

$assert(str_contains($executorSource, 'WHERE id = :id AND user_id = :user_id'), 'Run and bundle mutations should include user ownership.');
$assertSame([], $duplicateNamedPlaceholders($executorSource), 'Agent runtime SQL should not reuse named placeholders with native PDO prepares.');
$assert(str_contains($executorSource, 'lease_expires_at') && str_contains($executorSource, 'heartbeat_at'), 'Workers should use leases and heartbeats.');
$assert(str_contains($executorSource, "MariaDB reports changed rows, not matched rows") && str_contains($executorSource, 'SELECT id FROM agent_runs WHERE id = :id AND worker_id = :worker_id'), 'Zero-change heartbeats should verify lease ownership before failing.');
$assert(str_contains($executorSource, "popen('start \"\" /B '") && str_contains($executorSource, '@pclose($handle)'), 'Windows should detach the immediate worker without blocking startAgentRun.');
$assert(str_contains($executorSource, 'cancellation_requested_at') && str_contains($executorSource, 'assertNotCancelled'), 'Workers should check durable cancellation.');
$assert(str_contains($executorSource, 'sequence_no > :cursor'), 'Event polling should use reconnect cursors.');
$assert(str_contains($executorSource, 'AgentLanguagePolicy::directDecision') && str_contains($executorSource, 'AgentLanguagePolicy::isAllowedPublicOutput'), 'The runtime should enforce canonical identity and Bengali-or-English output.');
$assert(str_contains($executorSource, "while ((microtime(true) - \$started) < 4)") && str_contains($executorSource, 'ignore_user_abort(false)'), 'SSE should release single-worker PHP servers quickly before polling fallback.');
$assert(str_contains($executorSource, "status = 'awaiting_confirmation'") && str_contains($executorSource, 'confirmationTokenHash'), 'Writes should stop at immutable confirmation bundles.');
$assert(str_contains($registrySource, "['Admin', 'Developer']") && str_contains($registrySource, 'query_business_data'), 'Raw SQL fallback should be administrator-only.');
$assert(!str_contains($registrySource, "'reads' => ['checkFraudCourierHistory']"), 'Fraud provider calls should not be exposed as unconfirmed reads.');
$assert(str_contains($registrySource, "'attachmentIndex'") && str_contains($registrySource, 'ownedAttachment'), 'Media tools should use owned private attachments.');
$assert(!str_contains($registrySource, "'actions' => ['markPayrollPaid', 'payEmployeeWallet', 'deleteEmployeeWalletPayout']"), 'Permanent payroll deletion should not be exposed as an agent action.');
$assert(!str_contains($registrySource, "'reads' => ['fetchUsers', 'fetchUsersPage'"), 'Payroll tools should use scoped employee services instead of the broad user directory.');
$assert(str_contains($registrySource, 'inventory_analyze_low_stock') && str_contains($registrySource, 'inventory_compare_stock'), 'Inventory should expose typed low-stock and comparison reads.');
$assert(str_contains($registrySource, "'additionalProperties' => false") && str_contains($registrySource, 'documentItemSchema'), 'Agent action schemas should reject arbitrary fields and use typed document items.');
$assert(str_contains($registrySource, "'from' => ['type' => 'string'], 'to' => ['type' => 'string']") && !str_contains($registrySource, "'startDate' => ['type' => 'string'], 'endDate' => ['type' => 'string'], 'businessId'"), 'Meta tool schemas should use the backend from/to filter contract.');
$assert(str_contains($leadSource, "empty(\$params['agentReadOnly'])") && str_contains($leadSource, "empty(\$params['suppressOrderCreation'])"), 'Agent lead reads and analysis should suppress hidden writes and order creation.');
$assert(str_contains($metaSource, "skipRemoteFetch") && str_contains($metaSource, "skipAutoSync") && str_contains($metaSource, "skipSchemaEnsure"), 'Agent Meta reads should not silently synchronize, populate remote caches, or repair schema.');
$assert(str_contains($dispatcherSource, 'assertActionScope') && str_contains($dispatcherSource, 'assertCanSendOrderToCourier'), 'Courier record scope should be checked before provider submission.');
$assert(str_contains($operationsSource, 'orders.sendToCourierOwn') && str_contains($operationsSource, 'orders.sendToCourierAny'), 'Courier scope checks should distinguish own and any order permissions.');
$assert(!str_contains($masterSource, 'buildMameDatabaseFacts') && !str_contains($masterSource, 'callGeminiChat'), 'The retired synchronous schema/Gemini helper path should be removed.');
$assert(str_contains($protocolSource, 'functionResponse') && str_contains($protocolSource, 'tool_result') && str_contains($protocolSource, 'tool_call_id'), 'All provider tool-result shapes should be implemented.');
$assert(str_contains($migrationSource, 'agent_action_bundles') && str_contains($migrationSource, 'agent_action_items') && str_contains($migrationSource, 'agent_attachments'), 'The migration should include bundle and attachment tables.');
$assert(str_contains($migrationSource, 'uq_agent_run_events_sequence') && str_contains($migrationSource, 'uq_agent_runs_active_conversation'), 'The migration should enforce event ordering and one active run per conversation.');
$assert(str_contains($chatSource, 'streamAgentRunEvents') && str_contains($chatSource, 'fetchAgentRunEvents'), 'The UI should have SSE and polling fallback.');
$assert(str_contains($chatSource, 'message.runId === event.runId') && str_contains($chatSource, 'runId: message.runId'), 'Conversation restoration and terminal events should deduplicate assistant messages by run id.');
$assert(!str_contains($chatSource, 'Thinking...') && !str_contains($chatSource, 'Querying database'), 'The UI should not rotate fabricated activities.');

fwrite(STDOUT, 'Mame AI agent runtime tests passed: ' . $checks . " checks.\n");
