# PipraPay Setup Guidelines

## 1. Gateway configuration
- Open the developer settings payment gateway tab.
- Fill in the PipraPay base URL and API key provided by the gateway provider.
- Use the base URL without the trailing /api segment; the integration will add the required route suffix automatically.

## 2. Redirect checkout flow
- When the user clicks the subscription checkout button, the app sends a POST request to:
  - /api/checkout/redirect
- The request must include:
  - `full_name`
  - `email_address`
  - `mobile_number`
  - `amount`
  - `currency` with value `BDT`
  - `metadata` as a JSON string containing the plan name, payment datetime, and payment period (monthly or yearly)
  - `return_url` set to `/#/subscriptions` for HashRouter-based deployments
  - `webhook_url` pointing to the webhook endpoint for payment updates
- The gateway returns a `pp_id` and `pp_url`.
- The app should redirect the user to `pp_url` and temporarily keep `pp_id` for later verification.

## 3. Webhook handling
- The gateway sends a webhook payload for each transaction.
- The webhook endpoint should accept JSON input and respond with HTTP 200.
- A basic PHP example:

```php
<?php
$data = json_decode(file_get_contents('php://input'), true);
http_response_code(200);

if ($data) {
    $status = $data['status'] ?? 'unknown';
    $ppId = $data['pp_id'] ?? null;
    echo json_encode(['status' => 'ok']);
} else {
    echo json_encode(['status' => 'error', 'message' => 'Invalid payload']);
}
```

## 4. Payment verification
- After the user returns from the gateway, or when the webhook arrives, call the verification endpoint:
  - /api/verify-payment
- The request must include the PipraPay payment id as `pp_id`.
- The response should be checked for a completed payment before updating the subscription.

## 5. Recommended implementation behavior
- Save the local subscription reference and the gateway payment id in the local payment record.
- On verification success, mark the payment as approved and extend the subscription.
- On verification failure or cancellation, mark the payment as failed or canceled and keep the subscription in a non-renewed state.
- Log webhook and verification responses for debugging and reconciliation.

## 6. Handling payment outcomes explicitly
- If the verification response returns `pending`, leave the payment record as `processing` and retry verification later.
- If the verification response returns `completed` (or equivalent success values), update the local payment row to `approved`, mark it processed, and extend the subscription.
- If the verification response returns `failed`, update the local payment row to `failed`, mark it processed, and stop the renewal flow.
- If the verification response returns `canceled` (single `l`), update the local payment row to `canceled`, mark it processed, and show that the user cancelled the payment.
- If the verification response returns anything else, update the local payment row to `error`, mark it processed, and show a fallback message telling the user to contact the Mame Studios team for assistance.
