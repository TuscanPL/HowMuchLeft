-- Households are private to their members; bank secrets never reach a browser.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into public.signup_allowlist (entry) values ('@rls.test') on conflict do nothing;
insert into auth.users (id, email) values
  ('10000000-0000-4000-a000-000000000001', 'a@rls.test'),
  ('10000000-0000-4000-a000-000000000002', 'b@rls.test'),
  ('10000000-0000-4000-a000-000000000003', 'stranger@rls.test');

-- a creates a budget and invites b.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-a000-000000000001"}', true);
select set_config('t.hh', (public.create_household('Test budget')).id::text, true);
select is((select count(*)::int from public.categories), 12, 'new budget gets default categories');
insert into public.household_invites (household_id, created_by)
values (current_setting('t.hh')::uuid, '10000000-0000-4000-a000-000000000001');
select set_config('t.token', (select token from public.household_invites limit 1), true);

reset role;
insert into public.bank_connections (id, household_id, created_by, aspsp_name, status)
values ('10000000-0000-4000-c000-000000000001', current_setting('t.hh')::uuid,
        '10000000-0000-4000-a000-000000000001', 'ING', 'active');
insert into public.bank_connection_secrets (connection_id, session_id, auth_state)
values ('10000000-0000-4000-c000-000000000001', 'secret-session', 'secret-state');
insert into public.accounts (id, household_id, connection_id, external_uid, name)
values ('10000000-0000-4000-d000-000000000001', current_setting('t.hh')::uuid,
        '10000000-0000-4000-c000-000000000001', 'uid-1', 'Konto');
insert into public.transactions (household_id, account_id, external_id, booked_on, amount, description)
values (current_setting('t.hh')::uuid, '10000000-0000-4000-d000-000000000001', 'x1', current_date, -10, 'coffee');

-- The stranger sees nothing and can't join without the invite.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-a000-000000000003"}', true);
select is((select count(*)::int from public.households), 0, 'stranger sees no household');
select is((select count(*)::int from public.transactions), 0, 'stranger sees no transactions');
select is((select count(*)::int from public.categories), 0, 'stranger sees no categories');
select throws_ok(
  $$ insert into public.bills (household_id, name, amount, due_day)
     values (current_setting('t.hh')::uuid, 'x', 1, 1) $$,
  '42501', null, 'stranger cannot add bills');

-- b joins with the invite and sees everything.
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-a000-000000000002"}', true);
select is(public.redeem_invite(current_setting('t.token')), current_setting('t.hh')::uuid, 'b joins');
select is((select count(*)::int from public.transactions), 1, 'b sees the shared transactions');
select is((select count(*)::int from public.profiles), 2, 'b sees both profiles');

-- Bank consent secrets stay server-side.
select is((select status::text from public.bank_connections), 'active', 'b sees connection status');
select throws_ok('select session_id from public.bank_connection_secrets', '42501', null,
                 'session ids are not readable');
select lives_ok('select * from public.bank_connections', 'connection rows are readable');
select throws_ok(
  $$ update public.bank_connections set status = 'active' $$,
  '42501', null, 'members cannot edit connections');

-- Bank fields of a synced transaction can't be rewritten; categories can.
select throws_ok($$ update public.transactions set amount = 1000 $$, '42501', null,
                 'amount is read-only');
select lives_ok(
  $$ update public.transactions set ignored = true, note = 'test', manual = true $$,
  'category fields are editable');

select * from finish();
rollback;
