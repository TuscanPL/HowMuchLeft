-- The categorize trigger: transfers, bills, incomes, rules; manual edits win.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into public.signup_allowlist (entry) values ('@cat.test') on conflict do nothing;
insert into auth.users (id, email) values ('20000000-0000-4000-a000-000000000001', 'a@cat.test');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-a000-000000000001"}', true);
select set_config('t.hh', (public.create_household('Cat budget')).id::text, true);

create temp table ids as
select
  (select id from public.categories where household_id = current_setting('t.hh')::uuid and name = 'Groceries') as groceries,
  (select id from public.categories where household_id = current_setting('t.hh')::uuid and name = 'Fun') as fun,
  (select id from public.categories where household_id = current_setting('t.hh')::uuid and kind = 'transfer') as transfer,
  (select id from public.categories where household_id = current_setting('t.hh')::uuid and kind = 'income') as income;

insert into public.accounts (id, household_id, name, iban) values
  ('20000000-0000-4000-d000-000000000001', current_setting('t.hh')::uuid, 'Mine', 'PL11111111111111111111111111'),
  ('20000000-0000-4000-d000-000000000002', current_setting('t.hh')::uuid, 'Hers', 'PL22222222222222222222222222');
insert into public.rules (household_id, match, category_id)
select current_setting('t.hh')::uuid, 'biedronka', groceries from ids;
insert into public.bills (id, household_id, name, amount, due_day, match)
values ('20000000-0000-4000-e000-000000000001', current_setting('t.hh')::uuid, 'Phone', 50, 20, 'orange');
insert into public.incomes (id, household_id, name, amount, match)
values ('20000000-0000-4000-e000-000000000002', current_setting('t.hh')::uuid, 'Salary', 5000, 'acme');

create function pg_temp.add(p_id text, p_amount numeric, p_desc text, p_iban text default null)
returns public.transactions language sql as $$
  insert into public.transactions (household_id, account_id, external_id, booked_on, amount,
                                   description, counterparty_iban)
  values (current_setting('t.hh')::uuid, '20000000-0000-4000-d000-000000000001', p_id,
          current_date, p_amount, p_desc, p_iban)
  returning *;
$$;

select is((pg_temp.add('r', -20, 'Płatność BIEDRONKA 99')).category_id, (select groceries from ids), 'rule matches, case-insensitive');
select is((pg_temp.add('b', -50, 'ORANGE POLSKA faktura')).bill_id, '20000000-0000-4000-e000-000000000001'::uuid, 'bill matches');
select is((pg_temp.add('i', 5000, 'Wynagrodzenie ACME')).category_id, (select income from ids), 'income gets the income category');
select is((pg_temp.add('i2', 5000, 'ORANGE refund')).bill_id, null, 'money in never matches a bill');
select is((pg_temp.add('t', -100, 'Przelew', 'PL 2222 2222 2222 2222 2222 2222 22')).category_id, (select transfer from ids),
          'own IBAN is a transfer');
select is((pg_temp.add('u', -5, 'something else')).category_id, null, 'no match stays uncategorised');

-- A person's choice survives re-syncs and recategorize().
update public.transactions set category_id = (select fun from ids), manual = true where external_id = 'r';
update public.transactions set description = 'BIEDRONKA again' where external_id = 'r';
select is((select category_id from public.transactions where external_id = 'r'), (select fun from ids), 'manual choice kept on bank update');

-- A new rule applies to old transactions once recategorize() runs.
insert into public.rules (household_id, match, category_id)
select current_setting('t.hh')::uuid, 'something', fun from ids;
select is((select category_id from public.transactions where external_id = 'u'), null, 'rule does not apply by itself');
set local role authenticated;
select ok(public.recategorize(current_setting('t.hh')::uuid) >= 5, 'recategorize runs');
reset role;
select is((select category_id from public.transactions where external_id = 'u'), (select fun from ids), 'new rule applied');

select * from finish();
rollback;
