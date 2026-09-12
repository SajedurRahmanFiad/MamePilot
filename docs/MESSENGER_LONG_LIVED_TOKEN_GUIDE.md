# Messenger Long-Lived Token Guide

This guide explains how to create a long-lived Facebook user token, exchange it for a Page access token, and save that Page token in MamePilot.

## Before You Start

You need:

- A Meta Developer account.
- A Meta app configured for Facebook Page Messenger.
- Administrator access to the Facebook Page.
- The Meta App ID and App Secret.
- The Facebook Page ID.

Never share your App Secret or a complete access token. Treat both as passwords.

## Token Types

You will use three different values during this process:

1. **Short-lived user token**: generated temporarily by Graph API Explorer.
2. **Long-lived user token**: created by exchanging the short-lived user token.
3. **Page access token**: retrieved from the long-lived user token and saved in MamePilot.

MamePilot needs the **Page access token**, not the short-lived user token.

## Step 1: Find the App ID and App Secret

1. Open [Meta for Developers](https://developers.facebook.com/).
2. Select the app used for Messenger.
3. Open **App settings** and then **Basic**.
4. Copy the **App ID**.
5. Click **Show** beside **App Secret** and copy it securely.

Do not put the App Secret in a screenshot, chat message, public document, or source-code repository.

## Step 2: Generate a Short-Lived User Token

1. Open [Graph API Explorer](https://developers.facebook.com/tools/explorer/).
2. Select your Messenger app in the application dropdown.
3. Click **Get Token**.
4. Choose **Get User Access Token**.
5. Select the permissions required by your Messenger app, such as:
   - `pages_manage_metadata`
   - `pages_messaging`
   - `pages_read_engagement`
   - `business_management`, if Meta requests it
6. Complete the Facebook authorization steps.
7. Copy the generated token into a temporary secure location.

This is the **short-lived user token**. Do not paste it into MamePilot yet.

## Step 3: Exchange It for a Long-Lived User Token

The exchange request uses the Meta Graph API. Replace every placeholder in this URL:

```text
https://graph.facebook.com/v26.0/oauth/access_token?grant_type=fb_exchange_token&client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&fb_exchange_token=YOUR_SHORT_LIVED_USER_TOKEN
```

Replace:

- `YOUR_APP_ID` with the Meta App ID.
- `YOUR_APP_SECRET` with the Meta App Secret.
- `YOUR_SHORT_LIVED_USER_TOKEN` with the token copied from Graph API Explorer.

Keep the URL on one line. Do not include the placeholder text, quotes, spaces, or line breaks.

### Run the Exchange in PowerShell

PowerShell is safer than putting the secret into a browser address bar because the App Secret is less likely to be saved in browser history.

```powershell
$appId = "YOUR_APP_ID"
$appSecret = "YOUR_APP_SECRET"
$shortToken = "YOUR_SHORT_LIVED_USER_TOKEN"

$url = "https://graph.facebook.com/v26.0/oauth/access_token?grant_type=fb_exchange_token&client_id=$appId&client_secret=$appSecret&fb_exchange_token=$shortToken"

Invoke-RestMethod -Uri $url -Method Get
```

A successful response looks similar to this:

```json
{
  "access_token": "EAAB...",
  "token_type": "bearer",
  "expires_in": 5183944
}
```

Copy the value of `access_token`. This is your **long-lived user token**.

If Meta returns an error, verify that:

- The App ID belongs to the selected Meta app.
- The App Secret belongs to the same app.
- The short-lived token was generated for the same app.
- The token has not already expired.
- The required permissions were granted.

## Step 4: Get the Page Access Token

Use the long-lived user token to list the Pages available to that Facebook account:

```text
https://graph.facebook.com/v26.0/me/accounts?fields=id,name,access_token&access_token=YOUR_LONG_LIVED_USER_TOKEN
```

In PowerShell:

```powershell
$longToken = "YOUR_LONG_LIVED_USER_TOKEN"

Invoke-RestMethod `
  -Uri "https://graph.facebook.com/v26.0/me/accounts?fields=id,name,access_token&access_token=$longToken" `
  -Method Get
```

A successful response looks similar to this:

```json
{
  "data": [
    {
      "id": "123456789012345",
      "name": "Your Facebook Page",
      "access_token": "EAAB_PAGE_TOKEN..."
    }
  ]
}
```

Find the object whose `id` matches your Messenger Page ID. Copy that object's `access_token`. This is the **Page access token** that MamePilot requires.

## Step 5: Save the Page Token in MamePilot

1. Sign in to MamePilot.
2. Open **Settings**.
3. Open **Messenger**.
4. Enter the Facebook **Page ID**.
5. Paste the Page `access_token` into **Page access token**.
6. Click **Save Messenger**.
7. Click **Test connection**.
8. Confirm that the connection test succeeds.

If the server uses the `MESSENGER_PAGE_ACCESS_TOKEN` environment variable, update that value too. The server environment may take precedence over the value saved in the settings database.

## Step 6: Verify Messenger Sending

After the connection test succeeds:

1. Open the Messenger inbox in MamePilot.
2. Open an existing conversation.
3. Send a short test message.
4. Confirm that the message is delivered on Facebook Messenger.

If sending fails with `Session has expired`, generate a replacement Page token and repeat Step 5.

## Security Rules

- Never commit tokens or App Secrets to Git.
- Never send tokens through chat, email, or screenshots.
- Do not paste the App Secret into the MamePilot Page token field.
- Use HTTPS for the production MamePilot deployment.
- If a token is exposed, revoke or regenerate it immediately.
- Record the token expiration date and renew it before it expires.

## Recommended Production Option

For a production integration, consider using a Meta Business System User token assigned to the Facebook Page and Messenger app. System User tokens are more suitable for server-to-server integrations because they do not depend on a personal Facebook login session.

The exact System User permissions depend on the Meta Business setup. The token must have access to the Page and the Messenger-related app permissions required by the integration.
