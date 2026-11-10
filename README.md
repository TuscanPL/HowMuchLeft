# HowMuchLeft

A budgeting app for two, PocketGuard style. Both partners' bank accounts (Bank Millennium, ING Bank Śląski, or any other Polish bank on PSD2) sync in. Bills, savings goals and what's already been spent are taken off the month's income. One number is left: **what's in our pocket**, plus how much that is per day until the month ends.

Same stack as [Rently](https://github.com/TuscanPL/Rently): a static Vue 3 PWA on **GitHub Pages**, a **Supabase free-tier** project as the backend, and Google (or magic-link) sign-in limited to an allowlist. Bank data comes through **Enable Banking**, which is free for linking your own accounts. Hosting costs nothing.

## Repo layout

```
apps/web            Vue 3 + Vite PWA (hash routing, Pinia, Tailwind, vue-i18n)
packages/shared     budget-month dates, the pocket calculation, money helpers, DB types
packages/edge       edge function logic: Enable Banking client, sync (typed + tested in Node)
supabase/           migrations, seed, pgTAP tests, edge functions (bank, bank-sync)
.github/workflows   CI, Pages deploy, Supabase deploy, daily bank sync
```

## How the number is worked out

For the current budget month (it starts on payday; set the day in Settings):

```
in my pocket = income − bills − goals − spent so far
```

- **Income**: every expected income (salaries) counts its amount until the transfer arrives, then the real amount. Any other money in counts too, except transfers between your own accounts and refunds.
- **Bills**: every active bill (rent, phone, subscriptions) is set aside up front. Once a bank payment contains the bill's match text (e.g. `czynsz`, `orange`), the bill is marked paid and the real amount counts.
- **Goals**: each goal's monthly amount is set aside until the goal is reached.
- **Spent**: money out in spending categories, plus uncategorised money out, that isn't a bill. A refund in a spending category reduces it.
- **Never counted**: transfers between your own accounts (spotted automatically by IBAN), savings movements, transactions you mark "leave out", and accounts with **In pocket** switched off (e.g. a savings account).

The pocket screen also shows the amount per day for the days left, bills still to pay, and each category against its optional budget. Arrows step back through past months.

**Sorting transactions.** When a transaction arrives, a database trigger tries these in order:

1. If the other side is one of your own accounts, it's a transfer.
2. If it contains a bill's match text, it's that bill.
3. If it contains an income's match text, it's that income.
4. Otherwise the longest matching rule decides ("biedronka" → Groceries).

When you pick a category on a transaction, tick **Always use this category** to make a rule from it. The rule is applied to older transactions too. A transaction you set by hand is never re-sorted, unless you tap **Sort automatically again**. Cash spending can be added by hand (**Activity → + Cash**).

## Setup

You need a GitHub account, a free [Supabase](https://supabase.com) account, the [Supabase CLI](https://supabase.com/docs/guides/cli) (or `pnpm dlx supabase`) and an [Enable Banking](https://enablebanking.com) account.

1. **Create a Supabase project** (free tier). Note the **project ref**, the **database password**, and from Project Settings → API the project URL and the `anon` key.
2. **Create an access token** at https://supabase.com/dashboard/account/tokens.
3. **Add the GitHub repo secrets** (Settings → Secrets and variables → Actions):

   | Secret                   | Value                                                  |
   | ------------------------ | ------------------------------------------------------ |
   | `SUPABASE_ACCESS_TOKEN`  | token from step 2                                      |
   | `SUPABASE_PROJECT_REF`   | project ref                                            |
   | `SUPABASE_DB_PASSWORD`   | database password                                      |
   | `CRON_SECRET`            | any random string, e.g. `openssl rand -hex 32`         |
   | `VITE_SUPABASE_URL`      | `https://<ref>.supabase.co`                            |
   | `VITE_SUPABASE_ANON_KEY` | the anon key (public by design; RLS protects the data) |

   Optional repo **variables**: `VITE_GOOGLE_AUTH=true` once Google sign-in is set up (step 6), and `VITE_BASE=/` for a custom domain.

   **Never** put the service-role key or the Enable Banking key in a `VITE_` variable.

4. **Enable Pages:** Settings → Pages → Source: **GitHub Actions**.
5. **Auth URLs** in Supabase (Authentication → URL Configuration):
   - Site URL: `https://<user>.github.io/HowMuchLeft/`
   - Redirect URLs: `https://<user>.github.io/HowMuchLeft/**` and `http://localhost:5173/**`
6. **Google sign-in** (same as Rently): create an OAuth client in Google Cloud (type _Web application_, authorised redirect URI `https://<ref>.supabase.co/auth/v1/callback`). Enable the Google provider under Authentication → Providers with its client id and secret, then set the `VITE_GOOGLE_AUTH=true` repo variable. Magic links keep working either way; for the code in the email, paste `supabase/templates/magic_link.html` into Authentication → Email Templates → Magic Link.
7. **Enable Banking** (bank sync):
   1. Sign up at https://enablebanking.com and open the Control Panel → **Applications** → register a new application in the **Production** environment. Let it generate the key pair and keep the downloaded private key (`.pem`). The application id is the key's id.
   2. Set the application's **redirect URLs** to `https://<user>.github.io/HowMuchLeft/bank-callback.html` (and `http://localhost:5173/bank-callback.html` for local work).
   3. Activate it in **restricted mode** by linking your own accounts in the Control Panel. That's free for personal use, with no contract. Link the Millennium and ING accounts of **both** of you: each person signs in to their own bank during linking, so do it together. The app can only read accounts linked there.
   4. Store the secrets for the edge functions:
      ```sh
      supabase link --project-ref <ref>
      supabase secrets set ENABLE_BANKING_APP_ID=<application id> \
        ENABLE_BANKING_PRIVATE_KEY="$(cat <application id>.pem)" \
        APP_URLS=https://<user>.github.io/HowMuchLeft/ \
        CRON_SECRET=<same value as the CRON_SECRET repo secret>
      ```
      If the key starts with `BEGIN RSA PRIVATE KEY`, convert it first: `openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem`.
8. **Deploy:** push to `main`, or run _Deploy Supabase_ and _Deploy web_ from the Actions tab. The app is at `https://<user>.github.io/HowMuchLeft/`.
9. **Let yourselves in.** Sign-ups are locked to `public.signup_allowlist`, which starts empty. In the Supabase SQL editor:
   ```sql
   insert into public.signup_allowlist (entry) values ('you@gmail.com'), ('her@gmail.com');
   ```
10. **First run:** one of you signs in and creates the budget (pick the payday as the start day). Then **Settings → Create invite link**, and send it to the other. Next, **Banks → Connect a bank** for each bank: each of you connects your own accounts, signing in at the bank. Finally, fill in **Plan**: incomes, bills (with match texts), goals and budgets.

### Bank sync

- The **Sync banks** workflow runs every morning at 03:30 UTC and pulls balances and the last few days of transactions for every connection. It re-reads 10 days back so late bookings and pending card payments that got booked are caught. The first sync of a new account reads 90 days back.
- **Sync now** on the Banks page syncs straight away. Banks let an app read an account 4 times a day on its own, but a sync you start yourself doesn't count against that.
- **Consents end.** PSD2 consents last up to 180 days (some banks give 90). The Banks page counts the days down. From two weeks before the end it shows **Reconnect**: go through the bank sign-in again. The accounts and their history stay; nothing is lost.
- Only read access is ever asked for. Your bank logins never pass through this app; you sign in on the bank's own page. The Enable Banking session id lives in `bank_connection_secrets`, a table no browser can read.
- If the pocket shows "A bank connection needs attention", open Banks: the connection shows the error or **Expired**.

The daily call also counts as project activity, so the free Supabase project doesn't pause.

## Local development

Requirements: Node 22+, pnpm 10, Docker.

```sh
pnpm install
pnpm build:functions                  # supabase start needs the function bundle
pnpm db:start                         # Postgres, Auth, Mailpit…
cp apps/web/.env.example apps/web/.env.local
# paste the anon key printed by `supabase start` into .env.local
pnpm dev                              # http://localhost:5173
```

- Sign-in emails land in **Mailpit** at http://127.0.0.1:54324.
- The seed creates _Our budget_, shared by `me@example.com` and `partner@example.com`, with a Millennium and an ING connection, salaries, bills, goals, rules and a few weeks of transactions. The seeded connections have no real consent, so **Sync now** does nothing for them.
- For real bank sync locally: `cp supabase/functions/.env.example supabase/functions/.env`, fill in a **sandbox** Enable Banking application, then `pnpm functions:serve`.
- `pnpm db:reset` re-applies migrations and the seed. `pnpm db:types` regenerates `packages/shared/src/database.ts` after a schema change.

### Tests

```sh
pnpm test        # unit tests; the bank-function integration test runs when the local stack is up
pnpm db:test     # pgTAP: allowlist, RLS and bank secrets, transaction sorting
```

The integration test (`packages/edge/src/bank.integration.test.ts`) uses the real database and a fake Enable Banking. It runs connect → first sync → booking a pending payment → re-sync (hand-made categories survive) → cron sync → disconnect.
