# Connect an existing WhatsApp Business app to MamePilot

This guide explains the complete setup in plain language. It covers the Meta
app, the WhatsApp Business mobile app, the MamePilot settings, the webhook, the
first connection, testing, and the most common mistakes.

The feature is officially called **WhatsApp Business app onboarding**. It is
also commonly called **Coexistence**. Coexistence means the same business phone
number works in both places:

- staff can continue using the WhatsApp Business mobile app;
- MamePilot can send and receive messages through Meta's Cloud API;
- supported one-to-one messages can be mirrored between both places.

This document reflects Meta's Embedded Signup v4 instructions available on
August 6, 2026. Meta's current implementation guide uses Graph API `v26.0`.

## The exact cause of the “connected, but no WhatsApp account returned” error

There are two different things in Meta that look very similar:

1. a general **Facebook Login for Business** connection, which can connect a
   business portfolio, Facebook Page, ad account, catalog, or other asset; and
2. a **WhatsApp Embedded Signup** connection, which returns a WhatsApp Business
   account and starts the WhatsApp Business mobile confirmation.

If the popup says something like **“PRETTYPICK has been connected to MamePilot
WP”**, but only asked for a portfolio or Page and never offered the existing
WhatsApp Business account, Meta completed the first kind of connection. It did
not complete WhatsApp Business app onboarding.

That produces this MamePilot error:

> Meta returned authorization but did not return the selected WhatsApp
> business account.

The problem can have two parts:

- **Code issue:** the website must launch Meta with
  `featureType=whatsapp_business_app_onboarding` and session logging version
  `3`. MamePilot now supplies both values.
- **Meta setup issue:** the Configuration ID saved in MamePilot must belong to
  a real WhatsApp Embedded Signup configuration. A generic portfolio/Page
  configuration will still open and authorize, but it will not return a
  WhatsApp Business account.

Both parts must be correct. Updating MamePilot fixes the first part. The Meta
Dashboard steps in this guide fix the second part.

## Do not wait for a QR code

Meta's current flow normally shows a **verification code** in the browser.
Inside WhatsApp Business, an official Facebook Business message asks the
business to connect to the Business Platform. The person completing the setup
taps the buttons in that message and pastes the browser's verification code.

The mobile screen may offer **Scan QR code instead**, but the QR code is only an
alternative. A connection is not broken merely because no QR code appeared.
It is broken when the popup never offers the existing WhatsApp Business account
or the phone receives no official connection message.

## Before starting

Prepare all of the following first.

### People and access

- One person must have the **Developer** role in MamePilot. Only a Developer
  can save the Meta app ID, app secret, Configuration ID, and webhook security
  values.
- The person opening the Meta popup must be an administrator of the intended
  Meta business portfolio and WhatsApp Business account.
- The Meta app must belong to the correct developer/business organization.
- For a test while the Meta app is still in Development mode, add the tester's
  Facebook account under **App roles** as an Administrator or Developer.

### Provider eligibility

Meta currently requires the onboarding provider to already be a **Solution
Partner** or **Tech Provider**. This is a Meta account/business requirement;
MamePilot cannot approve it automatically.

For normal customers outside the app's own test roles, the Meta app also needs
the required business verification, permission review/advanced access, and
Live mode approval. A Developer-role test can be performed earlier, but a
successful private test does not prove the app is approved for every customer.

### The phone and mobile app

- The number must be active in the **WhatsApp Business** app, not the normal
  consumer WhatsApp app.
- Update WhatsApp Business before starting. Meta currently requires version
  `2.24.17` or newer for this feature.
- Keep the phone online, unlocked, and near the person completing the browser
  flow.
- Make sure the person can open messages from the official **Facebook
  Business** account in WhatsApp Business.
- Back up important chats before changing a production number.

### Important changes after Coexistence is enabled

Explain these points to the business before connecting:

- one-to-one chats remain available in the mobile app and can be mirrored;
- group chats are not sent to MamePilot;
- Cloud API messages still follow Meta's 24-hour customer-service-window and
  template rules;
- broadcasts cannot be newly created in the Business app after onboarding, and
  existing broadcast lists become read-only;
- disappearing messages and view-once messages are disabled for one-to-one
  chats;
- live-location messages are not supported through Cloud API;
- current linked companion devices are unlinked during onboarding and supported
  devices must be linked again afterward;
- Meta's current guide says WhatsApp for Windows and WearOS are not supported
  companion clients for this Coexistence behavior;
- messages sent through the WhatsApp Business app remain free under the mobile
  app behavior, while messages sent through Cloud API use Cloud API pricing;
- the Coexistence phone has Meta's documented fixed throughput limit of 20
  messages per second.

### Website requirements

- MamePilot must already be running on a public `https://` address.
- The SSL certificate must be valid. A local address such as `localhost` is not
  enough for the real provider flow.
- The public webhook URL must be reachable without logging in to MamePilot.
- Popups and cross-site tracking must not be blocked for the MamePilot site and
  Facebook during the test.

## Values to prepare

Use a simple worksheet before configuring anything:

| Item | Example | Where it comes from |
| --- | --- | --- |
| MamePilot website | `https://app.example.com` | Your deployed MamePilot URL |
| Settings page | `https://app.example.com/settings?tab=whatsapp` | MamePilot |
| Webhook URL | `https://app.example.com/api/whatsapp-webhook.php` | MamePilot deployment |
| Meta App ID | Numeric value | Meta App Dashboard header / Basic settings |
| Meta App Secret | Secret value | Meta App Dashboard > App settings > Basic |
| Embedded Signup Configuration ID | Numeric value | Facebook Login for Business > Configurations |
| Webhook verify token | A private random phrase | You create it and use the exact same value in both systems |
| Graph API version | `v26.0` | Current version used by this integration |

Never send the Meta App Secret, business access token, or webhook verify token
in chat, screenshots, tickets, or public documents.

## Part 1 — Create or prepare the Meta app

Meta changes menu positions occasionally, but the names below are the important
part.

1. Sign in at [Meta for Developers](https://developers.facebook.com/apps/).
2. Open the app that MamePilot will use, or create an app for this integration.
3. Confirm that the app is owned by the intended business and that the app's
   contact email, privacy-policy URL, and data-deletion information are filled
   in as required by Meta.
4. Add or configure the **WhatsApp** product.
5. Add or configure **Facebook Login for Business**. Do not use ordinary
   consumer Facebook Login as the Embedded Signup configuration.
6. In **App settings > Basic**, copy the numeric **App ID** to the worksheet.
7. In the same area, reveal and copy the **App Secret** only when ready to save
   it securely in MamePilot.

If Meta does not show WhatsApp Embedded Signup templates or Coexistence options,
stop here. Check that the app/business is recognized as an eligible Tech
Provider or Solution Partner. A Page connection cannot substitute for provider
eligibility.

## Part 2 — Allow the MamePilot website to use Meta login

1. In the Meta App Dashboard, open **Facebook Login for Business > Settings**.
2. Find **Client OAuth settings**.
3. Turn on the settings Meta's current Embedded Signup guide requires:
   **Client OAuth Login**, **Web OAuth Login**, **Enforce HTTPS**,
   **Embedded Browser OAuth Login**, **Use Strict Mode for Redirect URIs**, and
   **Login with the JavaScript SDK**.
4. In **Allowed domains for the JavaScript SDK** or **Allowed domains**, add the
   MamePilot host name. For example, add `app.example.com` without a path.
5. In **Valid OAuth Redirect URIs**, add the exact secure MamePilot locations
   from which the popup can be opened. For this application, include at least:
   `https://app.example.com/` and
   `https://app.example.com/settings?tab=whatsapp`.
6. If the Meta App Dashboard also has an **App Domains** field under
   **App settings > Basic**, add `app.example.com` there too.
7. Save the changes.

Use the real deployed host name. Do not enter `localhost`, an IP address with no
valid certificate, `http://`, or a different staging domain unless that exact
domain will also be used for testing.

## Part 3 — Create the correct Embedded Signup configuration

This is the most important setup step for the reported problem.

1. Open **Facebook Login for Business > Configurations**.
2. Choose **Create from template**.
3. Select the template named exactly or very similarly to:
   **WhatsApp Embedded Signup Configuration With 60 Expiration Token**.
4. Give the configuration a clear name, for example
   `MamePilot WhatsApp Coexistence v4`.
5. If Meta asks for the login variation, choose
   **WhatsApp Embedded Signup**.
6. Select Embedded Signup **version 4**.
7. Request only assets and permissions that MamePilot actually needs for
   WhatsApp. Do not add Facebook Pages, ad accounts, catalogs, datasets, or
   Instagram accounts just because they are available.
8. The common required permissions are the WhatsApp business management and
   messaging permissions, plus business management where Meta's template
   requires it. Use the template defaults unless a reviewed provider setup has
   a specific reason to change them.
9. Finish creating the configuration.
10. Copy the numeric **Configuration ID**. This is not the App ID, business
    portfolio ID, Page ID, WABA ID, or phone number ID.

If a custom configuration is used instead of the template, it must still use
the **WhatsApp Embedded Signup** login variation. A generic Facebook Login for
Business configuration is not sufficient.

### Quick test for a wrong configuration

The configuration is probably wrong if the popup primarily asks the user to
select a Facebook Page, ad account, catalog, or general portfolio and then says
the portfolio has been connected. The correct Coexistence flow offers an option
to connect the existing WhatsApp Business app account and phone number.

## Part 4 — Prepare the MamePilot webhook

The webhook is the public delivery address where Meta sends inbound messages,
message statuses, mobile-app echoes, contacts, history, and disconnect events.

1. Choose a private webhook verify token. It can be a long random phrase. Do
   not use the Meta App Secret as this token.
2. Build the webhook URL from the deployed MamePilot address. A normal cPanel
   deployment uses:
   `https://YOUR-DOMAIN/api/whatsapp-webhook.php`.
3. Sign in to MamePilot as a **Developer**.
4. Open **Settings > WhatsApp**.
5. In **Developer setup for WhatsApp login**, enter:
   - **Meta app ID** — the numeric App ID;
   - **Embedded Signup v4 configuration ID** — the ID from Part 3;
   - **Meta app secret** — the secret from Meta App settings;
   - **Webhook verify token** — the new private token;
   - **Public HTTPS webhook URL** — the public URL from step 2;
   - **Meta Graph API version** — `v26.0`.
6. Click **Save login setup**.
7. Wait for the server-confirmed success message.
8. The App Secret and verify-token boxes become blank after saving. This is
   intentional. Confirm that both show **Saved securely on the server**.

If a field says **Managed by the server environment**, change that value in the
deployment environment instead of the browser. Non-empty environment values
take priority over database values.

The equivalent environment entries are:

```dotenv
WHATSAPP_EMBEDDED_SIGNUP_APP_ID=<Meta App ID>
WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID=<WhatsApp Embedded Signup Configuration ID>
WHATSAPP_APP_SECRET=<Meta App Secret>
WHATSAPP_GRAPH_VERSION=v26.0
WHATSAPP_WEBHOOK_URL=https://<deployment>/api/whatsapp-webhook.php
WHATSAPP_VERIFY_TOKEN=<private value used in Meta too>
```

Do not set the old `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, or
`WHATSAPP_BUSINESS_ACCOUNT_ID` values for a new Embedded Signup connection.
MamePilot receives and stores those values automatically after a successful
connection. Those environment fields exist only for older manual Cloud API
deployments.

## Part 5 — Configure and verify the webhook in Meta

Save the MamePilot values before asking Meta to verify the callback; otherwise
MamePilot does not yet know the verify token Meta will send.

1. Return to the Meta App Dashboard.
2. Open **WhatsApp > Configuration**.
3. In the webhook section, choose **Edit** or **Configure**.
4. Paste the exact MamePilot webhook URL.
5. Paste the exact same webhook verify token saved in MamePilot.
6. Click **Verify and save**.
7. Subscribe the WhatsApp Business account webhook to the normal message field
   and all Coexistence fields MamePilot needs:
   - `messages`;
   - `history`;
   - `smb_app_state_sync`;
   - `smb_message_echoes`;
   - `account_update`.
8. Keep the app's default callback pointed at this deployment. Meta sends
   important mobile disconnect/offboarding account updates to the app's default
   callback, even when a WABA-specific callback override is used for other
   message delivery.

After Embedded Signup finishes, MamePilot also subscribes the selected WABA and
sets the deployment callback automatically. The default callback still matters
for account updates.

If Meta cannot verify the callback:

- compare both tokens character by character;
- confirm the URL begins with `https://`;
- confirm there is no firewall, maintenance page, login redirect, or bot
  protection in front of the webhook;
- confirm the deployed package includes
  `/api/whatsapp-webhook.php`;
- confirm the App Secret in MamePilot belongs to the same Meta App ID.

## Part 6 — Permissions, review, and app mode

For a private provider test:

1. Keep the app in Development mode if desired.
2. Add the Facebook account doing the test as an app Administrator or Developer.
3. Use a business and WhatsApp account that this person genuinely administers.

For real customer onboarding:

1. Complete Meta business verification for the app owner.
2. Complete any required Tech Provider/Solution Partner onboarding.
3. Request advanced access/app review for the permissions used by the WhatsApp
   Embedded Signup template, including the applicable WhatsApp business
   management and messaging permissions.
4. Supply the privacy policy, data deletion instructions, review video, and
   reviewer test steps Meta requests.
5. Switch the app to Live mode only after the review requirements are met.

MamePilot cannot turn a Meta app into an approved Tech Provider, pass App Review,
or change the Meta app to Live mode. These are owner-controlled Meta Dashboard
actions.

## Part 7 — Connect the existing WhatsApp Business number

Use a desktop browser for MamePilot and keep the business phone beside you.

1. On the phone, update and open **WhatsApp Business**.
2. On the computer, sign in to MamePilot as an Admin or Developer.
3. Open **Settings > WhatsApp**.
4. Confirm the page does not say that login setup is missing.
5. Click **Open WhatsApp login**.
6. Allow the popup if the browser asks.
7. Sign in to Meta using the account that administers the intended business.
8. Select the correct business portfolio.
9. Choose the option to connect the **existing WhatsApp Business app** account
   and enter/select its phone number.
10. Meta normally displays a verification code in the browser. Keep this popup
    open and copy the code.
11. On the phone, wait for a message from the official **Facebook Business**
    account in WhatsApp Business.
12. Open that message and tap **Connect**.
13. Tap **Connect to the Business Platform**.
14. Tap **Confirm** when WhatsApp asks about connecting and chat-history choice.
15. Paste the verification code shown in the browser. If the phone offers
    **Scan QR code instead** and the browser shows a QR option, that alternative
    can be used, but it is not required.
16. Choose whether to share chat history. Declining history sharing does not
    cancel the connection; it only prevents old chat history from being sent to
    MamePilot.
17. Complete the remaining Meta screens.
18. Click **Finish** in the popup.
19. Keep WhatsApp Business open and online while MamePilot finishes onboarding
    and begins synchronization.

The correct successful MamePilot state says:

> WhatsApp Business app + Cloud API are connected.

MamePilot then stores the provider token and asset IDs, discovers the phone,
subscribes the WABA, confirms that the phone is still on the Business app, and
requests the one-time contact and history synchronization.

## Part 8 — What MamePilot does automatically

After the browser returns both the one-time authorization code and the WhatsApp
Business account ID, MamePilot automatically:

1. exchanges the short-lived code for a server-side business token;
2. saves the token without exposing it to the browser;
3. finds the selected WhatsApp Business phone number;
4. saves the WABA ID and phone number ID;
5. subscribes the WABA to the deployment webhook;
6. verifies `is_on_biz_app=true` and `platform_type=CLOUD_API`;
7. avoids the normal phone-registration PIN call because the existing Business
   app number is already registered;
8. requests the one-time contact sync;
9. requests up to 180 days of supported message history if the business agreed
   to share it;
10. stores new Business-app-sent messages from `smb_message_echoes` in the same
    MamePilot conversation.

The code returned by Meta lasts only about 30 seconds. Do not pause after the
final Meta screen or close the MamePilot page while it is finishing.

## Part 9 — Verify the connection completely

Do not consider setup complete just because the popup says Connected.

### Check the MamePilot settings card

1. The status must say **WhatsApp Business app + Cloud API are connected**.
2. The intended business display name and phone number must be shown.
3. Click **Verify connection**.
4. It must confirm Coexistence, not only Cloud API access.
5. The page should eventually show a recent **Last message delivery** time after
   a webhook is received.

### Test an inbound message

1. Use a separate personal WhatsApp number.
2. Send a new message to the business number.
3. Confirm the conversation appears in MamePilot without refreshing repeatedly.
4. Confirm the same conversation remains visible in WhatsApp Business.

### Test an outbound mobile message

1. Reply from the WhatsApp Business mobile app.
2. Confirm the customer receives it.
3. Confirm a matching outbound message appears in the MamePilot thread. This
   proves the `smb_message_echoes` subscription works.

### Test an outbound MamePilot message

1. Reply from MamePilot while the Cloud API customer-service window is open.
2. Confirm the customer receives it.
3. Confirm the message status advances to sent/delivered/read when appropriate.
4. Confirm the message is mirrored in the supported Business app chat.

### Test contacts and history

1. Keep WhatsApp Business open and online.
2. Allow several minutes for larger accounts.
3. Confirm contacts arrive in MamePilot.
4. If chat history was shared, confirm old supported one-to-one messages appear.
5. If history was declined, expect no old history; this is not a connection
   failure.

### Test media and templates

1. Send a supported image/document from MamePilot.
2. Send an image from WhatsApp Business and confirm the webhook copy is handled.
3. Outside the 24-hour customer-service window, send an approved Meta template
   and confirm delivery.

## Repair the currently failed PRETTYPICK attempt

Use these exact recovery steps:

1. Deploy the MamePilot version containing the Coexistence launch fix.
2. In Meta, open **Facebook Login for Business > Configurations**.
3. Do not reuse the configuration that only asks for the portfolio/Page.
4. Create a new configuration from
   **WhatsApp Embedded Signup Configuration With 60 Expiration Token**.
5. Confirm its variation is **WhatsApp Embedded Signup** and its version is v4.
6. Copy the new Configuration ID.
7. In MamePilot, sign in as Developer and open **Settings > WhatsApp**.
8. Replace only the **Embedded Signup v4 configuration ID** with the new ID.
9. Confirm App ID, App Secret, webhook URL, verify token, and Graph version
   `v26.0` are still correct.
10. Click **Save login setup** and wait for the server confirmation.
11. Clear any popup blocker for the MamePilot domain.
12. Open WhatsApp login again.
13. The correct screen must offer the existing WhatsApp Business app account.
14. Follow the verification-code/mobile-message steps in Part 7.

The earlier generic portfolio/Page authorization does not supply MamePilot with
a WABA, so it cannot be converted into a WhatsApp connection by clicking Finish
again. Run the correct WhatsApp flow from the beginning.

## Troubleshooting by symptom

### The popup only connects a portfolio or Page

Cause: the saved Configuration ID is generic, or the website is still running
old code without the Coexistence launch extras.

Fix: deploy the corrected MamePilot build and create a new Configuration ID from
the WhatsApp Embedded Signup template. Do not add unnecessary Page/ad assets.

### MamePilot says authorization returned but no WhatsApp account returned

Cause: Meta returned the login code but no `WA_EMBEDDED_SIGNUP` finish event
with `waba_id`. This normally means the WhatsApp flow did not actually run.

Fix: verify the template/variation, v4, allowed domain, valid redirect URI,
JavaScript SDK login toggle, popup/tracking permissions, and the corrected
MamePilot deployment.

### No QR code appears

This alone is not an error. Use the verification code. Open the official
Facebook Business message inside WhatsApp Business, tap Connect, tap Connect to
the Business Platform, and paste the code. Use QR only if Meta offers it.

### No official Facebook Business message arrives on the phone

- confirm the number is in WhatsApp Business, not consumer WhatsApp;
- update WhatsApp Business;
- confirm the exact number was selected in Meta;
- keep the primary phone online;
- restart the flow and do not finish a generic portfolio/Page connection;
- confirm the provider/app is eligible for Coexistence.

### Meta says the app is connected, but MamePilot still is not

The word “connected” in Meta can describe only the general business login. The
MamePilot status must show the actual phone and confirm Business app + Cloud API.
If it does not, run **Verify connection** and inspect the persistent error on the
settings card.

### The popup closes without authorization

Allow popups and cross-site tracking for both the MamePilot domain and Facebook.
Try a current Chrome or Edge window without strict privacy extensions. Confirm
the domain and exact settings URL are allowed in Facebook Login for Business.

### Meta rejects the redirect or says the URL is not allowed

Add the exact HTTPS host to **Allowed domains**, add the exact Settings URL to
**Valid OAuth Redirect URIs**, turn on **Login with the JavaScript SDK**, and
make sure the App ID in MamePilot matches the app being edited.

### Webhook verification fails

Confirm the callback URL and token are identical in both systems. Save them in
MamePilot first. Remove maintenance/login protection from only the public
webhook endpoint, keep HTTPS valid, and ensure the cPanel package contains the
webhook PHP file.

### A Meta test number or Cloud API-only number appears

That is a legacy/manual connection, not Coexistence. Open WhatsApp login and
complete the existing Business app option for the intended production number.

### More than one phone is returned

Choose the intended phone inside the Meta flow. Avoid configurations that allow
irrelevant or multiple WABA assets unless the product intentionally supports a
multi-WABA selection workflow.

### Contact or history synchronization is empty

- history may be empty because the business declined sharing;
- the business app must remain online during synchronization;
- the request must begin within 24 hours of onboarding;
- the `history` and `smb_app_state_sync` webhook fields must be subscribed;
- each initial sync can be requested only once per onboarding;
- if the 24-hour limit or one-time request is missed, offboard and onboard the
  business again.

### The business disconnects later

In WhatsApp Business, the business can go to
**Settings > Account > Business Platform** and disconnect. Meta sends an
`account_update` event. MamePilot records the disconnection, and an
administrator must complete Embedded Signup again to reconnect.

## Security rules

- Keep the App Secret and all access tokens only on the server.
- Never put secrets in frontend environment variables beginning with `VITE_`.
- Never log authorization codes or tokens in production.
- Use a unique verify token per deployment.
- Use HTTPS everywhere.
- Give Meta only the permissions/assets the integration needs.
- Remove former staff from both Meta app roles and business roles.
- Treat screenshots of provider settings as sensitive.

## Official Meta references

- [Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/)
- [Embedded Signup versions](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions/)
- [Embedded Signup v4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4/)
- [Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)
- [Onboard customers as a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/)
- [Webhook overrides](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override/)

## Completion boundary

A local build and automated backend test can prove that MamePilot launches the
correct Coexistence mode, protects credentials, stores connection state, and
handles representative signed webhooks. Only a live test with the real Meta
app, eligible business, real WhatsApp Business phone, mobile confirmation, and
real webhook delivery can prove that the provider setup is complete.
