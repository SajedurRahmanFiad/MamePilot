# Shopify integration

MamePilot uses Shopify Admin GraphQL API version `2026-07` for connection checks, webhook subscription management, and complete cursor-paginated imports.

## Shopify custom app permissions

Grant these Admin API scopes before installing the custom app:

- `read_products`
- `read_orders`
- `read_customers`
- `read_all_orders` when orders older than Shopify's standard order-history window must be imported

Copy the Admin API access token and the app API secret key into Settings > Shopify. The API secret key is required because Shopify signs HTTPS webhook deliveries with the app client secret. It is not interchangeable with the access token.

## Matching and duplicate prevention

- Products match by exact, case-insensitive SKU. Variants without a SKU are skipped and reported.
- Customers match by normalized phone number. Customer webhooks without a phone number are acknowledged but skipped.
- Orders match by normalized customer phone plus the sorted aggregate of SKU and quantity pairs. The same key is persisted in `shopify_order_links`.
- Shopify webhook delivery IDs are persisted in `shopify_webhook_events`, so retries remain idempotent.

## Automatic webhooks

MamePilot registers and monitors these subscriptions:

- `ORDERS_CREATE`
- `CUSTOMERS_CREATE`
- `CUSTOMERS_UPDATE`

The public cPanel endpoint is `/api/shopify-webhook.php`. It requires HTTPS and verifies `X-Shopify-Hmac-Sha256` against the stored app API secret before processing any payload.

## Recommended first-time workflow

1. Save the store connection.
2. Test the connection and correct any missing scopes.
3. Import all products.
4. Import all orders.
5. Turn on automatic sync.
6. Confirm webhook health is green.
