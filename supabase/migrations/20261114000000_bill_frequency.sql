-- Bills that aren't monthly (yearly subscriptions, quarterly payments), and a
-- Subscriptions category so bills can be grouped (see packages/shared/src/bills.ts).
alter table public.bills
  add column every_months smallint not null default 1
    check (every_months in (1, 2, 3, 6, 12)),
  -- For a bill not paid monthly: a month (1–12) it's paid in.
  add column due_month smallint check (due_month between 1 and 12),
  -- Set aside a share every month instead of all in the month it's due.
  add column spread boolean not null default false,
  add constraint bills_due_month_needed check (every_months = 1 or due_month is not null);

-- New budgets get a Subscriptions category; existing ones too.
create or replace function public.create_household(p_name text, p_period_start_day smallint default 1)
returns public.households
language plpgsql security definer set search_path = ''
as $$
declare
  v_household public.households;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.households (name, period_start_day, created_by)
  values (p_name, coalesce(p_period_start_day, 1), auth.uid())
  returning * into v_household;

  insert into public.household_members (household_id, user_id, role)
  values (v_household.id, auth.uid(), 'owner');

  -- A starting set of categories; everything is editable.
  insert into public.categories (household_id, name, emoji, kind, position) values
    (v_household.id, 'Groceries', '🛒', 'expense', 10),
    (v_household.id, 'Eating out', '🍽️', 'expense', 20),
    (v_household.id, 'Transport', '🚌', 'expense', 30),
    (v_household.id, 'Home', '🏠', 'expense', 40),
    (v_household.id, 'Health', '💊', 'expense', 50),
    (v_household.id, 'Shopping', '🛍️', 'expense', 60),
    (v_household.id, 'Fun', '🎉', 'expense', 70),
    (v_household.id, 'Bills', '🧾', 'expense', 80),
    (v_household.id, 'Subscriptions', '📺', 'expense', 85),
    (v_household.id, 'Other', '💸', 'expense', 90),
    (v_household.id, 'Income', '💰', 'income', 100),
    (v_household.id, 'Savings', '🐷', 'savings', 110),
    (v_household.id, 'Between our accounts', '🔁', 'transfer', 120);

  return v_household;
end;
$$;

insert into public.categories (household_id, name, emoji, kind, position)
select h.id, 'Subscriptions', '📺', 'expense', 85
from public.households h
on conflict (household_id, name) do nothing;
