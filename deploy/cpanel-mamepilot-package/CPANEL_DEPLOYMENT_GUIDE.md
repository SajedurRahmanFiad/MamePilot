# cPanel Deployment & Database Setup Guide

This guide describes how to deploy the **MamePilot** frontend and backend to a cPanel hosting server, set up the MariaDB database, and configure your `.env` variables.

It also supports automated updates for many deployments. See [docs/AUTOMATIC_DEPLOYMENTS.md](docs/AUTOMATIC_DEPLOYMENTS.md) for the simple workflow: bump version, commit/push once, and let each server update itself.

---

## 1. Directory Structure Mapping

To ensure security, the backend code containing sensitive application logic should be placed outside the public web root (`public_html` or the subdomain folder), while the compiled frontend and API routing entry points are placed inside the web root.

Here is where each folder and file from this local repository needs to be uploaded on cPanel:

| Local Repository Source | cPanel Destination | Purpose / Details |
| :--- | :--- | :--- |
| **`dist/*`** (everything inside after building) | `/public_html/subdomain/` *(Document Root)* | The compiled HTML, CSS, and JS files for the React app. |
| **`deploy/cpanel-template/public_html/.htaccess`** | `/public_html/subdomain/.htaccess` | Configures public routing, compression, cache controls, and proxies requests to `/api` to the PHP router. |
| **`deploy/cpanel-template/public_html/api/`** (Folder) | `/public_html/subdomain/api/` | Public folder acting as the gateway/endpoint for all API traffic. Contains: <br>• `index.php` (processes requests)<br>• `.htaccess` (rewrites URLs) |
| **`backend/`** (Folder) | `/mamepilot_backend/backend/` | Secure backend PHP codebase containing controllers, models, and system files. Place this directory **one level above** your Document Root (e.g. `/home/username/mamepilot_backend`). |
| **`.env`** (Created manually) | `/mamepilot_backend/.env` | Secure database connection strings and configuration settings. |

> [!IMPORTANT]
> **Understanding Relative Paths for `mamepilot_backend`:**
> The `api/index.php` entry point automatically calculates the path to your backend by going two levels up from its own location:
> * If your subdomain folder is `/home/username/subdomain/`, it searches for `/home/username/mamepilot_backend/backend/bootstrap.php`.
> * If your subdomain folder is `/home/username/public_html/subdomain/`, it searches for `/home/username/public_html/mamepilot_backend/backend/bootstrap.php`.
> 
> If you wish to place it in a customized absolute path, set the environment variable `MAMEPILOT_APP_ROOT` in your cPanel server environment to point to that directory's absolute path.

---

## 2. Database Creation & Setup

Follow these steps to configure your MariaDB/MySQL database on cPanel:

### Step 1: Create a Database
1. Log in to your cPanel dashboard.
2. Under the **Databases** section, click **MySQL Databases** or **MySQL Database Wizard**.
3. Create a new database (e.g., `yourusername_mamepilot`). Note down the full database name.

### Step 2: Create a Database User
1. Scroll down to **MySQL Users -> Add New User**.
2. Enter a username (e.g., `yourusername_dbuser`).
3. Generate a strong password. **Save this password** as you will need to add it to your `.env` configuration.
4. Click **Create User**.

### Step 3: Grant Privileges
1. Scroll to **Add User To Database**.
2. Select your newly created user and database.
3. Click **Add**.
4. Check **ALL PRIVILEGES** and click **Make Changes**.

### Step 4: Import Database Schema
1. From cPanel home, open **phpMyAdmin**.
2. Select your new database from the left-hand menu.
3. Click on the **Import** tab at the top.
4. Click **Choose File** and select the [schema.sql](file:///f:/Projects/React/MamePilot/backend/database/schema.sql) file from the `backend/database/` directory of your local workspace.
5. Click **Import** (or **Go** depending on the cPanel version).

Then import [seed.sql](file:///f:/Projects/React/MamePilot/backend/database/seed.sql) only for fresh installs.

> [!IMPORTANT]
> Do **not** run `seed.sql` repeatedly on existing customer databases. It contains default rows with `ON DUPLICATE KEY UPDATE` and can overwrite settings or the default developer user. Existing deployments should receive `schema-only.sql` during updates; `schema.sql` is for fresh databases.

---

## 3. Configuring the `.env` File

Create a file named `.env` in the root of your secure backend directory (`/mamepilot_backend/.env`):

```ini
# Backend Database Settings
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=yourusername_mamepilot     # Full database name from cPanel
DB_USER=yourusername_dbuser        # Full database user from cPanel
DB_PASS=your_strong_password       # User password

# Application Timezone
APP_TIMEZONE=Asia/Dhaka

# Frontend / Vite Configuration
VITE_API_BASE_URL=/api/
```

> [!TIP]
> * Most cPanel shared hosting accounts host MySQL on the same server, so `DB_HOST` is usually `127.0.0.1` or `localhost`.
> * Make sure there are no spaces around the `=` character, and do not wrap values in quotes unless they contain spaces.

---

## 4. Database Backups and Schema Updates

Before updating an important deployment, create a database backup:

```bash
php backend/bin/backup_db.php
```

This creates a compressed `.sql.gz` backup in `DB_BACKUP_ROOT`.

To restore a backup:

```bash
php backend/bin/restore_db.php --file /path/to/backup.sql.gz
```

For an existing deployment, code updates should be followed by the pure schema update:

```bash
php /home/your-cpanel-user/mamepilot_backend/backend/bin/update.php
```

The update agent applies `backend/database/schema-only.sql` automatically and does not run `seed.sql` unless `UPDATE_RUN_SEED=1`.

### Automatic calling schedule

Setup and automatic updates now register the minute schedule automatically on
compatible Linux hosting. The next eligible order also repairs a missing entry,
so installations receiving this change through the older updater become
self-healing without a second release. Each installation uses a path-specific
schedule marker, so multiple domains under one hosting account keep independent
workers and do not replace each other's entries.

If the host blocks application-managed schedules, add this cPanel cron job with
the real account name and backend path:

```text
* * * * * /usr/local/bin/php /home/your-cpanel-user/mamepilot_backend/backend/bin/process_survey_queue.php --once >> /home/your-cpanel-user/mamepilot-auto-call.log 2>&1
```

Run it every minute. The post-order background process is the immediate
fast-path; the recurring schedule reliably handles longer delays and retries.
Set `AUTO_CALL_MANAGE_CRON=0` only when the host manages this entry separately.
The Auto Calling page shows whether delivery is running and whether calls are
overdue.

---

## 5. Optional Automatic Updates

Each deployment can check for updates automatically using the update agent. This is useful when you manage many domains, but it must be configured carefully.

Add these optional values to `/mamepilot_backend/.env`:

```ini
UPDATE_ENABLED=0
# Choose one method:
# Git method:
UPDATE_USE_GIT=0
UPDATE_GIT_URL=
UPDATE_GIT_BRANCH=main
UPDATE_GIT_DEPLOY_ROOT=/home/username/repositories/Mame Pilot
UPDATE_DOCUMENT_ROOT=/home/username/public_html
UPDATE_BACKEND_ROOT=/home/username/mamepilot_backend
UPDATE_SKIP_BUILD=0
UPDATE_BUILD_COMMAND=npm run build
# Release package method:
UPDATE_BASE_URL=https://your-central-domain.com/mamepilot
UPDATE_VERSION_FILENAME=VERSION
UPDATE_PACKAGE_NAME=cpanel-mamepilot-package
UPDATE_APP_ROOT=/home/your-cpanel-user/mamepilot_backend
UPDATE_PUBLIC_ROOT=/home/your-cpanel-user/public_html/your-subdomain
UPDATE_DOCUMENT_ROOT_FOLDER=public_html
UPDATE_BACKEND_FOLDER=mamepilot_backend
UPDATE_RUN_SCHEMA=1
UPDATE_RUN_SEED=0
UPDATE_RUN_MIGRATIONS=0
UPDATE_BACKUP_BEFORE_UPDATE=1
UPDATE_BACKUP_ROOT=/home/your-cpanel-user/mamepilot_backups
UPDATE_CRON_SECRET=use-a-long-random-secret-here
```

Check manually from the backend folder:

```bash
php backend/bin/update.php --check
php backend/bin/update.php
```

You can also call the protected web endpoint:

```text
/api/update.php?action=check&secret=YOUR_UPDATE_CRON_SECRET
/api/update.php?action=update&secret=YOUR_UPDATE_CRON_SECRET
```

The update agent preserves the existing `.env` file. It does not overwrite it.

If an update breaks the site, restore code files from the latest backup:

```bash
php backend/bin/rollback.php
```

Database rollback is not automatic. Keep database backups separately if you need to undo data/schema changes.

---

## 6. Verification & Troubleshooting

Once files are uploaded and config is set, verify the setup by navigating to your API health endpoint in the browser:
`https://subdomain.yourdomain.com/api/health`

### Common Errors:
1. **`Backend bootstrap not found`**
   * **Cause:** The `api/index.php` cannot locate the `backend/bootstrap.php` file based on the relative path logic.
   * **Fix:** Verify that the `mamepilot_backend` folder is placed exactly one level above the directory containing your static files. If your subdomain directory is `/home/username/public_html/subdomain`, `mamepilot_backend` should be `/home/username/public_html/mamepilot_backend`.
2. **`Database connection failed` or PHP Errors**
   * **Cause:** Incorrect credentials in `/mamepilot_backend/.env` or missing database privileges.
   * **Fix:** Ensure the database user has **All Privileges** on the database and verify the credentials.
3. **`404 Not Found` when trying to access `/api/...`**
   * **Cause:** The `.htaccess` file is missing or `mod_rewrite` is disabled on your hosting provider.
   * **Fix:** Ensure you uploaded the `.htaccess` file directly to the root subdomain folder and to the `api/` folder.
