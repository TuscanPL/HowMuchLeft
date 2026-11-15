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

Each budget month is for a calendar month ("November budget"), and it **starts with the first salary to arrive** for it:

- With two salaries on different days (say hers on the 1st, mine on the 15th), whichever arrives first starts the month. The other is the month's **second influx**.
- Anything paid **from the 24th on counts for the next month**. A salary in the last week of October is November's: an early payday. That holds for a salary normally paid on the 26th, for one that came early, and even for one that's very late.
- Otherwise a salary belongs to the month whose expected payday it's closest to.
- Until a salary arrives, the month starts on the earliest expected payday. If one is late, the month rolls over on that day anyway, and the start moves once the money comes.
- A salary is recognised by its income's bank match text (Plan → Income). An income with **Payday** switched off (e.g. a small regular transfer) still counts as income but never starts a month. With no salaries set up, months start on the day set in Settings.

The Pocket screen shows the month, why it started ("started when Her salary arrived"), and each salary as arrived or expected. While a salary is still to come, it also shows **what you have until it lands**: income already in, minus bills paid or due by that day, minus spending so far, with the amount per day. If that's negative, it shows how much you'll be short.

Then for the whole month:

```
in my pocket = income − bills − goals − spent so far
```

- **Income**: every expected income (salaries) counts its amount until the transfer arrives, then the real amount. Any other money in counts too, except transfers between your own accounts and refunds.
- **Bills**: every active bill (rent, subscriptions, a developer you pay monthly) is set aside up front. Once a bank payment contains the bill's match text (e.g. `czynsz`, `netflix`), the bill is marked paid and the real amount counts. Bills can repeat **monthly, every 2 or 3 months, every 6 months or yearly**. A bill that isn't monthly is either set aside **a bit every month** (a yearly 499 zł → 41,58 zł a month, the default) or **all in the month it's paid**. Its payment never counts as spending. In **Plan → Bills**, bills are grouped by category (Home, Subscriptions, or one you add such as "Superprofit"), and each group shows what it costs per month on average.
- **Goals** (their own tab): each goal's monthly amount is set aside until the goal is reached. A goal can be **secret**, e.g. saving for a surprise: only the person who made it sees it. Its monthly amount still comes off the shared pocket, so the other person sees one **Private savings** line with the total and nothing else (no name, target or progress). The database enforces this, not just the app (`private_goals_monthly`). Bank transfers into it are not hidden in Activity.
- **Spent**: money out in spending categories, plus uncategorised money out, that isn't a bill. A refund in a spending category reduces it.
- **Never counted**: transfers between your own accounts (spotted automatically by IBAN), savings movements, transactions you mark "leave out", and accounts with **In pocket** switched off (e.g. a savings account).

**Salary not picked up?** If a salary wasn't matched (no bank sync for that account, or the match text is missing), use **Mark payday** under the pocket number. A marked payday counts like a salary arriving. There's one per month for the whole budget. If one of you already marked it and the other presses a few days later, nothing changes: the sheet says who started the month and when, and offers **Keep** or **Move the start to …**. The database enforces this too (`mark_payday`). A marked payday can be undone.

The pocket screen also shows the amount per day for the days left, bills still to pay, and each category against its optional budget. Arrows step back through past months.

**Sorting transactions.** When a transaction arrives, a database trigger tries these in order:

1. If the other side is one of your own accounts, it's a transfer.
2. If it contains a bill's match text, it's that bill.
3. If it contains an income's match text, it's that income.
4. Otherwise the longest matching rule decides ("biedronka" → Groceries).

A payment that is really a recurring cost can become a bill straight from **Activity**: open it and tap **Make this a bill**. The bill form opens filled in from the payment (name, amount, day, bank text, category), and it shows how many other payments contain the same text. Saving links this payment and those others to the new bill. When you pick a category on a transaction, tick **Always use this category** to make a rule from it. The rule is applied to older transactions too. A transaction you set by hand is never re-sorted, unless you tap **Sort automatically again**. Cash spending can be added by hand (**Activity → + Cash**).

**Events.** Going out or visiting someone? Tap **Check in** on the Pocket screen, name it ("Beers at Kasia's"), and optionally give it a budget. Tap **Check out** when you leave (forgot? it closes by itself at the end of the next day). The event then lists **your** charges dated on the event's days, and you tick the ones that belong to it. Banks only give a date, not a time, so nothing is added automatically. Cash added while you're checked in goes to the event unless you change it, and any transaction can be put in an event from Activity. An event is a tag on top of the category: it never changes the pocket number, it just shows what the evening cost (money a friend pays back lowers it). If a pending card payment you tagged gets booked as a new row, the tag moves with it. All events and their totals are under **Activity → Events**.

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
10. **First run:** one of you signs in and creates the budget. Then **Settings → Create invite link**, and send it to the other. Next, **Banks → Connect a bank** for each bank: each of you connects your own accounts, signing in at the bank. Finally, fill in **Plan**: both salaries with their usual day and bank match text (that is what starts each month), then bills (with match texts) and budgets. Goals go in the **Goals** tab.

### Bank sync

- The **Sync banks** workflow runs every morning at 03:30 UTC and pulls balances and the last few days of transactions for every connection. It re-reads 10 days back so late bookings and pending card payments that got booked are caught. The first sync of a new account reads 90 days back.
- **Opening the app** (or coming back to it) syncs by itself when the banks were last read more than an hour ago. While it runs, the Pocket screen says "Getting the latest from the banks…". A failed try waits 10 minutes before the next.
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
pnpm db:test     # pgTAP: allowlist, RLS and bank secrets, transaction sorting, paydays, events, secret goals
```

The integration test (`packages/edge/src/bank.integration.test.ts`) uses the real database and a fake Enable Banking. It runs connect → first sync → booking a pending payment → re-sync (hand-made categories survive) → cron sync → disconnect.
