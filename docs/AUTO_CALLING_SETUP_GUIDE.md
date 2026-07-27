# Auto Calling Setup Guide

This guide walks you through setting up automatic voice calls for order confirmation using AwajDigital. Written in plain language — no technical background needed.

---

## What does auto-calling do?

When a customer places an order, MamePilot can automatically call the customer's phone to confirm the order. Here's how it works:

```
Customer places order
        ↓
MamePilot waits a few minutes (configurable)
        ↓
MamePilot sends the order to AwajDigital
        ↓
AwajDigital calls the customer's phone
        ↓
Customer picks up and presses a key:
  Press 1 → Order confirmed
  Press 2 → Order cancelled
  No answer → MamePilot tries again later
        ↓
MamePilot records the result automatically
```

No manual work needed — once set up, it runs on its own.

---

## Before you start

You need an **AwajDigital** account. This is the service that actually makes the phone calls. You'll need three things from them:

1. **API Token** — a password that lets MamePilot talk to AwajDigital
2. **Sender** — the phone number or name that shows up when the customer receives the call
3. **Template Name** — the voice message template you created in AwajDigital (the recorded message the customer hears)

If you don't have these yet, sign up at AwajDigital and create a voice survey template first.

---

## Step 1: Configure the connection to AwajDigital

1. Open MamePilot and go to **Settings** (the gear icon in the sidebar).
2. Click the **Voice Survey** tab.
3. Fill in the **AwajDigital Integration** section:

   | Field | What to enter |
   |-------|---------------|
   | **API Token** | Your AwajDigital API token |
   | **Sender** | Your AwajDigital sender name or number |
   | **Template Name** | The name of your published AwajDigital template |

4. Click **Save**.

After saving, MamePilot automatically creates a **Webhook URL** and **Webhook Secret**. These are used by AwajDigital to report back the results of each call. You don't need to create these yourself — they're generated for you.

---

## Step 2: Enable auto-calling

1. Still in **Settings → Voice Survey**, find the **Auto Calling** section.
2. Turn on the **Enable Auto Calling** toggle.
3. Choose your settings:

   | Setting | What it means | Recommended value |
   |---------|---------------|-------------------|
   | **Trigger Status** | Which orders get auto-called. When an order is set to this status, MamePilot will queue a call. | "On Hold" (default) |
   | **Delay (minutes)** | How long to wait after the order is created before making the call. This gives you time to review the order first. | 5 minutes |

4. Click **Save**.

---

## Step 3: Set up the background worker (CRON JOB) — IMPORTANT

This is the step most people miss. MamePilot needs a **cron job** — a scheduled task that runs every minute on your server to process the call queue. Without this, orders will be queued but never actually called.

### Method 1: Automatic setup (recommended)

If your cPanel has **Terminal** access, run this one command:

```bash
cd /home/your-cpanel-user/mamepilot_backend && php backend/bin/install_auto_call_cron.php
```

Replace `your-cpanel-user` with your actual cPanel username (the one you use to log into cPanel, also visible in the top-right corner of the cPanel dashboard).

That's it. The script finds your PHP path, detects your server setup, and installs the cron job automatically. You should see:

- **"The automatic calling schedule was installed."** — success, you're done.
- **"The automatic calling schedule is already installed."** — it was already set up, you're done.
- **"The hosting account does not provide user cron access."** — your hosting blocks this. Use Method 2 below.

### Method 2: Manual setup (if Terminal is not available)

If your hosting doesn't have Terminal, or the automatic setup didn't work:

1. Log into your **cPanel** dashboard.
2. Look for **Cron Jobs** (usually under the "Advanced" section).
3. In the **Add New Cron Job** section, set:
   - **Common Settings**: Choose **Every Minute** (`* * * * *`)
   - **Command**: Copy and paste this (replace `your-cpanel-user` with your actual cPanel username):

   ```
   /usr/local/bin/php /home/your-cpanel-user/mamepilot_backend/backend/bin/process_survey_queue.php --once >> /home/your-cpanel-user/mamepilot-auto-call.log 2>&1
   ```

4. Click **Add New Cron Job**.

#### How to find your cPanel username

Your cPanel username is the name you use to log into cPanel. It's also visible in the top-right corner of the cPanel dashboard. For example, if your username is `fiadsoft`, the command becomes:

```
/usr/local/bin/php /home/fiadsoft/mamepilot_backend/backend/bin/process_survey_queue.php --once >> /home/fiadsoft/mamepilot-auto-call.log 2>&1
```

#### What if I don't know my PHP path?

The command above uses `/usr/local/bin/php`, which works on most cPanel servers. If it doesn't work, try:

```
/usr/bin/php /home/your-cpanel-user/mamepilot_backend/backend/bin/process_survey_queue.php --once >> /home/your-cpanel-user/mamepilot-auto-call.log 2>&1
```

Or find your PHP path by going to cPanel → **MultiPHP Manager** or running `which php` in Terminal.

---

## Step 4: Verify the webhook URL

AwajDigital needs to be able to reach your webhook URL to report call results. Here's how to check:

1. Go to **Settings → Voice Survey** in MamePilot.
2. Look at the **Webhook URL** field. It should look something like:
   ```
   https://your-domain.com/api/webhook-survey.php?token=a1b2c3d4...
   ```
3. Copy this URL and open it in your browser. You should see:
   - A "Method not allowed" message (this is correct — it only accepts POST requests from AwajDigital, not browser visits)
   - **NOT** a 404 error or a blank page

If you get a 404 error, your server might be blocking access to the `webhook-survey.php` file. Check that:
- The file exists at `backend/public/webhook-survey.php` on your server
- Your `.htaccess` rules aren't blocking the `/api/` path

---

## Step 5: Test it

1. Create a test order in MamePilot.
2. Set the order status to your trigger status (e.g., "On Hold").
3. Wait for the delay period you configured (e.g., 5 minutes).
4. Check the **Auto Calling** page in MamePilot — you should see the call in the history.
5. Check if the customer's phone rings.

### If nothing happens

1. Go to **Settings → Voice Survey** and check the **Queue delivery** card at the bottom:
   - If it says **"Automatic calling is running normally"** → the cron job is working. The issue might be with AwajDigital. Check the log file (see below).
   - If it says **"Automatic calling is temporarily unavailable"** → the cron job is NOT running. Go back to Step 3.
   - If it says **"Automatic calling needs setup"** → some configuration fields are missing. Go back to Step 1.

2. Check the log file on your server:
   ```
   cat /home/your-cpanel-user/mamepilot-auto-call.log
   ```
   This shows what the worker is doing. Look for error messages.

---

## How retries work

If the customer doesn't answer or doesn't press a key, MamePilot automatically retries:

| Situation | How many retries | Time between retries |
|-----------|------------------|---------------------|
| Customer didn't answer | 3 retries | 30 minutes apart |
| Customer answered but didn't press a key | 2 retries | 10 minutes apart |

You can change these numbers in **Settings → Voice Survey** under the retry settings.

---

## What the statuses mean

On the **Auto Calling** page, you'll see these statuses:

| Status | What it means |
|--------|---------------|
| **Running** (green) | Everything is working. The cron job is active and processing calls. |
| **Needs attention** (yellow) | The cron job hasn't checked in for a while, but no calls are overdue yet. Check if the cron job is set up. |
| **Needs attention** (red) | Something is wrong — either a configuration error or the worker has stopped and calls are overdue. |

---

## Troubleshooting

### "The scheduled task is not running"

**Cause**: The cron job hasn't run in the last 3 minutes.

**Fix**:
1. Run the automatic setup command in cPanel Terminal:
   ```bash
   cd /home/your-cpanel-user/mamepilot_backend && php backend/bin/install_auto_call_cron.php
   ```
2. If that doesn't work, set up the cron manually in cPanel → Cron Jobs (see Step 3, Method 2).
3. Wait 1-2 minutes and refresh the page.

### "Automatic calling needs setup"

**Cause**: One or more required fields are empty.

**Fix**: Go to Settings → Voice Survey and make sure all these fields are filled in:
- API Token
- Sender
- Template Name
- Webhook Secret (auto-generated — should not be empty)
- Webhook URL (auto-generated — should not be empty)

### Calls are being made but the customer doesn't get confirmed

**Cause**: AwajDigital is calling, but the webhook isn't reporting back.

**Fix**:
1. Verify the Webhook URL is correct (Step 4).
2. Make sure your server has HTTPS enabled (AwajDigital requires it).
3. Check the webhook URL in your browser — it should respond, not give a 404.

### The log file shows errors

Check the log file:
```bash
cat /home/your-cpanel-user/mamepilot-auto-call.log
```

Common errors:
- **"Voice survey is not enabled"** → Go to Settings and enable auto-calling.
- **"Survey webhook URL is not configured"** → Save the AwajDigital settings again to generate the webhook URL.
- **"Could not start schedule command"** → Your server doesn't allow the background process. Set up the cron job manually (Step 3).
- **Connection errors** → The server can't reach AwajDigital. Check if your server allows outgoing HTTP requests.

### Orders are queued but never called

**Cause**: The order's status doesn't match the trigger status.

**Fix**: Check your trigger status in Settings → Voice Survey. Only orders with that exact status will be called. For example, if your trigger is "On Hold", orders with "Processing" status won't be called.

---

## Quick reference

| What | Where |
|------|-------|
| AwajDigital settings | Settings → Voice Survey → AwajDigital Integration |
| Auto-calling on/off | Settings → Voice Survey → Auto Calling |
| Call history | Auto Calling page (sidebar) |
| Worker health status | Settings → Voice Survey → Queue delivery card |
| Log file | `/home/your-cpanel-user/mamepilot-auto-call.log` on server |
| Cron job | cPanel → Cron Jobs |

---

## Summary checklist

- [ ] AwajDigital account created with API token, sender, and template
- [ ] API Token, Sender, Template Name filled in Settings → Voice Survey
- [ ] Auto Calling enabled in Settings → Voice Survey
- [ ] Cron job installed (run `php backend/bin/install_auto_call_cron.php` in Terminal, or add it manually in cPanel → Cron Jobs)
- [ ] Webhook URL accessible (no 404 error)
- [ ] Test order created and call received by customer
