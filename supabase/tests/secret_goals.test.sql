-- Secret goals: only the owner sees one; the partner gets only a monthly total.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into public.signup_allowlist (entry) values ('@goal.test') on conflict do nothing;
insert into auth.users (id, email) values
  ('50000000-0000-4000-a000-000000000001', 'me@goal.test'),
  ('50000000-0000-4000-a000-000000000002', 'her@goal.test'),
  ('50000000-0000-4000-a000-000000000003', 'stranger@goal.test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-a000-000000000001"}', true);
select set_config('t.hh', (public.create_household('Goal budget')).id::text, true);
reset role;
insert into public.household_members (household_id, user_id)
values (current_setting('t.hh')::uuid, '50000000-0000-4000-a000-000000000002');
set local role authenticated;

-- I add a shared goal and a secret one.
insert into public.goals (household_id, name, target, saved, monthly_contribution)
values (current_setting('t.hh')::uuid, 'Holiday', 5000, 0, 500);
insert into public.goals (household_id, name, target, saved, monthly_contribution, private_to)
values (current_setting('t.hh')::uuid, 'Ring', 4000, 3800, 300, '50000000-0000-4000-a000-000000000001');
select is((select count(*)::int from public.goals), 2, 'I see both my goals');
select is(public.private_goals_monthly(current_setting('t.hh')::uuid), 0::numeric,
          'my own secret goal is not in my private total');

-- She sees only the shared one, and the secret one as a total (capped at what's left: 200).
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-a000-000000000002"}', true);
select is((select array_agg(name) from public.goals), array['Holiday'], 'she sees only the shared goal');
select is(public.private_goals_monthly(current_setting('t.hh')::uuid), 200::numeric,
          'she gets one total for my secret goal');
update public.goals set name = 'Peek' where private_to is not null;
delete from public.goals where private_to is not null;
reset role;
select is((select name from public.goals where private_to is not null and household_id = current_setting('t.hh')::uuid), 'Ring',
          'she cannot change or delete my secret goal');
set local role authenticated;
select throws_ok(
  $$ insert into public.goals (household_id, name, target, private_to)
     values (current_setting('t.hh')::uuid, 'Fake', 100, '50000000-0000-4000-a000-000000000001') $$,
  '42501', null, 'she cannot make a secret goal in my name');
select throws_ok(
  $$ update public.goals set private_to = '50000000-0000-4000-a000-000000000001' where name = 'Holiday' $$,
  '42501', null, 'she cannot hand a shared goal to me as secret');

-- Once it's reached, it no longer takes anything off.
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-a000-000000000001"}', true);
update public.goals set saved = 4000 where name = 'Ring';
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-a000-000000000002"}', true);
select is(public.private_goals_monthly(current_setting('t.hh')::uuid), 0::numeric,
          'a reached secret goal sets nothing aside');

-- A stranger gets nothing.
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-a000-000000000003"}', true);
select is((select count(*)::int from public.goals), 0, 'a stranger sees no goals');
select throws_ok($$ select public.private_goals_monthly(current_setting('t.hh')::uuid) $$,
  '42501', null, 'a stranger cannot read the private total');

select * from finish();
rollback;
