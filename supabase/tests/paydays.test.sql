-- Paydays: shared within the household, private to it, one per budget month.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.signup_allowlist (entry) values ('@pay.test') on conflict do nothing;
insert into auth.users (id, email) values
  ('30000000-0000-4000-a000-000000000001', 'me@pay.test'),
  ('30000000-0000-4000-a000-000000000002', 'her@pay.test'),
  ('30000000-0000-4000-a000-000000000003', 'stranger@pay.test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-000000000002"}', true);
select set_config('t.hh', (public.create_household('Pay budget')).id::text, true);
reset role;
insert into public.household_members (household_id, user_id)
values (current_setting('t.hh')::uuid, '30000000-0000-4000-a000-000000000001');
set local role authenticated;

-- She presses on the 8th.
select is(
  (select created from public.mark_payday(current_setting('t.hh')::uuid, '2026-11-08')),
  true, 'her press starts the month');

-- I press two days later: nothing changes, and I learn she already did.
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-000000000001"}', true);
select results_eq(
  $$ select starts_on, created_by, created from public.mark_payday(current_setting('t.hh')::uuid, '2026-11-10') $$,
  $$ values ('2026-11-08'::date, '30000000-0000-4000-a000-000000000002'::uuid, false) $$,
  'my press two days later keeps her payday');
select is((select array_agg(starts_on) from public.paydays), array['2026-11-08'::date],
          'still one payday');

-- Moving it on purpose replaces it.
select is(
  (select created from public.mark_payday(current_setting('t.hh')::uuid, '2026-11-10', true)),
  true, 'moving the start on purpose');
select is((select array_agg(starts_on) from public.paydays), array['2026-11-10'::date],
          'the payday moved to the 10th');

-- Next month is a separate payday.
select is(
  (select created from public.mark_payday(current_setting('t.hh')::uuid, '2026-12-09')),
  true, 'a month later is a new payday');

select throws_ok(
  $$ insert into public.paydays (household_id, starts_on) values (current_setting('t.hh')::uuid, '2027-01-08') $$,
  '42501', null, 'direct inserts go through mark_payday');

select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-000000000003"}', true);
select is((select count(*)::int from public.paydays), 0, 'a stranger sees no paydays');
select throws_ok(
  $$ select * from public.mark_payday(current_setting('t.hh')::uuid, '2027-01-08') $$,
  '42501', null, 'a stranger cannot mark one');

select * from finish();
rollback;
