# Courier webhooks and automatic shipping costs

## What changed

MamePilot no longer asks every courier for every order status from each open browser. CarryBee, Paperfly, Pathao, and Steadfast notify MamePilot when a parcel changes, while a low-volume server worker periodically confirms open consignments through the legacy courier APIs when a webhook is delayed or missing.

The old courier status-check actions remain available for support diagnostics and are also used by the bounded server fallback worker. One deployment runs at most one small provider batch per schedule tick, uses a database lock to prevent overlap, rotates through all providers and exchange consignments, and backs off at the database cursor boundary instead of downloading every order at once. It also retries authenticated webhook events that arrived before the local order became matchable. This keeps shared hosting responsive across many deployments.

## One-time setup

Open **Settings > Courier**. Each available courier shows its exact webhook URL. Add that URL in the courier's merchant portal and save the matching verification value in MamePilot.

| Courier | Webhook URL ending | Verification setup |
| --- | --- | --- |
| CarryBee | `?provider=carrybee` | Copy CarryBee's webhook signature into **Webhook signature**. |
| Paperfly | `?provider=paperfly` | Use the same secret token in Paperfly and **Webhook secret token**. |
| Pathao | `?provider=pathao` | Use the same custom header name and value in Pathao and MamePilot. |
| Steadfast | `?provider=steadfast` | Steadfast sends the existing API key as a Bearer token; no second secret is needed. |

The URL must be public, use HTTPS, and accept a `POST` request. A successful notification receives HTTP 200. Requests with a missing or incorrect verification value are rejected.

### CarryBee webhook setup, step by step

1. Open **Settings > Courier** in MamePilot and copy the **CarryBee Webhook URL** (it ends with `?provider=carrybee`).
2. Log in to your CarryBee merchant dashboard and open the webhook/developer settings page.
3. Create a new webhook and paste the MamePilot webhook URL into CarryBee.
4. CarryBee asks for (or generates) a **Webhook Secret** at that moment. Copy the secret string it shows you — this is the password CarryBee will put in every notification it sends. If CarryBee lets you type your own secret, type any long random string and remember it.
5. Go back to MamePilot, **Settings > Courier > CarryBee Secrets**, and paste that exact secret into **Webhook signature header value**.

   Do not invent a value here: MamePilot only accepts notifications that carry the exact same secret that CarryBee uses. The **Webhook signature header name** stays `X-Carrybee-Webhook-Signature` (the default).
6. **Webhook integration header name/value** fields are the answer CarryBee expects while it verifies the webhook. Keep the shown defaults unless CarryBee's dashboard tells you a different header name or verification value.
7. Save Courier settings. When CarryBee tests the webhook ("integration" event), it receives HTTP 202 with the correct answer, and real order notifications are accepted only when signed with the secret from step 4.

If a notification fails, re-check that the secret in CarryBee and the secret in MamePilot are exactly the same (copy-paste them).

## How order statuses change

| Courier message | MamePilot result |
| --- | --- |
| Picked up / in transit | Picked |
| Delivered | Completed |
| Exchange parcel delivered | Exchange delivered |
| Returned | Returned |
| Cancelled | Cancelled |
| Created, tracking-only, or unknown | Saved for reference; no unsafe status change |

A late older message cannot move an order backward after it is Completed, Returned, Cancelled, or Exchange delivered. A delayed message for the original parcel also cannot complete an exchange parcel by mistake.

MamePilot matches notifications using the courier consignment/tracking number first and the MamePilot order number as a fallback. Events that cannot yet match an order are retained. If the courier retries after the identifier is available, MamePilot tries the match again.

## How shipping costs are calculated

The fee is saved as soon as an event includes it, even if the order is not delivered yet.

- CarryBee: **COD fee + delivery fee**.
- Steadfast: **delivery charge**. `cod_amount` is the amount collected for the parcel and is not a fee.
- Paperfly: only an explicit courier fee/charge field is used. `package_price` and `collected_amount` are not fees.
- Pathao: only explicit COD, delivery, shipping, or courier charge fields are used. Collectable/COD parcel amounts are not used as fees.

Fee parts received in separate messages are combined. Corrected positive fee values replace the earlier component, so the saved total remains the current COD fee plus delivery fee.

## Automatic expense option

Turn on **Automatically record courier shipping costs** in **Settings > Courier** to enable accounting.

When a delivery notification arrives and a positive courier fee has been saved, MamePilot creates exactly one linked **Expense** transaction in **Shipping Costs**. It uses the default account and payment method from General Settings. If no default account is selected, the oldest available account is used.

The transaction deducts that account once and is included in the same Undoer restore point as the delivery. If the fee arrives after delivery, it is attached to the existing delivery restore point. Exact webhook retries cannot create another expense.

While this option is on, **Add Additional Expense** is hidden for courier-delivered orders and the server also rejects that manual action. Return expenses remain manual and available. Turning the option off still saves courier fee information, but creates no automatic accounting transaction.

If there is no account or the selected account cannot cover the expense, delivery processing fails as one unit and the courier receives an error so it can retry. The order is not partly completed without its required expense.

## Checking a mismatch

Use this order of checks:

1. Confirm the merchant portal uses the webhook URL shown in Courier Settings and that its latest delivery attempt received HTTP 200. A webhook delivery failure is not terminal: the server confirmation worker will retry the open consignment through the courier API.
2. Confirm the verification signature/token/header exactly matches Courier Settings.
3. Compare the courier's consignment/tracking number and merchant order reference with the MamePilot order.
4. Compare only the provider's explicit fee fields using the formulas above. Do not compare COD collected, collectable amount, package price, or product price as shipping cost.
5. Confirm the automatic option was on when delivery was processed and that a default or fallback account had enough balance.
6. Check that the order history says it was updated automatically from the expected courier and that its linked Shipping Costs transaction has the same fee total.

For developer/support investigation, `courier_webhook_events` contains the received event and its match/processing result. `courier_order_charges` contains the saved fee components, total, matched order, and linked expense transaction. These records make it possible to distinguish a provider payload problem, an order-matching problem, and an accounting problem without guessing from the order status alone.
