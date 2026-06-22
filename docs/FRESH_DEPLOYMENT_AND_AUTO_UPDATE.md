# Fresh Deployment and Auto-Update Guide

This document explains:

1. How to deploy MamePilot for the first time.
2. How to configure automatic updates for the release package method.
3. What to do after you make a bug fix.

---

## 1. Fresh deployment (first install)

### Step 1: Deploy the app files

On the target server, deploy these parts:

- Frontend build output (`dist/`) to the public website root.
- Backend PHP code to a secure folder outside the public web root.
- `backend/database/schema.sql` into the database.
- `backend/database/seed.sql` only for a brand-new install, not for existing customer databases.

Example folder layout:

- `/home/your-user/public_html/` → frontend files and `api/`
- `/home/your-user/mamepilot_backend/` → backend PHP and `backend/bin/update.php`

### Step 2: Create the backend `.env`

In the backend folder, create `.env` with your credentials and update settings.

Example `.env` for the release package update method:

```ini
UPDATE_ENABLED=1
UPDATE_USE_GIT=0
UPDATE_BASE_URL=https://your-central-domain.com/mamepilot
UPDATE_VERSION_FILENAME=VERSION
UPDATE_PACKAGE_NAME=cpanel-mamepilot-package
UPDATE_APP_ROOT=/home/your-user/mamepilot_backend
UPDATE_PUBLIC_ROOT=/home/your-user/public_html
UPDATE_DOCUMENT_ROOT_FOLDER=public_html
UPDATE_BACKEND_FOLDER=mamepilot_backend
UPDATE_RUN_SCHEMA=1
UPDATE_RUN_SEED=0
UPDATE_BACKUP_BEFORE_UPDATE=1
UPDATE_BACKUP_ROOT=/home/your-user/mamepilot_backups
UPDATE_CRON_SECRET=use-a-long-random-secret-here
```

If you prefer explicit URLs, use:

```ini
UPDATE_ENABLED=1
UPDATE_USE_GIT=0
UPDATE_VERSION_URL=https://your-central-domain.com/mamepilot/VERSION
UPDATE_RELEASE_URL=https://your-central-domain.com/mamepilot/cpanel-mamepilot-package.zip
UPDATE_APP_ROOT=/home/your-user/mamepilot_backend
UPDATE_PUBLIC_ROOT=/home/your-user/public_html
UPDATE_DOCUMENT_ROOT_FOLDER=public_html
UPDATE_BACKEND_FOLDER=mamepilot_backend
UPDATE_RUN_SCHEMA=1
UPDATE_RUN_SEED=0
UPDATE_BACKUP_BEFORE_UPDATE=1
UPDATE_BACKUP_ROOT=/home/your-user/mamepilot_backups
UPDATE_CRON_SECRET=use-a-long-random-secret-here
```

### Step 3: Upload the update source files to the central host

On your central update host, upload these generated release artifacts to the folder referenced by `UPDATE_BASE_URL` or explicit URLs:

- `deploy/releases/VERSION`
- `deploy/releases/cpanel-mamepilot-package.zip`

After upload, these URLs must work:

- `https://your-central-domain.com/mamepilot/VERSION`
- `https://your-central-domain.com/mamepilot/cpanel-mamepilot-package.zip`

`VERSION` must be plain text containing the release version, for example:

```text
0.0.4
```

### Step 4: Create the cron job on the deployment server

Add one scheduled cron job on the deployment server:

```text
*/30 * * * * php /home/your-user/mamepilot_backend/backend/bin/update.php >> /home/your-user/mamepilot-update.log 2>&1
```

This makes the deployment check for updates every 30 minutes.

### Step 5: Verify the deployment

Run on the server:

```bash
php /home/your-user/mamepilot_backend/backend/bin/update.php --check
```

Expected result:

- `localVersion` shows the deployment version
- `remoteVersion` shows the version from the central host
- `updateAvailable` is `false` if there is no newer version yet

---

## 2. After a bug fix

When you make a bug fix and want deployments to update automatically:

### Step 1: Create a release locally

From your repository root, run:

```powershell
npm run release:push
```

This will:

- bump the root `VERSION`
- update `package.json` version
- build the frontend
- prepare `deploy/releases/VERSION`
- prepare `deploy/releases/cpanel-mamepilot-package.zip`
- commit and push the release files

If you do not want the commit/push behavior and only need the release files, run:

```powershell
npm run release:cpanel:prepare
```

### Step 2: Upload the new release files

Upload these files to the central update host folder:

- `deploy/releases/VERSION`
- `deploy/releases/cpanel-mamepilot-package.zip`

This updates the central source that deployments poll.

### Step 3: Wait for the deployments to auto-update

Each deployment will check the central host on the next cron run.

If you want to force a deployment to check immediately, run:

```bash
php /home/your-user/mamepilot_backend/backend/bin/update.php --check
```

If you want to force the update immediately:

```bash
php /home/your-user/mamepilot_backend/backend/bin/update.php
```

---

## 3. Important notes

- `UPDATE_ENABLED=1` is required for automatic updates.
- The deployment cron is required. Without it, automatic updates will not happen.
- The central host must serve plain-text `VERSION` and the ZIP file.
- `backend/VERSION` must exist on each deployed backend so the updater can read the current installed version.
- `UPDATE_RUN_SCHEMA=1` ensures database schema changes are applied during updates.
- `UPDATE_RUN_SEED=0` is safer for existing databases; only run seeds on a fresh install if needed.

---

## 4. Quick command summary

### Local release creation

```powershell
npm run release:push
```

Or:

```powershell
npm run release:cpanel:prepare
```

### Deployment verification

```bash
php /home/your-user/mamepilot_backend/backend/bin/update.php --check
```

### Deployment cron job

```text
*/30 * * * * php /home/your-user/mamepilot_backend/backend/bin/update.php >> /home/your-user/mamepilot-update.log 2>&1
```
