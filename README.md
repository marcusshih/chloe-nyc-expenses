# NYC with Chloe ♡

A small, mobile-first shared expense tracker for Marcus and Chloe, November 4–9, 2026. Next.js App Router + React + JavaScript + Tailwind CSS + Lucide + Supabase. Static export hosted on GitHub Pages; no application server, API routes, server actions, or service-role key.

## 1. Create Supabase (required)

1. Create a project at https://supabase.com/dashboard. Save your database password privately; it is never needed in the browser app.
2. Open **SQL Editor → New query**, paste `supabase/migrations/001_trip.sql`, and run it once. It creates tables, RLS, invitation functions, triggers, and Realtime publication.
3. In **Project Settings → API** (or the Connect dialog), copy your Project URL and **publishable key** (legacy `anon` also works). Never use `service_role` or a secret key.
4. In **Authentication → Providers → Email**, enable Email and email confirmation. Keep the standard magic-link template containing `{{ .ConfirmationURL }}`. This app uses passwordless magic links, not passwords or an OTP-code form.
5. In **Authentication → URL Configuration**, set Site URL to `https://marcusshih.github.io/chloe-nyc-expenses/`. Add redirect URLs `https://marcusshih.github.io/chloe-nyc-expenses/**` and `http://localhost:3000/**`. The wildcard preserves the optional invitation query parameter. If using a different GitHub owner, replace the hostname.
6. For reliable delivery to both accounts, configure your SMTP provider under Authentication email settings. Supabase's built-in testing sender can restrict recipients and impose low limits; check the dashboard's current limits. Never put SMTP credentials in this project.

Reference: [Supabase passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Realtime](https://supabase.com/docs/guides/realtime/postgres-changes).

## 2. Run locally

Requires Node 22+.

```sh
cd chloe-nyc-expenses
cp .env.example .env.local
# Fill in the URL and publishable key in .env.local; leave BASE_PATH empty.
npm ci
npm test
npm run dev
```

Open http://localhost:3000. Configuration is compiled into the static site; restart dev or rebuild after changing it. Without credentials the app displays a setup screen. No fake expenses or browser-only database are used. Supabase may persist its authentication session in browser storage; all trip data lives in PostgreSQL.

## 3. Create the shared trip

1. Marcus signs in with his own email, opens the email link, chooses **Marcus**, and creates the NYC trip. Chloe can instead create first as **Chloe**.
2. The creator clicks **Invite**, enters the partner's exact sign-in email, creates the invitation, and privately shares the link.
3. The partner opens the link, signs in with the matching email, and clicks **Join trip**. If signing in separately, paste the invitation link or 64-character code into the join form.
4. Both phones now access the same trip. Each account can belong to one trip and each trip has exactly one available slot for each name. The database assigns the invited name; the recipient cannot choose another role.

Invitation tokens contain 256 random bits, are stored only as SHA-256 hashes, expire after 48 hours, are bound to a confirmed email, and are single-use. A new invitation invalidates earlier invitations. Trip-row locking serializes redemption. There are no direct client writes to membership or invitations.

## 4. Publish to GitHub Pages

The public repository is https://github.com/marcusshih/chloe-nyc-expenses and the Pages source is already configured to GitHub Actions. The creation commands below are for reproducing setup; skip them for the existing repository.

The app folder intentionally has no `.git`: the surrounding directory is an existing coursework repository. Publish only this app's files, not coursework. Use a separate checkout outside that repository, for example:

```sh
# Run these from the coursework root after installing GitHub CLI.
gh auth login
# Skip creation if the repository already exists.
gh repo create marcusshih/chloe-nyc-expenses --public --description 'Shared NYC trip expenses'
# Use an unused destination outside the coursework repository.
git clone https://github.com/marcusshih/chloe-nyc-expenses.git /private/tmp/chloe-nyc-publish
rsync -av --exclude=.git --exclude=node_modules --exclude=.next --exclude=out --exclude=.env.local --exclude='.env.production*' chloe-nyc-expenses/ /private/tmp/chloe-nyc-publish/
cd /private/tmp/chloe-nyc-publish
git switch -c main
git add .
git commit -m 'Build shared NYC expense tracker'
git push -u origin main
```

Before pushing, in the new repository's **Settings → Secrets and variables → Actions → Variables**, add:

- `NEXT_PUBLIC_SUPABASE_URL`: your project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: your publishable/anon key

These two values are intentionally public browser configuration; RLS enforces access. Never add a service-role key. Under **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**. The workflow tests, exports Next.js with `/chloe-nyc-expenses` as both base path and asset prefix, uploads `out/`, and deploys Pages. If the first run predates configuration, rerun **Actions → Deploy trip to GitHub Pages → Run workflow**. When both variables are absent, the workflow warns and publishes the setup screen. If only one is set, the build fails. Add both and rerun to activate the tracker.

Expected URL after a successful deployment: https://marcusshih.github.io/chloe-nyc-expenses/ . This URL is an expected destination, not proof of deployment. Confirm the Actions deployment succeeds and then visit it on both phones.

[Next.js static export](https://nextjs.org/docs/app/guides/static-exports) is enabled with `output: 'export'`. Production uses webpack for a reproducible build in environments that restrict Turbopack subprocesses. Local dev uses the same webpack compiler. No network font downloads are required.

## Money and behavior

- Monetary amounts are integer cents from validated decimal strings; the UI accepts $0.01–$1,000,000 per expense. Expenses are restricted to the six trip dates by both the UI and SQL.
- Shared odd cents consistently go to Marcus: $0.01 allocates Marcus 1¢, Chloe 0¢. Personal expenses allocate 100% to the named person, regardless of who paid.
- Settlement = amount Marcus paid minus Marcus's responsibility. Positive: Chloe owes Marcus; negative: Marcus owes Chloe.
- Totals, settlement, and category breakdown always cover the whole trip. Date filtering changes the expense list and CSV export only.
- Edits/deletes use `updated_at` optimistic concurrency checks. Stale forms report a conflict instead of overwriting a partner's changes. Deletion requires a confirmation dialog.
- Realtime listens to RLS-protected trip UPDATE events. An expense trigger touches the parent trip for every insert, update, or delete, and the client refetches authorized rows. This also handles deletes without exposing unfiltered expense DELETE events. Subscriptions and event listeners clean up on trip change/unmount. Reconnect, focus, and a 30-second fallback refresh recover missed changes. A sync status indicates connection state; failures are surfaced.
- CSV exports exactly two decimal places, escapes quotes and line breaks, and neutralizes formula-leading content.

## Verify before the trip

```sh
npm test
NEXT_PUBLIC_BASE_PATH=/chloe-nyc-expenses npm run build
```

Then test with actual Supabase credentials:

1. Sign in in separate browser profiles with Marcus and Chloe. Create and join the trip.
2. Add a shared $51 expense paid by Marcus. Both phones should show $51 total and “Chloe owes Marcus $25.50”.
3. Add $0.01 shared, personal expenses paid by the other person, and verify settlement.
4. Edit and delete on each phone; confirm the other phone refreshes, including on reconnect. Open the same expense on both phones to confirm a stale edit is rejected.
5. Check date filtering, CSV, keyboard focus, dialog Escape, and 390px iPhone layout.
6. Sign in as a third, unrelated account: it must see none of this trip. Direct REST reads of the trip/expenses should return no rows; mutations should fail. Test invitations with a wrong email, expired/reused token, and anonymous access. These checks require a real Supabase instance; unit tests do not prove deployed RLS or synchronization.

## Structure

- `app/page.js`: browser auth, onboarding, expense forms, dashboard, Realtime lifecycle
- `app/globals.css`: Tailwind entry and warm sage responsive styling
- `app/layout.js`: metadata and viewport
- `lib/supabase.js`: singleton public browser client
- `lib/money.js`: pure cent math, summaries, CSV
- `supabase/migrations/001_trip.sql`: schema, scoped RPCs, RLS, Realtime
- `tests/money.test.js`: monetary invariants and CSV tests
- `.github/workflows/deploy.yml`: static Pages build/deploy
- `.env.example`: configuration template; actual env files are ignored

## Verification status

Money and CSV unit tests run locally. Supabase project setup, real email sign-in, invitation acceptance, deployed RLS, and two-device Realtime require your Supabase project and are not verified until the checklist above is completed.
