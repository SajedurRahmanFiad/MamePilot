# WhatsApp Business app Coexistence

MamePilot uses Meta Embedded Signup's WhatsApp Business app onboarding flow.
This is the Coexistence flow: the same number remains usable in the WhatsApp
Business mobile app while MamePilot sends and receives Cloud API messages.

## Developer-only Meta configuration

Sign in with the **Developer** role and open the WhatsApp credential settings.
The **Developer setup for WhatsApp login** card accepts the Meta app ID,
Embedded Signup v4 configuration ID, app secret, public HTTPS webhook URL,
verify token, and Graph API version. The app secret and verify token are
write-only: the browser can save replacements and see presence indicators, but
can never read the stored values back. Admin users can operate Embedded Signup
after setup but cannot change these developer-owned credentials.

For deployments managed through server configuration, the same values may be
set in the environment:

```dotenv
WHATSAPP_EMBEDDED_SIGNUP_APP_ID=<Meta app ID>
WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID=<Facebook Login for Business configuration ID>
WHATSAPP_APP_SECRET=<Meta app secret>
WHATSAPP_GRAPH_VERSION=v25.0
WHATSAPP_WEBHOOK_URL=https://<deployment>/api/whatsapp-webhook.php
WHATSAPP_VERIFY_TOKEN=<long random value also entered in Meta App Dashboard>
```

Non-empty environment values take precedence over saved database values and the
corresponding fields are shown as environment-managed in Developer settings.

The Meta app must have WhatsApp configured, Facebook Login for Business with the
deployment domain allowed, and a Coexistence-enabled **Embedded Signup v4**
configuration. Meta's current versions guide says v4 is the latest version and
that v2 is deprecated on October 15, 2026. The popup therefore leaves the v4
`extras` object empty instead of using the legacy `sessionInfoVersion` option.
Meta requires the onboarding integration to be used by an approved Solution
Partner or Tech Provider. The business's WhatsApp Business app must meet Meta's
currently documented minimum version (2.24.17 or newer at the time this
integration was implemented).

Configure the Meta app's default WhatsApp webhook callback to the same HTTPS
URL and verify token, and subscribe it to `account_update` as well as the normal
message fields. Meta does not support callback overrides for `account_update`;
it always sends disconnect events to the app's default callback. This package
therefore assumes the deployment's Meta app default callback points to this
deployment (or that an external central callback securely forwards the event).

## Runtime flow

1. An administrator clicks **Open WhatsApp login**. The browser launches
   Facebook Login for Business with `response_type=code`,
   `override_default_response_type=true`, and the empty `extras` object required
   by Embedded Signup v4. The Meta configuration itself enables WhatsApp
   Business app user onboarding.
2. The Meta popup returns a one-time code and a `WA_EMBEDDED_SIGNUP` finish event
   containing the WABA ID. MamePilot sends both to the authenticated backend.
3. The backend exchanges the code at `GET /oauth/access_token` using the
   developer-only app ID and secret, discovers the phone number, subscribes the
   WABA, and supplies `override_callback_uri` plus the deployment verify token.
4. The backend verifies `is_on_biz_app=true` and `platform_type=CLOUD_API`. It
   deliberately skips the normal `/register` PIN call because a Coexistence
   number is already registered.
5. MamePilot requests the one-time `smb_app_state_sync` and `history` syncs. Meta
   may send zero or more history webhooks when the business declines history
   sharing. These requests must be started within 24 hours and cannot be
   repeated unless the business offboards and onboards again.

## Troubleshooting the settings card

If the card shows a Meta **Test Number** or says that a Cloud API-only number is
saved, the deployment still contains credentials from the older manual Cloud
API setup. That does not mean WhatsApp Business app Coexistence is connected.
Complete Embedded Signup with the intended existing Business app number.

The Meta app ID, app secret, Embedded Signup configuration ID, webhook URL, and
verify token are developer-owned deployment settings. A Developer can enter
them in the protected setup card, or manage them through server environment
values. If any are missing, the login button reports the exact missing setup
instead of silently doing nothing.

## Webhook fields

The webhook handler accepts normal `messages` and delivery statuses plus
`history`, `smb_app_state_sync`, `smb_message_echoes`, and `account_update`.
Messages sent from the WhatsApp Business mobile app arrive as
`smb_message_echoes` and are stored as outbound messages in the same thread.
The handler deduplicates message IDs and does not mark historical messages as
new unread conversations.

Meta documents that a business can disconnect from Cloud API in WhatsApp
Business mobile settings; the backend records the `PARTNER_REMOVED` account
update when the Meta app's default callback is routed here, and the
administrator must use Embedded Signup again to reconnect.

## Official references

- [Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/)
- [Embedded Signup versions](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions/)
- [Embedded Signup v4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4/)
- [Onboard Business app users (Coexistence)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)
- [Onboard customers as a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/)
- [Webhook overrides](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override/)

## Live verification checklist

After setting the developer environment and deploying the package, test with a
real eligible WhatsApp Business account: complete the Meta popup and mobile
**Connect to the Business Platform** prompt; verify the settings card reports
both Business app and Cloud API; confirm contact/history webhooks; send a text
from the mobile app and confirm its `smb_message_echoes` copy appears in the
same MamePilot thread; send a Cloud API message and verify delivery/read
statuses; test media and approved templates; and finally confirm disconnect
handling. A local build cannot prove Meta eligibility, app review, mobile QR
handoff, or real provider delivery without those credentials and a live test
number.
