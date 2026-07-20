# Auto Calling System

MamePilot integrates with AwajDigital voice surveys. A newly created order is
queued only when its order status is listed in Voice Survey settings (the
default is `On Hold`). The queue creates one Awaj survey for one customer and
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

There is no result polling. The only periodic survey request in the frontend
is the five-minute Awaj account-balance refresh; it does not fetch call
results.

## AwajDigital contract

AwajDigital documents these required survey fields: `request_id` (16-64
characters), `template_name`, `sender`, and a `phone_numbers` array. The
optional `webhook_url` is called when the survey is complete. The callback has
`survey_id`, `metadata`, and `results`; each result has `phone_number`,
`status`, `duration`, `response`, and `responses`.

The listener accepts only POST and requires HTTPS in production. The shared
secret is generated when Voice Survey is enabled. Configure the public URL
behind the reverse proxy so `X-Forwarded-Proto: https` is preserved.

## Queue operation

`backend/bin/process_survey_queue.php` runs as a single MySQL advisory-locked
worker for up to ten minutes. It processes delayed calls and due retries once
per minute. Configure a cPanel cron entry to run it every minute so retries
whose delay exceeds ten minutes are also delivered:

```text
* * * * * /usr/local/bin/php /home/ACCOUNT/mamepilot_backend/backend/bin/process_survey_queue.php --once
```

The post-order background trigger starts the same worker without `--once`.
If shell execution is disabled by the host, the cron entry remains the
reliable queue trigger.

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

