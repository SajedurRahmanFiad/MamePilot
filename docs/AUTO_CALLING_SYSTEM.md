# Auto Calling System

MamePilot integrates with AwajDigital voice surveys. A newly created order is
queued only when its order status matches the single trigger status selected
in Voice Survey settings (the default is `On Hold`). The queue creates one Awaj survey for one customer and
passes the order id in metadata.

## Current flow

1. `createOrder` commits the order first. The API then marks it `pending` and
   starts the queue worker when voice survey is enabled.
2. The worker claims pending orders atomically, waits for `delay_minutes`, and
   calls `POST https://api.awajdigital.com/api/surveys`.
3. The request includes `webhook_url` and a random shared secret:

```json
{
  "request_id": "mame_<40 character hash>",
  "template_name": "published-template",
  "sender": "active-sender",
  "phone_numbers": ["01XXXXXXXXX"],
  "metadata": { "order_id": "<mamepilot-order-id>" },
  "webhook_url": "https://example.com/api/webhook-survey.php?token=<secret>"
}
```

4. AwajDigital sends one completion callback to
   `POST /api/webhook-survey.php`. The listener validates the secret, matches
   the order and survey id, and applies the first callback atomically.
5. Key `1` sets `confirmation_status=confirmed`, key `2` sets
   `cancelled`, key `3` or another key sets `on_hold`. A missed call or an
   answered call without a key is scheduled for the configured retry policy.
   Duplicate callbacks and callbacks from an older retry are ignored.

The worker starts every eligible order in its batch after the preceding create
request is accepted; it never waits for a survey-result response or webhook
before creating the next survey. The persisted public webhook URL is included
as `webhook_url` in every create request because CLI workers do not have a
reliable HTTP host context.

There is no result polling. The only periodic survey request in the frontend
is the five-minute Awaj account-balance refresh; it does not fetch call
results.

## AwajDigital contract

AwajDigital documents these required survey fields: `request_id` (16-64
characters), `template_name`, `sender`, and a `phone_numbers` array. The
optional `webhook_url` is called when the survey is complete. The callback has
`survey_id`, `metadata`, and `results`; each result has `phone_number`,
`status`, `duration`, `response`, and `responses`.

AwajDigital's documented `GET /api/broadcasts` route lists ordinary voice
broadcast campaigns, not surveys created through `POST /api/surveys`. The
provider documents survey lookup only by id at
`GET /api/surveys/:id/result`; it does not document a list-surveys route.
Accordingly, the Auto Calling page reads its paginated call history from the
orders and webhook results persisted by MamePilot. This keeps pending calls,
completed outcomes, retries, and all-time date filtering aligned with the
actual auto-calling workflow.

The listener accepts only POST and requires HTTPS in production. API credentials,
sender/template values, and the webhook secret/URL are managed in the
developer-only AwajDigital settings tab. Configure the public URL behind the
reverse proxy so `X-Forwarded-Proto: https` is preserved.

## Queue operation

`backend/bin/process_survey_queue.php` runs as a single, deployment-scoped
MySQL advisory-locked worker for up to ten minutes. It processes delayed calls
and due retries once per minute. Setup and updates use `AutoCallScheduler` to
install the recurring entry idempotently on compatible Linux hosting. The next
eligible order also repairs a missing entry for deployments receiving this
change through an older updater. Its marker is derived from the installed worker
path, which keeps schedules isolated when one hosting account serves multiple
MamePilot domains.

```text
* * * * * /usr/local/bin/php /home/ACCOUNT/mamepilot_backend/backend/bin/process_survey_queue.php --once >> /home/ACCOUNT/mamepilot-auto-call.log 2>&1
```

The post-order background trigger starts the same worker as a fast-path and
writes its output to `mamepilot-auto-call.log`. It watches for the configured
initial delay and possible retry window (up to one day), which also makes local
Windows development work without Unix cron. The recurring schedule remains the
reliable production queue trigger. If the host blocks crontab access, add the
entry manually or set `AUTO_CALL_MANAGE_CRON=0` when the hosting control panel
manages it. The Auto Calling page reports the last run and pending or overdue
counts in business-facing language.

PDO native prepared statements require each named placeholder to be unique.
The survey claim and retry updates therefore use separate timestamp bindings;
reusing `:now` in the same statement causes `SQLSTATE[HY093]` before any
AwajDigital request is sent.

## Order fields

The additive schema migration adds:

- `survey_id`, `survey_status`, `survey_response`, `survey_call_status`
- `confirmation_status`, `survey_result_fetch_at`
- `survey_next_retry_at`, `survey_retry_count`
- `survey_last_retry_reason`, `survey_last_retry_at`, `survey_triggered_at`

The result-fetch timestamp is retained for compatibility with older data but
is not used for polling.

## Verification checklist

- The configured Awaj template is published and the sender is active.
- The webhook URL is publicly reachable over HTTPS and returns HTTP 200.
- `voice_survey_settings.webhook_secret` is non-empty.
- The queue cron is active and the process log shows no advisory-lock errors.
- A test callback with an old `survey_id` does not change the current order.
- Replaying the same callback does not increment retry count or change an
  already completed order.
