# New York — Travel ledger

A public, shared expense tracker for Marcus and Chloe’s NYC trip, November 4–9, 2026. Anyone opening the configured site can immediately view, add, edit, and delete expenses. No accounts, sign-in links, invitations, or membership setup.

The existing Next.js App Router frontend exports static files for GitHub Pages. Supabase PostgreSQL holds the shared data; Supabase Realtime syncs changes across devices. No application server or private browser credentials are needed.

## Public-editable means public

**Every shared expense, title, payer, date, category, and note is public. Anyone can change or permanently delete all shared expenses through the site or directly through the API.** The publishable key and trip ID are visible in the downloaded JavaScript; hiding the website URL does not protect the data. “Paid by” is a choice, not verified identity. There is no user audit trail, authorization between Marcus and Chloe, or undo. Third parties can copy the data, spam the database, or consume your Supabase quota.

Do not enter emails, addresses, payment details, receipt images with private information, or other sensitive information. Export CSV backups regularly and keep copies outside the app. A CSV is a snapshot; the app does not automatically restore it or keep a backup history. The owner can restore reviewed data through the Supabase dashboard. This tradeoff is intentional for a small personal trip.

**Never put a Supabase secret key (`sb_secret_…`), legacy `service_role` key, database password, or JWT signing secret in this repository, GitHub Actions variables, or any `NEXT_PUBLIC_` variable.** Use only a public publishable key (`sb_publishable_…`). The build rejects other key formats before compiling the app. RLS stays enabled and restricts public writes to the fixed shared trip; it does not prevent public vandalism of that trip. Supabase’s [API key guide](https://supabase.com/docs/guides/api/api-keys) explains the key types.

## Supabase setup

1. Create a project at [Supabase](https://supabase.com/dashboard), preferably dedicated to this tracker. No Auth provider, email, SMTP, redirect URL, or anonymous sign-in setup is needed.
2. Open **SQL Editor** and apply the migrations in order:
   - New project: run [001_trip.sql](supabase/migrations/001_trip.sql), then [002_public_shared_trip.sql](supabase/migrations/002_public_shared_trip.sql). The first file is the unchanged historical schema; the second removes its account requirements and callable invitation functions.
   - Existing tracker database with `001` already applied: **back up the database first**, then run **only `002`** once. Do not rerun `001`.
3. `002` creates the one shared trip with ID `20261104-0000-4000-8000-000000000001`. If exactly one old trip has the original name `NYC with Chloe ♡` and dates November 4–9, its existing expenses are moved into the shared trip without changing expense IDs or payer/split values. Those expenses become public. Other trips stay private. Legacy membership/invitation records and creator UUIDs are retained for the database owner but inaccessible to browser roles. The frontend does not use them.
4. If multiple old trips match, the migration aborts atomically. As owner, review and consolidate the intended NYC trip first, or narrow the `source_id` selection in a reviewed copy of `002` to the specific trip you intend to publish. If you renamed the old trip, explicitly select its ID before running the migration; the default name/date match will leave it private. Do not merge unrelated trips.
5. In **Project Settings → API Keys**, copy the **publishable key** (`sb_publishable_…`). Copy the project URL from **Connect** or the project’s API settings.
6. The migration adds only `public.expense_sync` to this app’s `supabase_realtime` publication and removes this app’s old `trips`/`expenses` publication entries. Under **Database → Publications**, confirm `expense_sync` is enabled. It contains only a fixed trip ID and a revision counter.

The migration is transactional and intended to run once. Applying it makes the original account-based frontend incompatible; rebuild/publish the new frontend after migrating.

## Run locally

Requires Node 22+.

```sh
npm ci
cp .env.example .env.local
```

Fill `.env.local` with:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
NEXT_PUBLIC_BASE_PATH=
```

Replace the placeholders with real values, then:

```sh
npm test
npm run dev
```

Open http://localhost:3000 on each device/browser. Both see the same trip immediately. Select **Paid by Marcus** or **Paid by Chloe** when adding an expense. No user identity is stored or required. Existing authentication sessions from the old site are never read or reused: the client disables Supabase Auth and always uses the public key’s `anon` role.

Configuration is compiled into the static site: restart dev or rebuild after changing it. Both empty/placeholder values show a setup message; incomplete settings or a non-publishable key fail configuration validation. There is no fake database or local-only expense storage.

## GitHub Pages

Keep the existing [repository](https://github.com/marcusshih/chloe-nyc-expenses) and `.github/workflows/deploy.yml` workflow. In **Settings → Secrets and variables → Actions → Variables**, set:

- `NEXT_PUBLIC_SUPABASE_URL`: your project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the public `sb_publishable_…` key. This replaces `NEXT_PUBLIC_SUPABASE_ANON_KEY`; remove that obsolete variable if present.

These values are intentionally public. Do not add a private key. Under **Settings → Pages**, select **GitHub Actions**. Push changes to `main` or run **Actions → Deploy trip to GitHub Pages → Run workflow**. The workflow installs dependencies, runs database/money/config and two-browser UI tests, builds with `/chloe-nyc-expenses` as the base path and asset prefix, and deploys `out/`.

If both variables are absent, the workflow warns and publishes the setup message. Set both and rebuild to activate the shared database. Missing one value or using the wrong key format fails the build.

Expected URL: https://marcusshih.github.io/chloe-nyc-expenses/ . Confirm the deployment succeeds before testing the URL on both phones. [Next.js static export](https://nextjs.org/docs/app/guides/static-exports) remains enabled; the app needs no server routes, middleware, or server actions.

## Data permissions and synchronization

- RLS remains enabled on every tracker table. Only `anon` receives public expense permissions: SELECT on explicit non-sensitive columns, INSERT on editable fields plus the fixed trip ID, UPDATE on editable fields, and DELETE. RLS checks the fixed trip ID for each operation, independent of frontend filters. Clients cannot change IDs, timestamps, trip assignment, or legacy creator fields. Existing constraints validate amounts, names, categories, title/notes lengths, split types, and trip dates.
- Trips, old members, and old invitations have no browser access. Old account RPCs and membership policies are removed. Old `authenticated` table **and column** grants are revoked. No grants are added to unrelated tables. Review any other tables/policies you previously created in the Supabase project separately; this migration only manages this tracker’s schema.
- `anon` can SELECT the small `expense_sync` row but cannot write it. A restricted trigger increments the counter after each shared expense INSERT, UPDATE, or DELETE. Realtime delivers that authorized UPDATE and the frontend reloads the expense list. Expense DELETE events and creator UUIDs are not published. This avoids the [Realtime DELETE authorization limitation](https://supabase.com/docs/guides/realtime/postgres-changes#receiving-old-records).
- The trigger runs with owner privileges, a fixed target, and an empty search path; browser roles cannot execute it directly. It has no arbitrary table/trip arguments. [RLS reference](https://supabase.com/docs/guides/database/postgres/row-level-security).
- Reconnect, window focus, returning to a visible tab, and a 30-second fallback refresh recover missed changes. The sync label reports the connection state. Errors are shown; failed writes do not silently become local data. Subscription/timer/listener cleanup occurs on unmount.

## Dashboard, money, and backups

- Monetary amounts remain validated integer cents ($0.01–$1,000,000). Expenses are limited to November 4–9, 2026 by both the form and database.
- Shared odd cents go to Marcus. Personal splits assign all responsibility to the selected person, regardless of who paid.
- Settlement = what Marcus paid minus Marcus’s responsibility. Positive means Chloe owes Marcus; negative means Marcus owes Chloe.
- Totals, settlement, and category breakdown cover the whole trip. Date/category filters affect the expense list only.
- **Export CSV** always downloads **all loaded trip expenses**, even with filters active, as `nyc-expenses-backup.csv`. Reads are paginated to avoid silently truncating at Supabase’s default response limit. CSV uses two decimal places, quotes/escapes text and line breaks, and neutralizes formula-leading values, including leading whitespace. CSV is for offline backups, not a full database dump.
- Edits/deletes check `updated_at`. A stale form reports a conflict; close and reopen it to use the latest version. Deletion requires confirmation.
- There were no separate Auth packages in this project. The login/invitation UI, actions, state, styles, and session configuration have been removed. The Supabase SDK remains necessary for PostgreSQL and Realtime; its internal Auth dependency is unused.

## Verification

```sh
# Offline: execute migrations/permissions in embedded PostgreSQL plus money/config tests.
npm test

# Browser UI: install Chromium once, then run two isolated browsers with a fixture API/socket.
npx playwright install chromium
npm run test:browser
# Alternatively, use an installed Google Chrome:
# PLAYWRIGHT_CHANNEL=chrome npm run test:browser

# Production static export with the existing GitHub project path.
NEXT_PUBLIC_BASE_PATH=/chloe-nyc-expenses npm run build

# Real Supabase: after applying SQL and configuring .env.local.
npm run test:supabase
```

`npm test` uses PGlite (embedded PostgreSQL) with Supabase role/Auth stubs. It applies the exact upgrade migration, executes CRUD as `anon`, verifies RLS and column grants, preservation of existing expenses, counter updates for insert/update/delete, stale-edit rejection, private-table denial, and atomic refusal of ambiguous migrations. Only `001`’s unused `pgcrypto` extension installation is omitted because PGlite does not provide it. This is a database-policy test, not a hosted Supabase test.

The browser test checks immediate public access, both payer choices, settlement, expense CRUD, event-driven synchronization between two sessions, stale-edit conflicts, category/date filters, CSV contents with active filters, and mobile width. Its REST/WebSocket transport is simulated; it does not prove a hosted Realtime publication works.

`npm run test:supabase` uses two independent clients with **only the publishable key**, creates a uniquely named test expense, verifies the second client receives insert/update/delete changes **through Realtime** (no database polling fallback), checks private data/sync writes are denied, and cleans up its test row. It fails without real configuration. No Supabase project was available during this change, so this hosted check must be run after setup.

Finally open the deployed site in two fresh/incognito browsers or on two phones. Confirm there is no login, add a $51 shared expense paid by Marcus, observe “Chloe owes Marcus $25.50” on both, edit the payer to Chloe, delete the expense, and confirm both update. Export a CSV and open it offline. Disconnect a device, reconnect, and verify its list catches up. Do not treat “Live sync” alone as proof that expenses are synchronizing.
