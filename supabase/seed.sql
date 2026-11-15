-- Local development seed (runs on `supabase db reset`, never on `db push`).
-- Two people share the example budget. Sign in with either address via magic
-- link; the email lands in Mailpit at http://127.0.0.1:54324.

-- Local only: let the seed users and test addresses sign up.
insert into public.signup_allowlist (entry) values ('@example.com'), ('@test.local');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-00000000000a',
   'authenticated', 'authenticated', 'me@example.com', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Me"}', now(), now(),
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-00000000000b',
   'authenticated', 'authenticated', 'partner@example.com', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Partner"}', now(), now(),
   '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                             last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.id in ('00000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-00000000000b');

-- The budget, created the way the app does it (with the default categories).
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', false);
select set_config('hml.seed_household',
  (public.create_household('Our budget', 1::smallint)).id::text, false);
select set_config('request.jwt.claims', '', false);

insert into public.household_members (household_id, user_id, role)
values (current_setting('hml.seed_household')::uuid, '00000000-0000-4000-a000-00000000000b',
        'member');

-- Accounts as if synced from the banks (no consent secrets: Sync skips them).
insert into public.bank_connections (id, household_id, created_by, aspsp_name, status,
                                     valid_until, last_synced_at)
values
  ('00000000-0000-4000-c000-000000000001', current_setting('hml.seed_household')::uuid,
   '00000000-0000-4000-a000-00000000000a', 'Bank Millennium', 'active',
   now() + interval '150 days', now() - interval '3 hours'),
  ('00000000-0000-4000-c000-000000000002', current_setting('hml.seed_household')::uuid,
   '00000000-0000-4000-a000-00000000000b', 'ING Bank Śląski', 'active',
   now() + interval '120 days', now() - interval '3 hours');

insert into public.accounts (id, household_id, connection_id, external_uid, owner_id, name,
                             iban, balance, balance_at, include_in_pocket)
values
  ('00000000-0000-4000-d000-000000000001', current_setting('hml.seed_household')::uuid,
   '00000000-0000-4000-c000-000000000001', 'seed-millennium-1',
   '00000000-0000-4000-a000-00000000000a', 'Konto 360°',
   'PL27116022020000000123456789', 4210.55, now(), true),
  ('00000000-0000-4000-d000-000000000002', current_setting('hml.seed_household')::uuid,
   '00000000-0000-4000-c000-000000000002', 'seed-ing-1',
   '00000000-0000-4000-a000-00000000000b', 'Konto Direct',
   'PL10105000997603123456789123', 3120.10, now(), true),
  ('00000000-0000-4000-d000-000000000003', current_setting('hml.seed_household')::uuid,
   '00000000-0000-4000-c000-000000000002', 'seed-ing-2',
   '00000000-0000-4000-a000-00000000000b', 'Otwarte Konto Oszczędnościowe',
   'PL61105000997603987654321000', 15000, now(), false);

-- Plan: income, bills, goals, a few budgets and rules.
insert into public.incomes (household_id, name, amount, pay_day, match)
values
  (current_setting('hml.seed_household')::uuid, 'My salary', 7200, 15, 'wynagrodzenie acme'),
  (current_setting('hml.seed_household')::uuid, 'Partner''s salary', 6400, 1, 'pensja');

-- A category of our own for the side project.
insert into public.categories (household_id, name, emoji, kind, position)
values (current_setting('hml.seed_household')::uuid, 'Superprofit', '🚀', 'expense', 86);

-- Bills, grouped by category; two of them yearly.
insert into public.bills (household_id, name, amount, due_day, match, category_id,
                          every_months, due_month, spread)
select current_setting('hml.seed_household')::uuid, b.name, b.amount, b.due_day, b.match, c.id,
       b.every_months, b.due_month, b.spread
from (values
  ('Rent', 3400, 5, 'czynsz', 'Home', 1, null, false),
  ('Phone & internet', 120, 20, 'orange', 'Bills', 1, null, false),
  ('Gym', 139, 3, 'zdrofit', 'Health', 1, null, false),
  ('Netflix', 60, 15, 'netflix', 'Subscriptions', 1, null, false),
  ('Spotify Duo', 30, 12, 'spotify', 'Subscriptions', 1, null, false),
  ('iCloud+ yearly', 499, 20, 'apple.com/bill', 'Subscriptions', 12, 3, true),
  ('Domain superprofit.pl', 120, 8, 'home.pl', 'Superprofit', 12, 6, false),
  ('Developer', 1000, 10, 'superprofit dev', 'Superprofit', 1, null, false)
) as b (name, amount, due_day, match, category, every_months, due_month, spread)
join public.categories c on c.household_id = current_setting('hml.seed_household')::uuid
                        and c.name = b.category;

insert into public.goals (household_id, name, emoji, target, saved, monthly_contribution)
values (current_setting('hml.seed_household')::uuid, 'Holiday in Portugal', '🏖️', 8000, 2500, 800),
       (current_setting('hml.seed_household')::uuid, 'Emergency fund', '🛟', 20000, 15000, 500);

update public.categories set monthly_limit = l.amount
from (values ('Groceries', 2000), ('Eating out', 600), ('Fun', 400)) as l (name, amount)
where categories.household_id = current_setting('hml.seed_household')::uuid
  and categories.name = l.name;

insert into public.rules (household_id, match, category_id)
select current_setting('hml.seed_household')::uuid, r.match, c.id
from (values ('biedronka', 'Groceries'), ('lidl', 'Groceries'), ('zabka', 'Groceries'),
             ('ztm', 'Transport'), ('uber', 'Transport'), ('pyszne', 'Eating out'),
             ('rossmann', 'Health')) as r (match, category)
join public.categories c on c.household_id = current_setting('hml.seed_household')::uuid
                        and c.name = r.category;

-- Transactions over the last ~40 days; the trigger sorts them by the rules above.
insert into public.transactions (household_id, account_id, external_id, booked_on, amount,
                                 description, counterparty, counterparty_iban)
select current_setting('hml.seed_household')::uuid, t.account::uuid, 'seed-' || t.n,
       current_date - t.days_ago, t.amount, t.description, t.counterparty, t.iban
from (values
  (1, '00000000-0000-4000-d000-000000000001', 1, -84.37, 'Płatność kartą BIEDRONKA 1234 WARSZAWA', 'BIEDRONKA', null),
  (2, '00000000-0000-4000-d000-000000000001', 2, -23.50, 'Płatność kartą ZABKA Z1234', 'ZABKA', null),
  (3, '00000000-0000-4000-d000-000000000002', 2, -112.00, 'PYSZNE.PL zamowienie', 'PYSZNE.PL', null),
  (4, '00000000-0000-4000-d000-000000000002', 3, -3400.00, 'Czynsz listopad', 'Jan Kowalski', 'PL50102010260000042270201111'),
  (5, '00000000-0000-4000-d000-000000000001', 4, -1500.00, 'Przelew własny na wspólne', 'Konto Direct', 'PL10105000997603123456789123'),
  (6, '00000000-0000-4000-d000-000000000002', 4, 1500.00, 'Przelew własny na wspólne', 'Konto 360', 'PL27116022020000000123456789'),
  (7, '00000000-0000-4000-d000-000000000001', 5, -259.99, 'Allegro zakupy', 'ALLEGRO', null),
  (8, '00000000-0000-4000-d000-000000000002', 6, -42.00, 'UBER *TRIP', 'UBER', null),
  (9, '00000000-0000-4000-d000-000000000001', 8, -139.00, 'ZDROFIT karnet', 'ZDROFIT', null),
  (10, '00000000-0000-4000-d000-000000000002', 12, 6400.00, 'Pensja 11/2026', 'Firma Sp. z o.o.', null),
  (11, '00000000-0000-4000-d000-000000000001', 12, -310.12, 'LIDL SP. Z O.O. WARSZAWA', 'LIDL', null),
  (12, '00000000-0000-4000-d000-000000000001', 15, -60.00, 'NETFLIX.COM', 'NETFLIX', null),
  (13, '00000000-0000-4000-d000-000000000001', 26, 7200.00, 'Wynagrodzenie ACME 10/2026', 'ACME S.A.', null),
  (14, '00000000-0000-4000-d000-000000000002', 35, -3400.00, 'Czynsz październik', 'Jan Kowalski', 'PL50102010260000042270201111'),
  (15, '00000000-0000-4000-d000-000000000001', 36, -95.40, 'ROSSMANN 123', 'ROSSMANN', null)
) as t (n, account, days_ago, amount, description, counterparty, iban);

-- An event: beers at a friend's place three days ago. Two of my charges from
-- that evening are in it, one from the same day isn't (a suggestion to add).
insert into public.events (id, household_id, created_by, name, emoji, budget, started_at, ended_at)
values ('00000000-0000-4000-f000-000000000001', current_setting('hml.seed_household')::uuid,
        '00000000-0000-4000-a000-00000000000a', 'Beers at Kasia''s', '🍺', 150,
        ((current_date - 3) + time '19:30') at time zone 'Europe/Warsaw',
        ((current_date - 3) + time '23:45') at time zone 'Europe/Warsaw');
insert into public.transactions (household_id, account_id, external_id, booked_on, amount,
                                 description, counterparty, event_id)
values
  (current_setting('hml.seed_household')::uuid, '00000000-0000-4000-d000-000000000001', 'seed-ev-1',
   current_date - 3, -64.00, 'Płatność kartą PIWNICA POD BARANAMI', 'PIWNICA POD BARANAMI',
   '00000000-0000-4000-f000-000000000001'),
  (current_setting('hml.seed_household')::uuid, '00000000-0000-4000-d000-000000000001', 'seed-ev-2',
   current_date - 3, -38.50, 'Płatność kartą ZABKA Z5678', 'ZABKA',
   '00000000-0000-4000-f000-000000000001'),
  (current_setting('hml.seed_household')::uuid, '00000000-0000-4000-d000-000000000001', 'seed-ev-3',
   current_date - 3, -27.00, 'UBER *TRIP', 'UBER', null);

-- A secret goal: only Me sees it; Partner sees "Private savings 300 zł" in the pocket.
insert into public.goals (household_id, name, emoji, target, saved, monthly_contribution, private_to)
values (current_setting('hml.seed_household')::uuid, 'Anniversary trip surprise', '🎁', 3000, 600, 300,
        '00000000-0000-4000-a000-00000000000a');
