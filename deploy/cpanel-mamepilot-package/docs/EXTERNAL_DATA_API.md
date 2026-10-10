# External Data API

This API provides read-only access to MamePilot orders, customers, transactions, bills, vendors, and accounts. It is intended for server-to-server use by a separate application. It does not expose the internal action-dispatch API.

## Base URL and Authentication

Production base URL: `https://YOUR-DOMAIN/api/v1`

The local Vite proxy exposes the same routes under `/api/v1`; it forwards them to the PHP backend as `/v1` paths.

Data endpoints require an integration key in the HTTP Authorization header. Do not put keys in URLs, query parameters, application source code, or browser bundles.

```http
Authorization: Bearer mp_live_<secret>
```

Configure `APP_API_KEY_PEPPER` in the backend environment before creating or using keys. It must be a unique random value of at least 32 bytes. Do not reuse `APP_JWT_SECRET`, commit the pepper, or share it with the integration application.

An administrator or developer creates a key with a label, optional ISO-8601 expiry, and one or more scopes. The full secret is returned only by the create call. Store it in the consuming app's server-side secret manager. Listing keys shows only a short prefix and metadata. Revocation takes effect on the next request. Keys stop working if their issuing account is deleted, disabled, or no longer has the administrator/developer role.

```http
POST /api/v1/keys
Authorization: Bearer <MamePilot-admin-session-token>
Content-Type: application/json

{"label":"Customer automation","scopes":["orders.read","customers.read","transactions.read"],"expires_at":"2027-10-11T00:00:00Z"}
```

Supported scopes are `orders.read`, `customers.read`, `transactions.read`, `bills.read`, `vendors.read`, `accounts.read`, and `accounts.read_balance`. `accounts.read_balance` requires `accounts.read`. Account balance fields and balance filters are unavailable without the extra balance scope.

Key administration routes require an existing MamePilot administrator/developer session token, not an integration key:

- `POST /keys`: create a key. Returns HTTP 201 and the secret once.
- `GET /keys`: list key metadata. Does not return secrets or hashes.
- `DELETE /keys/{id}`: revoke a key.

No data endpoint supports writes. The consumer may save and replay its own filter parameters; MamePilot does not store named filter presets.

## Collection Behavior

Each collection is paginated and filtered in the database before rows are returned. The default page size is 100 and the maximum is 200. Responses contain `data` and `pagination` with `page`, `page_size`, `total`, and `has_more`. Pages use deterministic ordering and an ID tie-breaker. Offset pagination is supported; cursor pagination is not currently implemented.

Different filter fields combine with AND. Comma-separated values within one enum/list filter combine with OR. For example, `status=Processing,Picked&payment_status=unpaid` means `(status is Processing OR Picked) AND payment status is unpaid`.

Common parameters:

| Parameter | Meaning |
|---|---|
| `page` | 1-based page number; defaults to 1. The requested offset is capped at 1,000,000 rows. |
| `page_size` | Rows per page; defaults to 100 and must be 1 through 200. |
| `ids` | Comma-separated exact record IDs; maximum 100. |
| `search` | Case-insensitive contains search over the resource-specific safe fields listed below; maximum 255 characters. `%`, `_`, and `=` are treated literally. |
| `created_from`, `created_to` | Inclusive creation timestamp bounds. |
| `updated_from`, `updated_to` | Inclusive update timestamp bounds. |
| `updated_since` | Inclusive update lower bound for incremental polling. |
| `sort_by` | Resource-specific allowlisted field; defaults to `created_at`. |
| `sort_direction` | `asc` or `desc`; defaults to `desc`. |
| `include_deleted` | Include soft-deleted rows where supported. Defaults to false. Accounts do not support deletion filtering. |

Dates may be `YYYY-MM-DD` or ISO-8601 timestamps with an explicit timezone, such as `2026-10-11T12:30:00+06:00`. Timestamp values are normalized to UTC. Date-only lower bounds mean 00:00:00 UTC; date-only upper bounds include the day through 23:59:59 UTC. Reversed ranges are rejected. `updated_since` is inclusive.

Unknown parameters, invalid enums, unsupported sorts, malformed dates, too many IDs, and reversed ranges return HTTP 422 with `code: INVALID_FILTER` or a more specific validation code. All filters are allowlisted; clients cannot provide SQL, arbitrary columns, or sort expressions.

## Orders

Routes: `GET /orders`, `GET /orders/{id}`. Requires `orders.read` and current `orders.view` permission.

Filters:

| Parameter | Meaning |
|---|---|
| `status`, `status_not` | Exact canonical status or comma-separated statuses. `Created` is accepted as a legacy alias for `On Hold`. Supported values: `Created`, `On Hold`, `Processing`, `Courier assigned`, `Picked`, `Completed`, `pending_delivered`, `pending_partial`, `partially_delivered`, `Exchange processing`, `Exchange picked`, `Exchange delivered`, `Exchange returned`, `Exchange cancelled`, `Repair processing`, `Repair Courier Assigned`, `Repair picked`, `Repair delivered`, `Repair canceled`, `Repair returned`, `Returned`, `Cancelled`. |
| `delivery_status` | Normalized value: `delivered`, `partially_delivered`, `not_delivered`, `returned`, or `cancelled`. Uses current order status and the partial-delivery timestamp. Exchange and repair delivered/returned/cancelled statuses are included in their corresponding normalized state. |
| `payment_status` | `unpaid`, `partially_paid`, `paid`, `overpaid`, or `refunded`. Derived from total, paid amount, cancellation state, and refund history. |
| `customer_id`, `customer_ids` | Exact customer ID, or a comma-separated list of IDs. |
| `customer_phone` | Contains match on customer phone. |
| `order_number` | Contains match on order number. |
| `created_by_id`, `created_by_ids` | Creator user ID or comma-separated IDs. |
| `source_ad`, `page_id` | Exact source-ad or page ID. |
| `courier` | Courier name/identifier; known courier tracking fields and order history are considered. |
| `is_pos` | `true` or `false`; only available when the deployed schema has the POS column. |
| `min_amount`, `max_amount` | Inclusive bounds on order total. |
| `min_paid`, `max_paid` | Inclusive bounds on paid amount. |
| `min_due`, `max_due` | Inclusive bounds on outstanding due, calculated as max(settlement total minus paid amount, zero). Cancelled orders have a settlement total of zero. |
| `order_date_from`, `order_date_to` | Inclusive order-date bounds. |
| `status_event`, `status_changed_from`, `status_changed_to` | Filter by one supported lifecycle timestamp and inclusive bounds. Events include processing, courier, picked, delivered, returned, cancelled, partial delivery, and supported exchange/repair lifecycle events. Both an event and at least one bound are required. |
| `product_id`, `product_ids` | Match a line item's `productId` in order items. This filter is JSON-backed and should be used selectively. |

`search` checks order ID/number, status, customer name/phone, source ad, and notes. Order responses contain IDs, order/date/status fields, line items, totals and payment amount, customer name/phone/address, selected lifecycle timestamps, history, and creation/deletion metadata. Customer contact values are business-sensitive; grant `orders.read` only to trusted integrations.

Example: `GET /orders?delivery_status=delivered&payment_status=unpaid&min_amount=200&max_amount=400&page_size=100`.

The delivery filter is a normalized convenience, not a promise that every historical row has complete lifecycle data. Historical statuses may have missing timestamps or legacy history payloads.

## Customers

Routes: `GET /customers`, `GET /customers/{id}`. Requires `customers.read` and current `customers.view` permission.

Filters: `name` and `address` use case-insensitive contains matching; `phone` uses contains matching; `created_by_id` is exact and `created_by_ids` is a comma-separated list; `total_orders_min`/`total_orders_max` and `due_min`/`due_max` are inclusive numeric bounds; `include_walkin=true|false` controls the POS walk-in customer (default false). Common filters also apply.

`search` checks ID, name, phone, address, order count, due amount, creator ID, and creation time. Responses include ID, name, phone, address, total order count, due amount, creator ID, and created/updated/deletion metadata. Health-related fields, identity documents, emergency contacts, and fraud-check detail are not included in the external projection.

## Transactions

Routes: `GET /transactions`, `GET /transactions/{id}`. Requires `transactions.read` and current `transactions.view` permission.

Filters: `type`, `type_in`, and `type_not` accept `Income`, `Expense`, or `Transfer`; `category` and `account_id` are exact; `category_ids` and `account_ids` are comma-separated exact lists; `to_account_id`, `contact_id`, `reference_id`, `created_by_id`, and `recurring_transaction_id` are exact; `contact_type` is `Customer` or `Vendor`; `payment_method` uses contains matching; `approval_status` is `approved`, `pending`, or `declined`; `account_effect_applied` is boolean; `min_amount`/`max_amount` are inclusive; `transaction_date_from`/`transaction_date_to` bound the transaction date. Common filters also apply.

`search` checks transaction ID, description, reference, category, account name, and contact name. Responses omit attachment URLs/names and approval notes. They include transaction/date/type/category, account and contact IDs/names/types, amount, reference, payment method, creator, approval status, account-effect state, and created/deletion metadata.

## Bills

Routes: `GET /bills`, `GET /bills/{id}`. Requires `bills.read` and current `bills.view` permission.

Filters: `status` and `status_not` accept `On Hold`, `Processing`, `Received`, `Paid`, `Returned`, or `Cancelled`; `bill_status` accepts normalized `on_hold`, `processing`, `received`, `returned`, or `cancelled`; `payment_status` accepts `unpaid`, `partially_paid`, `paid`, `overpaid`, or `refunded`; `vendor_id` is exact and `vendor_ids` is a comma-separated list; `vendor_name`, `vendor_phone`, and `bill_number` use contains matching; `created_by_id` is exact and `created_by_ids` is a comma-separated list; `min_amount`/`max_amount`, `min_paid`/`max_paid`, and `min_due`/`max_due` are inclusive; `bill_date_from`/`bill_date_to` bound bill date. Common filters also apply.

`bill_status` treats `Received` and legacy `Paid` as received, and recognizes returned/cancelled history. Payment status uses settlement total, paid amount, and refund history. `status_event` with `status_changed_from`/`status_changed_to` is accepted only when the installation has the corresponding bill lifecycle timestamp columns; otherwise the request returns HTTP 422 `UNSUPPORTED_FILTER`. Product line-item filters are JSON-backed and should be used selectively.

`search` checks bill ID/number, bill date, vendor ID/name/phone/address, creator, status, items, total/payment values, notes, history, and creation time. Responses include bill/vendor IDs and contact details, bill/status/date, line items, totals, payment amount, notes/history, and creation/deletion metadata.

## Vendors

Routes: `GET /vendors`, `GET /vendors/{id}`. Requires `vendors.read` and current `vendors.view` permission.

Filters: `name`, `phone`, and `address` use case-insensitive contains matching; `created_by_id` is exact and `created_by_ids` is a comma-separated list; `total_purchases_min`/`total_purchases_max` bound the purchase count; `payable_min`/`payable_max` bound due amount. Common filters also apply.

`search` checks ID, name, phone, address, total purchase count, payable, creator ID, and creation time. Responses include ID, name, phone, address, total purchase count, payable, creator, and created/updated/deletion metadata.

## Accounts

Routes: `GET /accounts`, `GET /accounts/{id}`. Requires `accounts.read` and current `accounts.view` permission.

Filters: `name` uses contains matching; `type` accepts `Bank` or `Cash`; `min_opening_balance`/`max_opening_balance` and `min_current_balance`/`max_current_balance` are inclusive and require `accounts.read_balance`. Common filters apply, except `include_deleted=true`, which is unsupported because accounts do not have soft-delete columns.

`search` checks account ID, name, and type. Without `accounts.read_balance`, response objects contain only ID, name, and type. With that scope, opening and current balances are also returned.

## Incremental Synchronization

For an initial import, request pages until `has_more` is false. For scheduled polling, save a UTC high-water timestamp and query with `updated_since=<checkpoint>&updated_to=<poll-start-time>`. Use a small overlap when advancing the checkpoint and deduplicate by resource ID plus `updatedAt`; updates can occur while pages are being read. Include `include_deleted=true` for resources with soft deletes so tombstones are returned. Accounts have no deletion marker.

All collection resource records expose `updatedAt` from the source row. Orders, customers, transactions, bills, and vendors can return soft-deleted rows with `include_deleted=true`; the same setting on accounts returns HTTP 422. The consuming app should retain the greatest successfully processed timestamp and use overlap/deduplication rather than assuming page numbers form a transactionally frozen snapshot.

## Limits, Errors, and Data Safety

- Rate limit: 120 requests per integration key per minute. Exceeding it returns HTTP 429 and `code: RATE_LIMIT_EXCEEDED`.
- `page_size` is capped at 200; ID lists at 100; `search` and scalar text filters at 255 characters.
- API audit rows record key ID, resource, HTTP method, status, and time only. Filter values, secrets, and request/response bodies are not logged.
- Error bodies use `error` and `code`; validation errors use HTTP 422, missing/invalid keys use 401, missing scopes/permissions use 403, missing resources use 404, unsupported methods use 405, rate limit uses 429, and unexpected failures use 500 with a request ID.
- Use HTTPS, store the key server-side, grant only required scopes, rotate keys by creating a replacement and revoking the old key, and do not log Authorization headers.

## Examples

```sh
curl --get 'https://YOUR-DOMAIN/api/v1/orders' \
  --header 'Authorization: Bearer mp_live_<secret>' \
  --data-urlencode 'delivery_status=delivered' \
  --data-urlencode 'payment_status=unpaid' \
  --data-urlencode 'min_amount=200' \
  --data-urlencode 'max_amount=400' \
  --data-urlencode 'page_size=100'
```

```sh
curl --get 'https://YOUR-DOMAIN/api/v1/transactions' \
  --header 'Authorization: Bearer mp_live_<secret>' \
  --data-urlencode 'type_in=Income,Transfer' \
  --data-urlencode 'approval_status=approved' \
  --data-urlencode 'min_amount=100' \
  --data-urlencode 'transaction_date_from=2026-10-01' \
  --data-urlencode 'transaction_date_to=2026-10-31'
```

The machine-readable contract is in `docs/external-data-api.openapi.yaml`.