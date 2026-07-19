# Pathao Courier API — Complete Reference

## Overview

This document covers everything about the Pathao courier integration from a pure API perspective: what credentials are needed, which endpoints are called, what the payloads look like, and how authentication works.

Pathao uses an OAuth2-style authentication flow (Resource Owner Password Credentials grant) followed by Bearer token authentication for all subsequent API calls.

---

## 1. Required Credentials / Settings

The following values must be configured before the Pathao integration can work:

| Setting Key | DB Column | Type | Required | Description |
|---|---|---|---|---|
| `pathaoBaseUrl` | `pathao_base_url` | string | **Yes** | The Pathao API base URL (e.g., `https://merchant-api-live.pathao.com`) |
| `pathaoClientId` | `pathao_client_id` | string | **Yes** | OAuth2 client ID provided by Pathao |
| `pathaoClientSecret` | `pathao_client_secret` | string | **Yes** | OAuth2 client secret provided by Pathao |
| `pathaoUsername` | `pathao_username` | string | **Yes*** | Pathao merchant account username/email |
| `pathaoPassword` | `pathao_password` | string | **Yes*** | Pathao merchant account password |
| `pathaoStoreId` | `pathao_store_id` | string | **Yes** | The Pathao store ID to create orders under |

\* Required for `password` grant type. For `refresh_token` grant, the refresh token itself is needed instead.

### Optional Default Values

These are used when creating orders if the caller does not provide explicit overrides:

| Setting Key | DB Column | Type | Default | Description |
|---|---|---|---|---|
| `pathaoDefaultQuantity` | `pathao_default_quantity` | int | `1` | Default item quantity for orders |
| `pathaoDefaultWeight` | `pathao_default_weight` | float | `1.0` | Default item weight in kg |
| `pathaoDefaultDeliveryType` | `pathao_default_delivery_type` | int | `48` | Default delivery speed (see Delivery Type values below) |
| `pathaoDefaultItemType` | `pathao_default_item_type` | int | `2` | Default item category (see Item Type values below) |

### Token-Related Settings (managed automatically)

| Setting Key | DB Column | Type | Description |
|---|---|---|---|
| `pathaoAccessToken` | `pathao_access_token` | string | Current OAuth2 access token (auto-populated after token generation) |
| `pathaoRefreshToken` | `pathao_refresh_token` | string | Current OAuth2 refresh token (auto-populated after token generation) |
| `pathaoTokenExpiresAt` | `pathao_token_expires_at` | string | ISO 8601 timestamp of when the access token expires |

### Minimum Required for "Configured" Status

The system considers Pathao "configured" when **all four** of these are non-empty:
- `pathaoBaseUrl`
- `pathaoClientId`
- `pathaoClientSecret`
- `pathaoStoreId`

---

## 2. Authentication — Token Endpoint

### Endpoint

```
POST {baseUrl}/aladdin/api/v1/issue-token
```

### Grant Type: `password` (Initial Token Generation)

**Request:**
```json
{
  "client_id": "<pathaoClientId>",
  "client_secret": "<pathaoClientSecret>",
  "grant_type": "password",
  "username": "<pathaoUsername>",
  "password": "<pathaoPassword>"
}
```

**Headers:**
```
Content-Type: application/json
Accept: application/json
```

**Successful Response (200):**
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGci...",
  "refresh_token": "def50200a1b2c3d4e5f6...",
  "expires_in": 86400,
  "message": "Token issued successfully"
}
```

**Field Descriptions:**
| Field | Type | Description |
|---|---|---|
| `access_token` | string | Bearer token used for all subsequent API calls |
| `refresh_token` | string | Token used to obtain a new access token without re-entering credentials |
| `expires_in` | int | Token lifetime in seconds (e.g., `86400` = 24 hours) |

### Grant Type: `refresh_token` (Token Renewal)

**Request:**
```json
{
  "client_id": "<pathaoClientId>",
  "client_secret": "<pathaoClientSecret>",
  "grant_type": "refresh_token",
  "refresh_token": "<previously obtained refresh_token>"
}
```

**Response:** Same structure as the password grant.

### Token Lifecycle

- After a successful token response, the system stores `accessToken`, `refreshToken`, and computes `expiresAt` as `now + expiresIn` (in UTC ISO 8601 format).
- The access token must be refreshed before it expires. The Settings UI shows a live countdown to expiry.
- If the access token expires, order creation will fail with an authentication error.

---

## 3. Order Creation Endpoint

### Endpoint

```
POST {baseUrl}/aladdin/api/v1/orders
```

### Headers

```
Content-Type: application/json
Accept: application/json
Authorization: Bearer {accessToken}
```

### Request Payload

```json
{
  "store_id": "12345",
  "recipient_name": "John Doe",
  "recipient_phone": "01712345678",
  "recipient_address": "House 12, Road 5, Dhanmondi, Dhaka",
  "delivery_type": 48,
  "item_type": 2,
  "special_instruction": "Call before delivery",
  "item_quantity": 1,
  "item_weight": 0.5,
  "amount_to_collect": 1500
}
```

### Payload Field Details

| Field | Type | Required | Description |
|---|---|---|---|
| `store_id` | string | **Yes** | The Pathao store ID (from `pathaoStoreId` setting) |
| `recipient_name` | string | **Yes** | Customer's full name |
| `recipient_phone` | string | **Yes** | Customer's phone number |
| `recipient_address` | string | **Yes** | Full delivery address |
| `delivery_type` | int | **Yes** | Delivery speed (see enum values below) |
| `item_type` | int | **Yes** | Item category (see enum values below) |
| `special_instruction` | string \| null | No | Delivery notes / special instructions (e.g., "Call before delivery") |
| `item_quantity` | int | **Yes** | Number of items in the parcel |
| `item_weight` | float | **Yes** | Weight of the parcel in kg |
| `amount_to_collect` | int | **Yes** | Cash-on-delivery (COD) amount in BDT (integer, rounded) |

### Where Payload Values Come From

| Payload Field | Source |
|---|---|
| `store_id` | Setting: `pathaoStoreId` |
| `recipient_name` | Order's `processedInfo.name` |
| `recipient_phone` | Order's `processedInfo.phone` |
| `recipient_address` | Order's `processedInfo.address` |
| `delivery_type` | Request body `deliveryType` override, or setting `pathaoDefaultDeliveryType` (default `48`) |
| `item_type` | Request body `itemType` override, or setting `pathaoDefaultItemType` (default `2`) |
| `special_instruction` | Order's `processedInfo.additionalPhone` (if present), otherwise falls back to the `selectedNote` parameter passed by the caller |
| `item_quantity` | Request body `itemQuantity` override, or setting `pathaoDefaultQuantity` (default `1`) |
| `item_weight` | Request body `itemWeight` override, or setting `pathaoDefaultWeight` (default `1.0`) |
| `amount_to_collect` | Order's `cod` field, converted to integer via `round()` with a floor of `0` |

### Delivery Type Values

| Value | Meaning |
|---|---|
| `48` | Normal Delivery (48-hour) — **default** |
| `12` | On Demand Delivery (12-hour) |

### Item Type Values

| Value | Meaning |
|---|---|
| `1` | Document |
| `2` | Parcel — **default** |

### Successful Response (200)

```json
{
  "message": "Order created successfully",
  "data": {
    "consignment_id": "PH-CONS-2024-ABC123",
    "merchant_order_id": "ORD-1001"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `data.consignment_id` | string | Pathao's unique consignment/tracking ID for the shipment |
| `data.merchant_order_id` | string | Echo of the merchant's order reference |

### Error Response (non-2xx)

The raw response body is returned along with the HTTP status code. Common patterns:
- **401 / 403**: Access token expired or invalid — regenerate the token.
- **422**: Validation error — missing or invalid fields in the payload.
- **502**: Upstream Pathao error or network failure.

---

## 4. Complete API Flow Summary

```
┌─────────────────────────────────────────────────────────┐
│                   INITIAL SETUP                         │
│                                                         │
│  1. Configure settings:                                 │
│     - pathaoBaseUrl                                     │
│     - pathaoClientId                                    │
│     - pathaoClientSecret                                │
│     - pathaoUsername                                    │
│     - pathaoPassword                                    │
│     - pathaoStoreId                                     │
│     - (optional defaults: quantity, weight, etc.)       │
│                                                         │
│  2. Generate token:                                     │
│     POST /aladdin/api/v1/issue-token                    │
│     grant_type = "password"                             │
│     → Stores access_token + refresh_token               │
│                                                         │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   ORDER CREATION                        │
│                                                         │
│  POST /aladdin/api/v1/orders                            │
│  Authorization: Bearer {access_token}                   │
│                                                         │
│  Required body fields:                                  │
│    store_id, recipient_name, recipient_phone,           │
│    recipient_address, delivery_type, item_type,         │
│    item_quantity, item_weight, amount_to_collect        │
│                                                         │
│  Optional body field:                                   │
│    special_instruction                                  │
│                                                         │
│  Response → data.consignment_id (tracking number)       │
│                                                         │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   TOKEN REFRESH                         │
│                                                         │
│  When access token is about to expire:                  │
│  POST /aladdin/api/v1/issue-token                       │
│  grant_type = "refresh_token"                           │
│  refresh_token = {stored refresh_token}                 │
│  → Updates stored tokens                                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 5. Validation Rules

### Server-Side (PHP backend) Validation

Before calling the Pathao token endpoint:
- `baseUrl`, `clientId`, `clientSecret` must all be non-empty.
- For `password` grant: `username` and `password` must be non-empty.
- For `refresh_token` grant: `refreshToken` must be non-empty.

Before calling the Pathao order creation endpoint:
- `pathaoBaseUrl`, `pathaoAccessToken`, `pathaoStoreId` must all be non-empty in settings.
- `recipient_name`, `recipient_phone`, `recipient_address` must all be non-empty in the payload.
- If any of these three are missing, the request is rejected with a `400` error before hitting the Pathao API.

### COD Amount

- The `amount_to_collect` is derived from the order's `cod` field.
- It is cast to `int` after `round()`, with a minimum floor of `0` (negative values are clamped to zero).

---

## 6. Database Schema (Pathao-Related Columns in `settings` Table)

```sql
pathao_base_url           VARCHAR/TEXT   -- API base URL
pathao_client_id          VARCHAR/TEXT   -- OAuth2 client ID
pathao_client_secret      VARCHAR/TEXT   -- OAuth2 client secret
pathao_username           VARCHAR/TEXT   -- Merchant username
pathao_password           VARCHAR/TEXT   -- Merchant password
pathao_store_id           VARCHAR/TEXT   -- Store ID
pathao_default_quantity   INT            -- Default item quantity (min 1)
pathao_default_weight     FLOAT          -- Default item weight in kg
pathao_default_delivery_type INT         -- 48 (normal) or 12 (on demand)
pathao_default_item_type  INT            -- 1 (document) or 2 (parcel)
pathao_access_token       VARCHAR/TEXT   -- Current access token
pathao_refresh_token      VARCHAR/TEXT   -- Current refresh token
pathao_token_expires_at   VARCHAR/TEXT   -- ISO 8601 expiry timestamp
```

---

## 7. Error Handling

| Scenario | Behavior |
|---|---|
| Missing credentials in settings | Returns `400` with `"Pathao credentials are not fully configured"` |
| Missing recipient fields | Returns `400` with `"Missing required order field: {field}"` |
| Invalid/expired access token | Pathao returns 401/403; the raw response is passed through with `success: false` |
| Network/timeout error | Caught by PHP exception handler, returns `502` with error details |
| Pathao returns validation error (422) | Raw response body is returned in the `raw` field alongside `success: false` |
| Token endpoint returns missing fields | Returns `502` with `"Pathao token response was missing required fields"` |
| Token endpoint returns invalid (non-JSON) response | Returns `502` with `"Invalid response from Pathao token endpoint"` |

---

## 8. API Endpoints Summary (Internal PHP Wrappers)

| Internal Endpoint | Method | Purpose | Calls Pathao Endpoint |
|---|---|---|---|
| `/api/pathao-token.php` | POST | Generate or refresh OAuth2 token | `POST /aladdin/api/v1/issue-token` |
| `/api/pathao-create-order.php` | POST | Create a new delivery order | `POST /aladdin/api/v1/orders` |
| `/api/settings.php` | GET/PUT | Read/update all Pathao settings | N/A (manages credentials) |

---

## 9. Key Constants & Defaults

| Constant | Value | Description |
|---|---|---|
| Token endpoint path | `/aladdin/api/v1/issue-token` | Appended to `baseUrl` |
| Order endpoint path | `/aladdin/api/v1/orders` | Appended to `baseUrl` |
| Default delivery type | `48` | Normal (48-hour) delivery |
| Default item type | `2` | Parcel |
| Default quantity | `1` | Single item |
| Default weight | `1.0` kg | One kilogram |
