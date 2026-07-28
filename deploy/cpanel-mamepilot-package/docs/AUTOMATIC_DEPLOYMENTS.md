# MamePilot simple deployment plan

This is the simple way to manage many production deployments.

## The simple rule

You only do this on your computer:

```bash
npm run release:push
```

That command:

1. Increases `VERSION`
2. Updates `package.json`
3. Runs `npm run build`
4. Prepares `deploy/releases/VERSION`
5. Prepares `deploy/releases/cpanel-mamepilot-package.zip`
6. Saves schema/seed changes
7. Commits
8. Pushes to git

This deliberately publishes both update channels from the same version:

- Git-capable deployments can update from the pushed branch.
- Package deployments can update from `deploy/releases/VERSION` and the ZIP after you upload them to the central server (or directly from the configured GitHub raw release folder).

Neither deployment method replaces the other. Every deployment chooses its own method with `UPDATE_USE_GIT`.

After that, each production deployment can update itself automatically, but only after the deployment is configured correctly.

Automatic updates do not create application backups. Package updates use a
temporary download/extraction workspace and remove it after every successful or
failed attempt. Arrange a separate hosting or database backup policy if needed.

### What you must do before auto-update works

For a first deployment you must:

1. Upload the built frontend files and the `api/` router files to your public web root.
2. Upload the backend PHP code to a secure folder outside the public web root.
3. Create a `.env` file in the backend folder with your database credentials and update settings.
4. Import `backend/database/schema.sql` into your database.
5. If this is a brand-new install, import `backend/database/seed.sql` once.
6. Choose your update method and configure the corresponding `UPDATE_*` variables.
7. Run `php backend/bin/setup.php` once. Package deployments install the recurring update cron automatically on compatible Linux hosting. Git deployments remove their managed updater cron because authenticated browser sessions dispatch the Git updater instead.
8. Only for package deployments: if the host does not expose user crontab access, create the update cron in the hosting panel.

You can choose one of two update methods:

1. **Release package method**: deployment downloads `VERSION` and ZIP from `UPDATE_BASE_URL`.
2. **Git method**: deployment runs `git pull --ff-only` from your repository.

The release package method is safer for cPanel. The git method is simpler if your hosting supports git.
Git checks the configured branch's `VERSION` directly; it does not require the central ZIP server. Package deployments continue using the central `VERSION` and ZIP URLs.

---

## Git update method

If your hosting supports git, use this method.

### Setup steps

1. Clone your repo on the server once:

```bash
git clone https://github.com/your-user/MamePilot.git /home/user/mamepilot_repo
```

2. Configure the backend `.env` with these values:

```ini
UPDATE_ENABLED=1
UPDATE_USE_GIT=1
UPDATE_GIT_URL=https://github.com/your-user/MamePilot.git
UPDATE_GIT_BRANCH=main
UPDATE_GIT_DEPLOY_ROOT=/home/user/repositories/Mame Pilot
UPDATE_DOCUMENT_ROOT=/home/user/public_html
UPDATE_BACKEND_ROOT=/home/user/mamepilot_backend
UPDATE_SKIP_BUILD=0
UPDATE_BUILD_COMMAND=npm run build
UPDATE_APP_ROOT=/home/user/mamepilot_backend
UPDATE_RUN_SCHEMA=1
UPDATE_RUN_SEED=0
UPDATE_CRON_SECRET=use-a-long-random-secret-here
UPDATE_MANAGE_CRON=1
UPDATE_CRON_SCHEDULE=*/15 * * * *
```

### What the update script does

When the update script runs, it will:

```bash
git fetch origin main
git pull --ff-only origin main
npm run build
```

The update check reads `VERSION` from `origin/main`, so Git deployments remain independent of the package server.

Then it copies:

- `dist/*` to `UPDATE_DOCUMENT_ROOT`
- `deploy/cpanel-template/public_html/.htaccess` to `UPDATE_DOCUMENT_ROOT/.htaccess`
- `deploy/cpanel-template/public_html/api/` to `UPDATE_DOCUMENT_ROOT/api/`
- `backend/` to `UPDATE_BACKEND_ROOT/backend/`
- `.env.example` and `VERSION` to `UPDATE_BACKEND_ROOT/`

Then it applies `schema-only.sql`.

Important: `git pull --ff-only` will fail if the server has local file changes. That is good. It prevents accidental overwrites.

### Automatic git update cron

When `UPDATE_USE_GIT=1`, the setup script automatically installs a cron job that calls `api/update.php?action=dispatch` via curl every 15 minutes (configurable via `UPDATE_CRON_SCHEDULE`). The `dispatch` action launches the updater as a detached background process and returns immediately. The updater then runs `git pull --ff-only`, builds the frontend, and deploys — all in the background.

This requires `APP_FRONTEND_URL` and `UPDATE_CRON_SECRET` to be set in your `.env`. If either is missing, the cron falls back to running `backend/bin/update.php` directly (synchronous).

Keep `UPDATE_MANAGE_CRON=1` so setup and successful updates can manage the cron entry automatically.

### Optional browser dispatcher

While at least one user is authenticated in the app, the frontend also calls a separate dispatch endpoint every two minutes. This provides faster update detection but is not required — the cron job is the primary trigger.

The legacy public `api/trigger_update.php` stays disabled. It is not used because it allowed unauthenticated visitors to launch server processes.

---

## cPanel Git Version Control method

If your cPanel has Git Version Control, you can let cPanel handle the repository pull instead of the app maintaining its own clone. This avoids stale-checkout problems where the app's separate git clone falls behind.

### How it works

1. cPanel's Git Version Control clones your repo and keeps it current (manually or via auto-deploy on push).
2. The app's auto-updater reads `VERSION` from cPanel's local repo, builds the frontend, and deploys — it never runs `git pull` itself.

### Setup steps

1. In cPanel → **Git Version Control**, create a repo pointing to your GitHub repository. Note the clone path (for example `/home/user/repositories/MamePilot`). Enable **Pull from Remote** auto-deploy if available.

2. Configure the backend `.env` with these values:

```ini
UPDATE_ENABLED=1
UPDATE_USE_GIT=1
UPDATE_GIT_SKIP_PULL=1
UPDATE_GIT_DEPLOY_ROOT=/home/user/repositories/MamePilot
UPDATE_GIT_BRANCH=main
UPDATE_DOCUMENT_ROOT=/home/user/public_html
UPDATE_BACKEND_ROOT=/home/user/mamepilot_backend
UPDATE_SKIP_BUILD=0
UPDATE_BUILD_COMMAND=npm run build
UPDATE_APP_ROOT=/home/user/mamepilot_backend
UPDATE_RUN_SCHEMA=1
UPDATE_RUN_SEED=0
UPDATE_CRON_SECRET=use-a-long-random-secret-here
UPDATE_MANAGE_CRON=1
```

Note: `UPDATE_GIT_URL` is not required when `UPDATE_GIT_SKIP_PULL=1` because cPanel manages the remote.

### What the update script does

When the update script runs with `UPDATE_GIT_SKIP_PULL=1`, it will:

```bash
# No git fetch or pull — cPanel handles that
npm run build
```

Then it copies the same files as the normal git method and applies `schema-only.sql`.

### Keeping cPanel's repo current

After each `npm run release:push` on your local machine, cPanel's auto-deploy (if enabled) will pull the new commits automatically. If auto-deploy is not available, open cPanel → Git Version Control and click **Pull from Remote** manually.

The app's auto-updater detects the new `VERSION` in the local repo and runs the build and deploy steps.

---

## Release package update method

If your hosting does not support git, use the release package method.

### How it works

The server checks a public update URL and downloads a package only if a newer version exists. Setup installs the recurring check automatically when the host permits user crontab management.

### What the cron job does

If automatic schedule installation reports `unavailable`, create one hosting-panel scheduled task that runs the update script periodically. For example:

```text
*/30 * * * * php /home/your-cpanel-user/mamepilot_backend/backend/bin/update.php >> /home/your-cpanel-user/mamepilot-update.log 2>&1
```

That means:

- Every 30 minutes, run the update script.
- Write a log entry to `mamepilot-update.log`.
- Do not overwrite your existing `.env`.

### What the update script checks

The background update script does these steps:

1. Check the remote `VERSION` file.
2. If the remote version is newer, download the ZIP package.
3. Extract it and copy updated files.
4. Preserve the existing `.env` file.
5. Run the database schema update.
6. Never run seed data during an update. Fresh installations use `backend:setup` before joining the update channel.
7. Save audit logs.

### What you must configure for this method

In your `.env` file, set:

```ini
UPDATE_ENABLED=1
UPDATE_USE_GIT=0
UPDATE_BASE_URL=https://your-central-domain.com/mamepilot
UPDATE_VERSION_FILENAME=VERSION
UPDATE_PACKAGE_NAME=cpanel-mamepilot-package
UPDATE_APP_ROOT=/home/your-cpanel-user/mamepilot_backend
UPDATE_PUBLIC_ROOT=/home/your-cpanel-user/public_html/your-subdomain
UPDATE_DOCUMENT_ROOT_FOLDER=public_html
UPDATE_BACKEND_FOLDER=mamepilot_backend
UPDATE_RUN_SCHEMA=1
UPDATE_RUN_SEED=0
UPDATE_CRON_SECRET=use-a-long-random-secret-here
```

`UPDATE_DOCUMENT_ROOT_FOLDER` and `UPDATE_BACKEND_FOLDER` are names inside the release ZIP. Put absolute server destinations in `UPDATE_PUBLIC_ROOT` and `UPDATE_APP_ROOT`; do not put absolute paths in the two `*_FOLDER` settings. The updater retains compatibility with older deployments that did so by falling back to the standard package folder names.

Then create the cron job. Without the cron, the server will not check or install updates automatically.

---

## Database files

MamePilot keeps fresh-install, production-upgrade, and seed responsibilities separate:

| File | Purpose |
| :--- | :--- |
| `backend/database/schema.sql` | Complete schema for a fresh database. `CREATE TABLE IF NOT EXISTS` alone does not upgrade columns in existing tables. |
| `backend/database/schema-only.sql` | Generated additive production-upgrade artifact. The automatic updater applies this file. |
| `backend/database/seed.sql` | Append-only default data for fresh installs. Updates never execute it. |

`schema-only.sql` is generated from `schema.sql` plus every SQL file in `migrations/`:

```text
backend/database/schema-only.sql
```

To regenerate it manually:

```bash
npm run schema:sync
```

For every schema change, update the fresh schema and add an idempotent migration:

```text
backend/database/schema.sql
migrations/YYYY-MM-DD_description.sql
```

---

## What happens when you fix a bug

1. Fix the bug.
2. If the database changed, edit `backend/database/schema.sql` and add an idempotent file under `migrations/`.
3. If fresh installs need default data, edit `backend/database/seed.sql`.
4. Run this one command:

```bash
npm run release:push
```

That is the only release command you normally need.

The command prepares this folder for you. After pushing, upload it to your central hosting/domain:

```text
deploy/releases/
```

It should contain:

```text
deploy/releases/
  VERSION
  cpanel-mamepilot-package.zip
```

Then set:

```ini
UPDATE_BASE_URL=https://your-central-domain.com/mamepilot
```

The update script automatically looks for:

```text
https://your-central-domain.com/mamepilot/VERSION
https://your-central-domain.com/mamepilot/cpanel-mamepilot-package.zip
```

---

## Fresh install

For a brand-new deployment:

1. Import `backend/database/schema.sql`
2. Import `backend/database/seed.sql`
3. Upload files
4. Configure `.env`

---

## Existing production deployment

For an existing customer database:

- Do **not** run `seed.sql`
- Run `schema-only.sql`
- Keep `.env` untouched

The update agent does this automatically when it installs a new release.

---

## Important `.env` values

Each deployment needs:

```ini
UPDATE_ENABLED=1
UPDATE_BASE_URL=https://your-central-domain.com/mamepilot
UPDATE_VERSION_FILENAME=VERSION
UPDATE_PACKAGE_NAME=cpanel-mamepilot-package
UPDATE_APP_ROOT=/home/your-cpanel-user/mamepilot_backend
UPDATE_PUBLIC_ROOT=/home/your-cpanel-user/public_html/your-subdomain
UPDATE_DOCUMENT_ROOT_FOLDER=public_html
UPDATE_BACKEND_FOLDER=mamepilot_backend
UPDATE_RUN_SCHEMA=1
UPDATE_RUN_SEED=0
AUDIT_LOG_FILE=/home/your-cpanel-user/mamepilot_backend/backend/storage/audit/update-log.jsonl
UPDATE_CRON_SECRET=use-a-long-random-secret-here
```

Keep `UPDATE_RUN_SEED=0` for clarity. The updater ignores this legacy flag and preserves existing customer data even if an older `.env` still contains `1`.

---

## If something breaks

Rollback code:

```bash
php backend/bin/rollback.php
```

Check logs:

```bash
php backend/bin/audit_log.php
```

Database backup before important updates:

```bash
php backend/bin/backup_db.php
```

Restore database:

```bash
php backend/bin/restore_db.php --file /path/to/backup.sql.gz
```

---

## Beginner checklist

Before release:

- [ ] I fixed the bug.
- [ ] If database changed, I updated `backend/database/schema.sql` and added an idempotent migration under `migrations/`.
- [ ] If fresh-install defaults changed, I updated `backend/database/seed.sql`.
- [ ] I ran `npm run schema:sync` if I manually edited SQL files.
- [ ] I ran `npm run release:push`.

On each production server:

- [ ] `UPDATE_ENABLED=1`
- [ ] Cron job runs `php backend/bin/update.php`
- [ ] `UPDATE_RUN_SEED=0` for existing customer sites
