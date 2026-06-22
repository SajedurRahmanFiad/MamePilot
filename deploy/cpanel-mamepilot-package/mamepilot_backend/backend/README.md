# MariaDB + PHP Backend

## What this does

- Creates the local MariaDB schema used by the app
- Provides a PHP API that replaces the former Supabase query/edge-function layer
- Includes a Supabase-to-MariaDB importer
- Includes a bootstrap admin creator for emergency/local access

## Commands

- `npm run backend:setup`
  Creates `bdhatbela_management` and applies [`schema.sql`](/f:/Projects/React/BDHATBELA-MANAGEMENT-FINAL/backend/database/schema.sql)

- `npm run backend:setup-import`
  Runs setup, then attempts a live import from Supabase

- `npm run backend:import`
  Attempts a live import from Supabase into the existing MariaDB schema

- `npm run backend:serve`
  Starts the PHP API on `http://127.0.0.1:8001`

- `php backend/bin/create_admin.php --name="Admin" --phone="017XXXXXXXX" --password="secret"`
  Creates a local admin account when a live import is unavailable

## Frontend

- Vite proxies `/api` to `http://127.0.0.1:8001`
- The React app now calls the PHP API through [`apiClient.ts`](/f:/Projects/React/BDHATBELA-MANAGEMENT-FINAL/src/services/apiClient.ts)

## Environment

The backend config loader reads:

- project `.env`
- project `.env.local`
- `backend/.env`
- `backend/.env.local`

For local MariaDB, the defaults already match:

- host `127.0.0.1`
- port `3306`
- database `bdhatbela_management`
- user `root`
- password empty
