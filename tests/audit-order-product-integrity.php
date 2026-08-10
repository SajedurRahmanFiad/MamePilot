<?php

declare(strict_types=1);

$dumpPath = $argv[1] ?? (__DIR__ . '/bdhatbela_rifababyshop.sql');
if (!is_file($dumpPath)) {
    fwrite(STDERR, "SQL dump not found: {$dumpPath}\n");
    exit(1);
}

/** @return array<int, string|null> */
function parseMysqlValuesRow(string $line): array
{
    $line = trim($line);
    $line = preg_replace('/^[\(]|[\),;]+$/', '', $line) ?? $line;
    $values = str_getcsv($line, ',', "'", '\\');

    return array_map(static function (string $value): ?string {
        $value = trim($value);
        if (strcasecmp($value, 'NULL') === 0) {
            return null;
        }
        return strtr($value, [
            '\\\\' => '\\',
            '\\n' => "\n",
            '\\r' => "\r",
            '\\t' => "\t",
            "\\'" => "'",
            '\\"' => '"',
        ]);
    }, $values);
}

/** @return array<string, array<int, array<string, string|null>>> */
function readDumpTables(string $path, array $wantedTables): array
{
    $result = array_fill_keys($wantedTables, []);
    $columns = [];
    $activeTable = null;
    $handle = fopen($path, 'rb');
    if ($handle === false) {
        throw new RuntimeException("Could not open SQL dump: {$path}");
    }

    while (($line = fgets($handle)) !== false) {
        if (preg_match('/^INSERT INTO `([^`]+)` \((.+)\) VALUES\s*$/', trim($line), $match) === 1) {
            $table = $match[1];
            $activeTable = in_array($table, $wantedTables, true) ? $table : null;
            if ($activeTable !== null) {
                preg_match_all('/`([^`]+)`/', $match[2], $columnMatches);
                $columns[$activeTable] = $columnMatches[1];
            }
            continue;
        }
        if ($activeTable === null || !str_starts_with(ltrim($line), '(')) {
            continue;
        }

        $values = parseMysqlValuesRow($line);
        if (count($values) !== count($columns[$activeTable])) {
            throw new RuntimeException(sprintf(
                'Could not parse %s row: expected %d values, received %d.',
                $activeTable,
                count($columns[$activeTable]),
                count($values)
            ));
        }
        $result[$activeTable][] = array_combine($columns[$activeTable], $values);
        if (str_ends_with(rtrim($line), ';')) {
            $activeTable = null;
        }
    }
    fclose($handle);

    return $result;
}

function normalizedProductName(string $value): string
{
    $value = trim(preg_replace('/\s+/u', ' ', $value) ?? $value);
    return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
}

function comparableProductName(string $value): string
{
    $value = normalizedProductName($value);
    $value = strtr($value, ['০' => '0', '১' => '1', '২' => '2', '৩' => '3', '৪' => '4', '৫' => '5', '৬' => '6', '৭' => '7', '৮' => '8', '৯' => '9']);
    return preg_replace('/[\s~_\-–—]+/u', '', $value) ?? $value;
}

/** @return array<string, array<string, string>> */
function knownRepurposedProductMappings(): array
{
    return [
        '1479f38f-0894-4961-b955-4d8895d06ad0' => ['30×32~~ 10 পিস' => 'c46fb035-994e-40a8-9e22-22faebc58763'],
        '6d803061-7344-4a5b-85ad-a49b58bc6bec' => ['30×32~~ ৬ পিস' => 'c43bf8de-87c6-4f05-bdb6-2c341b1f9e6d'],
        '85442186-0d1d-4d17-98a1-d6270c28a144' => ['22×32~~ 6 পিস' => '62b4b743-f680-4c2f-85b4-9150e990729d'],
        'ce3a2f25-53d1-4350-9e9b-7620077d51e0' => ['22×32~~ 10 পিস' => '2fe3c248-1eee-4bae-b70a-bc73b2c6c097'],
        'c43bf8de-87c6-4f05-bdb6-2c341b1f9e6d' => ['26×32~~ 6 পিস' => '54301035-b67b-4910-be65-caa7739f49eb'],
        'c46fb035-994e-40a8-9e22-22faebc58763' => ['26×32~~ 10 পিস' => 'b6e3d0ea-da8f-48f0-befd-4c0e9baf7827'],
    ];
}

function mappedProductId(string $productId, string $productName): ?string
{
    foreach (knownRepurposedProductMappings()[$productId] ?? [] as $historicalName => $targetId) {
        if (normalizedProductName($historicalName) === normalizedProductName($productName)) {
            return $targetId;
        }
    }
    return null;
}

/** @return array{items:array<int, mixed>, mappings:array<string, string>} */
function repairItemProductIds(array $items): array
{
    $mappings = [];
    foreach ($items as $index => $item) {
        if (!is_array($item)) {
            continue;
        }
        $oldId = trim((string) ($item['productId'] ?? ''));
        $targetId = mappedProductId($oldId, trim((string) ($item['productName'] ?? '')));
        if ($targetId === null) {
            continue;
        }
        $items[$index]['productId'] = $targetId;
        $mappings[$oldId] = $targetId;
    }
    return ['items' => $items, 'mappings' => $mappings];
}

$tables = readDumpTables($dumpPath, [
    'orders',
    'products',
    'courier_webhook_events',
    'order_cogs_expenses',
    'transactions',
    'order_status_undo_events',
]);
$productsById = [];
foreach ($tables['products'] as $product) {
    $productsById[(string) $product['id']] = $product;
}

$ordersById = [];
$mismatches = [];
$missingProducts = [];
$invalidItemsJson = [];
$amountErrors = [];
$productOrderNames = [];
foreach ($tables['orders'] as $order) {
    $orderId = (string) $order['id'];
    $ordersById[$orderId] = $order;
    $items = json_decode((string) ($order['items'] ?? ''), true);
    if (!is_array($items)) {
        $invalidItemsJson[] = ['order' => $order['order_number'], 'id' => $orderId];
        continue;
    }
    $subtotal = 0.0;
    foreach ($items as $index => $item) {
        $productId = trim((string) ($item['productId'] ?? ''));
        $itemName = trim((string) ($item['productName'] ?? ''));
        $rate = round((float) ($item['rate'] ?? 0), 2);
        $quantity = (float) ($item['quantity'] ?? 0);
        $amount = round((float) ($item['amount'] ?? 0), 2);
        $subtotal += $amount;
        if (abs($amount - round($rate * $quantity, 2)) > 0.01) {
            $amountErrors[] = ['order' => $order['order_number'], 'item' => $index, 'type' => 'item_amount'];
        }
        if ($productId === '' || !isset($productsById[$productId])) {
            $missingProducts[] = ['order' => $order['order_number'], 'id' => $orderId, 'productId' => $productId, 'name' => $itemName];
            continue;
        }
        $product = $productsById[$productId];
        $expectedName = trim((string) $product['name']);
        $productOrderNames[$productId][$itemName] = ($productOrderNames[$productId][$itemName] ?? 0) + 1;
        if (normalizedProductName($itemName) !== normalizedProductName($expectedName)) {
            $mismatches[] = [
                'order' => $order['order_number'],
                'orderId' => $orderId,
                'status' => $order['status'],
                'productId' => $productId,
                'itemName' => $itemName,
                'productName' => $expectedName,
                'sameCanonicalText' => comparableProductName($itemName) === comparableProductName($expectedName),
                'orderCreatedAt' => $order['created_at'],
                'productCreatedAt' => $product['created_at'],
                'productUpdatedAt' => $product['updated_at'],
                'productDeletedAt' => $product['deleted_at'],
            ];
        }
    }
    if (abs(round($subtotal, 2) - round((float) $order['subtotal'], 2)) > 0.01) {
        $amountErrors[] = ['order' => $order['order_number'], 'type' => 'subtotal'];
    }
    $expectedTotal = round(max(0, $subtotal - (float) $order['discount'] + (float) $order['shipping']), 2);
    if (abs($expectedTotal - round((float) $order['total'], 2)) > 0.01) {
        $amountErrors[] = ['order' => $order['order_number'], 'type' => 'total'];
    }
}

$courierCounts = [];
$courierProblemEvents = [];
foreach ($tables['courier_webhook_events'] as $event) {
    $status = (string) $event['processing_status'];
    $courierCounts[$status] = ($courierCounts[$status] ?? 0) + 1;
    if ($status !== 'processed') {
        $courierProblemEvents[] = [
            'id' => $event['id'],
            'status' => $status,
            'orderId' => $event['order_id'],
            'reference' => $event['merchant_reference'],
            'consignment' => $event['consignment_id'],
            'event' => $event['event_name'],
            'message' => $event['processing_message'],
        ];
    }
}

$courierAssignedWithMatchedEvents = [];
foreach ($ordersById as $orderId => $order) {
    if ((string) $order['status'] !== 'Courier assigned') {
        continue;
    }
    $events = array_values(array_filter(
        $tables['courier_webhook_events'],
        static fn(array $event): bool => (string) ($event['order_id'] ?? '') === $orderId
    ));
    if ($events !== []) {
        $courierAssignedWithMatchedEvents[] = [
            'order' => $order['order_number'],
            'orderId' => $orderId,
            'consignment' => $order['steadfast_consignment_id'],
            'eventCount' => count($events),
            'lastEventStatus' => end($events)['processing_status'] ?? null,
            'lastEventName' => end($events)['event_name'] ?? null,
            'lastMessage' => end($events)['processing_message'] ?? null,
        ];
    }
}

$cogsByOrderId = [];
foreach ($tables['order_cogs_expenses'] as $cogs) {
    $cogsByOrderId[(string) $cogs['order_id']] = $cogs;
}
$transactionsById = [];
foreach ($tables['transactions'] as $transaction) {
    $transactionsById[(string) $transaction['id']] = $transaction;
}

$cogsMismatches = [];
foreach ($mismatches as $mismatch) {
    $cogs = $cogsByOrderId[$mismatch['orderId']] ?? null;
    if ($cogs === null) {
        continue;
    }
    $breakdown = json_decode((string) ($cogs['breakdown'] ?? ''), true);
    if (!is_array($breakdown)) {
        continue;
    }
    foreach ($breakdown as $line) {
        if ((string) ($line['productId'] ?? '') !== $mismatch['productId']) {
            continue;
        }
        $transaction = $transactionsById[(string) ($cogs['transaction_id'] ?? '')] ?? null;
        $cogsMismatches[] = [
            'order' => $mismatch['order'],
            'orderId' => $mismatch['orderId'],
            'cogsId' => $cogs['id'],
            'transactionId' => $cogs['transaction_id'],
            'recordedCogsTotal' => (float) $cogs['amount'],
            'recordedLinePurchasePrice' => (float) ($line['purchasePrice'] ?? 0),
            'recordedLineAmount' => (float) ($line['amount'] ?? 0),
            'transactionAmount' => $transaction === null ? null : (float) $transaction['amount'],
            'transactionAccountId' => $transaction['account_id'] ?? null,
            'productId' => $mismatch['productId'],
            'itemName' => $mismatch['itemName'],
        ];
    }
}

$undoRowsForAffectedOrders = [];
$affectedOrderIds = array_fill_keys(array_unique(array_column($mismatches, 'orderId')), true);
foreach ($tables['order_status_undo_events'] as $event) {
    if (!isset($affectedOrderIds[(string) $event['order_id']])) {
        continue;
    }
    $undoRowsForAffectedOrders[] = [
        'id' => $event['id'],
        'order' => $event['order_number'],
        'orderId' => $event['order_id'],
        'fromStatus' => $event['from_status'],
        'toStatus' => $event['to_status'],
        'hasStockDeltas' => trim((string) ($event['stock_deltas'] ?? '')) !== '' && trim((string) $event['stock_deltas']) !== '[]',
    ];
}

$repairOrders = [];
$repairMappingsByOrderId = [];
$stockDeltas = [];
$stockStatuses = ['Processing', 'Courier assigned', 'Picked', 'Exchange processing', 'Exchange picked', 'Exchange delivered', 'Completed'];
foreach ($tables['orders'] as $order) {
    $items = json_decode((string) ($order['items'] ?? ''), true);
    if (!is_array($items)) {
        continue;
    }
    $repaired = repairItemProductIds($items);
    if ($repaired['mappings'] === []) {
        continue;
    }
    $newItemsJson = json_encode($repaired['items'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $repairOrders[] = [
        'id' => $order['id'],
        'order' => $order['order_number'],
        'status' => $order['status'],
        'beforeItems' => $order['items'],
        'afterItems' => $newItemsJson,
    ];
    $repairMappingsByOrderId[(string) $order['id']] = $repaired['mappings'];
    if (in_array((string) $order['status'], $stockStatuses, true)) {
        foreach ($items as $index => $item) {
            if (!is_array($item)) continue;
            $oldId = trim((string) ($item['productId'] ?? ''));
            $targetId = trim((string) ($repaired['items'][$index]['productId'] ?? $oldId));
            if ($oldId === $targetId) continue;
            $quantity = (int) ($item['quantity'] ?? 0);
            $stockDeltas[$oldId] = ($stockDeltas[$oldId] ?? 0) + $quantity;
            $stockDeltas[$targetId] = ($stockDeltas[$targetId] ?? 0) - $quantity;
        }
    }
}

$repairStocks = [];
foreach ($stockDeltas as $productId => $delta) {
    $product = $productsById[$productId] ?? null;
    if ($product === null) {
        throw new RuntimeException("Repair target product is missing: {$productId}");
    }
    $before = (int) $product['stock'];
    $repairStocks[] = [
        'id' => $productId,
        'name' => $product['name'],
        'delta' => $delta,
        'beforeStock' => $before,
        'afterStock' => $before + $delta,
    ];
}

$repairUndoEvents = [];
foreach ($tables['order_status_undo_events'] as $event) {
    $orderId = (string) $event['order_id'];
    $orderMappings = $repairMappingsByOrderId[$orderId] ?? [];
    if ($orderMappings === []) {
        continue;
    }
    $changes = [];
    foreach (['before_snapshot', 'after_snapshot'] as $column) {
        $snapshot = json_decode((string) ($event[$column] ?? ''), true);
        if (!is_array($snapshot)) continue;
        $snapshotItems = json_decode((string) ($snapshot['items'] ?? ''), true);
        if (!is_array($snapshotItems)) continue;
        $repaired = repairItemProductIds($snapshotItems);
        if ($repaired['mappings'] === []) continue;
        $snapshot['items'] = json_encode($repaired['items'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $changes[$column] = [
            'before' => $event[$column],
            'after' => json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ];
    }
    $stockDeltaJson = (string) ($event['stock_deltas'] ?? '');
    $stockDeltaValues = json_decode($stockDeltaJson, true);
    if (is_array($stockDeltaValues) && !array_is_list($stockDeltaValues)) {
        $repairedDeltas = $stockDeltaValues;
        foreach ($orderMappings as $oldId => $targetId) {
            if (!array_key_exists($oldId, $repairedDeltas)) continue;
            $repairedDeltas[$targetId] = ($repairedDeltas[$targetId] ?? 0) + $repairedDeltas[$oldId];
            unset($repairedDeltas[$oldId]);
        }
        $afterStockDeltas = json_encode($repairedDeltas, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($afterStockDeltas !== $stockDeltaJson) {
            $changes['stock_deltas'] = ['before' => $stockDeltaJson, 'after' => $afterStockDeltas];
        }
    }
    if ($changes !== []) {
        $repairUndoEvents[] = ['id' => $event['id'], 'order' => $event['order_number'], 'changes' => $changes];
    }
}

$repairCogs = [];
foreach ($tables['order_cogs_expenses'] as $cogs) {
    $orderId = (string) $cogs['order_id'];
    if (!isset($repairMappingsByOrderId[$orderId])) continue;
    $breakdown = json_decode((string) ($cogs['breakdown'] ?? ''), true);
    if (!is_array($breakdown)) continue;
    $changed = false;
    $total = 0.0;
    foreach ($breakdown as $index => $line) {
        if (!is_array($line)) continue;
        $oldId = trim((string) ($line['productId'] ?? ''));
        $targetId = mappedProductId($oldId, trim((string) ($line['productName'] ?? '')));
        if ($targetId !== null) {
            $targetProduct = $productsById[$targetId] ?? null;
            if ($targetProduct === null) throw new RuntimeException("COGS repair target is missing: {$targetId}");
            $quantity = (float) ($line['quantity'] ?? 0);
            $purchasePrice = (float) $targetProduct['purchase_price'];
            $breakdown[$index]['productId'] = $targetId;
            $breakdown[$index]['purchasePrice'] = $purchasePrice;
            $breakdown[$index]['amount'] = round($purchasePrice * $quantity, 2);
            $changed = true;
        }
        $total += (float) ($breakdown[$index]['amount'] ?? 0);
    }
    if (!$changed) continue;
    $transaction = $transactionsById[(string) ($cogs['transaction_id'] ?? '')] ?? null;
    $transactionAmount = $transaction === null ? null : round((float) $transaction['amount'], 2);
    if ($transactionAmount !== null && abs($transactionAmount - round($total, 2)) > 0.01) {
        throw new RuntimeException("COGS transaction amount would require financial reconciliation for order {$orderId}.");
    }
    $repairCogs[] = [
        'id' => $cogs['id'],
        'orderId' => $orderId,
        'transactionId' => $cogs['transaction_id'],
        'beforeAmount' => (float) $cogs['amount'],
        'afterAmount' => round($total, 2),
        'beforeBreakdown' => $cogs['breakdown'],
        'afterBreakdown' => json_encode($breakdown, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ];
}

$summary = [
    'counts' => [
        'orders' => count($tables['orders']),
        'products' => count($tables['products']),
        'courierEvents' => count($tables['courier_webhook_events']),
        'mismatchedOrderItems' => count($mismatches),
        'ordersWithMismatches' => count(array_unique(array_column($mismatches, 'orderId'))),
        'canonicalFormattingOnly' => count(array_filter($mismatches, static fn(array $row): bool => $row['sameCanonicalText'])),
        'missingProductItems' => count($missingProducts),
        'invalidItemsJson' => count($invalidItemsJson),
        'amountErrors' => count($amountErrors),
        'courierEventStatuses' => $courierCounts,
        'courierAssignedWithMatchedEvents' => count($courierAssignedWithMatchedEvents),
        'cogsLinesWithMismatchedProductIds' => count($cogsMismatches),
        'undoRowsForAffectedOrders' => count($undoRowsForAffectedOrders),
        'repairOrders' => count($repairOrders),
        'repairUndoEvents' => count($repairUndoEvents),
        'repairCogsRows' => count($repairCogs),
    ],
    'mismatches' => $mismatches,
    'missingProducts' => $missingProducts,
    'invalidItemsJson' => $invalidItemsJson,
    'amountErrors' => $amountErrors,
    'courierProblemEvents' => $courierProblemEvents,
    'courierAssignedWithMatchedEvents' => $courierAssignedWithMatchedEvents,
    'historicalNamesByProductId' => $productOrderNames,
    'cogsMismatches' => $cogsMismatches,
    'undoRowsForAffectedOrders' => $undoRowsForAffectedOrders,
    'repairPlan' => [
        'orders' => $repairOrders,
        'stocks' => $repairStocks,
        'undoEvents' => $repairUndoEvents,
        'cogs' => $repairCogs,
    ],
];

$encodedSummary = json_encode($summary, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if (!is_string($encodedSummary)) {
    throw new RuntimeException('Could not encode the audit summary.');
}
$outputArgument = $argv[2] ?? '';
if (str_starts_with($outputArgument, '--output=')) {
    $auditOutputPath = substr($outputArgument, strlen('--output='));
    if ($auditOutputPath === '' || file_put_contents($auditOutputPath, $encodedSummary . "\n") === false) {
        throw new RuntimeException('Could not write the audit summary output file.');
    }
} else {
    echo $encodedSummary, "\n";
}
