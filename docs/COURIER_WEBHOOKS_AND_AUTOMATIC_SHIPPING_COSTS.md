# Courier webhooks and automatic shipping costs

## What changed

MamePilot no longer asks every courier for every order status every ten minutes from each open browser. CarryBee, Paperfly, Pathao, and Steadfast now notify MamePilot when a parcel changes.

The old courier status-check actions remain available for support diagnostics, but MamePilot does not run them continuously.

## One-time setup

Open **Settings > Courier**. Each available courier shows its exact webhook URL. Add that URL in the courier's merchant portal and save the matching verification value in MamePilot.

| Courier | Webhook URL ending | Verification setup |
| --- | --- | --- |
| CarryBee | `?provider=carrybee` | Copy CarryBee's webhook signature into **Webhook signature**. |
| Paperfly | `?provider=paperfly` | Use the same secret token in Paperfly and **Webhook secret token**. |
| Pathao | `?provider=pathao` | Use the same custom header name and value in Pathao and MamePilot. |
| Steadfast | `?provider=steadfast` | Steadfast sends the existing API key as a Bearer token; no second secret is needed. |

The URL must be public, use HTTPS, and accept a `POST` request. A successful notification receives HTTP 200. Requests with a missing or incorrect verification value are rejected.

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

1. Confirm the merchant portal uses the webhook URL shown in Courier Settings and that its latest delivery attempt received HTTP 200.
2. Confirm the verification signature/token/header exactly matches Courier Settings.
3. Compare the courier's consignment/tracking number and merchant order reference with the MamePilot order.
4. Compare only the provider's explicit fee fields using the formulas above. Do not compare COD collected, collectable amount, package price, or product price as shipping cost.
5. Confirm the automatic option was on when delivery was processed and that a default or fallback account had enough balance.
6. Check that the order history says it was updated automatically from the expected courier and that its linked Shipping Costs transaction has the same fee total.

For developer/support investigation, `courier_webhook_events` contains the received event and its match/processing result. `courier_order_charges` contains the saved fee components, total, matched order, and linked expense transaction. These records make it possible to distinguish a provider payload problem, an order-matching problem, and an accounting problem without guessing from the order status alone.

