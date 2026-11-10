-- HowMuchLeft: initial schema.
-- Everything lives in a household (a couple shares one). RLS limits every row to
-- household members; membership changes only go through security-definer RPCs.
-- Amounts are signed: negative = money out, positive = money in.

-- ---------------------------------------------------------------------------
-- Enums (mirrored in packages/shared/src/enums.ts)
-- ---------------------------------------------------------------------------
create type public.household_role as enum ('owner', 'member');
-- expense: counts as spending; income: counts as income;
-- transfer: moving money between our own accounts (ignored);
-- savings: money put aside for a goal (covered by the goals line, not spending).
create type public.category_kind as enum ('expense', 'income', 'transfer', 'savings');
create type public.connection_status as enum ('pending', 'active', 'expired', 'error', 'revoked');
create type public.tx_status as enum ('booked', 'pending');

-- ---------------------------------------------------------------------------
-- People and households
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  currency text not null default 'PLN' check (currency ~ '^[A-Z]{3}$'),
  -- The budget month starts on this day (e.g. 10 if the salary comes on the 10th).
  period_start_day smallint not null default 1 check (period_start_day between 1 and 28),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.household_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- 64 hex chars from two v4 UUIDs: ~244 random bits.
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_by uuid not null default auth.uid() references public.profiles (id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references public.profiles (id),
  used_at timestamptz
);
create index household_invites_household_idx on public.household_invites (household_id);

-- ---------------------------------------------------------------------------
-- Budget setup
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  emoji text not null default '💸',
  kind public.category_kind not null default 'expense',
  -- Optional monthly budget for an expense category.
  monthly_limit numeric(12, 2) check (monthly_limit is null or monthly_limit >= 0),
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);
create index categories_household_idx on public.categories (household_id, position);

-- Recurring bills: rent, phone, subscriptions. They are set aside up front.
create table public.bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  amount numeric(12, 2) not null check (amount > 0),
  due_day smallint not null check (due_day between 1 and 31),
  category_id uuid references public.categories (id) on delete set null,
  -- Case-insensitive text found in the bank description or counterparty; a match marks the bill paid.
  match text check (match is null or length(trim(match)) >= 3),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index bills_household_idx on public.bills (household_id);

-- Expected income each budget month (salaries, regular transfers in).
create table public.incomes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  amount numeric(12, 2) not null check (amount > 0),
  pay_day smallint not null default 1 check (pay_day between 1 and 31),
  match text check (match is null or length(trim(match)) >= 3),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index incomes_household_idx on public.incomes (household_id);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  emoji text not null default '🎯',
  target numeric(12, 2) not null check (target > 0),
  saved numeric(12, 2) not null default 0 check (saved >= 0),
  -- Set aside from "in my pocket" every budget month until the goal is reached.
  monthly_contribution numeric(12, 2) not null default 0 check (monthly_contribution >= 0),
  target_date date,
  created_at timestamptz not null default now()
);
create index goals_household_idx on public.goals (household_id);

-- "Always put transactions containing X into category Y."
create table public.rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  match text not null check (length(trim(match)) >= 2),
  category_id uuid not null references public.categories (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (household_id, match)
);
create index rules_household_idx on public.rules (household_id);

-- ---------------------------------------------------------------------------
-- Banks (Enable Banking, PSD2)
-- ---------------------------------------------------------------------------
-- One row per bank consent. Members read these; the edge functions write them.
create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  aspsp_name text not null,
  aspsp_country text not null default 'PL',
  status public.connection_status not null default 'pending',
  valid_until timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index bank_connections_household_idx on public.bank_connections (household_id);

-- The consent's handles, kept apart so no browser can ever read them: the
-- `state` sent to the bank and the Enable Banking session id. No client policies.
create table public.bank_connection_secrets (
  connection_id uuid primary key references public.bank_connections (id) on delete cascade,
  auth_state text unique,
  session_id text unique
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  connection_id uuid references public.bank_connections (id) on delete set null,
  -- Enable Banking's account uid; null for a manual account (e.g. cash).
  external_uid text unique,
  owner_id uuid references public.profiles (id) on delete set null,
  name text not null,
  iban text,
  currency text not null default 'PLN',
  balance numeric(14, 2),
  balance_at timestamptz,
  -- Off for e.g. a savings account: its balance and transactions stay out of the pocket.
  include_in_pocket boolean not null default true,
  created_at timestamptz not null default now()
);
create index accounts_household_idx on public.accounts (household_id);
create index accounts_iban_idx on public.accounts (household_id, iban);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  -- Stable id from the bank, or a hash of the fields for banks without one.
  external_id text not null,
  status public.tx_status not null default 'booked',
  booked_on date not null,
  amount numeric(14, 2) not null,
  currency text not null default 'PLN',
  description text not null default '',
  counterparty text,
  counterparty_iban text,
  category_id uuid references public.categories (id) on delete set null,
  bill_id uuid references public.bills (id) on delete set null,
  income_id uuid references public.incomes (id) on delete set null,
  note text,
  -- Leave out of every total (e.g. a one-off reimbursement between us).
  ignored boolean not null default false,
  -- Set by a person: rules no longer touch this row.
  manual boolean not null default false,
  created_at timestamptz not null default now(),
  unique (account_id, external_id)
);
create index transactions_household_date_idx
  on public.transactions (household_id, booked_on desc);

-- ---------------------------------------------------------------------------
-- Membership helpers (security definer so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------
create function public.is_household_member(p_household_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid()
  );
$$;

create function public.is_household_owner(p_household_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid() and role = 'owner'
  );
$$;

create function public.shares_household_with(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.household_members a
    join public.household_members b on b.household_id = a.household_id
    where a.user_id = auth.uid() and b.user_id = p_user_id
  );
$$;

-- ---------------------------------------------------------------------------
-- Profiles for new users
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Categorising transactions
-- ---------------------------------------------------------------------------
-- Fills category / bill / income on a transaction that nobody edited by hand:
--   1. money between two of our own accounts → the household's transfer category
--   2. a bill whose match text appears → that bill (and its category)
--   3. an income whose match text appears → that income (and the income category)
--   4. the longest matching rule → its category
-- An update re-runs it only when the bank text or amount changed, or when
-- recategorize() asks (it sets hml.recategorize for its own update).
create function public.categorize_transaction()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_text text := lower(coalesce(new.description, '') || ' ' || coalesce(new.counterparty, ''));
  v_iban text := upper(replace(coalesce(new.counterparty_iban, ''), ' ', ''));
  v_force boolean := coalesce(current_setting('hml.recategorize', true), '') = 'on';
  v_bill public.bills;
  v_income public.incomes;
begin
  if new.manual then
    return new;
  end if;
  if tg_op = 'UPDATE' and not v_force
     and new.description is not distinct from old.description
     and new.counterparty is not distinct from old.counterparty
     and new.counterparty_iban is not distinct from old.counterparty_iban
     and new.amount = old.amount then
    return new;
  end if;

  new.category_id := null;
  new.bill_id := null;
  new.income_id := null;

  if v_iban <> '' and exists (
    select 1 from public.accounts a
    where a.household_id = new.household_id and a.id <> new.account_id
      and upper(replace(coalesce(a.iban, ''), ' ', '')) = v_iban
  ) then
    select c.id into new.category_id from public.categories c
    where c.household_id = new.household_id and c.kind = 'transfer'
    order by c.position limit 1;
    return new;
  end if;

  if new.amount < 0 then
    select * into v_bill from public.bills b
    where b.household_id = new.household_id and b.active and b.match is not null
      and position(lower(trim(b.match)) in v_text) > 0
    order by length(b.match) desc limit 1;
    if found then
      new.bill_id := v_bill.id;
      new.category_id := v_bill.category_id;
      return new;
    end if;
  else
    select * into v_income from public.incomes i
    where i.household_id = new.household_id and i.active and i.match is not null
      and position(lower(trim(i.match)) in v_text) > 0
    order by length(i.match) desc limit 1;
    if found then
      new.income_id := v_income.id;
      select c.id into new.category_id from public.categories c
      where c.household_id = new.household_id and c.kind = 'income'
      order by c.position limit 1;
      return new;
    end if;
  end if;

  select r.category_id into new.category_id from public.rules r
  where r.household_id = new.household_id
    and position(lower(trim(r.match)) in v_text) > 0
  order by length(r.match) desc limit 1;
  return new;
end;
$$;

create trigger transactions_categorize
  before insert or update on public.transactions
  for each row execute function public.categorize_transaction();

-- Re-runs the matching for every transaction nobody edited by hand, e.g. after
-- adding a rule or a bill. Returns how many rows it looked at.
create function public.recategorize(p_household_id uuid, p_since date default null)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_count int;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  perform set_config('hml.recategorize', 'on', true);
  update public.transactions t set amount = t.amount
  where t.household_id = p_household_id and not t.manual
    and (p_since is null or t.booked_on >= p_since);
  get diagnostics v_count = row_count;
  perform set_config('hml.recategorize', 'off', true);
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create function public.create_household(p_name text, p_period_start_day smallint default 1)
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
    (v_household.id, 'Other', '💸', 'expense', 90),
    (v_household.id, 'Income', '💰', 'income', 100),
    (v_household.id, 'Savings', '🐷', 'savings', 110),
    (v_household.id, 'Between our accounts', '🔁', 'transfer', 120);

  return v_household;
end;
$$;

create function public.invite_preview(p_token text)
returns table (household_id uuid, household_name text, invited_by text,
               expires_at timestamptz, is_valid boolean, already_member boolean)
language sql stable security definer set search_path = ''
as $$
  select h.id, h.name, p.display_name, i.expires_at,
         i.used_at is null and i.expires_at > now(),
         exists (select 1 from public.household_members m
                 where m.household_id = h.id and m.user_id = auth.uid())
  from public.household_invites i
  join public.households h on h.id = i.household_id
  join public.profiles p on p.id = i.created_by
  where i.token = p_token;
$$;

create function public.redeem_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_invite public.household_invites;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_invite from public.household_invites where token = p_token for update;
  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.household_members
             where household_id = v_invite.household_id and user_id = auth.uid()) then
    return v_invite.household_id;
  end if;
  if v_invite.used_at is not null then
    raise exception 'invite already used' using errcode = 'P0001';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite expired' using errcode = 'P0001';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_invite.household_id, auth.uid(), 'member');
  update public.household_invites set used_by = auth.uid(), used_at = now()
  where id = v_invite.id;

  return v_invite.household_id;
end;
$$;

revoke execute on function
  public.create_household(text, smallint),
  public.invite_preview(text),
  public.redeem_invite(text),
  public.recategorize(uuid, date),
  public.is_household_member(uuid),
  public.is_household_owner(uuid),
  public.shares_household_with(uuid)
from public, anon;
grant execute on function
  public.create_household(text, smallint),
  public.invite_preview(text),
  public.redeem_invite(text),
  public.recategorize(uuid, date),
  public.is_household_member(uuid),
  public.is_household_owner(uuid),
  public.shares_household_with(uuid)
to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.categorize_transaction() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.categories enable row level security;
alter table public.bills enable row level security;
alter table public.incomes enable row level security;
alter table public.goals enable row level security;
alter table public.rules enable row level security;
alter table public.bank_connections enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_household_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy households_select on public.households for select to authenticated
  using (public.is_household_member(id));
create policy households_update on public.households for update to authenticated
  using (public.is_household_member(id)) with check (public.is_household_member(id));
revoke update on public.households from authenticated;
grant update (name, currency, period_start_day) on public.households to authenticated;
create policy households_delete on public.households for delete to authenticated
  using (public.is_household_owner(id));

create policy household_members_select on public.household_members
  for select to authenticated using (public.is_household_member(household_id));
create policy household_members_delete on public.household_members
  for delete to authenticated
  using (user_id = auth.uid() or public.is_household_owner(household_id));

create policy household_invites_select on public.household_invites
  for select to authenticated using (public.is_household_member(household_id));
create policy household_invites_insert on public.household_invites
  for insert to authenticated
  with check (public.is_household_member(household_id) and created_by = auth.uid()
              and used_by is null and used_at is null);
create policy household_invites_delete on public.household_invites
  for delete to authenticated using (public.is_household_member(household_id));

-- Budget tables: full access for members.
create policy categories_all on public.categories for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy bills_all on public.bills for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy incomes_all on public.incomes for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy goals_all on public.goals for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy rules_all on public.rules for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- Bank connections: members read and delete; the edge functions create and update them.
create policy bank_connections_select on public.bank_connections
  for select to authenticated using (public.is_household_member(household_id));
create policy bank_connections_delete on public.bank_connections
  for delete to authenticated using (public.is_household_member(household_id));
revoke insert, update on public.bank_connections from anon, authenticated;
alter table public.bank_connection_secrets enable row level security;
revoke all on public.bank_connection_secrets from anon, authenticated;

-- Accounts: synced ones come from the bank; members rename, toggle and add manual ones.
create policy accounts_select on public.accounts for select to authenticated
  using (public.is_household_member(household_id));
create policy accounts_insert on public.accounts for insert to authenticated
  with check (public.is_household_member(household_id) and external_uid is null
              and connection_id is null);
create policy accounts_update on public.accounts for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy accounts_delete on public.accounts for delete to authenticated
  using (public.is_household_member(household_id));
revoke update on public.accounts from authenticated;
grant update (name, owner_id, include_in_pocket, balance, balance_at)
  on public.accounts to authenticated;

-- Transactions: members categorise, annotate and ignore; manual rows can be added
-- to manual accounts (e.g. cash spending).
create policy transactions_select on public.transactions for select to authenticated
  using (public.is_household_member(household_id));
create policy transactions_insert on public.transactions for insert to authenticated
  with check (
    public.is_household_member(household_id)
    and exists (select 1 from public.accounts a
                where a.id = account_id and a.household_id = transactions.household_id
                  and a.external_uid is null)
  );
create policy transactions_update on public.transactions for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy transactions_delete on public.transactions for delete to authenticated
  using (
    public.is_household_member(household_id)
    and exists (select 1 from public.accounts a
                where a.id = account_id and a.external_uid is null)
  );
revoke update on public.transactions from authenticated;
grant update (category_id, bill_id, income_id, note, ignored, manual)
  on public.transactions to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: the other person's changes show up without a reload.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.transactions,
  public.accounts,
  public.bank_connections,
  public.categories,
  public.bills,
  public.incomes,
  public.goals;
