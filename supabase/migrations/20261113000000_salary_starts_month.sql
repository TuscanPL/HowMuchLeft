-- Budget months start with the first salary to arrive (see packages/shared/src/dates.ts).
-- An income marked as a payday can start the month; a smaller regular transfer
-- in (e.g. a parent's allowance) is still income but doesn't move the month.
alter table public.incomes add column starts_month boolean not null default true;

-- Salary arrivals decide where months start, so the app reads them on their own.
create index transactions_income_idx on public.transactions (household_id, booked_on)
  where income_id is not null;
