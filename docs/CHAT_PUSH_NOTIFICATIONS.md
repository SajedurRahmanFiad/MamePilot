# Chat Push Notifications

Messenger and WhatsApp push notifications are sent by the backend after a verified webhook stores a new inbound message. The browser does not need to remain open; its service worker is started by the browser's push service when a notification arrives.

## Deployment Setup

Each deployment needs its own VAPID key pair. Generate one from the repository root after Composer dependencies are installed:

```powershell
php -r "require 'backend/vendor/autoload.php'; echo json_encode(Minishlink\WebPush\VAPID::createVapidKeys(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), PHP_EOL;"
```

If PHP cannot generate the EC key in your current runtime, use the Node fallback instead:

```powershell
npx web-push generate-vapid-keys
```

Add the returned `publicKey` and `privateKey` to the deployment's backend `.env` as `WEB_PUSH_VAPID_PUBLIC_KEY` and `WEB_PUSH_VAPID_PRIVATE_KEY`. Set `WEB_PUSH_VAPID_SUBJECT` to a valid `mailto:` contact or an HTTPS URL. Keep the private key server-only and stable; replacing it requires users to enable push again on each device.

Deploy the frontend build (including `service-worker.js`) and backend Composer dependencies, then run the standard database migrations. Push requires HTTPS. Users enable Messenger and WhatsApp notifications independently from each channel's settings; browser permission is requested only after they turn a switch on.

## Browser Notes

- Desktop Chromium, Firefox, and Safari support depends on current browser and operating-system versions.
- On iPhone and iPad, web push requires a supported iOS/iPadOS version and the site added to the Home Screen.
- Notifications include the customer's name and up to 120 characters of message preview. Device-level operating-system notification settings may still hide or expose previews.
- Turning off a channel switch disables delivery for that channel on the current browser subscription; the other channel remains independent.