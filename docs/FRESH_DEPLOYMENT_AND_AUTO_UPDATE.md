# MamePilot Setup Guide

This guide explains how to set up MamePilot on a server and how automatic updates work. Written in plain language — no technical background needed.

---

## How MamePilot updates itself

Once set up, MamePilot keeps itself updated automatically. You fix a bug on your computer, push it to GitHub, and every server running MamePilot picks up the change within 1 minute. Nobody has to log into the server or click anything.

Automatic updates do not save application backups. They use a temporary working
folder only while downloading and extracting a release, then remove it whether
the attempt succeeds or fails.

### The flow

```
You (on your computer)          →    GitHub              →    Your server (cPanel)
                                   
Fix the bug                         Stores the code           Detects new version
npm run release:push                Always has latest         Downloads & installs
                                    version                   Restarts automatically
```

### What YOU do (every time you fix something)

1. Fix the bug in the code.
2. Open terminal and type:
   ```bash
   npm run release:push
   ```
3. Done. Go drink coffee.

That command does everything for you:
- Increases the version number (like 0.0.95 → 0.0.96)
- Builds the website files
- Saves database changes
- Sends everything to GitHub

### What happens on the server (automatic)

Every 1 minute, the server wakes up and asks: **"Is there a newer version?"**

- If **no** → goes back to sleep.
- If **yes** → downloads the new code, builds it, installs it, updates the database if needed. Your visitors are now seeing the latest version.

---

## Two ways the server can get updates

Think of it like getting groceries:

### Way 1 — Git method (`UPDATE_USE_GIT=1`)

> The server goes to the store (GitHub) itself, picks the items (code), brings them home, and cooks (builds).

- The server has a copy of your GitHub repository.
- It pulls new changes from GitHub.
- It builds the website on the server.
- **Best for**: servers with git and npm installed (most cPanel servers).

### Way 2 — Package method (`UPDATE_USE_GIT=0`)

> You cook at home (build on your computer), pack a bag (ZIP file), ship it to the server. The server just unpacks it.

- You build everything on your computer (the `release:push` command does this).
- The server downloads the ready-made package from a URL you configure.
- **Best for**: shared hosting that doesn't have git or npm.

---

## First-time setup (Git method)

This is the most common setup. Use this if your cPanel has Terminal or SSH access.

### Step 1: Clone your repository on the server

In cPanel, go to **Git Version Control** and click **Create**. Enter:

- **Repository URL**: `https://github.com/SajedurRahmanFiad/MamePilot.git`
- **Clone path**: `/home/your-cpanel-user/repositories/MamePilot`

Or if you prefer Terminal:

```bash
git clone https://github.com/SajedurRahmanFiad/MamePilot.git /home/your-cpanel-user/repositories/MamePilot
```

Note the path — you'll need it in the next step.

### Step 2: Upload the website files

Upload these from your computer to the server:

- Everything inside `dist/` (the built website) → goes to `/home/your-cpanel-user/public_html/`
- The `backend/` folder → goes to `/home/your-cpanel-user/mamepilot_backend/backend/`
- The `.env.example` file → goes to `/home/your-cpanel-user/mamepilot_backend/.env.example`

### Step 3: Set up the database

In cPanel → **phpMyAdmin** (or MySQL Databases):

1. Create a new database (e.g., `mamepilot_db`).
2. Create a database user and give it full access to that database.
3. Import `backend/database/schema.sql` into the database.
4. If this is a brand-new install (not an existing customer), also import `backend/database/seed.sql`.

### Step 4: Create the `.env` file

In `/home/your-cpanel-user/mamepilot_backend/`, create a file called `.env` with these contents:

```ini
# ---- Database ----
DB_HOST=localhost
DB_NAME=mamepilot_db
DB_USER=your_db_user
DB_PASS=your_db_password

# ---- App ----
APP_FRONTEND_URL=https://your-domain.com

# ---- Automatic updates ----
UPDATE_ENABLED=1
UPDATE_USE_GIT=1
UPDATE_GIT_URL=https://github.com/SajedurRahmanFiad/MamePilot.git
UPDATE_GIT_BRANCH=main
UPDATE_GIT_DEPLOY_ROOT=/home/your-cpanel-user/repositories/MamePilot
UPDATE_DOCUMENT_ROOT=/home/your-cpanel-user/public_html
UPDATE_BACKEND_ROOT=/home/your-cpanel-user/mamepilot_backend
UPDATE_APP_ROOT=/home/your-cpanel-user/mamepilot_backend
UPDATE_SKIP_BUILD=0
UPDATE_BUILD_COMMAND=npm run build
UPDATE_RUN_SCHEMA=1
UPDATE_RUN_SEED=0
UPDATE_CRON_SECRET=make-up-a-long-random-password-here
UPDATE_MANAGE_CRON=1
UPDATE_CRON_SCHEDULE=*/1 * * * *
```

**Replace these values:**
- `DB_NAME` → your actual database name
- `DB_USER` → your actual database username
- `DB_PASS` → your actual database password
- `APP_FRONTEND_URL` → your actual website URL (like `https://orders.yourbusiness.com`)
- `your-cpanel-user` → your actual cPanel username (like `fiadsoft`)
- `UPDATE_CRON_SECRET` → make up a long random password (like `xK9mP2vL8nQ4wR7jT5y`)
- `UPDATE_GIT_DEPLOY_ROOT` → the path from Step 1

### Step 5: Run setup

Open cPanel Terminal (or SSH) and run:

```bash
cd /home/your-cpanel-user/mamepilot_backend
php backend/bin/setup.php
```

This does two things:
1. Sets up the database tables.
2. **Installs the automatic update check** — a cron job that runs every 1 minute.

**That's it. The server will now keep itself updated automatically.**

### Step 6: Verify it works

Run this to check if the server can see the latest version:

```bash
php /home/your-cpanel-user/mamepilot_backend/backend/bin/update.php --check
```

You should see:
- `localVersion` → the version currently installed on the server
- `remoteVersion` → the latest version on GitHub
- `updateAvailable` → `true` if there's a newer version, `false` if already up to date

---

## First-time setup (Package method)

Use this if your hosting doesn't have git or npm. The server downloads a ready-made ZIP file instead of building from source.

### Step 1: Upload the website files

Same as the Git method — upload `dist/` contents to `public_html/` and `backend/` to `mamepilot_backend/backend/`.

### Step 2: Set up the database

Same as the Git method — create database, import `schema.sql` and optionally `seed.sql`.

### Step 3: Upload release files to a public URL

After running `npm run release:push` on your computer, upload these two files to a public folder on any website:

- `deploy/releases/VERSION`
- `deploy/releases/cpanel-mamepilot-package.zip`

For example, if you upload to `https://your-website.com/mamepilot/`, these URLs must work:
- `https://your-website.com/mamepilot/VERSION`
- `https://your-website.com/mamepilot/cpanel-mamepilot-package.zip`

### Step 4: Create the `.env` file

```ini
# ---- Database ----
DB_HOST=localhost
DB_NAME=mamepilot_db
DB_USER=your_db_user
DB_PASS=your_db_password

# ---- App ----
APP_FRONTEND_URL=https://your-domain.com

# ---- Automatic updates ----
UPDATE_ENABLED=1
UPDATE_USE_GIT=0
UPDATE_BASE_URL=https://your-website.com/mamepilot
UPDATE_VERSION_FILENAME=VERSION
UPDATE_PACKAGE_NAME=cpanel-mamepilot-package
UPDATE_APP_ROOT=/home/your-cpanel-user/mamepilot_backend
UPDATE_PUBLIC_ROOT=/home/your-cpanel-user/public_html
UPDATE_DOCUMENT_ROOT_FOLDER=public_html
UPDATE_BACKEND_FOLDER=mamepilot_backend
UPDATE_RUN_SCHEMA=1
UPDATE_RUN_SEED=0
UPDATE_CRON_SECRET=make-up-a-long-random-password-here
UPDATE_MANAGE_CRON=1
```

### Step 5: Run setup

```bash
cd /home/your-cpanel-user/mamepilot_backend
php backend/bin/setup.php
```

---

## Optional: Let cPanel handle the git pull

If your cPanel has **Git Version Control** with **Auto Deploy** turned on, cPanel can pull from GitHub automatically when you push. The app then just builds and deploys — it doesn't pull from GitHub itself.

### How to set it up

1. In cPanel → **Git Version Control**, make sure your repo is set up and **Auto Deploy** is enabled.
2. Add this to your `.env`:
   ```ini
   UPDATE_GIT_SKIP_PULL=1
   ```
3. Remove or comment out `UPDATE_GIT_URL` — it's no longer needed.

Now the flow is: you push → cPanel pulls → the app detects the new version → builds and deploys.

---

## What if something goes wrong?

### Check the logs

```bash
php /home/your-cpanel-user/mamepilot_backend/backend/bin/audit_log.php
```

This shows a history of all update attempts — what worked, what failed, and why.

### Check the update log

```bash
cat /home/your-cpanel-user/mamepilot-update.log
```

This shows the raw output from each update run.

### Roll back to a previous version

```bash
php /home/your-cpanel-user/mamepilot_backend/backend/bin/rollback.php
```

This restores the backup from before the last update.

### Force an update now

```bash
php /home/your-cpanel-user/mamepilot_backend/backend/bin/update.php
```

### Force a check without updating

```bash
php /home/your-cpanel-user/mamepilot_backend/backend/bin/update.php --check
```

---

## The `.env` file explained

Every setting in the `.env` file and what it does:

### Database settings

| Setting | What it means |
|---------|---------------|
| `DB_HOST` | Usually `localhost` — where the database lives |
| `DB_NAME` | The name of your database |
| `DB_USER` | Your database username |
| `DB_PASS` | Your database password |

### App settings

| Setting | What it means |
|---------|---------------|
| `APP_FRONTEND_URL` | Your website URL (like `https://orders.yourbusiness.com`) |

### Update settings

| Setting | What it means |
|---------|---------------|
| `UPDATE_ENABLED` | `1` = auto-updates are on, `0` = off |
| `UPDATE_USE_GIT` | `1` = pull from GitHub, `0` = download ZIP package |
| `UPDATE_GIT_URL` | Your GitHub repository URL |
| `UPDATE_GIT_BRANCH` | Which branch to pull (usually `main`) |
| `UPDATE_GIT_DEPLOY_ROOT` | Where the git clone lives on the server |
| `UPDATE_GIT_SKIP_PULL` | `1` = let cPanel handle git pull instead of the app |
| `UPDATE_DOCUMENT_ROOT` | Where the website files go (usually `public_html`) |
| `UPDATE_BACKEND_ROOT` | Where the backend code goes |
| `UPDATE_APP_ROOT` | Same as `UPDATE_BACKEND_ROOT` in most cases |
| `UPDATE_SKIP_BUILD` | `0` = build on server, `1` = skip build (if you pre-built) |
| `UPDATE_BUILD_COMMAND` | The command to build the website (usually `npm run build`) |
| `UPDATE_BASE_URL` | (Package method only) Where to download the ZIP from |
| `UPDATE_RUN_SCHEMA` | `1` = apply database changes during update |
| `UPDATE_RUN_SEED` | Legacy compatibility flag. Automatic updates ignore it and preserve existing rows. |
| `UPDATE_CRON_SECRET` | A secret password that protects the update endpoint |
| `UPDATE_MANAGE_CRON` | `1` = let the system manage the cron job automatically |
| `UPDATE_CRON_SCHEDULE` | How often to check for updates (default: every 1 minute) |

---

## Existing customer site (not a fresh install)

If you're deploying to a site that already has data:

1. Do not use `seed.sql` as an upgrade mechanism; automatic updates never execute it.
2. Keep `UPDATE_RUN_SEED=0` for clarity. Older deployments left at `1` are still protected.
3. The automatic updater will apply `schema-only.sql` which only adds new columns and tables — it never deletes or overwrites existing data.

---

## Beginner checklist

### Before your first release

- [ ] I set up the server (Steps 1–5 above).
- [ ] I ran `php backend/bin/setup.php` and it succeeded.
- [ ] I ran `php backend/bin/update.php --check` and it shows my version.

### Before every release

- [ ] I fixed the bug.
- [ ] If the database changed, I updated `backend/database/schema.sql` and added a migration under `migrations/`.
- [ ] If fresh-install defaults changed, I updated `backend/database/seed.sql`.
- [ ] I ran `npm run release:push`.

### After release

- [ ] Wait 1 minute — the server picks it up automatically.
- [ ] If using the package method, I uploaded `deploy/releases/` to the central URL.

---

## Quick command reference

### On your computer

```bash
npm run release:push          # Release a new version
npm run schema:sync           # Regenerate schema-only.sql
```

### On the server

```bash
php backend/bin/setup.php                  # First-time setup (also installs cron)
php backend/bin/update.php --check         # Check if an update is available
php backend/bin/update.php                 # Force an update now
php backend/bin/audit_log.php              # View update history
php backend/bin/rollback.php               # Roll back to previous version
php backend/bin/backup_db.php              # Backup the database
php backend/bin/restore_db.php --file X    # Restore a database backup
```
