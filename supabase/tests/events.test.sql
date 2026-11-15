-- Events: check-in, one open event per person, tags that survive booking, privacy.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into public.signup_allowlist (entry) values ('@event.test') on conflict do nothing;
insert into auth.users (id, email) values
  ('40000000-0000-4000-a000-000000000001', 'me@event.test'),
  ('40000000-0000-4000-a000-000000000002', 'her@event.test'),
  ('40000000-0000-4000-a000-000000000003', 'stranger@event.test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-a000-000000000001"}', true);
select set_config('t.hh', (public.create_household('Event budget')).id::text, true);
reset role;
insert into public.household_members (household_id, user_id)
values (current_setting('t.hh')::uuid, '40000000-0000-4000-a000-000000000002');
insert into public.accounts (id, household_id, external_uid, owner_id, name)
values ('40000000-0000-4000-d000-000000000001', current_setting('t.hh')::uuid, 'ev-acc',
        '40000000-0000-4000-a000-000000000001', 'Mine');
insert into public.transactions (id, household_id, account_id, external_id, status, booked_on, amount, description)
values ('40000000-0000-4000-e000-000000000001', current_setting('t.hh')::uuid,
        '40000000-0000-4000-d000-000000000001', 'p:CARD1', 'pending', current_date, -45.50, 'PUB POD KRETEM'),
       ('40000000-0000-4000-e000-000000000002', current_setting('t.hh')::uuid,
        '40000000-0000-4000-d000-000000000001', 'p:', 'pending', current_date, -12.00, 'ZABKA');
set local role authenticated;

select set_config('t.ev1', (public.event_check_in(current_setting('t.hh')::uuid, 'Beers at Kasia''s', '🍺', 150)).id::text, true);
select results_eq(
  $$ select name, emoji, budget, created_by, ended_at is null from public.events where id = current_setting('t.ev1')::uuid $$,
  $$ values ('Beers at Kasia''s'::text, '🍺'::text, 150.00::numeric, '40000000-0000-4000-a000-000000000001'::uuid, true) $$,
  'checking in starts an open event');

-- Checking in again closes the first one.
select set_config('t.ev2', (public.event_check_in(current_setting('t.hh')::uuid, 'Kebab')).id::text, true);
select isnt((select ended_at from public.events where id = current_setting('t.ev1')::uuid), null,
            'a new check-in closes the open event');
select is((select count(*)::int from public.events where ended_at is null), 1, 'one open event per person');

-- An event left open for days closes at the end of the day after it started.
select is(public.event_auto_end('2026-11-14 18:00+01'), '2026-11-15 23:59:59+01'::timestamptz,
          'auto end is the end of the next day in Warsaw');

-- Tagging a charge keeps its category and doesn't make it manual.
update public.transactions set event_id = current_setting('t.ev1')::uuid
where id = '40000000-0000-4000-e000-000000000001';
select results_eq(
  $$ select event_id, manual from public.transactions where id = '40000000-0000-4000-e000-000000000001' $$,
  $$ values (current_setting('t.ev1')::uuid, false) $$,
  'a member tags a charge with the event');

-- Direct inserts are refused; check-ins go through event_check_in.
select throws_ok(
  $$ insert into public.events (household_id, name) values (current_setting('t.hh')::uuid, 'Sneaky') $$,
  '42501', null, 'events are created by checking in');

-- The bank books the pending card payment as a new row: the event comes along.
reset role;
insert into public.transactions (household_id, account_id, external_id, status, booked_on, amount, description)
values (current_setting('t.hh')::uuid, '40000000-0000-4000-d000-000000000001', 'CARD1', 'booked',
        current_date + 2, -45.50, 'PUB POD KRETEM');
select is((select event_id from public.transactions where external_id = 'CARD1'),
          current_setting('t.ev1')::uuid, 'the booked payment keeps the pending one''s event');
-- A booked charge with no matching tagged pending row stays untagged.
insert into public.transactions (household_id, account_id, external_id, status, booked_on, amount, description)
values (current_setting('t.hh')::uuid, '40000000-0000-4000-d000-000000000001', 'OTHER', 'booked',
        current_date, -99.00, 'LIDL');
select is((select event_id from public.transactions where external_id = 'OTHER'), null,
          'unrelated bookings are not tagged');
set local role authenticated;

-- My partner sees and can edit the event.
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-a000-000000000002"}', true);
select is((select count(*)::int from public.events), 2, 'my partner sees our events');
update public.events set budget = 200 where id = current_setting('t.ev1')::uuid;
select is((select budget from public.events where id = current_setting('t.ev1')::uuid), 200.00::numeric,
          'my partner can change the budget');

-- Deleting an event leaves its charges, untagged.
delete from public.events where id = current_setting('t.ev1')::uuid;
select is((select count(*)::int from public.transactions where event_id is not null), 0,
          'deleting an event untags its charges');

-- A stranger sees nothing.
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-a000-000000000003"}', true);
select throws_ok(
  $$ select public.event_check_in(current_setting('t.hh')::uuid, 'Party crasher') $$,
  '42501', null, 'a stranger cannot check in to our budget');

select * from finish();
rollback;
