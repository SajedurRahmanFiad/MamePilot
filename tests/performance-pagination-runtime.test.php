<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\MasterDataApi;
use App\MessengerApi;
use App\MetaAdsApi;
use App\OperationsApi;
use App\WhatsAppApi;

function performancePaginationAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$config = Config::load($root);
$database = new Database($config);
$auth = new Auth($config, $database);
$masterData = new MasterDataApi($database, $auth, $config);
$operations = new OperationsApi($database, $auth, $config);
$whatsApp = new WhatsAppApi($database, $auth, $config);
$messenger = new MessengerApi($database, $auth, $config);
$metaAds = new MetaAdsApi($database, $auth, $config);
$pdo = $database->connect();

$actor = $database->fetchOne(
    "SELECT id, name, phone, role
     FROM users
     WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL
     ORDER BY CASE WHEN role = 'Admin' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1"
);
if ($actor === null) {
    throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
}
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);

// Messaging tables predate the fresh base schema and retain guarded runtime
// compatibility. Run those guards before the rollback-only fixture transaction
// so any one-time DDL cannot implicitly commit test data.
$whatsApp->fetchWhatsAppContacts(['page' => 1, 'pageSize' => 10, 'search' => '__performance_preflight__']);
$messenger->fetchMessengerContacts(['page' => 1, 'pageSize' => 10, 'search' => '__performance_preflight__']);

$stamp = strtolower(str_replace('.', '', uniqid('perf-page-', true)));
$futureBase = '2038-02-03 10:';
$now = $database->nowUtc();
$pdo->beginTransaction();
try {
    // Recycle Bin: true SQL count, filter, deterministic ordering, and pages.
    for ($index = 0; $index < 12; $index++) {
        $database->execute(
            'INSERT INTO customers (
                id, name, phone, address, total_orders, due_amount, created_by,
                created_at, updated_at, deleted_at, deleted_by
             ) VALUES (
                :id, :name, :phone, :address, 0, 0, :created_by,
                :created_at, :updated_at, :deleted_at, :deleted_by
             )',
            [
                ':id' => substr('deleted-customer-' . $index . '-' . $stamp, 0, 64),
                ':name' => 'Deleted Performance Customer ' . $stamp . ' ' . $index,
                ':phone' => 'deleted-' . $index . '-' . $stamp,
                ':address' => 'Recycle performance fixture',
                ':created_by' => $actor['id'],
                ':created_at' => '2038-02-01 00:00:00',
                ':updated_at' => '2038-02-01 00:00:00',
                ':deleted_at' => sprintf('2038-02-02 12:%02d:00', $index),
                ':deleted_by' => $actor['id'],
            ]
        );
    }
    $recyclePageOne = $operations->fetchRecycleBinPage([
        'page' => 1,
        'pageSize' => 5,
        'search' => $stamp,
        'entityType' => 'customer',
    ]);
    $recyclePageThree = $operations->fetchRecycleBinPage([
        'page' => 3,
        'pageSize' => 5,
        'search' => $stamp,
        'entityType' => 'customer',
    ]);
    performancePaginationAssert((int) ($recyclePageOne['count'] ?? 0) === 12, 'Recycle Bin count must be computed in SQL.');
    performancePaginationAssert(count($recyclePageOne['data'] ?? []) === 5, 'Recycle Bin first page size.');
    performancePaginationAssert(count($recyclePageThree['data'] ?? []) === 2, 'Recycle Bin final page size.');

    // WhatsApp and Messenger: visible contact pages plus incremental message
    // polling on the stable (updated_at, id) cursor.
    $waContactIds = [];
    $messengerContactIds = [];
    for ($index = 0; $index < 12; $index++) {
        $waId = substr('wa-contact-' . $index . '-' . $stamp, 0, 64);
        $waContactIds[] = $waId;
        $database->execute(
            'INSERT INTO whatsapp_contacts (
                id, wa_id, phone_number, name, profile_name, unread_count,
                last_message_preview, last_message_type, last_message_at, created_at, updated_at
             ) VALUES (
                :id, :wa_id, :phone, :name, :profile_name, :unread_count,
                :preview, :type, :last_message_at, :created_at, :updated_at
             )',
            [
                ':id' => $waId,
                ':wa_id' => '88017' . str_pad((string) $index, 6, '0', STR_PAD_LEFT) . substr(hash('sha1', $stamp), 0, 4),
                ':phone' => 'wa-' . $index . '-' . $stamp,
                ':name' => 'WA Performance ' . $stamp . ' ' . $index,
                ':profile_name' => 'WA Profile ' . $index,
                ':unread_count' => $index % 3,
                ':preview' => 'WA preview ' . $stamp,
                ':type' => 'text',
                ':last_message_at' => sprintf($futureBase . '%02d:00', $index),
                ':created_at' => '2038-02-03 09:00:00',
                ':updated_at' => sprintf($futureBase . '%02d:00', $index),
            ]
        );

        $messengerId = substr('messenger-contact-' . $index . '-' . $stamp, 0, 64);
        $messengerContactIds[] = $messengerId;
        $database->execute(
            'INSERT INTO messenger_contacts (
                id, psid, name, first_name, last_name, unread_count,
                last_message_preview, last_message_type, last_message_at,
                last_user_message_at, created_at, updated_at
             ) VALUES (
                :id, :psid, :name, :first_name, :last_name, :unread_count,
                :preview, :type, :last_message_at,
                :last_user_message_at, :created_at, :updated_at
             )',
            [
                ':id' => $messengerId,
                ':psid' => 'psid-' . $index . '-' . $stamp,
                ':name' => 'Messenger Performance ' . $stamp . ' ' . $index,
                ':first_name' => 'Performance',
                ':last_name' => (string) $index,
                ':unread_count' => $index % 2,
                ':preview' => 'Messenger preview ' . $stamp,
                ':type' => 'text',
                ':last_message_at' => sprintf($futureBase . '%02d:00', $index),
                ':last_user_message_at' => sprintf($futureBase . '%02d:00', $index),
                ':created_at' => '2038-02-03 09:00:00',
                ':updated_at' => sprintf($futureBase . '%02d:00', $index),
            ]
        );
    }

    $waPageOne = $whatsApp->fetchWhatsAppContacts(['page' => 1, 'pageSize' => 10, 'search' => $stamp]);
    $waPageTwo = $whatsApp->fetchWhatsAppContacts(['page' => 2, 'pageSize' => 10, 'search' => $stamp]);
    performancePaginationAssert((int) ($waPageOne['count'] ?? 0) === 12, 'WhatsApp contact count.');
    performancePaginationAssert(count($waPageOne['data'] ?? []) === 10 && count($waPageTwo['data'] ?? []) === 2, 'WhatsApp contact pages.');

    $messengerPageOne = $messenger->fetchMessengerContacts(['page' => 1, 'pageSize' => 10, 'search' => $stamp]);
    $messengerPageTwo = $messenger->fetchMessengerContacts(['page' => 2, 'pageSize' => 10, 'search' => $stamp]);
    performancePaginationAssert((int) ($messengerPageOne['count'] ?? 0) === 12, 'Messenger contact count.');
    performancePaginationAssert(count($messengerPageOne['data'] ?? []) === 10 && count($messengerPageTwo['data'] ?? []) === 2, 'Messenger contact pages.');

    for ($index = 0; $index < 3; $index++) {
        $messageAt = sprintf('2038-02-03 11:%02d:00', $index);
        $database->execute(
            'INSERT INTO whatsapp_messages (
                id, contact_id, wa_message_id, direction, message_type,
                message_text, status, message_at, created_by, created_at, updated_at
             ) VALUES (
                :id, :contact_id, :external_id, :direction, :type,
                :text, :status, :message_at, :created_by, :created_at, :updated_at
             )',
            [
                ':id' => substr('wa-message-' . $index . '-' . $stamp, 0, 64),
                ':contact_id' => $waContactIds[0],
                ':external_id' => 'wamid-' . $index . '-' . $stamp,
                ':direction' => 'inbound',
                ':type' => 'text',
                ':text' => 'WA initial ' . $index,
                ':status' => 'received',
                ':message_at' => $messageAt,
                ':created_by' => $actor['id'],
                ':created_at' => $messageAt,
                ':updated_at' => $messageAt,
            ]
        );
        $database->execute(
            'INSERT INTO messenger_messages (
                id, contact_id, mid, direction, message_type,
                message_text, status, message_at, created_by, created_at, updated_at
             ) VALUES (
                :id, :contact_id, :external_id, :direction, :type,
                :text, :status, :message_at, :created_by, :created_at, :updated_at
             )',
            [
                ':id' => substr('messenger-message-' . $index . '-' . $stamp, 0, 64),
                ':contact_id' => $messengerContactIds[0],
                ':external_id' => 'mid-' . $index . '-' . $stamp,
                ':direction' => 'inbound',
                ':type' => 'text',
                ':text' => 'Messenger initial ' . $index,
                ':status' => 'received',
                ':message_at' => $messageAt,
                ':created_by' => $actor['id'],
                ':created_at' => $messageAt,
                ':updated_at' => $messageAt,
            ]
        );
    }
    $waInitial = $whatsApp->fetchWhatsAppMessages(['contactId' => $waContactIds[0], 'limit' => 20]);
    $messengerInitial = $messenger->fetchMessengerMessages(['contactId' => $messengerContactIds[0], 'limit' => 20]);
    performancePaginationAssert(empty($waInitial['incremental']) && count($waInitial['data'] ?? []) === 3, 'WhatsApp initial message window.');
    performancePaginationAssert(empty($messengerInitial['incremental']) && count($messengerInitial['data'] ?? []) === 3, 'Messenger initial message window.');

    $deltaAt = '2038-02-03 11:03:00';
    $database->execute(
        'INSERT INTO whatsapp_messages (
            id, contact_id, wa_message_id, direction, message_type,
            message_text, status, message_at, created_by, created_at, updated_at
         ) VALUES (:id, :contact, :external_id, \'inbound\', \'text\', :text, \'received\', :message_at, :created_by, :created_at, :updated_at)',
        [
            ':id' => substr('wa-message-delta-' . $stamp, 0, 64),
            ':contact' => $waContactIds[0],
            ':external_id' => 'wamid-delta-' . $stamp,
            ':text' => 'WA delta',
            ':message_at' => $deltaAt,
            ':created_at' => $deltaAt,
            ':updated_at' => $deltaAt,
            ':created_by' => $actor['id'],
        ]
    );
    $database->execute(
        'INSERT INTO messenger_messages (
            id, contact_id, mid, direction, message_type,
            message_text, status, message_at, created_by, created_at, updated_at
         ) VALUES (:id, :contact, :external_id, \'inbound\', \'text\', :text, \'received\', :message_at, :created_by, :created_at, :updated_at)',
        [
            ':id' => substr('messenger-message-delta-' . $stamp, 0, 64),
            ':contact' => $messengerContactIds[0],
            ':external_id' => 'mid-delta-' . $stamp,
            ':text' => 'Messenger delta',
            ':message_at' => $deltaAt,
            ':created_at' => $deltaAt,
            ':updated_at' => $deltaAt,
            ':created_by' => $actor['id'],
        ]
    );
    $waDelta = $whatsApp->fetchWhatsAppMessages([
        'contactId' => $waContactIds[0],
        'limit' => 20,
        'updatedAfter' => $waInitial['cursor']['updatedAt'] ?? '',
        'updatedAfterId' => $waInitial['cursor']['id'] ?? '',
    ]);
    $messengerDelta = $messenger->fetchMessengerMessages([
        'contactId' => $messengerContactIds[0],
        'limit' => 20,
        'updatedAfter' => $messengerInitial['cursor']['updatedAt'] ?? '',
        'updatedAfterId' => $messengerInitial['cursor']['id'] ?? '',
    ]);
    performancePaginationAssert(!empty($waDelta['incremental']) && count($waDelta['data'] ?? []) === 1, 'WhatsApp cursor delta.');
    performancePaginationAssert(!empty($messengerDelta['incremental']) && count($messengerDelta['data'] ?? []) === 1, 'Messenger cursor delta.');
    performancePaginationAssert(!empty($waDelta['data'][0]['updatedAt']), 'WhatsApp DTO updatedAt.');
    performancePaginationAssert(!empty($messengerDelta['data'][0]['updatedAt']), 'Messenger DTO updatedAt.');

    // Meta Ads: page/count, raw-search forwarding, and the lightweight source
    // ad selector used by order forms/details.
    $connectionId = substr('meta-connection-' . $stamp, 0, 64);
    $adAccountId = substr('meta-account-' . $stamp, 0, 64);
    $database->execute(
        'INSERT INTO meta_ads_connections (
            id, user_id, meta_user_id, access_token, is_active, created_at, updated_at
         ) VALUES (:id, :user_id, :meta_user_id, :token, 1, :created_at, :updated_at)',
        [
            ':id' => $connectionId,
            ':user_id' => $actor['id'],
            ':meta_user_id' => 'meta-user-' . $stamp,
            ':token' => 'transaction-only-test-token',
            ':created_at' => $now,
            ':updated_at' => $now,
        ]
    );
    $database->execute(
        'INSERT INTO meta_ad_accounts (
            id, connection_id, meta_ad_account_id, account_id, name, currency, created_at, updated_at
         ) VALUES (:id, :connection_id, :meta_id, :account_id, :name, :currency, :created_at, :updated_at)',
        [
            ':id' => $adAccountId,
            ':connection_id' => $connectionId,
            ':meta_id' => 'act-meta-' . $stamp,
            ':account_id' => 'act-' . $stamp,
            ':name' => 'Meta Account ' . $stamp,
            ':currency' => 'BDT',
            ':created_at' => $now,
            ':updated_at' => $now,
        ]
    );
    $metaAdIds = [];
    for ($index = 0; $index < 3; $index++) {
        $metaAdId = substr('meta-ad-' . $index . '-' . $stamp, 0, 64);
        $metaAdIds[] = $metaAdId;
        $database->execute(
            'INSERT INTO meta_ads (
                id, ad_account_id, meta_ad_id, name, status, effective_status,
                primary_text, spend, reach, impressions, clicks,
                created_time, updated_time, last_synced_at, created_at, updated_at
             ) VALUES (
                :id, :ad_account_id, :meta_ad_id, :name, :status, :effective_status,
                :primary_text, :spend, :reach, :impressions, :clicks,
                :created_time, :updated_time, :last_synced_at, :created_at, :updated_at
             )',
            [
                ':id' => $metaAdId,
                ':ad_account_id' => $adAccountId,
                ':meta_ad_id' => 'external-ad-' . $index . '-' . $stamp,
                ':name' => 'Performance Meta Ad ' . $stamp . ' ' . $index,
                ':status' => 'ACTIVE',
                ':effective_status' => 'ACTIVE',
                ':primary_text' => 'Raw searchable ' . $stamp,
                ':spend' => 10 + $index,
                ':reach' => 100 + $index,
                ':impressions' => 200 + $index,
                ':clicks' => 20 + $index,
                ':created_time' => sprintf('2038-02-03 12:0%d:00', $index),
                ':updated_time' => sprintf('2038-02-03 12:0%d:00', $index),
                ':last_synced_at' => $now,
                ':created_at' => $now,
                ':updated_at' => $now,
            ]
        );
    }
    $metaPageOne = $metaAds->fetchMetaAds([
        'page' => 1,
        'pageSize' => 2,
        'rawSearch' => $stamp,
        'skipAutoSync' => true,
        'skipSchemaEnsure' => true,
    ]);
    $metaPageTwo = $metaAds->fetchMetaAds([
        'page' => 2,
        'pageSize' => 2,
        'rawSearch' => $stamp,
        'skipAutoSync' => true,
        'skipSchemaEnsure' => true,
    ]);
    performancePaginationAssert((int) ($metaPageOne['count'] ?? 0) === 3, 'Meta Ads raw-search count.');
    performancePaginationAssert(count($metaPageOne['ads'] ?? []) === 2 && count($metaPageTwo['ads'] ?? []) === 1, 'Meta Ads pages.');
    $metaOptions = $metaAds->fetchMetaAdOptions(['search' => $stamp, 'activeOnly' => true, 'limit' => 10]);
    performancePaginationAssert(count($metaOptions['ads'] ?? []) === 3, 'Lightweight Meta Ad options.');
    performancePaginationAssert(array_keys($metaOptions['ads'][0] ?? []) === ['id', 'metaAdId', 'name', 'status', 'platformName'], 'Meta Ad options payload must stay lightweight.');

    // Wallet aggregates: a single SQL group per employee must preserve the
    // legacy commission ledger values and credited-order semantics.
    $employeeId = substr('employee-' . $stamp, 0, 64);
    $database->execute(
        'INSERT INTO users (
            id, name, phone, role, is_commission_based, fixed_salary, created_at, updated_at
         ) VALUES (:id, :name, :phone, \'Employee\', 1, NULL, :created_at, :updated_at)',
        [
            ':id' => $employeeId,
            ':name' => 'Wallet Performance ' . $stamp,
            ':phone' => 'wallet-' . $stamp,
            ':created_at' => $now,
            ':updated_at' => $now,
        ]
    );
    $walletOrderId = substr('wallet-order-' . $stamp, 0, 64);
    $nextOrderSeq = (int) (($database->fetchOne('SELECT COALESCE(MAX(order_seq), 0) + 1 AS seq FROM orders') ?? [])['seq'] ?? 1);
    $database->execute(
        'INSERT INTO orders (
            id, order_number, order_seq, order_date, customer_id, created_by,
            status, items, total, history, created_at, updated_at
         ) VALUES (
            :id, :order_number, :order_seq, CURRENT_DATE, :customer_id, :created_by,
            \'Completed\', \'[]\', 0, \'{}\', :created_at, :updated_at
         )',
        [
            ':id' => $walletOrderId,
            ':order_number' => 'WALLET-PERF-' . $stamp,
            ':order_seq' => $nextOrderSeq,
            ':customer_id' => substr('deleted-customer-0-' . $stamp, 0, 64),
            ':created_by' => $employeeId,
            ':created_at' => $now,
            ':updated_at' => $now,
        ]
    );
    foreach ([
        ['credit', 'order_credit', 100.0, $walletOrderId],
        ['reversal', 'order_reversal', -20.0, $walletOrderId],
        ['bonus', 'payroll_bonus', 10.0, null],
        ['deduction', 'payroll_deduction', -5.0, null],
        ['payout', 'payout', -20.0, null],
    ] as [$suffix, $entryType, $amount, $sourceOrderId]) {
        $database->execute(
            'INSERT INTO wallet_entries (
                id, employee_id, entry_type, amount_delta, source_order_id,
                source_order_number, note, created_at, created_by
             ) VALUES (
                :id, :employee_id, :entry_type, :amount_delta, :source_order_id,
                :source_order_number, :note, :created_at, :created_by
             )',
            [
                ':id' => substr('wallet-entry-' . $suffix . '-' . $stamp, 0, 64),
                ':employee_id' => $employeeId,
                ':entry_type' => $entryType,
                ':amount_delta' => $amount,
                ':source_order_id' => $sourceOrderId,
                ':source_order_number' => $sourceOrderId !== null ? 'WALLET-PERF-' . $stamp : null,
                ':note' => 'Performance aggregate fixture',
                ':created_at' => $now,
                ':created_by' => $actor['id'],
            ]
        );
    }
    $walletPage = $operations->fetchEmployeeWalletCardsPage([
        'page' => 1,
        'pageSize' => 10,
        'search' => $stamp,
    ]);
    $walletCard = $walletPage['data'][0] ?? [];
    performancePaginationAssert((int) ($walletPage['count'] ?? 0) === 1, 'Wallet search/count.');
    performancePaginationAssert((float) ($walletCard['baseEarned'] ?? 0) === 80.0, 'Wallet base aggregate.');
    performancePaginationAssert((float) ($walletCard['totalBonuses'] ?? 0) === 10.0, 'Wallet bonus aggregate.');
    performancePaginationAssert((float) ($walletCard['totalDeductions'] ?? 0) === 5.0, 'Wallet deduction aggregate.');
    performancePaginationAssert((float) ($walletCard['totalPaid'] ?? 0) === 20.0, 'Wallet payout aggregate.');
    performancePaginationAssert((int) ($walletCard['creditedOrders'] ?? 0) === 1, 'Wallet credited-order aggregate.');

    // Notifications: the summary and paginated feed share one central-sync
    // throttle, while read receipts remain visible in paginated history.
    $claimMethod = new ReflectionMethod($masterData, 'claimCentralNotificationSyncWindow');
    $claimMethod->setAccessible(true);
    $notificationScope = 'user-' . (string) $actor['id'];
    $claimMethod->invoke($masterData, $notificationScope);
    performancePaginationAssert($claimMethod->invoke($masterData, $notificationScope) === false, 'Central notification throttle must reject a duplicate claim.');
    $notificationIds = [];
    for ($index = 0; $index < 12; $index++) {
        $notificationId = substr('notification-' . $index . '-' . $stamp, 0, 64);
        $notificationIds[] = $notificationId;
        $database->execute(
            'INSERT INTO notifications (
                id, subject, content_html, target_roles, created_by,
                is_active, created_at, updated_at
             ) VALUES (
                :id, :subject, :content_html, :target_roles, :created_by,
                1, :created_at, :updated_at
             )',
            [
                ':id' => $notificationId,
                ':subject' => 'Performance Notification ' . $stamp . ' ' . $index,
                ':content_html' => '<p>Performance pagination fixture</p>',
                ':target_roles' => json_encode([(string) $actor['role']], JSON_THROW_ON_ERROR),
                ':created_by' => $actor['id'],
                ':created_at' => sprintf('2038-02-04 12:%02d:00', $index),
                ':updated_at' => sprintf('2038-02-04 12:%02d:00', $index),
            ]
        );
    }
    $database->execute(
        'INSERT INTO notification_receipts (
            notification_id, user_id, is_read, read_at, created_at, updated_at
         ) VALUES (:notification_id, :user_id, 1, :read_at, :created_at, :updated_at)',
        [
            ':notification_id' => $notificationIds[11],
            ':user_id' => $actor['id'],
            ':read_at' => '2038-02-04 12:12:00',
            ':created_at' => '2038-02-04 12:12:00',
            ':updated_at' => '2038-02-04 12:12:00',
        ]
    );
    $notificationPageOne = $masterData->fetchMyNotificationsPaginated(['page' => 1, 'pageSize' => 5]);
    $notificationPageThree = $masterData->fetchMyNotificationsPaginated(['page' => 3, 'pageSize' => 5]);
    $fixturePageOne = array_values(array_filter(
        $notificationPageOne['items'] ?? [],
        static fn(array $item): bool => str_contains((string) ($item['subject'] ?? ''), $stamp)
    ));
    performancePaginationAssert(count($fixturePageOne) === 5, 'Notification first SQL page.');
    performancePaginationAssert((int) ($notificationPageOne['total'] ?? 0) >= 12, 'Notification SQL count.');
    performancePaginationAssert(count($notificationPageThree['items'] ?? []) > 0, 'Notification later page.');
    performancePaginationAssert(!empty($fixturePageOne[0]['isRead']), 'Notification receipt mapping.');
    $notificationSummary = $masterData->fetchMyNotifications();
    performancePaginationAssert((int) ($notificationSummary['unreadCount'] ?? 0) >= 11, 'Notification unread summary.');

    echo "Performance pagination, cursor, notification, Meta Ads, Recycle Bin, and wallet runtime contracts passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
