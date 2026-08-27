<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\ApiException;
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
            items, total, paid_amount, history, carrybee_consignment_id, paperfly_tracking_number,
            steadfast_consignment_id, pathao_consignment_id,
            exchange_carrybee_consignment_id, exchange_paperfly_tracking_number,
            exchange_steadfast_consignment_id, exchange_pathao_consignment_id
         ) VALUES (
            :id, :order_number, :order_seq, CURRENT_DATE, :customer_id, :created_by, :status,
            :items, :total, :paid_amount, :history, :carrybee, :paperfly, :steadfast, :pathao,
            :exchange_carrybee, :exchange_paperfly, :exchange_steadfast, :exchange_pathao
         )',
        [
            ':id' => $id,
            ':order_number' => $orderNumber,
            ':order_seq' => $nextSequence++,
            ':customer_id' => $customerId,
            ':created_by' => (string) $actor['id'],
            ':status' => $status,
            ':items' => $extra['items'] ?? '[]',
            ':total' => $extra['total'] ?? 0,
            ':paid_amount' => $extra['paidAmount'] ?? 0,
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

/** @return array<string, mixed>|null */
function courierWebhookPayment(Database $database, string $orderId): ?array
{
    return $database->fetchOne(
        "SELECT * FROM transactions
         WHERE reference_id = :order_id AND type = 'Income'
           AND description LIKE 'Automatic courier % payment%'
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

foreach (['courier_webhook_events', 'courier_order_charges', 'order_status_undo_events', 'courier_tracking_events'] as $requiredTable) {
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
$pathaoHeaders = ['X-PATHAO-Signature' => 'pathao-test-secret'];

$pdo->beginTransaction();
try {
    $settings = $database->fetchOne('SELECT id FROM courier_settings LIMIT 1');
    if ($settings === null) {
        $database->execute('INSERT INTO courier_settings (id) VALUES (:id)', [':id' => 'courier-default']);
    }
    $database->execute(
        'UPDATE courier_settings SET
            automatically_deduct_shipping_costs = 0,
            automatically_mark_paid_after_delivery = 0,
            carrybee_webhook_signature = :carrybee,
            carrybee_webhook_header = :carrybee_header,
            paperfly_webhook_secret = :paperfly,
            steadfast_api_key = :steadfast,
            steadfast_secret_key = :steadfast_secret,
            pathao_webhook_header = :pathao_header,
            pathao_webhook_secret = :pathao_secret',
        [
            ':carrybee' => 'carrybee-test-signature',
            ':carrybee_header' => 'X-Carrybee-Webhook-Signature',
            ':paperfly' => 'paperfly-test-secret',
            ':steadfast' => 'steadfast-test-api-key',
            ':steadfast_secret' => 'steadfast-test-secret-key',
            ':pathao_header' => 'X-PATHAO-Signature',
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
    // CarryBee verifies real events with the configurable signature header
    // (X-Carrybee-Webhook-Signature), never with the integration header.
    expectCourierWebhookSignatureFailure(
        fn() => $courier->handleWebhook('carrybee', $minimalPayload, ['X-Carrybee-Webhook-Signature' => 'wrong']),
        'carrybee'
    );
    expectCourierWebhookSignatureFailure(
        fn() => $courier->handleWebhook('carrybee', $minimalPayload, ['X-CB-Webhook-Integration-Header' => 'carrybee-test-signature']),
        'carrybee'
    );
    $carrybeeIntegration = $courier->handleWebhook(
        'carrybee',
        courierWebhookJson(['event' => 'webhook.integration']),
        ['X-CB-Webhook-Integration-Header' => 'anything']
    );
    courierWebhookAssert(($carrybeeIntegration['integrationVerified'] ?? false) === true, 'CarryBee webhook.integration handshake was not acknowledged.');
    courierWebhookAssert(
        ($carrybeeIntegration['webhookIntegrationHeader'] ?? '') === 'X-CB-Webhook-Integration-Header'
        && ($carrybeeIntegration['webhookIntegrationValue'] ?? '') === '40489fe0-9386-4fc9-8e92-2b2fcb9d451c',
        'CarryBee integration response header name/value defaults are incorrect.'
    );
    $database->execute(
        "UPDATE courier_settings SET carrybee_webhook_header = 'X-CB-Custom-Signature'"
    );
    expectCourierWebhookSignatureFailure(
        fn() => $courier->handleWebhook('carrybee', $minimalPayload, ['X-Carrybee-Webhook-Signature' => 'carrybee-test-signature']),
        'carrybee'
    );
    $customHeaderResult = $courier->handleWebhook(
        'carrybee',
        courierWebhookJson(['event' => 'order.picked', 'consignment_id' => 'custom-header-' . $stamp]),
        ['X-CB-Custom-Signature' => 'carrybee-test-signature']
    );
    courierWebhookAssert(empty($customHeaderResult['orderMatched']), 'Custom CarryBee signature header was not accepted and verified.');
    $database->execute(
        "UPDATE courier_settings SET carrybee_webhook_header = 'X-Carrybee-Webhook-Signature'"
    );
    expectCourierWebhookSignatureFailure(
        fn() => $courier->handleWebhook('paperfly', $minimalPayload, ['X-Paperfly-Webhook-Secret' => 'wrong']),
        'paperfly'
    );
    expectCourierWebhookSignatureFailure(
        fn() => $courier->handleWebhook('steadfast', $minimalPayload, ['Authorization' => 'Bearer wrong']),
        'steadfast'
    );
    $steadfastSecretResult = $courier->handleWebhook(
        'steadfast',
        courierWebhookJson(['event' => 'tracking_update', 'consignment_id' => 'secret-header-' . $stamp]),
        ['Secret-Key' => 'steadfast-test-secret-key']
    );
    courierWebhookAssert(empty($steadfastSecretResult['orderMatched']), 'Steadfast Secret-Key authentication was rejected or matched an unrelated order.');
    expectCourierWebhookSignatureFailure(
        fn() => $courier->handleWebhook('pathao', $minimalPayload, ['X-PATHAO-Signature' => 'wrong']),
        'pathao'
    );

    // CarryBee: store order-created fees immediately, map every supplied event,
    // and never regress a terminal status when an older event arrives later.
    $carryOffId = 'cwh-carry-off-' . $stamp;
    $carryOffNumber = 'CWH-CARRY-OFF-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $carryOffId, $carryOffNumber, 'Processing', $customerId, [
        'carrybee' => 'CB-OFF-' . $stamp,
        'total' => 1500,
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
    $carryOffPaymentState = $database->fetchOne('SELECT paid_amount FROM orders WHERE id = :id', [':id' => $carryOffId]);
    courierWebhookAssert((float) ($carryOffPaymentState['paid_amount'] ?? -1) === 0.0, 'Toggle-off courier delivery was marked paid.');

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

    $carryPaidReturnId = 'cwh-carry-paid-return-' . $stamp;
    $carryPaidReturnNumber = 'CWH-CARRY-PAID-RETURN-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $carryPaidReturnId, $carryPaidReturnNumber, 'Picked', $customerId, [
        'carrybee' => 'CB-PAID-RETURN-' . $stamp,
    ]);
    $courier->handleWebhook('carrybee', courierWebhookJson([
        'event' => 'order.paid-return',
        'consignment_id' => 'CB-PAID-RETURN-' . $stamp,
        'merchant_order_id' => $carryPaidReturnNumber,
        'timestamptz' => '2026-08-01T14:30:00+00:00',
        'collected_amount' => 500,
        'attempt' => 1,
        'reason' => 'Wrong size',
        'remarks' => 'Paid return collected.',
    ]), $carryHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $carryPaidReturnId) === 'Returned', 'CarryBee paid-return did not map to Returned.');
    $carryPaidReturnCharge = courierWebhookExpense($database, $carryPaidReturnId);
    courierWebhookAssert($carryPaidReturnCharge === null, 'CarryBee paid-return created an expense before toggle-on.');

    $carryExchangeId = 'cwh-carry-exchange-' . $stamp;
    $carryExchangeNumber = 'CWH-CARRY-EXCHANGE-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $carryExchangeId, $carryExchangeNumber, 'Exchange processing', $customerId, [
        'carrybee' => 'CB-MAIN-' . $stamp,
        'exchangeCarrybee' => 'CB-EXCHANGE-' . $stamp,
    ]);
    $courier->handleWebhook('carrybee', courierWebhookJson([
        'event' => 'order.exchange',
        'consignment_id' => 'CB-EXCHANGE-' . $stamp,
        'merchant_order_id' => $carryExchangeNumber,
        'timestamptz' => '2026-08-01T15:00:00+00:00',
        'collected_amount' => 900,
        'reason' => 'Damaged item',
        'remarks' => 'Exchange delivered.',
    ]), $carryHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $carryExchangeId) === 'Exchange delivered', 'CarryBee exchange did not map to Exchange delivered.');

    // Enable accounting automation. A delivery now creates one linked Shipping
    // Costs transaction and includes it in the status Undoer restore point.
    $database->execute('UPDATE courier_settings SET automatically_deduct_shipping_costs = 1, automatically_mark_paid_after_delivery = 1');
    $carryAutoId = 'cwh-carry-auto-' . $stamp;
    $carryAutoNumber = 'CWH-CARRY-AUTO-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $carryAutoId, $carryAutoNumber, 'Picked', $customerId, [
        'carrybee' => 'CB-AUTO-' . $stamp,
        'total' => 2000,
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
    $carryPayment = courierWebhookPayment($database, $carryAutoId);
    courierWebhookAssert($carryExpense !== null, 'CarryBee automatic Shipping Costs expense was not created.');
    courierWebhookAssert(abs((float) $carryExpense['amount'] - 98.46) < 0.001, 'CarryBee automatic expense amount is incorrect.');
    courierWebhookAssert(strlen((string) $carryExpense['id']) <= 64, 'Automatic courier transaction id exceeds the database limit.');
    courierWebhookAssert($carryPayment !== null && abs((float) $carryPayment['amount'] - 2000.00) < 0.001, 'Courier delivery did not record the full outstanding payment.');
    $carryPaidState = $database->fetchOne('SELECT paid_amount, history FROM orders WHERE id = :id', [':id' => $carryAutoId]);
    courierWebhookAssert(abs((float) ($carryPaidState['paid_amount'] ?? 0) - 2000.00) < 0.001, 'Courier delivery did not mark the order fully paid.');
    courierWebhookAssert(str_contains((string) ($carryPaidState['history'] ?? ''), 'Automatically marked paid after courier delivery'), 'Automatic payment history is missing.');
    $carryUndo = $database->fetchOne(
        "SELECT transaction_ids FROM order_status_undo_events
         WHERE order_id = :order_id AND to_status = 'Completed' AND undone_at IS NULL
         ORDER BY created_at DESC, id DESC LIMIT 1",
        [':order_id' => $carryAutoId]
    );
    $carryUndoIds = json_decode((string) ($carryUndo['transaction_ids'] ?? '[]'), true);
    courierWebhookAssert(
        is_array($carryUndoIds)
            && in_array((string) $carryExpense['id'], $carryUndoIds, true)
            && in_array((string) $carryPayment['id'], $carryUndoIds, true),
        'CarryBee automatic payment/expense is missing from the Undoer event.'
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
    $carryPaymentCountAfterRetry = (int) (($database->fetchOne(
        "SELECT COUNT(*) AS total FROM transactions WHERE reference_id = :order_id AND type = 'Income' AND description LIKE 'Automatic courier delivery payment%'",
        [':order_id' => $carryAutoId]
    ) ?? [])['total'] ?? 0);
    courierWebhookAssert($carryPaymentCountAfterRetry === 1, 'CarryBee retry duplicated the automatic payment.');

    $operations->addCourierCompletionExpense([
        'orderId' => $carryAutoId,
        'outcome' => 'Delivered',
        'date' => gmdate('c'),
        'additionalExpenseAmount' => 1,
        'additionalExpenseCategoryId' => 'expense_shipping',
    ]);
    $manualDeliveredExpense = $database->fetchOne(
        "SELECT * FROM transactions
         WHERE reference_id = :order_id AND type = 'Expense'
           AND description LIKE 'Additional delivery expense for Order #%'
           AND amount = 1.00
           AND deleted_at IS NULL
         ORDER BY created_at ASC, id ASC LIMIT 1",
        [':order_id' => $carryAutoId]
    );
    courierWebhookAssert(
        $manualDeliveredExpense !== null,
        'Manual delivered-order expense was not recorded when courier automation was enabled.'
    );
    courierWebhookAssert(
        abs((float) ($manualDeliveredExpense['amount'] ?? 0) - 1.00) < 0.001,
        'Manual delivered-order expense did not preserve the requested amount.'
    );

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

    $steadfastTrackingStatusId = 'cwh-sf-tracking-status-' . $stamp;
    $steadfastTrackingStatusNumber = 'CWH-SF-TRACKING-STATUS-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $steadfastTrackingStatusId, $steadfastTrackingStatusNumber, 'Picked', $customerId, [
        'steadfast' => 'SF-TRACKING-STATUS-' . $stamp,
    ]);
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'tracking_update',
        'consignment_id' => 'SF-TRACKING-STATUS-' . $stamp,
        'invoice' => $steadfastTrackingStatusNumber,
        'status' => 'delivered',
    ]), ['Api-Key' => 'steadfast-test-api-key']);
    courierWebhookAssert(courierWebhookOrderStatus($database, $steadfastTrackingStatusId) === 'Completed', 'Steadfast tracking_update with explicit status was ignored.');

    $steadfastLateId = 'cwh-sf-late-' . $stamp;
    $steadfastLateNumber = 'CWH-SF-LATE-' . $stamp;
    $steadfastLateConsignment = 'SF-LATE-' . $stamp;
    $steadfastLatePayload = courierWebhookJson([
        'notification_type' => 'delivery_status',
        'consignment_id' => $steadfastLateConsignment,
        'invoice' => $steadfastLateNumber,
        'status' => 'delivered',
    ]);
    $lateResult = $courier->handleWebhook('steadfast', $steadfastLatePayload, $steadfastHeaders);
    courierWebhookAssert(empty($lateResult['orderMatched']), 'Pre-order Steadfast webhook unexpectedly matched an order.');
    $lateEventKey = hash('sha256', 'steadfast|' . $steadfastLatePayload);
    $database->execute(
        "UPDATE courier_webhook_events SET processed_at = '1970-01-01 00:00:00' WHERE provider = 'steadfast' AND event_key = :event_key",
        [':event_key' => $lateEventKey]
    );
    createCourierWebhookOrder($database, $actor, $nextSequence, $steadfastLateId, $steadfastLateNumber, 'Picked', $customerId, [
        'steadfast' => $steadfastLateConsignment,
    ]);
    $lateReplay = $courier->reconcileUnmatchedWebhookEvents(['provider' => 'steadfast', 'limit' => 1]);
    courierWebhookAssert(($lateReplay['matched'] ?? 0) === 1, 'Stored unmatched Steadfast webhook was not reconciled after the order became matchable.');
    courierWebhookAssert(courierWebhookOrderStatus($database, $steadfastLateId) === 'Completed', 'Reconciled Steadfast webhook did not update the order status.');

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
        'cod_amount' => 500,
        'delivery_charge' => 0,
        'updated_at' => '2026-08-03 14:00:00',
    ]), $steadfastHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $steadfastCancelledId) === 'Cancelled', 'Steadfast cancelled did not map to Cancelled.');
    courierWebhookAssert(
        courierWebhookPayment($database, $steadfastCancelledId) === null,
        'Steadfast cancelled webhook booked the COD amount as automatic courier income.'
    );
    $sfCancelPaid = $database->fetchOne('SELECT paid_amount FROM orders WHERE id = :id', [':id' => $steadfastCancelledId]);
    courierWebhookAssert((float) ($sfCancelPaid['paid_amount'] ?? -1) === 0.0, 'Steadfast cancelled webhook marked the order paid.');

    $steadfastPendingId = 'cwh-sf-pending-' . $stamp;
    $steadfastPendingNumber = 'CWH-SF-PENDING-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $steadfastPendingId, $steadfastPendingNumber, 'Processing', $customerId, [
        'steadfast' => 'SF-PENDING-' . $stamp,
    ]);
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'delivery_status',
        'consignment_id' => 'SF-PENDING-' . $stamp,
        'invoice' => $steadfastPendingNumber,
        'status' => 'pending',
        'delivery_charge' => 0,
        'updated_at' => '2026-08-03 14:30:00',
    ]), $steadfastHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $steadfastPendingId) === 'Picked', 'Steadfast pending did not map to Picked.');

    // Courier tracking timeline: Steadfast tracking_update messages are
    // persisted per order, retries deduplicate on the event key, and the
    // CLI reconciliation replay attaches a later-created order to the row.
    $timelineId = 'cwh-sf-timeline-' . $stamp;
    $timelineNumber = 'CWH-SF-TIMELINE-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $timelineId, $timelineNumber, 'Processing', $customerId, [
        'steadfast' => 'SF-TIMELINE-' . $stamp,
    ]);
    $timelineEventOne = courierWebhookJson([
        'notification_type' => 'tracking_update',
        'consignment_id' => 'SF-TIMELINE-' . $stamp,
        'invoice' => $timelineNumber,
        'tracking_message' => 'Parcel booked and queued for pickup.',
        'updated_at' => '2026-08-05T09:00:00+00:00',
    ]);
    $courier->handleWebhook('steadfast', $timelineEventOne, $steadfastHeaders);
    $timelineEventTwo = courierWebhookJson([
        'notification_type' => 'tracking_update',
        'consignment_id' => 'SF-TIMELINE-' . $stamp,
        'invoice' => $timelineNumber,
        'tracking_message' => 'Parcel is out for delivery.',
        'updated_at' => '2026-08-05T11:00:00+00:00',
    ]);
    $courier->handleWebhook('steadfast', $timelineEventTwo, $steadfastHeaders);
    $timelineRetry = $courier->handleWebhook('steadfast', $timelineEventTwo, $steadfastHeaders);
    courierWebhookAssert(($timelineRetry['duplicate'] ?? false) === true, 'Steadfast tracking_update retry was not deduplicated.');
    $timelineRows = $database->fetchAll(
        'SELECT order_id, tracking_message, event_at FROM courier_tracking_events
         WHERE provider = :provider AND order_id = :order_id ORDER BY event_at ASC, id ASC',
        [':provider' => 'steadfast', ':order_id' => $timelineId]
    );
    courierWebhookAssert(count($timelineRows) === 2, 'Steadfast tracking_update messages were not stored exactly once per event.');
    courierWebhookAssert((string) ($timelineRows[0]['tracking_message'] ?? '') === 'Parcel booked and queued for pickup.', 'First tracking event was not stored in chronological order.');
    courierWebhookAssert((string) ($timelineRows[1]['tracking_message'] ?? '') === 'Parcel is out for delivery.', 'Second tracking event was not stored in chronological order.');
    $timelineFetch = $courier->fetchCourierTrackingEvents(['orderId' => $timelineId]);
    courierWebhookAssert(count($timelineFetch['data']) === 2, 'fetchCourierTrackingEvents did not return the stored timeline.');
    courierWebhookAssert((string) ($timelineFetch['data'][0]['trackingMessage'] ?? '') === 'Parcel booked and queued for pickup.', 'fetchCourierTrackingEvents returned the wrong first message.');
    courierWebhookAssert((string) ($timelineFetch['data'][1]['eventAt'] ?? '') === '2026-08-05 11:00:00', 'fetchCourierTrackingEvents lost the event timestamp.');
    courierWebhookAssert(
        count($courier->fetchCourierTrackingEvents(['orderId' => 'cwh-sf-unrelated-' . $stamp])['data']) === 0,
        'fetchCourierTrackingEvents leaked events from another order.'
    );

    $timelineReplayPayload = courierWebhookJson([
        'notification_type' => 'tracking_update',
        'consignment_id' => 'SF-TIMELINE-REPLAY-' . $stamp,
        'tracking_message' => 'Shipment created before the order existed.',
        'updated_at' => '2026-08-05T12:00:00+00:00',
    ]);
    $courier->handleWebhook('steadfast', $timelineReplayPayload, $steadfastHeaders);
    $replayEventKey = hash('sha256', 'steadfast|' . $timelineReplayPayload);
    $database->execute(
        "UPDATE courier_webhook_events SET processed_at = '1970-01-01 00:00:00' WHERE provider = 'steadfast' AND event_key = :event_key",
        [':event_key' => $replayEventKey]
    );
    $timelineReplayId = 'cwh-sf-timeline-replay-' . $stamp;
    $timelineReplayNumber = 'CWH-SF-TIMELINE-REPLAY-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $timelineReplayId, $timelineReplayNumber, 'Processing', $customerId, [
        'steadfast' => 'SF-TIMELINE-REPLAY-' . $stamp,
    ]);
    $replayResult = $courier->reconcileUnmatchedWebhookEvents(['provider' => 'steadfast', 'limit' => 1]);
    courierWebhookAssert(($replayResult['matched'] ?? 0) === 1, 'Unmatched Steadfast tracking_update was not reconciled after its order appeared.');
    $replayRows = $database->fetchAll(
        'SELECT order_id, tracking_message FROM courier_tracking_events
         WHERE provider = :provider AND event_key = :event_key',
        [':provider' => 'steadfast', ':event_key' => $replayEventKey]
    );
    courierWebhookAssert(count($replayRows) === 1, 'Reconciled tracking_update replay duplicated the stored timeline event.');
    courierWebhookAssert((string) ($replayRows[0]['order_id'] ?? '') === $timelineReplayId, 'Reconciled tracking_update replay did not attach the later-created order.');
    courierWebhookAssert(
        count($courier->fetchCourierTrackingEvents(['orderId' => $timelineReplayId])['data']) === 1,
        'Reconciled tracking_update timeline is missing from fetchCourierTrackingEvents.'
    );

    $missingOrderIdThrown = false;
    try {
        $courier->fetchCourierTrackingEvents([]);
    } catch (RuntimeException $exception) {
        $missingOrderIdThrown = str_contains($exception->getMessage(), 'required');
    }
    courierWebhookAssert($missingOrderIdThrown, 'fetchCourierTrackingEvents accepted a missing order id.');

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
            'collected_amount' => 400,
        ],
    ]), $paperflyHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $paperflyCancelledId) === 'Cancelled', 'Paperfly cancelled did not map to Cancelled.');
    courierWebhookAssert(
        courierWebhookPayment($database, $paperflyCancelledId) === null,
        'Paperfly cancelled webhook booked the collected amount as automatic courier income.'
    );

    // A cancelled webhook that still carries a shipping fee is expensed when
    // the automatic shipping-cost setting is on; the toggle still gates it.
    $cancelFeeOnId = 'cwh-sf-cancel-fee-' . $stamp;
    $cancelFeeOnNumber = 'CWH-SF-CANCEL-FEE-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $cancelFeeOnId, $cancelFeeOnNumber, 'Picked', $customerId, [
        'steadfast' => 'SF-CANCEL-FEE-' . $stamp,
    ]);
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'delivery_status',
        'consignment_id' => 'SF-CANCEL-FEE-' . $stamp,
        'invoice' => $cancelFeeOnNumber,
        'status' => 'cancelled',
        'cod_amount' => 300,
        'delivery_charge' => 12.5,
        'updated_at' => '2026-08-03 15:00:00',
    ]), $steadfastHeaders);
    courierWebhookAssert(
        courierWebhookOrderStatus($database, $cancelFeeOnId) === 'Cancelled',
        'Fee-carrying Steadfast cancelled did not map to Cancelled.'
    );
    courierWebhookAssert(
        courierWebhookPayment($database, $cancelFeeOnId) === null,
        'Fee-carrying cancelled webhook booked the COD amount as automatic courier income.'
    );
    $cancelFeeOnExpense = courierWebhookExpense($database, $cancelFeeOnId);
    courierWebhookAssert(
        $cancelFeeOnExpense !== null && abs((float) $cancelFeeOnExpense['amount'] - 12.50) < 0.001,
        'Cancelled webhook shipping fee was not expensed while the automatic shipping-cost setting was on.'
    );

    $database->execute('UPDATE courier_settings SET automatically_deduct_shipping_costs = 0');
    $cancelFeeOffId = 'cwh-sf-cancel-fee-off-' . $stamp;
    $cancelFeeOffNumber = 'CWH-SF-CANCEL-FEE-OFF-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $cancelFeeOffId, $cancelFeeOffNumber, 'Picked', $customerId, [
        'steadfast' => 'SF-CANCEL-FEE-OFF-' . $stamp,
    ]);
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'delivery_status',
        'consignment_id' => 'SF-CANCEL-FEE-OFF-' . $stamp,
        'invoice' => $cancelFeeOffNumber,
        'status' => 'cancelled',
        'cod_amount' => 200,
        'delivery_charge' => 9.75,
        'updated_at' => '2026-08-03 15:30:00',
    ]), $steadfastHeaders);
    courierWebhookAssert(
        courierWebhookOrderStatus($database, $cancelFeeOffId) === 'Cancelled',
        'Toggle-off Steadfast cancelled did not map to Cancelled.'
    );
    courierWebhookAssert(
        courierWebhookExpense($database, $cancelFeeOffId) === null,
        'Cancelled webhook shipping fee was expensed while the automatic shipping-cost setting was off.'
    );
    courierWebhookAssert(
        courierWebhookPayment($database, $cancelFeeOffId) === null,
        'Toggle-off cancelled webhook booked the COD amount as automatic courier income.'
    );
    $database->execute('UPDATE courier_settings SET automatically_deduct_shipping_costs = 1');

    // Purchase-price COGS (when enabled) must never produce an expense for a
    // webhook-cancelled order; a delivered control proves the toggle is live.
    $cogsTablePresent = $database->fetchOne(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :table_name LIMIT 1',
        [':table_name' => 'order_cogs_expenses']
    ) !== null;
    if ($cogsTablePresent) {
        // The COGS feature is disabled while the purchases capability is on;
        // take the gate down for this block and restore it afterwards.
        $capRow = $database->fetchOne('SELECT id, capabilities FROM app_capability_settings LIMIT 1');
        $capabilities = is_array($capRow) ? json_decode((string) ($capRow['capabilities'] ?? '{}'), true) : null;
        $capabilities = is_array($capabilities) ? $capabilities : [];
        $originalPurchasesCapability = (bool) ($capabilities['purchases'] ?? false);
        if ($capRow !== null) {
            $capabilities['purchases'] = false;
            $database->execute(
                'UPDATE app_capability_settings SET capabilities = :capabilities WHERE id = :id',
                [':capabilities' => courierWebhookJson($capabilities), ':id' => (string) $capRow['id']]
            );
        }

        // Ensure exactly one singleton row exists, then enable the toggle on
        // every row so LIMIT 1 reads are deterministic.
        $defaultsRow = $database->fetchOne('SELECT id FROM system_defaults LIMIT 1');
        if ($defaultsRow === null) {
            $database->execute(
                'INSERT INTO system_defaults (id, default_account_id, default_payment_method) VALUES (:id, :account_id, :payment_method)',
                [':id' => 'cwh-defaults-' . $stamp, ':account_id' => $accountId, ':payment_method' => 'Cash']
            );
        }
        $database->execute(
            'UPDATE system_defaults SET default_account_id = :account_id, default_payment_method = :payment_method, calculate_cogs_from_purchase_price = 1',
            [':account_id' => $accountId, ':payment_method' => 'Cash']
        );
        $cogsProductId = 'cwh-cogs-product-' . $stamp;
        $database->execute(
            'INSERT INTO products (id, name, sale_price, purchase_price, stock) VALUES (:id, :name, 100.00, 40.00, 500)',
            [':id' => $cogsProductId, ':name' => 'COGS Webhook Product']
        );
        $cogsItems = courierWebhookJson([[
            'productId' => $cogsProductId,
            'productName' => 'COGS Webhook Product',
            'quantity' => 2,
            'salePrice' => 100,
        ]]);

        $cogsCancelledId = 'cwh-sf-cogs-cancel-' . $stamp;
        $cogsCancelledNumber = 'CWH-SF-COGS-CANCEL-' . $stamp;
        createCourierWebhookOrder($database, $actor, $nextSequence, $cogsCancelledId, $cogsCancelledNumber, 'Picked', $customerId, [
            'steadfast' => 'SF-COGS-CANCEL-' . $stamp,
            'items' => $cogsItems,
        ]);
        $courier->handleWebhook('steadfast', courierWebhookJson([
            'notification_type' => 'delivery_status',
            'consignment_id' => 'SF-COGS-CANCEL-' . $stamp,
            'invoice' => $cogsCancelledNumber,
            'status' => 'cancelled',
            'cod_amount' => 250,
            'updated_at' => '2026-08-03 16:00:00',
        ]), $steadfastHeaders);
        courierWebhookAssert(
            courierWebhookOrderStatus($database, $cogsCancelledId) === 'Cancelled',
            'COGS-test Steadfast cancelled did not map to Cancelled.'
        );
        courierWebhookAssert(
            courierWebhookPayment($database, $cogsCancelledId) === null,
            'Webhook-cancelled order was booked as automatic courier income.'
        );
        courierWebhookAssert(
            $database->fetchOne(
                'SELECT * FROM order_cogs_expenses WHERE order_id = :order_id LIMIT 1',
                [':order_id' => $cogsCancelledId]
            ) === null,
            'Webhook-cancelled order created a purchase-price COGS record.'
        );
        courierWebhookAssert(
            $database->fetchOne(
                "SELECT * FROM transactions
                 WHERE reference_id = :order_id AND type = 'Expense' AND category = 'expense_purchases' AND deleted_at IS NULL
                 ORDER BY created_at ASC, id ASC LIMIT 1",
                [':order_id' => $cogsCancelledId]
            ) === null,
            'Webhook-cancelled order created a purchase-price COGS expense transaction.'
        );

        // Control: the same items completed through a webhook still create COGS.
        $cogsDeliveredId = 'cwh-sf-cogs-delivered-' . $stamp;
        $cogsDeliveredNumber = 'CWH-SF-COGS-DELIVERED-' . $stamp;
        createCourierWebhookOrder($database, $actor, $nextSequence, $cogsDeliveredId, $cogsDeliveredNumber, 'Picked', $customerId, [
            'steadfast' => 'SF-COGS-DELIVERED-' . $stamp,
            'items' => $cogsItems,
        ]);
        $courier->handleWebhook('steadfast', courierWebhookJson([
            'notification_type' => 'delivery_status',
            'consignment_id' => 'SF-COGS-DELIVERED-' . $stamp,
            'invoice' => $cogsDeliveredNumber,
            'status' => 'delivered',
            'updated_at' => '2026-08-03 16:30:00',
        ]), $steadfastHeaders);
        $cogsDeliveredTx = $database->fetchOne(
            "SELECT * FROM transactions
             WHERE reference_id = :order_id AND type = 'Expense' AND category = 'expense_purchases' AND deleted_at IS NULL
             ORDER BY created_at ASC, id ASC LIMIT 1",
            [':order_id' => $cogsDeliveredId]
        );
        courierWebhookAssert(
            $cogsDeliveredTx !== null && abs((float) $cogsDeliveredTx['amount'] - 80.00) < 0.001,
            'Delivered control did not create the exact purchase-price COGS expense while the toggle was on.'
        );

        $database->execute('UPDATE system_defaults SET calculate_cogs_from_purchase_price = 0');
        if ($capRow !== null) {
            $capabilities['purchases'] = $originalPurchasesCapability;
            $database->execute(
                'UPDATE app_capability_settings SET capabilities = :capabilities WHERE id = :id',
                [':capabilities' => courierWebhookJson($capabilities), ':id' => (string) $capRow['id']]
            );
        }
    }

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

    // A pre-paid order must never let the courier's collected amount exceed the
    // remaining balance: automatic income is clamped to what is still due.
    $clampId = 'cwh-clamp-' . $stamp;
    $clampNumber = 'CWH-CLAMP-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $clampId, $clampNumber, 'Picked', $customerId, [
        'carrybee' => 'CB-CLAMP-' . $stamp,
        'total' => 1500,
        'paidAmount' => 700,
    ]);
    $courier->handleWebhook('carrybee', courierWebhookJson([
        'event' => 'order.delivered',
        'consignment_id' => 'CB-CLAMP-' . $stamp,
        'merchant_order_id' => $clampNumber,
        'timestamptz' => '2026-08-04T16:00:00+00:00',
        'collected_amount' => 2000,
    ]), $carryHeaders);
    $clampPayment = courierWebhookPayment($database, $clampId);
    courierWebhookAssert(
        $clampPayment !== null && abs((float) $clampPayment['amount'] - 800.00) < 0.001,
        'Automatic courier income was not clamped to the remaining order balance.'
    );
    $clampPaid = $database->fetchOne('SELECT paid_amount FROM orders WHERE id = :id', [':id' => $clampId]);
    courierWebhookAssert(abs((float) ($clampPaid['paid_amount'] ?? 0) - 1500.00) < 0.001, 'Clamped payment left the order balance wrong.');
    $clampPaymentCount = (int) (($database->fetchOne(
        "SELECT COUNT(*) AS total FROM transactions WHERE reference_id = :order_id AND type = 'Income' AND description LIKE 'Automatic courier delivery payment%'",
        [':order_id' => $clampId]
    ) ?? [])['total'] ?? 0);
    courierWebhookAssert($clampPaymentCount === 1, 'Clamped webhook payment duplicated the income transaction.');

    // A fully paid order records no additional automatic income at all.
    $fullyPaidId = 'cwh-fully-paid-' . $stamp;
    $fullyPaidNumber = 'CWH-FULLY-PAID-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $fullyPaidId, $fullyPaidNumber, 'Picked', $customerId, [
        'carrybee' => 'CB-FULLY-PAID-' . $stamp,
        'total' => 900,
        'paidAmount' => 900,
    ]);
    $courier->handleWebhook('carrybee', courierWebhookJson([
        'event' => 'order.delivered',
        'consignment_id' => 'CB-FULLY-PAID-' . $stamp,
        'merchant_order_id' => $fullyPaidNumber,
        'timestamptz' => '2026-08-04T16:30:00+00:00',
        'collected_amount' => 900,
    ]), $carryHeaders);
    courierWebhookAssert(
        courierWebhookPayment($database, $fullyPaidId) === null,
        'Automatic courier income was recorded for an already fully paid order.'
    );

    // Partial deliveries: the webhook fee is auto-expensed once, and confirming
    // the partial delivery must not book a duplicate shipping fee.
    $partialId = 'cwh-partial-' . $stamp;
    $partialNumber = 'CWH-PARTIAL-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $partialId, $partialNumber, 'Picked', $customerId, [
        'steadfast' => 'SF-PARTIAL-' . $stamp,
        'total' => 1000,
    ]);
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'delivery_status',
        'consignment_id' => 'SF-PARTIAL-' . $stamp,
        'invoice' => $partialNumber,
        'status' => 'partial_delivered',
        'cod_amount' => 500,
        'delivery_charge' => 12.5,
        'updated_at' => '2026-08-04 17:00:00',
    ]), $steadfastHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $partialId) === 'pending_partial', 'Steadfast partial did not map to pending_partial.');
    $partialAutoExpense = courierWebhookExpense($database, $partialId);
    courierWebhookAssert($partialAutoExpense !== null && abs((float) $partialAutoExpense['amount'] - 12.50) < 0.001, 'Partial webhook fee was not expensed automatically.');
    $operations->confirmPartialDelivery(['orderId' => $partialId, 'returnedItems' => []]);
    $partialShippingConfirmTx = $database->fetchOne(
        "SELECT * FROM transactions
         WHERE reference_id = :order_id AND type = 'Expense' AND category = 'Courier Shipping Cost' AND deleted_at IS NULL
         ORDER BY created_at ASC, id ASC LIMIT 1",
        [':order_id' => $partialId]
    );
    courierWebhookAssert($partialShippingConfirmTx === null, 'Partial confirmation duplicated the already-recorded shipping expense.');
    $partialExpenseCount = (int) (($database->fetchOne(
        "SELECT COUNT(*) AS total FROM transactions WHERE reference_id = :order_id AND type = 'Expense' AND deleted_at IS NULL",
        [':order_id' => $partialId]
    ) ?? [])['total'] ?? 0);
    courierWebhookAssert($partialExpenseCount === 1, 'Partial confirmation created more than one expense transaction.');

    // With the automatic shipping toggle off, the deferred shipping fee is
    // still booked at confirmation time (no webhook fee expense existed).
    $database->execute('UPDATE courier_settings SET automatically_deduct_shipping_costs = 0');
    $partialOffId = 'cwh-partial-off-' . $stamp;
    $partialOffNumber = 'CWH-PARTIAL-OFF-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $partialOffId, $partialOffNumber, 'Picked', $customerId, [
        'steadfast' => 'SF-PARTIAL-OFF-' . $stamp,
        'total' => 800,
    ]);
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'delivery_status',
        'consignment_id' => 'SF-PARTIAL-OFF-' . $stamp,
        'invoice' => $partialOffNumber,
        'status' => 'partial_delivered',
        'cod_amount' => 300,
        'delivery_charge' => 9.5,
        'updated_at' => '2026-08-04 17:30:00',
    ]), $steadfastHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $partialOffId) === 'pending_partial', 'Toggle-off partial did not map to pending_partial.');
    courierWebhookAssert(courierWebhookExpense($database, $partialOffId) === null, 'Toggle-off partial webhook created an automatic expense.');
    $operations->confirmPartialDelivery(['orderId' => $partialOffId, 'returnedItems' => []]);
    $partialOffShippingTx = $database->fetchOne(
        "SELECT * FROM transactions
         WHERE reference_id = :order_id AND type = 'Expense' AND category = 'Courier Shipping Cost' AND deleted_at IS NULL
         ORDER BY created_at ASC, id ASC LIMIT 1",
        [':order_id' => $partialOffId]
    );
    courierWebhookAssert(
        $partialOffShippingTx !== null && abs((float) $partialOffShippingTx['amount'] - 9.50) < 0.001,
        'Toggle-off partial confirmation lost the deferred shipping expense.'
    );
    $database->execute('UPDATE courier_settings SET automatically_deduct_shipping_costs = 1');

    // With both automation flags on, a delivered webhook must stage the order
    // into pending_delivered (deferred accounting) instead of booking income
    // and expense immediately. A follow-up delivered webhook confirms and
    // posts the transactions.
    $database->execute('UPDATE courier_settings SET automatically_record_sales_income = 1, automatically_mark_paid_after_delivery = 1');
    $pendingDeliveredId = 'cwh-pending-delivered-' . $stamp;
    $pendingDeliveredNumber = 'CWH-PENDING-DELIVERED-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $pendingDeliveredId, $pendingDeliveredNumber, 'Picked', $customerId, [
        'steadfast' => 'SF-PENDING-DELIVERED-' . $stamp,
        'total' => 1500,
    ]);
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'delivery_status',
        'consignment_id' => 'SF-PENDING-DELIVERED-' . $stamp,
        'invoice' => $pendingDeliveredNumber,
        'status' => 'delivered',
        'cod_amount' => 1500,
        'delivery_charge' => 14.0,
        'updated_at' => '2026-08-04 19:00:00',
    ]), $steadfastHeaders);
    courierWebhookAssert(
        courierWebhookOrderStatus($database, $pendingDeliveredId) === 'pending_delivered',
        'Delivered webhook with both automation flags on did not stage into pending_delivered.'
    );
    $pendingActionRow = $database->fetchOne(
        'SELECT delivery_action_required, partial_delivered_at FROM orders WHERE id = :id',
        [':id' => $pendingDeliveredId]
    );
    courierWebhookAssert(
        (int) ($pendingActionRow['delivery_action_required'] ?? 0) === 1,
        'Delivered webhook with both automation flags on did not set delivery_action_required=1.'
    );
    courierWebhookAssert(
        !empty($pendingActionRow['partial_delivered_at']),
        'Delivered webhook with both automation flags on did not stamp partial_delivered_at.'
    );
    courierWebhookAssert(
        courierWebhookExpense($database, $pendingDeliveredId) === null,
        'Delivered webhook with both automation flags on booked an immediate shipping expense instead of deferring.'
    );
    courierWebhookAssert(
        courierWebhookPayment($database, $pendingDeliveredId) === null,
        'Delivered webhook with both automation flags on booked an immediate COD income instead of deferring.'
    );

    // The follow-up delivered webhook confirms the pending order and posts
    // the deferred income + expense.
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'delivery_status',
        'consignment_id' => 'SF-PENDING-DELIVERED-' . $stamp,
        'invoice' => $pendingDeliveredNumber,
        'status' => 'delivered',
        'cod_amount' => 1500,
        'delivery_charge' => 14.0,
        'updated_at' => '2026-08-04 19:30:00',
    ]), $steadfastHeaders);
    courierWebhookAssert(
        courierWebhookOrderStatus($database, $pendingDeliveredId) === 'Completed',
        'Follow-up delivered webhook did not advance pending_delivered to Completed.'
    );
    $confirmedActionRow = $database->fetchOne(
        'SELECT delivery_action_required FROM orders WHERE id = :id',
        [':id' => $pendingDeliveredId]
    );
    courierWebhookAssert(
        (int) ($confirmedActionRow['delivery_action_required'] ?? 1) === 0,
        'Follow-up delivered webhook did not clear delivery_action_required.'
    );
    $confirmedExpense = courierWebhookExpense($database, $pendingDeliveredId);
    courierWebhookAssert(
        $confirmedExpense !== null && abs((float) $confirmedExpense['amount'] - 14.00) < 0.001,
        'Follow-up delivered webhook did not book the deferred shipping expense.'
    );
    $confirmedPayment = courierWebhookPayment($database, $pendingDeliveredId);
    courierWebhookAssert(
        $confirmedPayment !== null && abs((float) $confirmedPayment['amount'] - 1500.00) < 0.001,
        'Follow-up delivered webhook did not book the deferred COD income.'
    );

    // With the income-automation flag off, the delivered webhook must jump
    // straight to Completed and post the shipping expense + COD income
    // immediately (the webhook already carries both values).
    $database->execute('UPDATE courier_settings SET automatically_record_sales_income = 0');
    $autoIncomeId = 'cwh-auto-income-' . $stamp;
    $autoIncomeNumber = 'CWH-AUTO-INCOME-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $autoIncomeId, $autoIncomeNumber, 'Picked', $customerId, [
        'steadfast' => 'SF-AUTO-INCOME-' . $stamp,
        'total' => 850,
    ]);
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'delivery_status',
        'consignment_id' => 'SF-AUTO-INCOME-' . $stamp,
        'invoice' => $autoIncomeNumber,
        'status' => 'delivered',
        'cod_amount' => 850,
        'delivery_charge' => 11.0,
        'updated_at' => '2026-08-04 20:00:00',
    ]), $steadfastHeaders);
    courierWebhookAssert(
        courierWebhookOrderStatus($database, $autoIncomeId) === 'Completed',
        'Delivered webhook with income-automation off did not jump straight to Completed.'
    );
    courierWebhookAssert(
        courierWebhookExpense($database, $autoIncomeId) !== null,
        'Delivered webhook with income-automation off did not book an immediate shipping expense.'
    );
    courierWebhookAssert(
        courierWebhookPayment($database, $autoIncomeId) !== null,
        'Delivered webhook with income-automation off did not book an immediate COD income.'
    );
    $database->execute('UPDATE courier_settings SET automatically_record_sales_income = 1, automatically_mark_paid_after_delivery = 1');

    // Exchange deliveries book no automatic income; the money is settled
    // through the manual exchange flow.
    $exchangeIncomeId = 'cwh-exchange-income-' . $stamp;
    $exchangeIncomeNumber = 'CWH-EXCHANGE-INCOME-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $exchangeIncomeId, $exchangeIncomeNumber, 'Exchange processing', $customerId, [
        'paperfly' => 'PF-EXCHANGE-INCOME-MAIN-' . $stamp,
        'exchangePaperfly' => 'PF-EXCHANGE-INCOME-' . $stamp,
    ]);
    $courier->handleWebhook('paperfly', courierWebhookJson([
        'event' => 'parcel.exchange',
        'timestamp' => '2026-08-04T18:00:00+00:00',
        'data' => [
            'order_number' => 'PF-EXCHANGE-INCOME-' . $stamp,
            'merchant_order_reference' => $exchangeIncomeNumber,
            'order_status' => 'exchange',
            'collected_amount' => 250,
        ],
    ]), $paperflyHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $exchangeIncomeId) === 'Exchange delivered', 'Exchange-income test did not reach Exchange delivered.');
    courierWebhookAssert(
        courierWebhookPayment($database, $exchangeIncomeId) === null,
        'Exchange delivery webhook booked automatic income despite the manual exchange settlement flow.'
    );

    // Polling syncs now book the same money webhooks do: the polled fee is
    // upserted into the shared charge row and income uses its collected amount.
    $courierReflection = new ReflectionClass($courier);
    $syncChargeDetails = $courierReflection->getMethod('syncChargeDetails');
    $syncChargeDetails->setAccessible(true);
    $attachSyncedCharge = $courierReflection->getMethod('attachSyncedCharge');
    $attachSyncedCharge->setAccessible(true);
    $updateOrderAsCourierSystem = $courierReflection->getMethod('updateOrderAsCourierSystem');
    $updateOrderAsCourierSystem->setAccessible(true);

    $syncedDetails = $syncChargeDetails->invoke(
        $courier,
        'steadfast',
        ['status' => 'delivered', 'cod_amount' => 920.5, 'delivery_charge' => 13.5],
        'SF-SYNC-' . $stamp,
        ''
    );
    courierWebhookAssert(abs((float) ($syncedDetails['totalCharge'] ?? 0) - 13.50) < 0.001, 'Sync poll did not extract the delivery fee.');
    courierWebhookAssert(abs((float) ($syncedDetails['collectedAmount'] ?? 0) - 920.50) < 0.001, 'Sync poll did not extract the Steadfast cod amount.');
    courierWebhookAssert(abs((float) ($syncedDetails['codFee'] ?? 0)) === 0.0, 'Sync poll misread a non-fee field as the COD fee.');

    $syncOrderId = 'cwh-sync-' . $stamp;
    $syncOrderNumber = 'CWH-SYNC-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $syncOrderId, $syncOrderNumber, 'Picked', $customerId, [
        'steadfast' => 'SF-SYNC-' . $stamp,
        'total' => 920.5,
    ]);
    $syncUpdates = [];
    $attachSyncedCharge->invokeArgs($courier, [
        &$syncUpdates,
        'steadfast',
        ['status' => 'delivered', 'cod_amount' => 920.5, 'delivery_charge' => 13.5],
        'SF-SYNC-' . $stamp,
        '',
        $syncOrderId,
    ]);
    courierWebhookAssert(
        !empty($syncUpdates['courierAutomaticExpense']['chargeId']),
        'Sync polling did not attach the provider charge to the order updates.'
    );
    $syncUpdates['status'] = 'Completed';
    $syncUpdates['history'] = ['completed' => 'Marked delivered automatically from Steadfast delivery status "delivered" on ' . gmdate('c')];
    $updateOrderAsCourierSystem->invokeArgs($courier, [['id' => $syncOrderId, 'updates' => $syncUpdates]]);
    courierWebhookAssert(courierWebhookOrderStatus($database, $syncOrderId) === 'Completed', 'Simulated sync status change was not applied.');
    $syncExpense = courierWebhookExpense($database, $syncOrderId);
    courierWebhookAssert($syncExpense !== null && abs((float) $syncExpense['amount'] - 13.50) < 0.001, 'Sync-completed order did not book the polled shipping fee.');
    $syncPayment = courierWebhookPayment($database, $syncOrderId);
    courierWebhookAssert($syncPayment !== null && abs((float) $syncPayment['amount'] - 920.50) < 0.001, 'Sync-completed order did not book income from the polled collected amount.');
    $syncChargeCount = (int) (($database->fetchOne(
        'SELECT COUNT(*) AS total FROM courier_order_charges WHERE provider = :provider AND consignment_id = :consignment',
        [':provider' => 'steadfast', ':consignment' => 'SF-SYNC-' . $stamp]
    ) ?? [])['total'] ?? 0);
    courierWebhookAssert($syncChargeCount === 1, 'Sync polling duplicated the provider charge row.');

    // Steadfast return values are cancellations: whatever fee and collected
    // amount the webhook carries, only the shipping fee is expensed and no
    // income is ever booked.
    $sfReturnId = 'cwh-sf-return-money-' . $stamp;
    $sfReturnNumber = 'CWH-SF-RETURN-MONEY-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $sfReturnId, $sfReturnNumber, 'Picked', $customerId, [
        'steadfast' => 'SF-RETURN-MONEY-' . $stamp,
        'total' => 1200,
    ]);
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'delivery_status',
        'consignment_id' => 'SF-RETURN-MONEY-' . $stamp,
        'invoice' => $sfReturnNumber,
        'status' => 'return',
        'cod_amount' => 0,
        'delivery_charge' => 12.5,
        'updated_at' => '2026-08-05 09:00:00',
    ]), $steadfastHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $sfReturnId) === 'Cancelled', 'Steadfast return did not map to Cancelled.');
    $sfReturnExpense = courierWebhookExpense($database, $sfReturnId);
    courierWebhookAssert(
        $sfReturnExpense !== null && abs((float) $sfReturnExpense['amount'] - 12.50) < 0.001,
        'Steadfast return webhook shipping fee was not expensed.'
    );
    courierWebhookAssert(
        courierWebhookPayment($database, $sfReturnId) === null,
        'Steadfast return with no collected amount created automatic income.'
    );
    $sfReturnPaid = $database->fetchOne('SELECT paid_amount FROM orders WHERE id = :id', [':id' => $sfReturnId]);
    courierWebhookAssert((float) ($sfReturnPaid['paid_amount'] ?? -1) === 0.0, 'Steadfast return webhook marked the order partially paid.');

    // CarryBee paid return: the courier collected money at the door, but a
    // returned parcel never generates income — only the shipping fee is expensed.
    $cbPaidReturnId = 'cwh-cb-paid-return-' . $stamp;
    $cbPaidReturnNumber = 'CWH-CB-PAID-RETURN-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $cbPaidReturnId, $cbPaidReturnNumber, 'Picked', $customerId, [
        'carrybee' => 'CB-PAID-RETURN-' . $stamp,
        'total' => 1200,
    ]);
    $courier->handleWebhook('carrybee', courierWebhookJson([
        'event' => 'order.paid_return',
        'consignment_id' => 'CB-PAID-RETURN-' . $stamp,
        'merchant_order_id' => $cbPaidReturnNumber,
        'timestamptz' => '2026-08-05T09:30:00+00:00',
        'collected_amount' => 500,
        'delivery_fee' => 10,
    ]), $carryHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $cbPaidReturnId) === 'Returned', 'CarryBee paid-return did not map to Returned.');
    $cbPaidReturnExpense = courierWebhookExpense($database, $cbPaidReturnId);
    courierWebhookAssert(
        $cbPaidReturnExpense !== null && abs((float) $cbPaidReturnExpense['amount'] - 10.00) < 0.001,
        'CarryBee paid-return webhook shipping fee was not expensed.'
    );
    $cbPaidReturnPayment = courierWebhookPayment($database, $cbPaidReturnId);
    courierWebhookAssert(
        $cbPaidReturnPayment === null,
        'CarryBee paid-return created automatic income for a returned parcel.'
    );
    $cbPaidReturnPaid = $database->fetchOne('SELECT paid_amount FROM orders WHERE id = :id', [':id' => $cbPaidReturnId]);
    courierWebhookAssert(abs((float) ($cbPaidReturnPaid['paid_amount'] ?? 0)) < 0.001, 'CarryBee paid-return incorrectly marked the order as paid.');

    // CarryBee plain return: fee expensed, nothing collected means no income.
    $cbReturnId = 'cwh-cb-return-money-' . $stamp;
    $cbReturnNumber = 'CWH-CB-RETURN-MONEY-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $cbReturnId, $cbReturnNumber, 'Picked', $customerId, [
        'carrybee' => 'CB-RETURN-MONEY-' . $stamp,
        'total' => 900,
    ]);
    $courier->handleWebhook('carrybee', courierWebhookJson([
        'event' => 'order.returned',
        'consignment_id' => 'CB-RETURN-MONEY-' . $stamp,
        'merchant_order_id' => $cbReturnNumber,
        'timestamptz' => '2026-08-05T10:00:00+00:00',
        'collected_amount' => 0,
        'delivery_fee' => 8,
    ]), $carryHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $cbReturnId) === 'Returned', 'CarryBee return did not map to Returned.');
    $cbReturnExpense = courierWebhookExpense($database, $cbReturnId);
    courierWebhookAssert(
        $cbReturnExpense !== null && abs((float) $cbReturnExpense['amount'] - 8.00) < 0.001,
        'CarryBee return webhook shipping fee was not expensed.'
    );
    courierWebhookAssert(courierWebhookPayment($database, $cbReturnId) === null, 'CarryBee return with no collected amount created income.');

    // Paperfly return: fee lives under data.delivery_fee.
    $pfReturnMoneyId = 'cwh-pf-return-money-' . $stamp;
    $pfReturnMoneyNumber = 'CWH-PF-RETURN-MONEY-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $pfReturnMoneyId, $pfReturnMoneyNumber, 'Picked', $customerId, [
        'paperfly' => 'PF-RETURN-MONEY-' . $stamp,
        'total' => 800,
    ]);
    $courier->handleWebhook('paperfly', courierWebhookJson([
        'event' => 'parcel.return',
        'timestamp' => '2026-08-05T10:30:00+00:00',
        'data' => [
            'order_number' => 'PF-RETURN-MONEY-' . $stamp,
            'merchant_order_reference' => $pfReturnMoneyNumber,
            'status' => 'return',
            'delivery_fee' => 7.25,
        ],
    ]), $paperflyHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $pfReturnMoneyId) === 'Returned', 'Paperfly return did not map to Returned.');
    $pfReturnExpense = courierWebhookExpense($database, $pfReturnMoneyId);
    courierWebhookAssert(
        $pfReturnExpense !== null && abs((float) $pfReturnExpense['amount'] - 7.25) < 0.001,
        'Paperfly return webhook shipping fee was not expensed.'
    );
    courierWebhookAssert(courierWebhookPayment($database, $pfReturnMoneyId) === null, 'Paperfly return with no collected amount created income.');

    // Pathao Return Delivered: fee arrives with the same event.
    $paReturnId = 'cwh-pa-return-money-' . $stamp;
    $paReturnNumber = 'CWH-PA-RETURN-MONEY-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $paReturnId, $paReturnNumber, 'Picked', $customerId, [
        'pathao' => 'PATHAO-RETURN-MONEY-' . $stamp,
        'total' => 1100,
    ]);
    $courier->handleWebhook('pathao', courierWebhookJson([
        'event' => 'order.updated',
        'data' => [
            'consignment_id' => 'PATHAO-RETURN-MONEY-' . $stamp,
            'merchant_order_id' => $paReturnNumber,
            'order_status_slug' => 'Return Delivered',
            'delivery_fee' => 5,
            'updated_at' => '2026-08-05 11:00:00',
        ],
    ]), $pathaoHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $paReturnId) === 'Returned', 'Pathao Return Delivered did not map to Returned.');
    $paReturnExpense = courierWebhookExpense($database, $paReturnId);
    courierWebhookAssert(
        $paReturnExpense !== null && abs((float) $paReturnExpense['amount'] - 5.00) < 0.001,
        'Pathao Return Delivered shipping fee was not expensed.'
    );
    courierWebhookAssert(courierWebhookPayment($database, $paReturnId) === null, 'Pathao Return Delivered without collected amount created income.');

    // A fee arriving after the return event (order already terminal) is still
    // expensed once; no income is ever added for an unpaid return.
    $latePaReturnId = 'cwh-pa-return-late-fee-' . $stamp;
    $latePaReturnNumber = 'CWH-PA-RETURN-LATE-FEE-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $latePaReturnId, $latePaReturnNumber, 'Picked', $customerId, [
        'pathao' => 'PATHAO-RETURN-LATE-FEE-' . $stamp,
        'total' => 600,
    ]);
    $courier->handleWebhook('pathao', courierWebhookJson([
        'event' => 'order.updated',
        'data' => [
            'consignment_id' => 'PATHAO-RETURN-LATE-FEE-' . $stamp,
            'merchant_order_id' => $latePaReturnNumber,
            'order_status_slug' => 'Return Delivered',
            'updated_at' => '2026-08-05 11:30:00',
        ],
    ]), $pathaoHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $latePaReturnId) === 'Returned', 'Late-fee Pathao return did not map to Returned.');
    courierWebhookAssert(courierWebhookExpense($database, $latePaReturnId) === null, 'Fee-less return webhook created an expense.');
    $courier->handleWebhook('pathao', courierWebhookJson([
        'event' => 'fee.updated',
        'data' => [
            'consignment_id' => 'PATHAO-RETURN-LATE-FEE-' . $stamp,
            'merchant_order_id' => $latePaReturnNumber,
            'delivery_fee' => 3.75,
            'updated_at' => '2026-08-05 12:00:00',
        ],
    ]), $pathaoHeaders);
    $latePaReturnExpense = courierWebhookExpense($database, $latePaReturnId);
    courierWebhookAssert(
        $latePaReturnExpense !== null && abs((float) $latePaReturnExpense['amount'] - 3.75) < 0.001,
        'Late return fee was not expensed after the order became terminal.'
    );
    courierWebhookAssert(courierWebhookPayment($database, $latePaReturnId) === null, 'Late return fee event created automatic income.');

    // Both toggles off: a return webhook carrying fee and collected amount
    // changes the status only and creates no transactions.
    $database->execute('UPDATE courier_settings SET automatically_deduct_shipping_costs = 0, automatically_mark_paid_after_delivery = 0');
    $offReturnId = 'cwh-return-off-' . $stamp;
    $offReturnNumber = 'CWH-RETURN-OFF-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $offReturnId, $offReturnNumber, 'Picked', $customerId, [
        'steadfast' => 'SF-RETURN-OFF-' . $stamp,
        'total' => 700,
    ]);
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'delivery_status',
        'consignment_id' => 'SF-RETURN-OFF-' . $stamp,
        'invoice' => $offReturnNumber,
        'status' => 'return',
        'cod_amount' => 700,
        'delivery_charge' => 20,
        'updated_at' => '2026-08-05 12:30:00',
    ]), $steadfastHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $offReturnId) === 'Cancelled', 'Toggle-off return did not map to Cancelled.');
    courierWebhookAssert(courierWebhookExpense($database, $offReturnId) === null, 'Toggle-off return webhook created an expense.');
    courierWebhookAssert(courierWebhookPayment($database, $offReturnId) === null, 'Toggle-off return webhook created automatic income.');
    $database->execute('UPDATE courier_settings SET automatically_deduct_shipping_costs = 1, automatically_mark_paid_after_delivery = 1');

    // Steadfast return_status notifications (no status field) only mean the
    // return flow has started: they never cancel the order. The order is
    // flagged action-required for the merchant to review instead, no fee is
    // expensed while the order is not terminal, and no income is ever booked.
    $returnStatusId = 'cwh-sf-return-status-' . $stamp;
    $returnStatusNumber = 'CWH-SF-RETURN-STATUS-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $returnStatusId, $returnStatusNumber, 'Picked', $customerId, [
        'steadfast' => 'SF-RS-' . $stamp,
        'total' => 1000,
    ]);
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'return_status',
        'consignment_id' => 'SF-RS-' . $stamp,
        'invoice' => $returnStatusNumber,
        'tracking_message' => 'Consignment Return status has been updated to Processing',
        'updated_at' => '2026-08-15 13:59:44',
    ]), $steadfastHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $returnStatusId) === 'Picked', 'Steadfast return_status cancelled the order.');
    $returnStatusActionRow = $database->fetchOne(
        'SELECT courier_return_action_required FROM orders WHERE id = :id',
        [':id' => $returnStatusId]
    );
    courierWebhookAssert(
        (int) ($returnStatusActionRow['courier_return_action_required'] ?? 0) === 1,
        'Steadfast return_status did not flag the order action-required.'
    );
    courierWebhookAssert(
        courierWebhookPayment($database, $returnStatusId) === null,
        'Steadfast return_status booked automatic courier income.'
    );
    courierWebhookAssert(
        courierWebhookExpense($database, $returnStatusId) === null,
        'Fee-less Steadfast return_status created a shipping expense.'
    );
    $returnStatusPaid = $database->fetchOne('SELECT paid_amount FROM orders WHERE id = :id', [':id' => $returnStatusId]);
    courierWebhookAssert((float) ($returnStatusPaid['paid_amount'] ?? -1) === 0.0, 'Steadfast return_status marked the order paid.');

    // A return_status that carries a shipping fee only stores the charge: the
    // order is not terminal, so nothing is expensed yet. Confirming the return
    // afterwards expenses the stored fee and clears the action-required flag.
    $returnStatusFeeId = 'cwh-sf-return-status-fee-' . $stamp;
    $returnStatusFeeNumber = 'CWH-SF-RETURN-STATUS-FEE-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $returnStatusFeeId, $returnStatusFeeNumber, 'Picked', $customerId, [
        'steadfast' => 'SF-RS-FEE-' . $stamp,
        'total' => 900,
    ]);
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'return_status',
        'consignment_id' => 'SF-RS-FEE-' . $stamp,
        'invoice' => $returnStatusFeeNumber,
        'cod_amount' => 700,
        'delivery_charge' => 11.25,
        'tracking_message' => 'Consignment Return status has been updated to Processing',
        'updated_at' => '2026-08-15 14:05:00',
    ]), $steadfastHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $returnStatusFeeId) === 'Picked', 'Fee-carrying Steadfast return_status changed the order status.');
    $returnStatusFeeCharge = $database->fetchOne(
        'SELECT total_charge, expense_status FROM courier_order_charges
         WHERE provider = :provider AND consignment_id = :consignment LIMIT 1',
        [':provider' => 'steadfast', ':consignment' => 'SF-RS-FEE-' . $stamp]
    );
    courierWebhookAssert(
        $returnStatusFeeCharge !== null && abs((float) ($returnStatusFeeCharge['total_charge'] ?? 0) - 11.25) < 0.001,
        'Fee-carrying Steadfast return_status did not store the shipping fee.'
    );
    courierWebhookAssert(
        (string) ($returnStatusFeeCharge['expense_status'] ?? '') === 'not_recorded',
        'Fee-carrying Steadfast return_status recorded the expense before the order became terminal.'
    );
    courierWebhookAssert(
        courierWebhookExpense($database, $returnStatusFeeId) === null,
        'Fee-carrying Steadfast return_status expensed the fee before the order became terminal.'
    );
    courierWebhookAssert(
        courierWebhookPayment($database, $returnStatusFeeId) === null,
        'Fee-carrying Steadfast return_status booked the COD amount as income.'
    );
    $operations->updateOrder(['id' => $returnStatusFeeId, 'updates' => ['status' => 'Returned']]);
    $returnStatusFeeExpense = courierWebhookExpense($database, $returnStatusFeeId);
    courierWebhookAssert(
        $returnStatusFeeExpense !== null && abs((float) $returnStatusFeeExpense['amount'] - 11.25) < 0.001,
        'Confirmed return did not expense the stored Steadfast shipping fee.'
    );
    $returnStatusFeeActionRow = $database->fetchOne(
        'SELECT courier_return_action_required FROM orders WHERE id = :id',
        [':id' => $returnStatusFeeId]
    );
    courierWebhookAssert(
        (int) ($returnStatusFeeActionRow['courier_return_action_required'] ?? 1) === 0,
        'Manual return confirmation did not clear the action-required flag.'
    );

    // Steadfast return_status never regresses an already-terminal status and
    // does not flag an already-resolved order.
    $returnStatusGuardId = 'cwh-sf-return-status-guard-' . $stamp;
    $returnStatusGuardNumber = 'CWH-SF-RETURN-STATUS-GUARD-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $returnStatusGuardId, $returnStatusGuardNumber, 'Returned', $customerId, [
        'steadfast' => 'SF-RS-GUARD-' . $stamp,
        'history' => ['returned' => 'Marked returned automatically from Steadfast delivery status "returned" on 2026-08-15.'],
    ]);
    $courier->handleWebhook('steadfast', courierWebhookJson([
        'notification_type' => 'return_status',
        'consignment_id' => 'SF-RS-GUARD-' . $stamp,
        'invoice' => $returnStatusGuardNumber,
        'tracking_message' => 'Consignment Return status has been updated to Processing',
        'updated_at' => '2026-08-15 14:30:00',
    ]), $steadfastHeaders);
    courierWebhookAssert(courierWebhookOrderStatus($database, $returnStatusGuardId) === 'Returned', 'Steadfast return_status regressed an already-terminal order.');
    $returnStatusGuardActionRow = $database->fetchOne(
        'SELECT courier_return_action_required FROM orders WHERE id = :id',
        [':id' => $returnStatusGuardId]
    );
    courierWebhookAssert(
        (int) ($returnStatusGuardActionRow['courier_return_action_required'] ?? 0) === 0,
        'Steadfast return_status flagged an already-terminal order.'
    );
    courierWebhookAssert(
        courierWebhookExpense($database, $returnStatusGuardId) === null,
        'Return_status on an already-terminal order created a shipping expense.'
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

    // Webhook event saving toggle plus Developer-only paging and detail.
    $developerActor = $database->fetchOne(
        "SELECT id, name, phone, role FROM users WHERE role = 'Developer' AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1"
    );
    if ($developerActor === null) {
        throw new RuntimeException('Local Developer test actor is unavailable.');
    }
    $adminActor = $database->fetchOne(
        "SELECT id FROM users WHERE role = 'Admin' AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1"
    );
    $toggleOff = $courier->setWebhookSavingEnabled(['enabled' => false]);
    courierWebhookAssert(($toggleOff['savingEnabled'] ?? true) === false, 'Webhook saving toggle did not turn off.');
    courierWebhookAssert(
        (int) (($database->fetchOne('SELECT save_webhook_events FROM courier_settings LIMIT 1') ?? [])['save_webhook_events'] ?? 1) === 0,
        'save_webhook_events was not persisted as disabled.'
    );
    $saveOffId = 'cwh-save-off-' . $stamp;
    $saveOffNumber = 'CWH-SAVE-OFF-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $saveOffId, $saveOffNumber, 'Picked', $customerId, [
        'carrybee' => 'CB-SAVE-OFF-' . $stamp,
        'total' => 600,
    ]);
    $saveOffResult = $courier->handleWebhook('carrybee', courierWebhookJson([
        'event' => 'order.delivered',
        'consignment_id' => 'CB-SAVE-OFF-' . $stamp,
        'merchant_order_id' => $saveOffNumber,
        'timestamptz' => '2026-08-06T09:00:00+00:00',
        'collected_amount' => 600,
    ]), $carryHeaders);
    courierWebhookAssert(($saveOffResult['webhookEventSaved'] ?? true) === false, 'Toggle-off webhook reported that an event row was saved.');
    courierWebhookAssert(courierWebhookOrderStatus($database, $saveOffId) === 'Completed', 'Toggle-off webhook was not processed for the order status.');
    courierWebhookAssert(courierWebhookPayment($database, $saveOffId) !== null, 'Toggle-off webhook did not book the automatic payment.');
    $saveOffEventCount = (int) (($database->fetchOne(
        'SELECT COUNT(*) AS total FROM courier_webhook_events WHERE provider = :provider AND consignment_id = :consignment',
        [':provider' => 'carrybee', ':consignment' => 'CB-SAVE-OFF-' . $stamp]
    ) ?? [])['total'] ?? 0);
    courierWebhookAssert($saveOffEventCount === 0, 'Toggle-off webhook stored an event row.');

    $toggleOn = $courier->setWebhookSavingEnabled(['enabled' => true]);
    courierWebhookAssert(($toggleOn['savingEnabled'] ?? false) === true, 'Webhook saving toggle did not turn on.');
    $saveOnId = 'cwh-save-on-' . $stamp;
    $saveOnNumber = 'CWH-SAVE-ON-' . $stamp;
    createCourierWebhookOrder($database, $actor, $nextSequence, $saveOnId, $saveOnNumber, 'Picked', $customerId, [
        'carrybee' => 'CB-SAVE-ON-' . $stamp,
        'total' => 500,
    ]);
    $saveOnResult = $courier->handleWebhook('carrybee', courierWebhookJson([
        'event' => 'order.returned',
        'consignment_id' => 'CB-SAVE-ON-' . $stamp,
        'merchant_order_id' => $saveOnNumber,
        'timestamptz' => '2026-08-06T09:30:00+00:00',
        'reason' => 'Buyer refused',
    ]), $carryHeaders);
    courierWebhookAssert(($saveOnResult['webhookEventSaved'] ?? false) === true, 'Toggle-on webhook did not report the stored event.');
    courierWebhookAssert(courierWebhookOrderStatus($database, $saveOnId) === 'Returned', 'Toggle-on webhook was not processed for the order status.');
    $saveOnEvent = $database->fetchOne(
        'SELECT * FROM courier_webhook_events WHERE provider = :provider AND consignment_id = :consignment LIMIT 1',
        [':provider' => 'carrybee', ':consignment' => 'CB-SAVE-ON-' . $stamp]
    );
    courierWebhookAssert($saveOnEvent !== null && ($saveOnEvent['processing_status'] ?? '') === 'processed', 'Toggle-on event was not stored as processed.');
    courierWebhookAssert((string) ($saveOnEvent['order_id'] ?? '') === $saveOnId, 'Stored toggle-on event is missing the matched order id.');
    $saveOnPayload = json_decode((string) ($saveOnEvent['payload'] ?? ''), true);
    courierWebhookAssert(is_array($saveOnPayload) && ($saveOnPayload['reason'] ?? '') === 'Buyer refused', 'Stored webhook payload does not match the raw JSON.');

    $pageResult = $courier->fetchWebhookEventsPage(['page' => 1, 'pageSize' => 5, 'filters' => ['search' => 'CB-SAVE-ON-' . $stamp]]);
    courierWebhookAssert(is_array($pageResult['data'] ?? null) && count($pageResult['data']) === 1, 'Webhook event page did not return the saved event.');
    courierWebhookAssert((string) ($pageResult['data'][0]['id'] ?? '') === (string) $saveOnEvent['id'], 'Webhook event page returned the wrong event row.');
    courierWebhookAssert((string) ($pageResult['data'][0]['orderNumber'] ?? '') === $saveOnNumber, 'Webhook event page lost the matched order number.');
    courierWebhookAssert(($pageResult['savingEnabled'] ?? false) === true, 'Webhook event page reported the wrong saving toggle.');
    courierWebhookAssert(count($pageResult['options']['eventNames'] ?? []) > 0, 'Webhook event page options are empty.');

    $detailResult = $courier->fetchWebhookEventDetail(['id' => (string) $saveOnEvent['id']]);
    $detailEvent = $detailResult['event'] ?? [];
    courierWebhookAssert((string) ($detailEvent['id'] ?? '') === (string) $saveOnEvent['id'], 'Webhook event detail returned the wrong event.');
    $detailPayload = $detailEvent['payload'] ?? null;
    courierWebhookAssert(is_array($detailPayload) && ($detailPayload['event'] ?? '') === 'order.returned', 'Webhook event detail payload was not decoded.');
    courierWebhookAssert((string) (($detailResult['order'] ?? [])['orderNumber'] ?? '') === $saveOnNumber, 'Webhook event detail lost the linked order.');
    courierWebhookAssert(is_array($detailResult['charges'] ?? null), 'Webhook event detail charges are missing.');
    try {
        $courier->fetchWebhookEventDetail(['id' => 'no-such-webhook-event']);
        throw new RuntimeException('Unknown webhook event id was not rejected.');
    } catch (RuntimeException $exception) {
        courierWebhookAssert(str_contains($exception->getMessage(), 'not found'), 'Unknown webhook event id failed for the wrong reason.');
    }

    if ($adminActor !== null && (string) ($adminActor['id'] ?? '') !== (string) $developerActor['id']) {
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($adminActor);
        try {
            $courier->fetchWebhookEventsPage([]);
            throw new RuntimeException('Non-developer was allowed to list courier webhook events.');
        } catch (ApiException $exception) {
            courierWebhookAssert($exception->httpStatus() === 403, 'Non-developer webhook listing was rejected with the wrong status.');
        }
        try {
            $courier->setWebhookSavingEnabled(['enabled' => true]);
            throw new RuntimeException('Non-developer was allowed to change webhook event saving.');
        } catch (ApiException $exception) {
            courierWebhookAssert($exception->httpStatus() === 403, 'Non-developer toggle change was rejected with the wrong status.');
        }
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($developerActor);
    }

    $startingBalance = 5000.00;
    $linkedExpenseTotal = (float) (($database->fetchOne(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
         WHERE account_id = :account_id AND type = 'Expense' AND deleted_at IS NULL AND account_effect_applied = 1",
        [':account_id' => $accountId]
    ) ?? [])['total'] ?? 0);
    $linkedIncomeTotal = (float) (($database->fetchOne(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
         WHERE account_id = :account_id AND type = 'Income' AND deleted_at IS NULL AND account_effect_applied = 1",
        [':account_id' => $accountId]
    ) ?? [])['total'] ?? 0);
    $endingBalance = (float) (($database->fetchOne(
        'SELECT current_balance FROM accounts WHERE id = :account_id',
        [':account_id' => $accountId]
    ) ?? [])['current_balance'] ?? 0);
    courierWebhookAssert(
        abs($endingBalance - ($startingBalance + $linkedIncomeTotal - $linkedExpenseTotal)) < 0.001,
        'Automatic courier payments and expenses did not affect the account exactly once.'
    );

    $realtimeProvider = (string) file_get_contents($root . '/src/contexts/RealtimeProvider.tsx');
    courierWebhookAssert(!str_contains($realtimeProvider, 'setInterval'), 'Browser courier polling interval still exists.');
    courierWebhookAssert(!str_contains($realtimeProvider, 'syncCarryBeeTransferStatuses'), 'Browser still calls courier status sync automatically.');
    $courierWorker = (string) file_get_contents($root . '/backend/bin/process_courier_statuses.php');
    $courierScheduler = (string) file_get_contents($root . '/backend/src/CourierStatusScheduler.php');
    courierWebhookAssert(str_contains($courierWorker, "['carrybee', 'paperfly', 'steadfast', 'pathao', 'exchange']"), 'Server fallback worker does not cover every courier status path.');
    courierWebhookAssert(str_contains($courierWorker, 'GET_LOCK'), 'Courier fallback worker does not prevent overlapping runs.');
    courierWebhookAssert(str_contains($courierScheduler, 'process_courier_statuses.php'), 'Courier fallback worker is not installed by the scheduler.');
    $orderDetails = (string) file_get_contents($root . '/pages/OrderDetails.tsx');
    $ordersPage = (string) file_get_contents($root . '/pages/Orders.tsx');
    courierWebhookAssert(str_contains($orderDetails, 'canAddCourierCompletionExpense'), 'Order Details does not expose the manual completion-expense gate.');
    courierWebhookAssert(str_contains($ordersPage, 'canAddCourierCompletionExpense'), 'Orders list does not expose the manual completion-expense gate.');
    courierWebhookAssert(!str_contains($orderDetails, '!(automaticCourierExpenseEnabled && courierAutomaticExpenseRecorded)'), 'Order Details still retains the legacy manual-expense hide check.');
    courierWebhookAssert(!str_contains($ordersPage, '!(automaticCourierExpenseEnabled && courierAutomaticExpenseRecorded)'), 'Orders list still retains the legacy manual-expense hide check.');

    echo "Courier webhook verification, mappings, idempotency, charges, expenses, account effects, and Undoer integration passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
