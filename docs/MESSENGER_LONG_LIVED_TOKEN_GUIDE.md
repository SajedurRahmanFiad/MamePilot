# Meta System User Token Guide (Production Recommended)

This guide explains how to generate a Meta System User access token. This is the recommended method for a production deployment of MamePilot. 

Unlike personal user tokens, System User tokens belong to your Meta Business Account. They do not expire when you change your personal Facebook password, ensuring MamePilot maintains a permanent, stable connection to your Facebook Page inbox.

## Before You Start

You need:
- A Meta Business Account (Business Manager).
- Administrator access to the Meta Business Account.
- The Facebook Page added to your Business Account.
- The Meta app configured for Messenger added to your Business Account.

*Note: If your App or Page is only in your personal developer account, you must transfer or link them to your Business Account first.*

## Step 1: Create a System User

1. Open [Meta Business Settings](https://business.facebook.com/settings).
2. In the left sidebar, under **Users**, click **System Users**.
3. Click **Add** to create a new system user.
4. Name the system user (e.g., `MamePilot Server`).
5. Set the System User Role to **Admin System User**. 
6. Click **Create System User**.

*(Note: While standard system users can work, an Admin System User is highly recommended for API integrations to prevent permission conflicts with Page management scopes).*

## Step 2: Assign Assets to the System User

The System User cannot generate a working token until it is granted explicit access to both your Facebook Page and your Meta App.

1. Select your new System User and click **Add Assets**.
2. **Assign the Page:**
   - Under **Asset Type**, select **Pages**.
   - Check the box next to your Facebook Page.
   - Under **Full Control**, toggle the switch to give the System User complete access.
3. **Assign the App:**
   - Under **Asset Type**, select **Apps**.
   - Check the box next to your Messenger App.
   - Under **Full Control**, toggle the switch.
4. Click **Save Changes**.

## Step 3: Generate the Initial Token

1. With the System User still selected, click **Generate New Token**.
2. Select your Messenger App from the dropdown list.
3. Under **Token Expiration**, select **Never**.
4. Scroll down to the **Available Permissions** list and select the following scopes:
   - `pages_manage_metadata`
   - `pages_messaging`
   - `pages_read_engagement`
   - `pages_show_list` 
5. Click **Generate Token**.
6. A popup will display your permanent token. **Copy this token immediately.** Meta will only show it to you this one time.

## Step 4: Exchange for a Page Access Token

*Important: Meta's New Pages Experience strictly requires a Page Access Token to subscribe apps to page events (like webhooks). The token generated in Step 3 is a System User Token. You must exchange it to avoid HTTP 400 errors during the MamePilot subscription check.*

Open your Windows Command Prompt (`cmd`) and run the following single-line `curl` command. Replace `YOUR_SYSTEM_USER_TOKEN` with the token you just copied:

```cmd
curl -X GET "https://graph.facebook.com/v26.0/me/accounts?fields=id,name,access_token&access_token=YOUR_SYSTEM_USER_TOKEN"
```

In the JSON response, find the object whose `id` matches your MamePilot Page ID. Copy its `access_token`. This is your **permanent Page access token**.

## Step 5: Save the Token in MamePilot

1. Sign in to MamePilot.
2. Open **Settings**.
3. Open **Messenger**.
4. Enter the Facebook **Page ID**.
5. Paste the final **Page access token** (from Step 4) into **Page access token**.
6. Click **Save Messenger**.
7. Click **Test connection**.
8. Confirm that the connection test succeeds. (The HTTP 400 warning should no longer appear).

If your server relies on environment variables, update the `MESSENGER_PAGE_ACCESS_TOKEN` variable in your production environment and restart the server.

## Security Rules

- **Treat this token like a master password.** Admin System User tokens are incredibly powerful and provide deep access to your Business assets.
- Never commit the token to version control (Git).
- Never send the token through chat, email, or screenshots.
- Use HTTPS/TLS for your production MamePilot deployment.
- If this token is ever exposed, go back to Meta Business Settings, select the System User, and immediately click **Revoke Token**.