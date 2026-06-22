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

After that, each production deployment can update itself automatically, but only after the deployment is configured correctly.

### What you must do before auto-update works

For a first deployment you must:

1. Upload the built frontend files and the `api/` router files to your public web root.
2. Upload the backend PHP code to a secure folder outside the public web root.
3. Create a `.env` file in the backend folder with your database credentials and update settings.
4. Import `backend/database/schema.sql` into your database.
5. If this is a brand-new install, import `backend/database/seed.sql` once.
6. Choose your update method and configure the corresponding `UPDATE_*` variables.
7. If you want automatic periodic updates, create a cron job on the server.

You can choose one of two update methods:

1. **Release package method**: deployment downloads `VERSION` and ZIP from `UPDATE_BASE_URL`.
2. **Git method**: deployment runs `git pull --ff-only` from your repository.

The release package method is safer for cPanel. The git method is simpler if your hosting supports git.

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
UPDATE_BACKUP_BEFORE_UPDATE=1
UPDATE_BACKUP_ROOT=/home/user/mamepilot_backups
UPDATE_CRON_SECRET=use-a-long-random-secret-here
```

### What the update script does

When the update script runs, it will:

```bash
git pull --ff-only origin main
npm run build
```

Then it copies:

- `dist/*` to `UPDATE_DOCUMENT_ROOT`
- `deploy/cpanel-template/public_html/.htaccess` to `UPDATE_DOCUMENT_ROOT/.htaccess`
- `deploy/cpanel-template/public_html/api/` to `UPDATE_DOCUMENT_ROOT/api/`
- `backend/` to `UPDATE_BACKEND_ROOT/backend/`
- `.env.example` and `VERSION` to `UPDATE_BACKEND_ROOT/`

Then it applies `schema.sql`.

Important: `git pull --ff-only` will fail if the server has local file changes. That is good. It prevents accidental overwrites.

### Cron job for git method

You still need a cron job to make updates automatic. Use the same cron command as the release package method:

```text
*/30 * * * * php /home/your-cpanel-user/mamepilot_backend/backend/bin/update.php >> /home/your-cpanel-user/mamepilot-update.log 2>&1
```

Without the cron, the server will not check for or install updates automatically.

---

## Release package update method

If your hosting does not support git, use the release package method.

### How it works

The server will check a public update URL and download a package only if a newer version exists. It does not do this automatically until you create the cron job.

### What the cron job does

Create one scheduled task that runs the update script periodically. For example:

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
6. Run seeds only if the deployment is new or `UPDATE_RUN_SEED=1`.
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
UPDATE_BACKUP_BEFORE_UPDATE=1
UPDATE_BACKUP_ROOT=/home/your-cpanel-user/mamepilot_backups
UPDATE_CRON_SECRET=use-a-long-random-secret-here
```

Then create the cron job. Without the cron, the server will not check or install updates automatically.

---

## Database files

MamePilot now has two database files:

| File | Purpose |
| :--- | :--- |
| `backend/database/schema.sql` | Pure schema only. No data seeding. Safe to run repeatedly on production databases. |
| `backend/database/seed.sql` | Basic default data for fresh installs. Do not run this repeatedly on customer databases unless you intentionally want to refresh defaults. |

The old combined file is still available for compatibility and is generated from the two files above:

```text
backend/database/schema-only.sql
```

To regenerate it manually:

```bash
npm run schema:sync
```

New work should point to:

```text
backend/database/schema.sql
backend/database/seed.sql
```

---

## What happens when you fix a bug

1. Fix the bug.
2. If the database changed, edit `backend/database/schema.sql`.
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
- Run `schema.sql`
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
UPDATE_BACKUP_BEFORE_UPDATE=1
UPDATE_BACKUP_ROOT=/home/your-cpanel-user/mamepilot_backups
AUDIT_LOG_FILE=/home/your-cpanel-user/mamepilot_backend/backend/storage/audit/update-log.jsonl
UPDATE_CRON_SECRET=use-a-long-random-secret-here
```

`UPDATE_RUN_SEED=0` is important for existing customer sites.

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
- [ ] If database changed, I updated `backend/database/schema.sql`.
- [ ] If fresh-install defaults changed, I updated `backend/database/seed.sql`.
- [ ] I ran `npm run schema:sync` if I manually edited SQL files.
- [ ] I ran `npm run release:push`.

On each production server:

- [ ] `UPDATE_ENABLED=1`
- [ ] Cron job runs `php backend/bin/update.php`
- [ ] `UPDATE_RUN_SEED=0` for existing customer sites
