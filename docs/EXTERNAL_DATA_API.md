# External Data API

This API provides scoped access to MamePilot orders, customers, transactions, bills, vendors, accounts, and products. Integrations can create, update, and soft-delete orders, customers, bills, vendors, and products when granted the corresponding write scopes. Transactions and accounts remain read-only. It is intended for server-to-server use by a separate application and does not expose the internal action-dispatch API.

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

Supported read scopes are `orders.read`, `customers.read`, `transactions.read`, `bills.read`, `vendors.read`, `accounts.read`, `accounts.read_balance`, and `products.read`. `accounts.read_balance` requires `accounts.read`. Account balance fields and balance filters are unavailable without the extra balance scope. Write scopes are `orders.create`, `orders.update`, `orders.delete`, `customers.create`, `customers.update`, `customers.delete`, `bills.create`, `bills.update`, `bills.delete`, `vendors.create`, `vendors.update`, `vendors.delete`, `products.create`, `products.update`, and `products.delete`. Each write operation requires its matching scope and the issuing user must still have the corresponding MamePilot permission.

Key administration routes require an existing MamePilot administrator/developer session token, not an integration key:

- `POST /keys`: create a key. Returns HTTP 201 and the secret once.
- `GET /keys`: list key metadata. Does not return secrets or hashes.
- `DELETE /keys/{id}`: revoke a key.

The consumer may save and replay its own filter parameters; MamePilot does not store named filter presets.

## Write Operations

Write requests use the same integration key and resource path as reads. `POST /{resource}` creates a record, `PATCH /{resource}/{id}` partially updates one, and `DELETE /{resource}/{id}` soft-deletes one. `PUT` is not supported. Successful creates return HTTP 201; updates and deletes return HTTP 200. Mutation responses contain only the record ID (and `deleted: true` for a delete), so a separate read scope is needed to fetch the resulting record. Write requests do not accept query parameters or unknown body fields. Create and update bodies use the camelCase field names below.

| Resource | Create fields | Update fields |
|---|---|---|
| Orders | `customerId` (required), `items` (non-empty array, required), `orderDate`, `subtotal`, `discount`, `shipping`, `total`, `notes`, `pageId`, `sourceAd` | `customerId`, `orderDate`, `items`, `subtotal`, `discount`, `shipping`, `total`, `notes`, `status`, `paymentAmount`, `refundAmount`, `accountId`, `paymentMethod`, `transactionDate` |
| Customers | `name` (required), `phone`, `address` | `name`, `phone`, `address` |
| Bills | `vendorId` (required), `items` (non-empty array, required), `billDate`, `subtotal`, `discount`, `shipping`, `total`, `notes` | `vendorId`, `billDate`, `billNumber`, `items`, `subtotal`, `discount`, `shipping`, `total`, `notes`, `status`, `paymentAmount`, `refundAmount`, `accountId`, `paymentMethod`, `transactionDate`, `additionalExpenseAmount`, `additionalExpenseCategoryId` |
| Vendors | `name` (required), `phone`, `address` | `name`, `phone`, `address` |
| Products | `name` (required), `slug`, `sku`, `category`, `unitId`, `salePrice`, `purchasePrice`, `stock`, `dynamicPricing`, `sofaCoverPricing`, `manufacturer`, `batchLotNumber`, `expiryDate`, `recommendedDoseSequence`, `notes` | Same as create fields, all optional |

Each order or bill `items` entry requires `productId`, a positive integer `quantity`, and a non-negative numeric `rate`. `amount` is optional and defaults to `rate × quantity`; if supplied it must match. `subtotal` must equal the sum of item amounts, and `total` must equal `subtotal - discount + shipping` (not below zero). Order and bill dates, when supplied, must use `YYYY-MM-DD`.

Order and bill creation starts in `On Hold`; the API does not accept client-supplied record IDs, paid totals, histories, creator fields, or derived customer/vendor balances. Payment and refund fields on updates go through the existing transaction logic and require the issuer's relevant payment/refund permission. Other status changes and edits retain the application's own permission, lifecycle, stock, and feature checks. Order/bill record-level permission denials return 404 to avoid exposing record existence. Deleting an order or bill also applies the existing related stock and transaction handling. Duplicate customer/vendor phone numbers and product slugs/SKUs return HTTP 409. Product images are excluded because file uploads are managed by the MamePilot application. Products with inventory-bearing order or bill history cannot be deleted. Transactions and accounts do not have write routes or write scopes.

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

Routes: `GET /orders`, `GET /orders/{id}`, `POST /orders`, `PATCH /orders/{id}`, `DELETE /orders/{id}`. Read routes require `orders.read`; write routes require the matching write scope and current MamePilot permission.

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

Routes: `GET /customers`, `GET /customers/{id}`, `POST /customers`, `PATCH /customers/{id}`, `DELETE /customers/{id}`. Read routes require `customers.read`; write routes require the matching write scope and current MamePilot permission.

Filters: `name` and `address` use case-insensitive contains matching; `phone` uses contains matching; `created_by_id` is exact and `created_by_ids` is a comma-separated list; `total_orders_min`/`total_orders_max` and `due_min`/`due_max` are inclusive numeric bounds; `include_walkin=true|false` controls the POS walk-in customer (default false). Common filters also apply.

`search` checks ID, name, phone, address, order count, due amount, creator ID, and creation time. Responses include ID, name, phone, address, total order count, due amount, creator ID, and created/updated/deletion metadata. Health-related fields, identity documents, emergency contacts, and fraud-check detail are not included in the external projection.

## Transactions

Routes: `GET /transactions`, `GET /transactions/{id}`. Requires `transactions.read` and current `transactions.view` permission.

Filters: `type`, `type_in`, and `type_not` accept `Income`, `Expense`, or `Transfer`; `category` and `account_id` are exact; `category_ids` and `account_ids` are comma-separated exact lists; `to_account_id`, `contact_id`, `reference_id`, `created_by_id`, and `recurring_transaction_id` are exact; `contact_type` is `Customer` or `Vendor`; `payment_method` uses contains matching; `approval_status` is `approved`, `pending`, or `declined`; `account_effect_applied` is boolean; `min_amount`/`max_amount` are inclusive; `transaction_date_from`/`transaction_date_to` bound the transaction date. Common filters also apply.

`search` checks transaction ID, description, reference, category, account name, and contact name. Responses omit attachment URLs/names and approval notes. They include transaction/date/type/category, account and contact IDs/names/types, amount, reference, payment method, creator, approval status, account-effect state, and created/deletion metadata.

## Bills

Routes: `GET /bills`, `GET /bills/{id}`, `POST /bills`, `PATCH /bills/{id}`, `DELETE /bills/{id}`. Read routes require `bills.read`; write routes require the matching write scope and current MamePilot permission.

Filters: `status` and `status_not` accept `On Hold`, `Processing`, `Received`, `Paid`, `Returned`, or `Cancelled`; `bill_status` accepts normalized `on_hold`, `processing`, `received`, `returned`, or `cancelled`; `payment_status` accepts `unpaid`, `partially_paid`, `paid`, `overpaid`, or `refunded`; `vendor_id` is exact and `vendor_ids` is a comma-separated list; `vendor_name`, `vendor_phone`, and `bill_number` use contains matching; `created_by_id` is exact and `created_by_ids` is a comma-separated list; `min_amount`/`max_amount`, `min_paid`/`max_paid`, and `min_due`/`max_due` are inclusive; `bill_date_from`/`bill_date_to` bound bill date. Common filters also apply.

`bill_status` treats `Received` and legacy `Paid` as received, and recognizes returned/cancelled history. Payment status uses settlement total, paid amount, and refund history. `status_event` with `status_changed_from`/`status_changed_to` is accepted only when the installation has the corresponding bill lifecycle timestamp columns; otherwise the request returns HTTP 422 `UNSUPPORTED_FILTER`. Product line-item filters are JSON-backed and should be used selectively.

`search` checks bill ID/number, bill date, vendor ID/name/phone/address, creator, status, items, total/payment values, notes, history, and creation time. Responses include bill/vendor IDs and contact details, bill/status/date, line items, totals, payment amount, notes/history, and creation/deletion metadata.

## Vendors

Routes: `GET /vendors`, `GET /vendors/{id}`, `POST /vendors`, `PATCH /vendors/{id}`, `DELETE /vendors/{id}`. Read routes require `vendors.read`; write routes require the matching write scope and current MamePilot permission.

Filters: `name`, `phone`, and `address` use case-insensitive contains matching; `created_by_id` is exact and `created_by_ids` is a comma-separated list; `total_purchases_min`/`total_purchases_max` bound the purchase count; `payable_min`/`payable_max` bound due amount. Common filters also apply.

`search` checks ID, name, phone, address, total purchase count, payable, creator ID, and creation time. Responses include ID, name, phone, address, total purchase count, payable, creator, and created/updated/deletion metadata.

## Accounts

Routes: `GET /accounts`, `GET /accounts/{id}`. Requires `accounts.read` and current `accounts.view` permission.

Filters: `name` uses contains matching; `type` accepts `Bank` or `Cash`; `min_opening_balance`/`max_opening_balance` and `min_current_balance`/`max_current_balance` are inclusive and require `accounts.read_balance`. Common filters apply, except `include_deleted=true`, which is unsupported because accounts do not have soft-delete columns.

`search` checks account ID, name, and type. Without `accounts.read_balance`, response objects contain only ID, name, and type. With that scope, opening and current balances are also returned.

## Products

Routes: `GET /products`, `GET /products/{id}`, `POST /products`, `PATCH /products/{id}`, `DELETE /products/{id}`. Read routes require `products.read`; write routes require the matching create/update/delete scope and current MamePilot `products.create`, `products.edit`, or `products.delete` permission. All routes also require the Inventory capability.

Filters: `name`, `sku`, `category`, and `manufacturer` use case-insensitive contains matching; `unit_id` and `created_by_id` are exact; `created_by_ids` is a comma-separated list; `min_sale_price`/`max_sale_price`, `min_purchase_price`/`max_purchase_price`, and `min_stock`/`max_stock` are inclusive numeric bounds. Common filters apply, including `include_deleted=true` for deleted products.

`search` checks product ID, name, slug, SKU, category, and manufacturer. Responses include ID, name, slug, SKU, category, unit ID, sale/purchase prices, stock, dynamic and sofa-cover pricing, manufacturer, batch lot, expiry date, recommended dose sequence, notes, creator, and created/updated/deletion metadata. Image fields are omitted.

Create requires `name`; SKU and slug must be unique. Create/update accept catalog fields but not record IDs, image paths, creator fields, or deletion metadata. Product stock may be set with `stock`. Delete is a soft delete and is rejected if the product has inventory-bearing order or bill history.

## Incremental Synchronization

For an initial import, request pages until `has_more` is false. For scheduled polling, save a UTC high-water timestamp and query with `updated_since=<checkpoint>&updated_to=<poll-start-time>`. Use a small overlap when advancing the checkpoint and deduplicate by resource ID plus `updatedAt`; updates can occur while pages are being read. Include `include_deleted=true` for resources with soft deletes so tombstones are returned. Accounts have no deletion marker.

All collection resource records expose `updatedAt` from the source row. Orders, customers, transactions, bills, and vendors can return soft-deleted rows with `include_deleted=true`; the same setting on accounts returns HTTP 422. The consuming app should retain the greatest successfully processed timestamp and use overlap/deduplication rather than assuming page numbers form a transactionally frozen snapshot.

## Limits, Errors, and Data Safety

- Rate limit: 120 requests per integration key per minute. Exceeding it returns HTTP 429 and `code: RATE_LIMIT_EXCEEDED`.
- `page_size` is capped at 200; ID lists at 100; `search` and scalar text filters at 255 characters.
- API audit rows record key ID, resource, HTTP method, status, and time only. Filter values, secrets, and request/response bodies are not logged.
- Error bodies use `error` and `code`; validation errors use HTTP 422, duplicate customer/vendor phones use 409, missing/invalid keys use 401, missing scopes and non-record permissions use 403, missing or inaccessible order/bill records use 404, unsupported methods use 405, rate limit uses 429, and unexpected failures use 500 with a request ID.
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