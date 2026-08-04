<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\CourierApi;
use App\Database;
use App\OperationsApi;
function courierWebhookAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

/** @param array<string, mixed> $payload */
function courierWebhookJson(array $payload): string
{
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($json)) {
        throw new RuntimeException('Could not encode courier webhook test payload.');
    }
    return $json;
}

/** @param callable(): mixed $callback */
function expectCourierWebhookSignatureFailure(callable $callback, string $provider): void
{
    try {
        $callback();
    } catch (RuntimeException $exception) {
        courierWebhookAssert(
            str_contains(strtolower($exception->getMessage()), 'signature'),
            ucfirst($provider) . ' rejected the request for the wrong reason.'
        );
        return;
    }
    throw new RuntimeException(ucfirst($provider) . ' accepted an invalid webhook signature.');
}

/**
 * @param array<string, mixed> $actor
 * @param array<string, mixed> $extra
 */
function createCourierWebhookOrder(
    Database $database,
    array $actor,
    int &$nextSequence,
    string $id,
    string $orderNumber,
    string $status,
    string $customerId,
    array $extra = []
): void {
    $history = $extra['history'] ?? [];
    $database->execute(
        'INSERT INTO orders (
            id, order_number, order_seq, order_date, customer_id, created_by, status,
            items, total, history, carrybee_consignment_id, paperfly_tracking_number,
            steadfast_consignment_id, pathao_consignment_id,
            exchange_carrybee_consignment_id, exchange_paperfly_tracking_number,
            exchange_steadfast_consignment_id, exchange_pathao_consignment_id
         ) VALUES (
            :id, :order_number, :order_seq, CURRENT_DATE, :customer_id, :created_by, :status,
            :items, 0, :history, :carrybee, :paperfly, :steadfast, :pathao,
            :exchange_carrybee, :exchange_paperfly, :exchange_steadfast, :exchange_pathao
         )',
        [
            ':id' => $id,
            ':order_number' => $orderNumber,
            ':order_seq' => $nextSequence++,
            ':customer_id' => $customerId,
            ':created_by' => (string) $actor['id'],
            ':status' => $status,
            ':items' => '[]',
            ':history' => courierWebhookJson(is_array($history) ? $history : []),
            ':carrybee' => $extra['carrybee'] ?? null,
            ':paperfly' => $extra['paperfly'] ?? null,
            ':steadfast' => $extra['steadfast'] ?? null,
            ':pathao' => $extra['pathao'] ?? null,
            ':exchange_carrybee' => $extra['exchangeCarrybee'] ?? null,
            ':exchange_paperfly' => $extra['exchangePaperfly'] ?? null,
            ':exchange_steadfast' => $extra['exchangeSteadfast'] ?? null,
            ':exchange_pathao' => $extra['exchangePathao'] ?? null,
        ]
    );
}

function courierWebhookOrderStatus(Database $database, string $orderId): string
{
    return (string) (($database->fetchOne(
        'SELECT status FROM orders WHERE id = :id',
        [':id' => $orderId]
    ) ?? [])['status'] ?? '');
}

/** @return array<string, mixed>|null */
function courierWebhookExpense(Database $database, string $orderId): ?array
{
    return $database->fetchOne(
        "SELECT * FROM transactions
         WHERE reference_id = :order_id AND type = 'Expense' AND category = 'expense_shipping'
           AND deleted_at IS NULL
         ORDER BY created_at ASC, id ASC LIMIT 1",
        [':order_id' => $orderId]
    );
}

$root = dirname(__DIR__);
$config = Config::load($root);
$database = new Database($config);
$auth = new Auth($config, $database);
$operations = new OperationsApi($database, $auth, $config);
$courier = new CourierApi($database, $auth, $config, $operations);
$pdo = $database->connect();

foreach (['courier_webhook_events', 'courier_order_charges', 'order_status_undo_events'] as $requiredTable) {
    $exists = $database->fetchOne(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :table_name LIMIT 1',
        [':table_name' => $requiredTable]
    );
    if ($exists === null) {
        throw new RuntimeException("Required test table {$requiredTable} is missing; apply schema-only.sql first.");
    }
}

$actor = $database->fetchOne(
    "SELECT id, name, phone, role FROM users
     WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL
     ORDER BY CASE WHEN role = 'Developer' THEN 0 ELSE 1 END, created_at ASC LIMIT 1"
);
if ($actor === null) {
    throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
}
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);

$stamp = substr(hash('sha256', uniqid('courier-webhook-', true)), 0, 20);
$accountId = 'cwh-account-' . $stamp;
$customerId = 'cwh-customer-' . $stamp;
$phone = '019' . substr(preg_replace('/\D/', '', (string) microtime(true)), -8);
$nextSequence = (int) (($database->fetchOne(
    'SELECT COALESCE(MAX(order_seq), 0) + 1 AS next_sequence FROM orders'
) ?? [])['next_sequence'] ?? 1);

$carryHeaders = ['X-Carrybee-Webhook-Signature' => 'carrybee-test-signature'];
$paperflyHeaders = ['X-Paperfly-Webhook-Secret' => 'paperfly-test-secret'];
$steadfastHeaders = ['Authorization' => 'Bearer steadfast-test-api-key'];
$pathaoHeaders = ['X-Test-Pathao-Secret' => 'pathao-test-secret'];

$pdo->beginTransaction();
try {
    $settings = $database->fetchOne('SELECT id FROM courier_settings LIMIT 1');
    if ($settings === null) {
        $database->execute('INSERT INTO courier_settings (id) VALUES (:id)', [':id' => 'courier-default']);
    }
    $database->execute(
        'UPDATE courier_settings SET
            automatically_deduct_shipping_costs = 0,
            carrybee_webhook_signature = :carrybee,
            paperfly_webhook_secret = :paperfly,
            steadfast_api_key = :steadfast,
            pathao_webhook_header = :pathao_header,
            pathao_webhook_secret = :pathao_secret',
        [
            ':carrybee' => 'carrybee-test-signature',
            ':paperfly' => 'paperfly-test-secret',
            ':steadfast' => 'steadfast-test-api-key',
            ':pathao_header' => 'X-Test-Pathao-Secret',
            ':pathao_secret' => 'pathao-test-secret',
        ]
    );
    $database->execute(
        'INSERT INTO accounts (id, name, type, opening_balance, current_balance)
         VALUES (:id, :name, :type, 5000, 5000)',
        [':id' => $accountId, ':name' => 'Courier Webhook Test', ':type' => 'Cash']
    );
    $database->execute(
        'INSERT INTO customers (id, name, phone, address, created_by)
         VALUES (:id, :name, :phone, :address, :created_by)',
        [
            ':id' => $customerId,
            ':name' => 'Courier Webhook Test Customer',
            ':phone' => $phone,
            ':address' => 'Dhaka',
            ':created_by' => (string) $actor['id'],
        ]
    );
    $database->execute(
        'UPDATE system_defaults SET default_account_id = :account_id, default_payment_method = :payment_method',
        [':account_id' => $accountId, ':payment_method' => 'Cash']
    );

    $minimalPayload = courierWebhookJson(['event' => 'order.picked', 'consignment_id' => 'invalid-signature-test']);
    expectCourierWebhookSignatureFailure(
        fn() => $courier->handleWebhook('carrybee', $minimalPayload, ['X-Carrybee-Webhook-Signature' => 'wrong']),
        'carrybee'
    );
    expectCourierWebhookSignatureFailure(
        fn() => $courier->handleWebhook('paperfly', $minimalPayload, ['X-Paperfly-Webhook-Secret' => 'wrong']),
        'paperfly'
    );
    expectCourierWebhookSignatureFailure(
        fn() => $courier->handleWebhook('steadfast', $minimalPayload, ['Authorization' => 'Bearer wrong']),
        'steadfast'
    );
    expectCourierWebhookSignatureFailure(
        fn() => $courier->handleWebhook('pathao', $minimalPayload, ['X-Test-Pathao-Secret' => 'wrong']),
        'pathao'
    );

    // CarryBee: store order-created fees immediately, map every supplied event,
    // and never regress a terminal status when an older event arrives later.
    $carryOffId = 'cwh-carry-off-' . $stamp;
    $carryOffNumber = 'CWH-CARRY-OFF-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $carryOffId, $carryOffNumber, 'Processing', $customerId, [
        'carrybee' => 'CB-OFF-' . $stamp,
    ]);
    $carryCreated = courierWebhookJson([
        'event' => 'order.created',
        'store_id' => 'store-test',
        'consignment_id' => 'CB-OFF-' . $stamp,
        'merchant_order_id' => $carryOffNumber,
        'timestamptz' => '2026-08-01T10:00:00+00:00',
        'collectable_amount' => 1500,
        'cod_fee' => 15,
        'delivery_fee' => 83.46,
    ]);
    $courier->handleWebhook('carrybee', $carryCreated, $carryHeaders);
    $carryCharge = $database->fetchOne(
        'SELECT * FROM courier_order_charges WHERE provider = :provider AND consignment_id = :consignment LIMIT 1',
        [':provider' => 'carrybee', ':consignment' => 'CB-OFF-' . $stamp]
    );
    courierWebhookAssert($carryCharge !== null, 'CarryBee order.created fee was not stored.');
    courierWebhookAssert(abs((float) $carryCharge['cod_fee'] - 15.00) < 0.001, 'CarryBee COD fee is incorrect.');
    courierWebhookAssert(abs((float) $carryCharge['delivery_fee'] - 83.46) < 0.001, 'CarryBee delivery fee is incorrect.');
    courierWebhookAssert(abs((float) $carryCharge['total_charge'] - 98.46) < 0.001, 'CarryBee total is not COD fee plus delivery fee.');
    courierWebhookAssert(courierWebhookExpense($database, $carryOffId) === null, 'Toggle-off CarryBee fee created an expense too early.');

    $courier->handleWebhook('carrybee', courierWebhookJson([
        'event' => 'order.picked',
        'consignment_id' => 'CB-OFF-' . $stamp,
        'merchant_order_id' => $carryOffNumber,
        'timestamptz' => '2026-08-01T11:00:00+00:00',
    ]), $carryHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $carryOffId) === 'Picked', 'CarryBee picked did not map to Picked.');

    $carryDelivered = courierWebhookJson([
        'event' => 'order.delivered',
        'consignment_id' => 'CB-OFF-' . $stamp,
        'merchant_order_id' => $carryOffNumber,
        'timestamptz' => '2026-08-01T12:00:00+00:00',
        'collected_amount' => 1500,
    ]);
    $carryDeliveryResult = $courier->handleWebhook('carrybee', $carryDelivered, $carryHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $carryOffId) === 'Completed', 'CarryBee delivered did not complete the order.');
    courierWebhookAssert(courierWebhookExpense($database, $carryOffId) === null, 'Toggle-off delivery created an automatic expense.');
    $carryDuplicateResult = $courier->handleWebhook('carrybee', $carryDelivered, $carryHeaders);
    courierWebhookAssert(($carryDuplicateResult['duplicate'] ?? false) === true, 'Exact CarryBee retry was not deduplicated.');
    courierWebhookAssert(($carryDeliveryResult['duplicate'] ?? true) === false, 'First CarryBee delivery was marked duplicate.');
    $courier->handleWebhook('carrybee', courierWebhookJson([
        'event' => 'order.picked',
        'consignment_id' => 'CB-OFF-' . $stamp,
        'merchant_order_id' => $carryOffNumber,
        'timestamptz' => '2026-08-01T13:00:00+00:00',
    ]), $carryHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $carryOffId) === 'Completed', 'Older CarryBee picked event regressed Completed.');

    $carryReturnId = 'cwh-carry-return-' . $stamp;
    $carryReturnNumber = 'CWH-CARRY-RETURN-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $carryReturnId, $carryReturnNumber, 'Picked', $customerId, [
        'carrybee' => 'CB-RETURN-' . $stamp,
    ]);
    $courier->handleWebhook('carrybee', courierWebhookJson([
        'event' => 'order.returned',
        'consignment_id' => 'CB-RETURN-' . $stamp,
        'merchant_order_id' => $carryReturnNumber,
        'timestamptz' => '2026-08-01T14:00:00+00:00',
        'reason' => 'Customer unavailable',
    ]), $carryHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $carryReturnId) === 'Returned', 'CarryBee returned did not map to Returned.');

    // Enable accounting automation. A delivery now creates one linked Shipping
    // Costs transaction and includes it in the status Undoer restore point.
    $database->execute('UPDATE courier_settings SET automatically_deduct_shipping_costs = 1');
    $carryAutoId = 'cwh-carry-auto-' . $stamp;
    $carryAutoNumber = 'CWH-CARRY-AUTO-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $carryAutoId, $carryAutoNumber, 'Picked', $customerId, [
        'carrybee' => 'CB-AUTO-' . $stamp,
    ]);
    $courier->handleWebhook('carrybee', courierWebhookJson([
        'event' => 'order.created',
        'consignment_id' => 'CB-AUTO-' . $stamp,
        'merchant_order_id' => $carryAutoNumber,
        'timestamptz' => '2026-08-02T10:00:00+00:00',
        'collectable_amount' => 2000,
        'cod_fee' => 15,
        'delivery_fee' => 83.46,
    ]), $carryHeaders);
    $carryAutoDelivered = courierWebhookJson([
        'event' => 'order.delivered',
        'consignment_id' => 'CB-AUTO-' . $stamp,
        'merchant_order_id' => $carryAutoNumber,
        'timestamptz' => '2026-08-02T12:00:00+00:00',
        'collected_amount' => 2000,
    ]);
    $courier->handleWebhook('carrybee', $carryAutoDelivered, $carryHeaders);
    $carryExpense = courierWebhookExpense($database, $carryAutoId);
    courierWebhookAssert($carryExpense !== null, 'CarryBee automatic Shipping Costs expense was not created.');
    courierWebhookAssert(abs((float) $carryExpense['amount'] - 98.46) < 0.001, 'CarryBee automatic expense amount is incorrect.');
    courierWebhookAssert(strlen((string) $carryExpense['id']) <= 64, 'Automatic courier transaction id exceeds the database limit.');
    $carryUndo = $database->fetchOne(
        "SELECT transaction_ids FROM order_status_undo_events
         WHERE order_id = :order_id AND to_status = 'Completed' AND undone_at IS NULL
         ORDER BY created_at DESC, id DESC LIMIT 1",
        [':order_id' => $carryAutoId]
    );
    $carryUndoIds = json_decode((string) ($carryUndo['transaction_ids'] ?? '[]'), true);
    courierWebhookAssert(
        is_array($carryUndoIds) && in_array((string) $carryExpense['id'], $carryUndoIds, true),
        'CarryBee automatic expense is missing from the Undoer event.'
    );
    $carryExpenseCountBeforeRetry = (int) (($database->fetchOne(
        "SELECT COUNT(*) AS total FROM transactions WHERE reference_id = :order_id AND category = 'expense_shipping'",
        [':order_id' => $carryAutoId]
    ) ?? [])['total'] ?? 0);
    $carryUndoCountBeforeRetry = (int) (($database->fetchOne(
        'SELECT COUNT(*) AS total FROM order_status_undo_events WHERE order_id = :order_id',
        [':order_id' => $carryAutoId]
    ) ?? [])['total'] ?? 0);
    $courier->handleWebhook('carrybee', $carryAutoDelivered, $carryHeaders);
    $carryExpenseCountAfterRetry = (int) (($database->fetchOne(
        "SELECT COUNT(*) AS total FROM transactions WHERE reference_id = :order_id AND category = 'expense_shipping'",
        [':order_id' => $carryAutoId]
    ) ?? [])['total'] ?? 0);
    $carryUndoCountAfterRetry = (int) (($database->fetchOne(
        'SELECT COUNT(*) AS total FROM order_status_undo_events WHERE order_id = :order_id',
        [':order_id' => $carryAutoId]
    ) ?? [])['total'] ?? 0);
    courierWebhookAssert($carryExpenseCountAfterRetry === $carryExpenseCountBeforeRetry, 'CarryBee retry duplicated the expense.');
    courierWebhookAssert($carryUndoCountAfterRetry === $carryUndoCountBeforeRetry, 'CarryBee retry duplicated status effects.');

    try {
        $operations->addCourierCompletionExpense([
            'orderId' => $carryAutoId,
            'outcome' => 'Delivered',
            'date' => gmdate('c'),
            'additionalExpenseAmount' => 1,
            'additionalExpenseCategoryId' => 'expense_shipping',
        ]);
        throw new RuntimeException('Manual delivered-order expense remained available while automation was enabled.');
    } catch (RuntimeException $exception) {
        courierWebhookAssert(
            str_contains(strtolower($exception->getMessage()), 'automatically'),
            'Manual delivered-order expense was rejected for the wrong reason.'
        );
    }

    $manualReturnId = 'cwh-manual-return-' . $stamp;
    $manualReturnNumber = 'CWH-MANUAL-RETURN-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $manualReturnId, $manualReturnNumber, 'Returned', $customerId, [
        'history' => ['returned' => 'Marked returned automatically from Pathao webhook event "return" on 2026-08-02.'],
    ]);
    $operations->addCourierCompletionExpense([
        'orderId' => $manualReturnId,
        'outcome' => 'Returned',
        'date' => gmdate('c'),
        'accountId' => $accountId,
        'amount' => 7,
        'paymentMethod' => 'Cash',
        'categoryId' => 'expense_shipping',
        'note' => 'Return charge remains manual',
    ]);
    courierWebhookAssert(courierWebhookExpense($database, $manualReturnId) !== null, 'Return-expense path was blocked by delivery automation.');

    // Steadfast: delivery_charge is the fee; cod_amount is the parcel amount.
    $steadfastId = 'cwh-steadfast-' . $stamp;
    $steadfastNumber = 'CWH-STEADFAST-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $steadfastId, $steadfastNumber, 'Picked', $customerId, [
        'steadfast' => 'SF-' . $stamp,
    ]);
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'delivery_status',
        'consignment_id' => 'SF-' . $stamp,
        'invoice' => $steadfastNumber,
        'cod_amount' => 1500,
        'status' => 'Delivered',
        'delivery_charge' => 100,
        'tracking_message' => 'Delivered successfully.',
        'updated_at' => '2026-08-03 12:45:30',
    ]), $steadfastHeaders);
    $steadfastExpense = courierWebhookExpense($database, $steadfastId);
    courierWebhookAssert(courierWebhookOrderStatus($database, $steadfastId) === 'Completed', 'Steadfast delivered did not complete the order.');
    courierWebhookAssert($steadfastExpense !== null && abs((float) $steadfastExpense['amount'] - 100) < 0.001, 'Steadfast booked COD amount as a fee or lost delivery_charge.');
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'tracking_update',
        'consignment_id' => 'SF-' . $stamp,
        'invoice' => $steadfastNumber,
        'tracking_message' => 'Package arrived at the sorting center.',
        'updated_at' => '2026-08-03 13:15:00',
    ]), $steadfastHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $steadfastId) === 'Completed', 'Steadfast tracking-only event changed status.');

    $steadfastCancelledId = 'cwh-sf-cancel-' . $stamp;
    $steadfastCancelledNumber = 'CWH-SF-CANCEL-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $steadfastCancelledId, $steadfastCancelledNumber, 'Picked', $customerId, [
        'steadfast' => 'SF-CANCEL-' . $stamp,
    ]);
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'delivery_status',
        'consignment_id' => 'SF-CANCEL-' . $stamp,
        'invoice' => $steadfastCancelledNumber,
        'status' => 'cancelled',
        'delivery_charge' => 0,
        'updated_at' => '2026-08-03 14:00:00',
    ]), $steadfastHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $steadfastCancelledId) === 'Cancelled', 'Steadfast cancelled did not map to Cancelled.');

    // Paperfly: package_price and collected_amount are not courier fees. An
    // explicit fee field is saved and later recorded on delivery.
    $paperflyId = 'cwh-paperfly-' . $stamp;
    $paperflyNumber = 'CWH-PAPERFLY-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $paperflyId, $paperflyNumber, 'Processing', $customerId, [
        'paperfly' => 'PF-' . $stamp,
    ]);
    $courier->handleWebhook('paperfly', courierWebhookJson([
        'event' => 'parcel.created',
        'timestamp' => '2026-08-03T17:28:24+00:00',
        'data' => [
            'order_number' => 'PF-' . $stamp,
            'merchant_order_reference' => $paperflyNumber,
            'barcode' => 'BAR-' . $stamp,
            'package_price' => 10,
            'delivery_fee' => 18.25,
        ],
    ]), $paperflyHeaders);
    $paperflyCharge = $database->fetchOne(
        'SELECT * FROM courier_order_charges WHERE provider = :provider AND consignment_id = :consignment LIMIT 1',
        [':provider' => 'paperfly', ':consignment' => 'PF-' . $stamp]
    );
    courierWebhookAssert($paperflyCharge !== null && abs((float) $paperflyCharge['total_charge'] - 18.25) < 0.001, 'Paperfly package price was treated as a fee or explicit fee was lost.');
    $courier->handleWebhook('paperfly', courierWebhookJson([
        'event' => 'parcel.picked_up',
        'timestamp' => '2026-08-03T17:34:53+00:00',
        'data' => [
            'order_number' => 'PF-' . $stamp,
            'merchant_order_reference' => $paperflyNumber,
            'journey' => 'forward',
            'action_datetime' => '2026-08-03 23:33:31',
        ],
    ]), $paperflyHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $paperflyId) === 'Picked', 'Paperfly picked_up did not map to Picked.');
    $courier->handleWebhook('paperfly', courierWebhookJson([
        'event' => 'parcel.delivered',
        'timestamp' => '2026-08-03T17:57:51+00:00',
        'data' => [
            'order_number' => 'PF-' . $stamp,
            'merchant_order_reference' => $paperflyNumber,
            'order_status' => 'delivered',
            'collected_amount' => 10,
            'action_date_time' => '2026-08-03 23:53:35',
        ],
    ]), $paperflyHeaders);
    $paperflyExpense = courierWebhookExpense($database, $paperflyId);
    courierWebhookAssert(courierWebhookOrderStatus($database, $paperflyId) === 'Completed', 'Paperfly delivered did not complete the order.');
    courierWebhookAssert($paperflyExpense !== null && abs((float) $paperflyExpense['amount'] - 18.25) < 0.001, 'Paperfly collected amount was treated as a fee.');

    $paperflyReturnId = 'cwh-pf-return-' . $stamp;
    $paperflyReturnNumber = 'CWH-PF-RETURN-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $paperflyReturnId, $paperflyReturnNumber, 'Picked', $customerId, [
        'paperfly' => 'PF-RETURN-' . $stamp,
    ]);
    $courier->handleWebhook('paperfly', courierWebhookJson([
        'event' => 'parcel.return',
        'timestamp' => '2026-08-03T19:19:53+00:00',
        'data' => [
            'order_number' => 'PF-RETURN-' . $stamp,
            'merchant_order_reference' => $paperflyReturnNumber,
            'journey_type' => 'Reverse',
            'status' => 'return',
        ],
    ]), $paperflyHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $paperflyReturnId) === 'Returned', 'Paperfly return did not map to Returned.');

    $paperflyExchangeId = 'cwh-pf-exchange-' . $stamp;
    $paperflyExchangeNumber = 'CWH-PF-EXCHANGE-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $paperflyExchangeId, $paperflyExchangeNumber, 'Exchange processing', $customerId, [
        'paperfly' => 'PF-MAIN-' . $stamp,
        'exchangePaperfly' => 'PF-EXCHANGE-' . $stamp,
    ]);
    $courier->handleWebhook('paperfly', courierWebhookJson([
        'event' => 'parcel.exchange',
        'timestamp' => '2026-08-03T19:06:50+00:00',
        'data' => [
            'order_number' => 'PF-EXCHANGE-' . $stamp,
            'merchant_order_reference' => $paperflyExchangeNumber,
            'order_status' => 'exchange',
            'collected_amount' => 5,
        ],
    ]), $paperflyHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $paperflyExchangeId) === 'Exchange delivered', 'Paperfly exchange did not map to Exchange delivered.');

    $paperflyCancelledId = 'cwh-pf-cancel-' . $stamp;
    $paperflyCancelledNumber = 'CWH-PF-CANCEL-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $paperflyCancelledId, $paperflyCancelledNumber, 'Picked', $customerId, [
        'paperfly' => 'PF-CANCEL-' . $stamp,
    ]);
    $courier->handleWebhook('paperfly', courierWebhookJson([
        'event' => 'parcel.cancelled',
        'timestamp' => '2026-08-03T20:00:00+00:00',
        'data' => [
            'order_number' => 'PF-CANCEL-' . $stamp,
            'merchant_order_reference' => $paperflyCancelledNumber,
            'status' => 'cancelled',
        ],
    ]), $paperflyHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $paperflyCancelledId) === 'Cancelled', 'Paperfly cancelled did not map to Cancelled.');

    // Pathao accepts configurable strict headers and flexible nested status
    // payloads. Fee components received separately remain one exact charge.
    $pathaoId = 'cwh-pathao-' . $stamp;
    $pathaoNumber = 'CWH-PATHAO-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $pathaoId, $pathaoNumber, 'Processing', $customerId, [
        'pathao' => 'PATHAO-' . $stamp,
    ]);
    $courier->handleWebhook('pathao', courierWebhookJson([
        'event' => 'order.updated',
        'data' => [
            'consignment_id' => 'PATHAO-' . $stamp,
            'merchant_order_id' => $pathaoNumber,
            'order_status_slug' => 'Picked Up',
            'delivery_fee' => 42.75,
            'updated_at' => '2026-08-04 10:00:00',
        ],
    ]), $pathaoHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $pathaoId) === 'Picked', 'Pathao picked status did not map to Picked.');
    $courier->handleWebhook('pathao', courierWebhookJson([
        'event' => 'fee.updated',
        'data' => [
            'consignment_id' => 'PATHAO-' . $stamp,
            'merchant_order_id' => $pathaoNumber,
            'cod_fee' => 5,
            'updated_at' => '2026-08-04 10:30:00',
        ],
    ]), $pathaoHeaders);
    $pathaoCharge = $database->fetchOne(
        'SELECT * FROM courier_order_charges WHERE provider = :provider AND consignment_id = :consignment LIMIT 1',
        [':provider' => 'pathao', ':consignment' => 'PATHAO-' . $stamp]
    );
    courierWebhookAssert($pathaoCharge !== null && abs((float) $pathaoCharge['total_charge'] - 47.75) < 0.001, 'Separate Pathao fee components did not retain the exact total.');
    $courier->handleWebhook('pathao', courierWebhookJson([
        'event' => 'order.updated',
        'data' => [
            'consignment_id' => 'PATHAO-' . $stamp,
            'merchant_order_id' => $pathaoNumber,
            'order_status_slug' => 'Delivered',
            'collectable_amount' => 999,
            'updated_at' => '2026-08-04 11:00:00',
        ],
    ]), $pathaoHeaders);
    $pathaoExpense = courierWebhookExpense($database, $pathaoId);
    courierWebhookAssert($pathaoExpense !== null && abs((float) $pathaoExpense['amount'] - 47.75) < 0.001, 'Pathao collectable amount changed the saved fee.');

    $referenceFirstId = 'cwh-reference-first-' . $stamp;
    $referenceFirstNumber = 'CWH-REFERENCE-FIRST-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $referenceFirstId, $referenceFirstNumber, 'Picked', $customerId, [
        'pathao' => 'PATHAO-REFERENCE-' . $stamp,
    ]);
    $courier->handleWebhook('pathao', courierWebhookJson([
        'event' => 'fee.updated',
        'data' => [
            'merchant_order_id' => $referenceFirstNumber,
            'delivery_fee' => 6.50,
            'updated_at' => '2026-08-04 11:15:00',
        ],
    ]), $pathaoHeaders);
    $courier->handleWebhook('pathao', courierWebhookJson([
        'event' => 'order.updated',
        'data' => [
            'consignment_id' => 'PATHAO-REFERENCE-' . $stamp,
            'merchant_order_id' => $referenceFirstNumber,
            'order_status_slug' => 'Delivered',
            'updated_at' => '2026-08-04 11:30:00',
        ],
    ]), $pathaoHeaders);
    $referenceFirstCharges = $database->fetchAll(
        'SELECT * FROM courier_order_charges WHERE provider = :provider AND order_id = :order_id',
        [':provider' => 'pathao', ':order_id' => $referenceFirstId]
    );
    $referenceFirstExpense = courierWebhookExpense($database, $referenceFirstId);
    courierWebhookAssert(count($referenceFirstCharges) === 1, 'Merchant-reference-first fee was split into duplicate charge rows.');
    courierWebhookAssert(
        (string) ($referenceFirstCharges[0]['consignment_id'] ?? '') === 'PATHAO-REFERENCE-' . $stamp,
        'Later consignment did not claim the merchant-reference fee row.'
    );
    courierWebhookAssert(
        $referenceFirstExpense !== null && abs((float) $referenceFirstExpense['amount'] - 6.50) < 0.001,
        'Merchant-reference-first fee was not recorded on delivery.'
    );

    $pathaoReturnId = 'cwh-pathao-return-' . $stamp;
    $pathaoReturnNumber = 'CWH-PATHAO-RETURN-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $pathaoReturnId, $pathaoReturnNumber, 'Picked', $customerId, [
        'pathao' => 'PATHAO-RETURN-' . $stamp,
    ]);
    $courier->handleWebhook('pathao', courierWebhookJson([
        'event' => 'order.updated',
        'data' => [
            'consignment_id' => 'PATHAO-RETURN-' . $stamp,
            'merchant_order_id' => $pathaoReturnNumber,
            'order_status_slug' => 'Return Delivered',
            'updated_at' => '2026-08-04 12:00:00',
        ],
    ]), $pathaoHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $pathaoReturnId) === 'Returned', 'Pathao Return Delivered was mistaken for Delivered.');

    $pathaoExchangeId = 'cwh-pathao-exchange-' . $stamp;
    $pathaoExchangeNumber = 'CWH-PATHAO-EXCHANGE-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $pathaoExchangeId, $pathaoExchangeNumber, 'Exchange processing', $customerId, [
        'pathao' => 'PATHAO-MAIN-' . $stamp,
        'exchangePathao' => 'PATHAO-EXCHANGE-' . $stamp,
    ]);
    $courier->handleWebhook('pathao', courierWebhookJson([
        'event' => 'order.updated',
        'data' => [
            'consignment_id' => 'PATHAO-MAIN-' . $stamp,
            'merchant_order_id' => $pathaoExchangeNumber,
            'order_status_slug' => 'Delivered',
            'updated_at' => '2026-08-04 13:00:00',
        ],
    ]), $pathaoHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $pathaoExchangeId) === 'Exchange processing', 'Delayed main Pathao event completed an active exchange.');
    $courier->handleWebhook('pathao', courierWebhookJson([
        'event' => 'order.updated',
        'data' => [
            'consignment_id' => 'PATHAO-EXCHANGE-' . $stamp,
            'merchant_order_id' => $pathaoExchangeNumber,
            'order_status_slug' => 'Delivered',
            'updated_at' => '2026-08-04 13:30:00',
        ],
    ]), $pathaoHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $pathaoExchangeId) === 'Exchange delivered', 'Pathao exchange shipment did not reach Exchange delivered.');

    // A fee that arrives after delivery must create the expense once and join
    // the existing completion Undoer record instead of becoming orphaned.
    $lateFeeId = 'cwh-late-fee-' . $stamp;
    $lateFeeNumber = 'CWH-LATE-FEE-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $lateFeeId, $lateFeeNumber, 'Picked', $customerId, [
        'pathao' => 'PATHAO-LATE-' . $stamp,
    ]);
    $courier->handleWebhook('pathao', courierWebhookJson([
        'event' => 'order.updated',
        'data' => [
            'consignment_id' => 'PATHAO-LATE-' . $stamp,
            'merchant_order_id' => $lateFeeNumber,
            'order_status_slug' => 'Delivered',
            'updated_at' => '2026-08-04 14:00:00',
        ],
    ]), $pathaoHeaders);
    courierWebhookAssert(courierWebhookExpense($database, $lateFeeId) === null, 'Zero-fee delivery created an expense.');
    $courier->handleWebhook('pathao', courierWebhookJson([
        'event' => 'fee.updated',
        'data' => [
            'consignment_id' => 'PATHAO-LATE-' . $stamp,
            'merchant_order_id' => $lateFeeNumber,
            'delivery_fee' => 12.34,
            'updated_at' => '2026-08-04 14:15:00',
        ],
    ]), $pathaoHeaders);
    $lateExpense = courierWebhookExpense($database, $lateFeeId);
    courierWebhookAssert($lateExpense !== null && abs((float) $lateExpense['amount'] - 12.34) < 0.001, 'Late Pathao fee did not create the exact expense.');
    $lateUndo = $database->fetchOne(
        "SELECT transaction_ids FROM order_status_undo_events
         WHERE order_id = :order_id AND to_status = 'Completed' AND undone_at IS NULL
         ORDER BY created_at DESC, id DESC LIMIT 1",
        [':order_id' => $lateFeeId]
    );
    $lateUndoIds = json_decode((string) ($lateUndo['transaction_ids'] ?? '[]'), true);
    courierWebhookAssert(
        is_array($lateUndoIds) && in_array((string) $lateExpense['id'], $lateUndoIds, true),
        'Late automatic expense was not attached to the existing Undoer event.'
    );

    // Unmatched events remain auditable and can match on an exact provider
    // retry after the local order identifier becomes available.
    $unmatchedConsignment = 'CB-UNMATCHED-' . $stamp;
    $unmatchedNumber = 'CWH-UNMATCHED-' . $stamp;
    $unmatchedRaw = courierWebhookJson([
        'event' => 'order.created',
        'consignment_id' => $unmatchedConsignment,
        'merchant_order_id' => $unmatchedNumber,
        'timestamptz' => '2026-08-04T15:00:00+00:00',
        'cod_fee' => 2,
        'delivery_fee' => 8,
    ]);
    $unmatchedResult = $courier->handleWebhook('carrybee', $unmatchedRaw, $carryHeaders);
    courierWebhookAssert(($unmatchedResult['orderMatched'] ?? true) === false, 'Unknown event unexpectedly matched an order.');
    $unmatchedEvent = $database->fetchOne(
        'SELECT * FROM courier_webhook_events WHERE provider = :provider AND consignment_id = :consignment LIMIT 1',
        [':provider' => 'carrybee', ':consignment' => $unmatchedConsignment]
    );
    courierWebhookAssert(($unmatchedEvent['processing_status'] ?? '') === 'unmatched', 'Unmatched event was not retained for diagnosis.');
    $unmatchedOrderId = 'cwh-unmatched-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $unmatchedOrderId, $unmatchedNumber, 'On Hold', $customerId, [
        'carrybee' => $unmatchedConsignment,
    ]);
    $rematchedResult = $courier->handleWebhook('carrybee', $unmatchedRaw, $carryHeaders);
    courierWebhookAssert(($rematchedResult['orderMatched'] ?? false) === true, 'Exact retry did not rematch the previously unknown order.');
    $unmatchedChargeCount = (int) (($database->fetchOne(
        'SELECT COUNT(*) AS total FROM courier_order_charges WHERE provider = :provider AND consignment_id = :consignment',
        [':provider' => 'carrybee', ':consignment' => $unmatchedConsignment]
    ) ?? [])['total'] ?? 0);
    courierWebhookAssert($unmatchedChargeCount === 1, 'Unmatched retry duplicated the provider charge row.');

    $startingBalance = 5000.00;
    $linkedExpenseTotal = (float) (($database->fetchOne(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
         WHERE account_id = :account_id AND type = 'Expense' AND deleted_at IS NULL AND account_effect_applied = 1",
        [':account_id' => $accountId]
    ) ?? [])['total'] ?? 0);
    $endingBalance = (float) (($database->fetchOne(
        'SELECT current_balance FROM accounts WHERE id = :account_id',
        [':account_id' => $accountId]
    ) ?? [])['current_balance'] ?? 0);
    courierWebhookAssert(
        abs($endingBalance - ($startingBalance - $linkedExpenseTotal)) < 0.001,
        'Automatic and manual courier expenses did not deduct the account exactly once.'
    );

    $realtimeProvider = (string) file_get_contents($root . '/src/contexts/RealtimeProvider.tsx');
    courierWebhookAssert(!str_contains($realtimeProvider, 'setInterval'), 'Browser courier polling interval still exists.');
    courierWebhookAssert(!str_contains($realtimeProvider, 'syncCarryBeeTransferStatuses'), 'Browser still calls courier status sync automatically.');
    $orderDetails = (string) file_get_contents($root . '/pages/OrderDetails.tsx');
    $ordersPage = (string) file_get_contents($root . '/pages/Orders.tsx');
    courierWebhookAssert(str_contains($orderDetails, 'courierAutomaticExpenseRecorded'), 'Order Details does not check if automatic expense was recorded.');
    courierWebhookAssert(str_contains($ordersPage, 'courierAutomaticExpenseRecorded'), 'Orders list does not check if automatic expense was recorded.');
    courierWebhookAssert(str_contains($orderDetails, '!(automaticCourierExpenseEnabled && courierAutomaticExpenseRecorded)'), 'Order Details does not conditionally hide the manual expense button.');
    courierWebhookAssert(str_contains($ordersPage, '!(automaticCourierExpenseEnabled && courierAutomaticExpenseRecorded)'), 'Orders list does not conditionally hide the manual expense button.');

    echo "Courier webhook verification, mappings, idempotency, charges, expenses, account effects, and Undoer integration passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
