# Auto Calling System — Technical Documentation

## Overview

The system integrates with **AwajDigital** (an external IVR/voice survey API at `api.awajdigital.com`) to automatically call customers when new **DRAFT** orders are created. The customer receives an automated phone call and presses a DTMF key to confirm or cancel:

| Key Pressed | Result |
|---|---|
| **1** | Order Confirmed |
| **2** | Order Cancelled |
| **3** | On Hold (wants to talk to a person) |
| No answer / no key | On Hold (triggers automatic retry) |

The system uses a **polling-based approach** to check call results (not webhooks). However, AwajDigital does support webhooks — see the [Webhook Listener](#webhook-listener) section below.

---

## End-to-End Flow

### Step 1 — Order Creation

**File:** `api/orders.php` (POST handler)

When a new order is created with `status = "DRAFT"`, the column `survey_status` is set to `"pending"`. After saving, `trigger_background_survey_cron(true)` is called via `register_shutdown_function` to immediately start the background worker.

### Step 2 — Background Cron Worker Trigger

**File:** `api/bootstrap.php` → `trigger_background_survey_cron()`

- Rate-limited to once per minute using a DB timestamp (`survey_cron_last_run` in settings table).
- Launches `cron-survey.php` as a background process using one of:
  1. Direct PHP binary execution via `shell_exec`/`popen`
  2. HTTP request via `fsockopen` to the same server
  3. Fallback `curl` request

### Step 3 — Cron Worker Processes Orders

**File:** `api/cron-survey.php`

Uses MySQL `GET_LOCK('auto_call_check_lock', 0)` to prevent concurrent execution. Runs in a loop for up to 10 minutes (`$maxRunSeconds = 600`). Three phases per iteration:

**Phase A — Initiate New Calls:**
```sql
SELECT * FROM orders
WHERE status = 'DRAFT'
  AND survey_status = 'pending'
  AND survey_next_retry_at IS NULL
  AND created_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
ORDER BY created_at ASC
LIMIT 50
```
The delay is `surveyDelayMinutes` from settings (default 5 minutes).

**Phase B — Process Due Retries:**
```sql
SELECT * FROM orders
WHERE status = 'DRAFT'
  AND survey_status = 'pending'
  AND survey_next_retry_at IS NOT NULL
  AND survey_next_retry_at <= UTC_TIMESTAMP()
```

**Phase C — Fetch Call Results:**
```sql
SELECT * FROM orders
WHERE status = 'DRAFT'
  AND survey_status IN ('initiated', 'triggered')
  AND survey_id IS NOT NULL
  AND survey_id <> ''
  AND (survey_result_fetch_at IS NULL OR survey_result_fetch_at <= UTC_TIMESTAMP())
```

### Step 4 — Initiating a Survey Call

**File:** `api/bootstrap.php` → `initiate_survey()`

1. Normalizes phone number to 11-digit format (`01XXXXXXXXX`).
2. Atomically claims the order: `UPDATE ... SET survey_status = 'triggered' WHERE survey_status = 'pending'`.
3. Generates a unique `request_id` in format: `awaz_{phone}_{customerName}_{orderId}_{timestamp}`.
4. Sends the API request to AwajDigital.

#### Create Survey Call — API Request

```
POST https://api.awajdigital.com/api/surveys
```

**Headers:**
```
Authorization: Bearer {surveyApiToken}
Accept: application/json
Content-Type: application/json
```

**Payload:**
```json
{
  "request_id": "awaz_01XXXXXXXXX_customerName_ord123_1234567890",
  "template_name": "{surveyTemplateName}",
  "sender": "{surveySender}",
  "phone_numbers": ["01XXXXXXXXX"],
  "metadata": {
    "order_id": "{internal_order_uuid}"
  }
}
```

| Field | Description |
|---|---|
| `request_id` | Unique identifier for this call attempt |
| `template_name` | Published survey template name in AwajDigital dashboard |
| `sender` | Caller ID / sender number registered on AwajDigital |
| `phone_numbers` | Array with a single phone number (11-digit format) |
| `metadata.order_id` | Internal order UUID for correlation |

**Success (2xx):** Extracts `survey.id` (or `data.id`) from response. Updates order to `survey_status = "initiated"`, sets `survey_result_fetch_at` = now + `maximumSurveyTimeSeconds`.

**Failure:** Resets `survey_status` back to `"pending"` with error info in `survey_call_status`.

### Step 5 — Fetching Call Results (Polling)

**File:** `api/cron-survey.php` → `fetch_and_process_survey_result()`

#### Get Survey Result — API Request

```
GET https://api.awajdigital.com/api/surveys/{surveyId}/result
```

**Headers:**
```
Authorization: Bearer {surveyApiToken}
Accept: application/json
```

**Response parsing** looks for:
- Survey status: `$data['survey']['status']` or `$data['status']`
- Call results: `$data['numbers']`, `$data['results']`, or `$data['result']`
- Call status: `status`, `call_status`, or `state` fields
- Pressed keys: `pressedKeys`, `pressed_keys`, `dtmf`, or `response` fields

**Pending statuses** (call still in progress — reschedules fetch):
`pending`, `surveying`, `queued`, `dialing`, `initiated`, `in_progress`, `scheduled`

**Completed call handling:**
| Condition | Result |
|---|---|
| Key `1` pressed + answered | `confirmation_status = "confirmed"` |
| Key `2` pressed + answered | `confirmation_status = "cancelled"` |
| Key `3` pressed or unexpected key | `confirmation_status = "on_hold"` |
| Answered but no key | Triggers retry logic |
| Not answered / failed | Triggers retry logic |

### Step 6 — Automatic Retry Logic

**File:** `api/cron-survey.php` → `schedule_survey_retry()`

| Scenario | Retry After | Max Retries |
|---|---|---|
| Missed/unreachable call | `surveyMissedCallRetryMinutes` (default 30 min) | `surveyMissedCallRetryCount` (default 3) |
| Answered but no key pressed | `surveyNoKeyRetryMinutes` (default 10 min) | `surveyNoKeyRetryCount` (default 2) |

**Missed call statuses:** `not_answered`, `no_answer`, `unanswered`, `unreachable`, `busy`, `failed`, `failed_call`, `call_failed`, `no_result`

Sets `survey_next_retry_at` and increments `survey_retry_count`.

### Step 7 — Stuck Order Recovery

Orders stuck in `survey_status = "triggered"` without a `survey_id` for over 2 minutes are reset to `"pending"`.

---

## Webhook Support (AwajDigital)

When creating a survey via `POST /api/surveys`, AwajDigital supports an optional **webhook URL** in the request payload. Instead of polling for results, AwajDigital will POST the results to your webhook URL when the call completes.

### Survey Creation with Webhook

```
POST https://api.awajdigital.com/api/surveys
```

**Headers:**
```
Authorization: Bearer {surveyApiToken}
Accept: application/json
Content-Type: application/json
```

**Payload (with webhook):**
```json
{
  "request_id": "awaz_01XXXXXXXXX_customerName_ord123_1234567890",
  "template_name": "{surveyTemplateName}",
  "sender": "{surveySender}",
  "phone_numbers": ["01XXXXXXXXX"],
  "metadata": {
    "order_id": "{internal_order_uuid}"
  },
  "webhook_url": "https://your-domain.com/api/webhook-survey.php"
}
```

### Webhook Payload Sent by AwajDigital

When the call (or batch of calls) completes, AwajDigital sends a POST to your `webhook_url` with this payload:

```json
{
  "survey_id": 456,
  "metadata": {
    "campaign_id": "summer2025",
    "customer_segment": "premium"
  },
  "results": [
    {
      "phone_number": "019XXXXXXXX",
      "status": "answered",
      "duration": 45,
      "response": "1",
      "responses": ["1", "5"]
    },
    {
      "phone_number": "018XXXXXXXX",
      "status": "answered",
      "duration": 62,
      "response": "2",
      "responses": ["2", "4", "1"]
    },
    {
      "phone_number": "017XXXXXXXX",
      "status": "not_answered",
      "duration": 0
    }
  ]
}
```

**Field descriptions:**

| Field | Description |
|---|---|
| `survey_id` | The AwajDigital survey ID |
| `metadata` | Arbitrary metadata passed during survey creation |
| `results[].phone_number` | The phone number that was called |
| `results[].status` | Call status: `answered`, `not_answered`, etc. |
| `results[].duration` | Call duration in seconds |
| `results[].response` | The primary DTMF response (the key the customer pressed) |
| `results[].responses` | Array of all DTMF responses (for multi-question surveys) |

---

## Webhook Listener — How to Build One

### Existing Legacy Webhook Endpoint

**File:** `api/webhook-survey.php`

This file already exists in the codebase. It accepts POST requests with a security token:

```
POST /api/webhook-survey.php?token={surveyWebhookSecret}
```

**Expected payload:**
```json
{
  "metadata": {
    "order_id": "{internal_order_uuid}"
  },
  "results": [
    {
      "status": "answered",
      "response": "1"
    }
  ]
}
```

**Processing:** Maps DTMF response to order status:
- `1` → CONFIRMED
- `2` → CANCELLED
- Anything else → ON_HOLD

> **Note:** The system currently uses **polling** instead of webhooks. The webhook columns (`survey_webhook_url`, `survey_webhook_secret`) were dropped from the settings table via migration `MIGRATE_REMOVE_WEBHOOK_ADD_CONFIRMATION_STATUS.sql`. The webhook file still exists and is functional if needed.

### Creating a New Webhook Listener

If you want to switch from polling to webhooks, here's how to build a webhook listener:

#### 1. Create the Endpoint

Create a PHP file (e.g., `api/webhook-callback.php`) that:

1. Validates the request method (POST only).
2. Optionally validates a shared secret or signature.
3. Parses the JSON payload.
4. Matches the `phone_number` in results to an order in your database.
5. Updates the order's `survey_status`, `survey_response`, and `confirmation_status`.

#### 2. Example Implementation

```php
<?php
// api/webhook-callback.php

header('Content-Type: application/json');

// Only accept POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// Read and parse payload
$rawBody = file_get_contents('php://input');
$payload = json_decode($rawBody, true);

if (!$payload || !isset($payload['results'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid payload']);
    exit;
}

// Connect to database
require_once __DIR__ . '/bootstrap.php';
$db = get_db_connection();

$surveyId = $payload['survey_id'] ?? null;
$metadata = $payload['metadata'] ?? [];
$orderId = $metadata['order_id'] ?? null;

foreach ($payload['results'] as $result) {
    $phoneNumber = $result['phone_number'] ?? '';
    $status = $result['status'] ?? '';
    $response = $result['response'] ?? null;
    $duration = $result['duration'] ?? 0;

    // Normalize phone number to match your DB format
    $normalizedPhone = normalize_phone($phoneNumber); // 01XXXXXXXXX

    // Determine confirmation status from DTMF response
    $confirmationStatus = 'waiting';
    $surveyCallStatus = $status;

    if ($status === 'answered' && $response !== null) {
        switch ($response) {
            case '1':
                $confirmationStatus = 'confirmed';
                break;
            case '2':
                $confirmationStatus = 'cancelled';
                break;
            default:
                $confirmationStatus = 'on_hold';
                break;
        }
    } elseif ($status !== 'answered') {
        $surveyCallStatus = 'not_answered';
    }

    // Find the order — by order_id from metadata or by phone number
    if ($orderId) {
        $stmt = $db->prepare(
            "UPDATE orders SET
                survey_status = 'completed',
                survey_response = ?,
                survey_call_status = ?,
                confirmation_status = ?
            WHERE uuid = ? AND survey_status IN ('initiated', 'triggered')"
        );
        $stmt->bind_param('ssss', $response, $surveyCallStatus, $confirmationStatus, $orderId);
        $stmt->execute();
    } else {
        // Fallback: match by phone number (less reliable)
        $stmt = $db->prepare(
            "UPDATE orders SET
                survey_status = 'completed',
                survey_response = ?,
                survey_call_status = ?,
                confirmation_status = ?
            WHERE phone = ?
              AND status = 'DRAFT'
              AND survey_status IN ('initiated', 'triggered')
            ORDER BY created_at DESC
            LIMIT 1"
        );
        $stmt->bind_param('ssss', $response, $surveyCallStatus, $confirmationStatus, $normalizedPhone);
        $stmt->execute();
    }
}

echo json_encode(['success' => true]);
```

#### 3. Register the Webhook URL

When creating a survey call, include your webhook URL:

```json
{
  "request_id": "awaz_...",
  "template_name": "...",
  "sender": "...",
  "phone_numbers": ["01XXXXXXXXX"],
  "metadata": { "order_id": "uuid-here" },
  "webhook_url": "https://your-domain.com/api/webhook-callback.php"
}
```

#### 4. Security Considerations

- **Shared secret:** Pass a secret token as a query parameter and validate it in the listener.
- **IP allowlist:** Restrict the endpoint to AwajDigital's IP addresses if they provide them.
- **HTTPS only:** Always use HTTPS for webhook URLs.
- **Idempotency:** Handle duplicate webhook deliveries gracefully (check if order is already completed).
- **Respond quickly:** Return `200 OK` immediately, then process asynchronously if needed.

---

## Configuration / Settings

All survey settings are stored in the `settings` MySQL table and managed via `api/settings.php`.

### Settings Table Columns

| Column | Type | Default | Description |
|---|---|---|---|
| `survey_enabled` | TINYINT(1) | 0 | Master on/off switch |
| `survey_delay_minutes` | INT | 5 | Minutes to wait after order creation before calling |
| `survey_api_token` | TEXT | NULL | AwajDigital Bearer token |
| `survey_sender` | VARCHAR(64) | NULL | Caller ID / sender number |
| `survey_template_name` | VARCHAR(191) | NULL | Survey template name in AwajDigital |
| `maximum_survey_time_seconds` | INT | 60 | Seconds to wait before polling results |
| `survey_missed_call_retry_minutes` | INT | 30 | Minutes before retrying missed calls |
| `survey_missed_call_retry_count` | INT | 3 | Max retries for missed calls |
| `survey_no_key_retry_minutes` | INT | 10 | Minutes before retrying no-key calls |
| `survey_no_key_retry_count` | INT | 2 | Max retries for no-key calls |
| `survey_cron_last_run` | DATETIME | NULL | Last cron trigger timestamp |

### Orders Table — Survey Columns

| Column | Type | Description |
|---|---|---|
| `survey_id` | VARCHAR(64) | AwajDigital survey/call ID |
| `survey_status` | VARCHAR(32) | `pending`, `triggered`, `initiated`, `completed`, `failed`, `skipped` |
| `survey_response` | VARCHAR(16) | DTMF key pressed (`1`, `2`, `3`) |
| `survey_call_status` | VARCHAR(32) | `answered`, `not_answered`, `api_error:...`, etc. |
| `confirmation_status` | VARCHAR(32) | `confirmed`, `cancelled`, `on_hold`, `waiting` |
| `survey_result_fetch_at` | DATETIME | When to next poll for results |
| `survey_next_retry_at` | DATETIME | When to next retry the call |
| `survey_retry_count` | INT | Number of retries attempted |
| `survey_last_retry_reason` | VARCHAR(32) | `missed_call` or `answered_no_key` |
| `survey_last_retry_at` | DATETIME | Timestamp of last retry |

---

## File Index

| File | Role |
|---|---|
| `api/cron-survey.php` | Background worker — initiates calls, polls results, handles retries |
| `api/webhook-survey.php` | Legacy webhook endpoint (still functional) |
| `api/bootstrap.php` | Core functions: `initiate_survey()`, `trigger_background_survey_cron()`, `normalize_survey_phone()` |
| `api/orders.php` | Order CRUD — triggers survey cron on DRAFT creation |
| `api/settings.php` | Settings CRUD — all survey configuration |
| `types.ts` | TypeScript types: `ConfirmationStatus`, `Order` survey fields, `Settings` survey fields |
| `store.tsx` | Global state with survey settings defaults |
| `pages/Settings.tsx` | Settings UI with Voice Survey tab |
| `components/SurveyStatusPanel.tsx` | Survey status display component |
| `components/OrderRow.tsx` | Desktop order row with confirmation dot |
| `components/MobileOrderCard.tsx` | Mobile order card with confirmation dot |
| `components/OrderDetailModal.tsx` | Order detail with survey status section |

## Migration Files

| File | Purpose |
|---|---|
| `MIGRATE_ADD_SURVEY_SETTINGS.sql` | Initial survey columns in settings and orders tables |
| `MIGRATE_AUTO_CALL_PENDING_ORDER_WORKFLOW.sql` | Indexes for auto-call queries |
| `MIGRATE_REMOVE_WEBHOOK_ADD_CONFIRMATION_STATUS.sql` | Removed webhook columns, added `confirmation_status` |
| `MIGRATE_VOICE_SURVEY_RETRIES.sql` | Added retry settings and order retry tracking |
