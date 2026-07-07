# Meta Ads Configuration Guide

This guide explains how to configure Meta Ads for MamePilot using the new database-backed settings flow.

## What this guide covers

- What the Meta redirect URL is
- Where to get `App ID` and `App Secret`
- How to set up the redirect/callback URL in Meta
- How to save the values in MamePilot
- What changes when you deploy the app

## 1. What is the redirect URL?

The redirect URL is the address Meta sends users back to after they approve access in the OAuth flow.

In MamePilot, the redirect URL is the backend callback endpoint:

- `https://your-domain/api/index.php?action=metaAdsOAuthCallback`

This URL must be registered in your Meta developer app settings.

### Why it matters

If Meta does not recognize the exact callback URL, the connection will fail.

## 2. Where do I get `App ID` and `App Secret`?

You get both values from the Meta developer dashboard:

1. Go to `developers.facebook.com`
2. Open your app under `My Apps`
3. In the app settings, find:
   - `App ID`
   - `App Secret`

Those are the two values you paste into the MamePilot `Meta Ads` settings page.

## 3. How to set the callback URL in Meta

1. Open your Meta app in the developer dashboard.
2. Find the `Facebook Login` settings.
3. Add the redirect URI under `Valid OAuth Redirect URIs`.
4. Use the exact backend callback URL for your deployment.

Example:

- Local development: `http://localhost:3000/api/index.php?action=metaAdsOAuthCallback`
- Deployed app: `https://your-production-domain.com/api/index.php?action=metaAdsOAuthCallback`

> Use the actual URL your backend is served from. Do not keep `localhost` for a production deployment.

## 4. How to configure Meta Ads inside MamePilot

1. Open MamePilot and go to `Settings`.
2. Select the `Meta Ads` tab.
3. Fill in these fields:
   - `App ID`
   - `App Secret`
   - `Redirect URI`
   - `Login Config ID` (optional)
   - `Graph Version` (default is `v25.0`)
   - `OAuth Scopes` (default is `public_profile,ads_read,business_management`)
4. Click `Save Meta App`.
5. After saving, click `Connect Meta`.
6. Complete the Meta login and grant permissions.
7. Optionally click `Sync Now` once the connection is established.

## 5. How to update the callback URL

If you need to change the callback URL:

1. Update the `Redirect URI` field on the `Meta Ads` settings page.
2. Click `Save Meta App`.
3. Update the redirect URL in your Meta app developer dashboard to match exactly.
4. Reconnect Meta if needed.

## 6. What happens in deployment?

- On local development, `localhost` is fine.
- In production, the redirect URL must use your real domain.
- If you deploy the app as-is, the callback URL will use the host of the backend request.
- Do not leave `localhost` in the saved redirect URL unless you are testing locally.

### Example production callback URL

If your backend runs at `https://app.example.com`, use:

- `https://app.example.com/api/index.php?action=metaAdsOAuthCallback`

## 7. Recommended values

- `Graph Version`: `v25.0`
- `OAuth Scopes`: `public_profile,ads_read,business_management`

> Note: `email` is not a valid Facebook Login scope. Use only valid permissions from the [Facebook Login permissions documentation](https://developers.facebook.com/docs/facebook-login/permissions).

## 8. Why this is now stored in the database

This version of MamePilot stores Meta Ads app credentials in the database, so:

- You can manage them from the admin settings UI
- You do not need to edit the backend `.env` file for Meta credentials
- The values are persisted in the `meta_ads_settings` database table

## 9. Common troubleshooting

- If `Connect Meta` fails, verify the `App ID` and `App Secret` are correct.
- If the redirect fails, verify the exact callback URI registered in Meta matches what is saved in MamePilot.
- If deployed, make sure the redirect URI uses `https://` and the real deployment domain.

---

If you want, I can also add a short screenshot-style example for the Meta developer dashboard settings. 