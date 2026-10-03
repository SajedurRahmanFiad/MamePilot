# Web Push / VAPID Setup Guide for Beginners

This guide explains how to configure browser push notifications for Messenger and WhatsApp in this project.

The app checks for VAPID values at runtime in [backend/src/ChatPushService.php](../backend/src/ChatPushService.php). If any of the required values are missing, the app shows the message:

> Browser push is not configured on this server.

That message means the server is missing the VAPID configuration needed to authenticate push requests.

---

## 1) What is VAPID?

VAPID means Voluntary Application Server Identification.

It is a security system used by browser push notifications. It lets your server prove that it is an authorized sender before the browser push service delivers a notification.

Think of it like this:

- the browser push service is the post office
- your backend server is the sender
- VAPID is the sender ID and signed certificate that proves the message is genuine

Without VAPID, the push service will reject the notification.

---

## 2) What values are required?

Your backend must have these three environment variables set in the deployment `.env` file:

```env
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
WEB_PUSH_VAPID_SUBJECT=
```

### `WEB_PUSH_VAPID_PUBLIC_KEY`
- This is the public key.
- It is sent to the browser during subscription registration.
- It is safe to expose in the browser.

### `WEB_PUSH_VAPID_PRIVATE_KEY`
- This is the private key.
- It stays only on the server.
- It is used to sign push requests.
- Keep this secret.

### `WEB_PUSH_VAPID_SUBJECT`
- This identifies the sender.
- Use either:
  - a valid email: `mailto:admin@yourdomain.com`
  - or a URL: `https://yourdomain.com`

A common value is:

```env
WEB_PUSH_VAPID_SUBJECT=mailto:admin@yourdomain.com
```

---

## 3) Prerequisites

Before you configure VAPID, make sure these are true:

### HTTPS is required
Browser push works only on secure contexts, usually HTTPS in production.

- Localhost is often allowed for development
- Real production use should be on HTTPS

### Backend dependencies are installed
This project already includes the Web Push PHP library.

If needed, install it with:

```bash
cd backend
composer install
```

### The app is deployed and the backend is running
Your server must be able to read the `.env` file and run PHP.

---

## 4) Generate the VAPID keys

From the project root, run:

```bash
php -r "require 'backend/vendor/autoload.php'; echo json_encode(Minishlink\WebPush\VAPID::createVapidKeys(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), PHP_EOL;"
```

If this fails in your current PHP/Windows setup because the EC key cannot be created, use the fallback instead:

```bash
npx web-push generate-vapid-keys
```

This returns a JSON object like:

```json
{
  "publicKey": "...",
  "privateKey": "..."
}
```

Example output:

```json
{
  "publicKey": "BPLt4pVb4QX1jB0OUY0b5bW1mS9mI4Y5wQ7JZ9Yv6iUQ6nVQwVxN3b0zE7U0G0zXh0m5zT7r0uYB0dN9k8s=",
  "privateKey": "7uB3RrO0uQ1M4fXQii5Q8sX7E9mK2s0H3x0tLqH1l0w="
}
```

Keep the `privateKey` secret and do not expose it in the frontend.

---

## 5) Update the backend environment file

Open your backend `.env` file and add:

```env
WEB_PUSH_VAPID_PUBLIC_KEY=PASTE_PUBLIC_KEY_HERE
WEB_PUSH_VAPID_PRIVATE_KEY=PASTE_PRIVATE_KEY_HERE
WEB_PUSH_VAPID_SUBJECT=mailto:admin@yourdomain.com
```

If you are using an example file, it is already scaffolded in [.env.example](../.env.example).

Example:

```env
WEB_PUSH_VAPID_PUBLIC_KEY=BNyL4t8d4u9gD2Hk5u7U2T8zsA0uK8mC1n6p4gE8sV2M=
WEB_PUSH_VAPID_PRIVATE_KEY=JY7sG7nT0fQ3d6n4b7uH5uF9j5uK8mL2W6iN0sM7xQ0=
WEB_PUSH_VAPID_SUBJECT=mailto:admin@yourdomain.com
```

Important:
- the public key is not secret
- the private key must stay server-side
- the subject should match your contact or domain

---

## 6) Restart the backend service

After editing the env file, restart the PHP backend process or reload the environment.

If you run the PHP app with a local server, restart it.

For example:

```bash
php -S 127.0.0.1:8001 -t backend/public
```

or restart your deployment service.

---

## 7) Make sure the frontend service worker is available

This project includes the browser push service worker at:

- [public/service-worker.js](../public/service-worker.js)

A production build must include this file. The app uses it to display the push notification when the browser receives a push.

When the site is built, it should output a service worker in the final build output.

---

## 8) Deploy to HTTPS

For real browser push on a live site, the app must be served over HTTPS.

This is required because browser push APIs depend on secure origin rules.

Examples:
- `https://yourdomain.com`
- `https://dashboard.yourdomain.com`

Do not rely on plain HTTP for production push.

---

## 9) Open the app and enable permissions

In the browser:

1. open the app
2. log in
3. open Messenger settings or WhatsApp settings
4. turn on the browser push toggle
5. when prompted, click Allow for notifications

This creates a push subscription and sends it to the backend.

---

## 10) What happens after enabling the toggle?

When the user turns on the toggle:

- the browser creates a push subscription
- it includes:
  - endpoint
  - p256dh key
  - auth secret
- the frontend sends that subscription to the backend
- the backend stores it in the `chat_push_subscriptions` table
- the user is now eligible to receive push notifications for that chat channel

This is implemented in [backend/src/ChatPushService.php](../backend/src/ChatPushService.php).

---

## 11) Test with a real incoming message

After configuration is complete:

1. make sure the browser tab is not focused or is in the background
2. send a real inbound message from Messenger or WhatsApp
3. wait a few seconds
4. the browser should display a push notification
5. clicking the notification should open the relevant conversation

If the app is already open on that conversation, the behavior may be suppressed in order to avoid duplicate notifications.

---

## 12) What if the app still says “push delivery is not configured”? 

This usually means one of the following:

### Problem 1: VAPID keys are missing
Check the backend `.env` file:

```env
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
WEB_PUSH_VAPID_SUBJECT=
```

If one of them is empty, the app treats push as disabled.

### Problem 2: the private key is wrong or copied incorrectly
Make sure:
- there are no extra spaces or quotes around the key
- the values are pasted exactly
- there is no accidental newline or truncation

### Problem 3: the app is not reading the new environment values
Restart the backend service after saving `.env`.

### Problem 4: HTTPS is missing
The browser will not fully allow push in an insecure environment.

---

## 13) Troubleshooting checklist

Use this list before blaming the app code:

- [ ] site is served over HTTPS
- [ ] backend `.env` has all 3 VAPID vars
- [ ] `WEB_PUSH_VAPID_PRIVATE_KEY` is not empty
- [ ] `WEB_PUSH_VAPID_SUBJECT` is valid
- [ ] backend was restarted after changes
- [ ] browser permission was granted
- [ ] service worker is registered
- [ ] messenger/whatsapp toggle is enabled

---

## 14) The most important rule

A push notification system will not work in production if the server has no valid VAPID credentials.

This project is already prepared for it, but the real live values must be supplied in the server environment.

---

## 15) Recommended production setup

For a real deployment, use:

```env
WEB_PUSH_VAPID_PUBLIC_KEY=YOUR_PUBLIC_KEY
WEB_PUSH_VAPID_PRIVATE_KEY=YOUR_PRIVATE_KEY
WEB_PUSH_VAPID_SUBJECT=mailto:admin@yourdomain.com
```

Keep:
- private key on the server only
- subject as your contact or domain
- a stable key pair for the deployment

If the keys change, users may need to re-enable notification permissions on their device.

---

## 16) Final summary

To enable push notification delivery in this app:

1. generate VAPID keys
2. put them in the backend `.env`
3. set a valid `WEB_PUSH_VAPID_SUBJECT`
4. run the app on HTTPS
5. open the site and allow notification permission
6. turn on Messenger or WhatsApp push in settings
7. send a real inbound message to test it

Once those steps are complete, the app is ready to deliver real browser push notifications.
