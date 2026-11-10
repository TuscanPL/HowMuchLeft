-- Paydays are shared within the household and private to it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into public.signup_allowlist (entry) values ('@pay.test') on conflict do nothing;
insert into auth.users (id, email) values
  ('30000000-0000-4000-a000-000000000001', 'a@pay.test'),
  ('30000000-0000-4000-a000-000000000002', 'stranger@pay.test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-000000000001"}', true);
select set_config('t.hh', (public.create_household('Pay budget')).id::text, true);

select lives_ok(
  $$ insert into public.paydays (household_id, starts_on) values (current_setting('t.hh')::uuid, '2026-11-08') $$,
  'a member marks a payday');
select throws_ok(
  $$ insert into public.paydays (household_id, starts_on) values (current_setting('t.hh')::uuid, '2026-11-08') $$,
  '23505', null, 'the same day only once');

select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-000000000002"}', true);
select is((select count(*)::int from public.paydays), 0, 'a stranger sees no paydays');
select throws_ok(
  $$ insert into public.paydays (household_id, starts_on) values (current_setting('t.hh')::uuid, '2026-12-08') $$,
  '42501', null, 'a stranger cannot mark one');

select * from finish();
rollback;
