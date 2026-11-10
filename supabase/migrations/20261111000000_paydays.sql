-- Paydays marked by hand ("Payday!" button): the salary came early or late, so
-- the budget month starts that day instead of on households.period_start_day.
-- A marked day replaces the usual start day within 15 days of it
-- (see packages/shared/src/dates.ts).
create table public.paydays (
  household_id uuid not null references public.households (id) on delete cascade,
  starts_on date not null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (household_id, starts_on)
);

alter table public.paydays enable row level security;
create policy paydays_all on public.paydays for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

alter publication supabase_realtime add table public.paydays;
