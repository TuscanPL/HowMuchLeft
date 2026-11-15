-- Events: "visiting Kasia", "concert". Someone checks in when it starts and out
-- when it ends; afterwards they pick which of their charges from those days
-- belong to it. An event is a tag on top of a transaction's category: it never
-- changes the pocket, it only answers "how much did that evening cost?".
-- A forgotten check-out closes by itself at the end of the next day (Warsaw).

create table public.events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Whoever checked in. Only their accounts are suggested for the event.
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 80),
  emoji text not null default '🎉',
  -- Optional: what we meant to spend.
  budget numeric(12, 2) check (budget is null or budget >= 0),
  started_at timestamptz not null default now(),
  -- Null while checked in (or until the next check-in closes it).
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  -- For the composite key below: a transaction's event is in the same household.
  unique (id, household_id)
);
create index events_household_idx on public.events (household_id, started_at desc);
-- One open event per person; event_check_in closes the old one first.
create unique index events_one_open_idx on public.events (created_by) where ended_at is null;

alter table public.transactions
  add column event_id uuid,
  add constraint transactions_event_fk foreign key (event_id, household_id)
    references public.events (id, household_id) on delete set null (event_id);
create index transactions_event_idx on public.transactions (event_id) where event_id is not null;

-- People tag transactions with an event; the sorting trigger never touches it.
grant update (event_id) on public.transactions to authenticated;

-- When an open event closes by itself: the end of the day after it started.
create function public.event_auto_end(p_started_at timestamptz)
returns timestamptz
language sql stable set search_path = ''
as $$
  select (((p_started_at at time zone 'Europe/Warsaw')::date + 2)::timestamp
          at time zone 'Europe/Warsaw') - interval '1 second'
$$;

alter table public.events enable row level security;
create policy events_select on public.events for select to authenticated
  using (public.is_household_member(household_id));
-- Members rename, re-time, budget, check out and delete; check-ins go through event_check_in.
create policy events_update on public.events for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy events_delete on public.events for delete to authenticated
  using (public.is_household_member(household_id));
revoke insert, update on public.events from authenticated;
grant update (name, emoji, budget, started_at, ended_at) on public.events to authenticated;

-- Check in: closes my open event (now, or when it closed by itself), then starts a new one.
create function public.event_check_in(
  p_household_id uuid,
  p_name text,
  p_emoji text default '🎉',
  p_budget numeric default null
)
returns public.events
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;

  update public.events e
  set ended_at = least(now(), public.event_auto_end(e.started_at))
  where e.created_by = auth.uid() and e.ended_at is null;

  insert into public.events (household_id, created_by, name, emoji, budget)
  values (p_household_id, auth.uid(), trim(p_name), coalesce(nullif(p_emoji, ''), '🎉'), p_budget)
  returning * into v_event;
  return v_event;
end;
$$;

revoke execute on function public.event_check_in(uuid, text, text, numeric) from public, anon;
grant execute on function public.event_check_in(uuid, text, text, numeric) to authenticated;

-- A card payment arrives pending, then comes back booked as a new row (the
-- pending one is pruned). Carry its event over so a tag added in between isn't
-- lost: the same bank id when there is one, else a pending row on the same
-- account with the same amount from the week before.
create function public.keep_event_on_booking()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'booked' or new.event_id is not null then
    return new;
  end if;
  select p.event_id into new.event_id
  from public.transactions p
  where p.account_id = new.account_id
    and p.status = 'pending'
    and p.event_id is not null
    and (p.external_id = 'p:' || new.external_id
         or (p.amount = new.amount and p.booked_on between new.booked_on - 7 and new.booked_on))
  order by (p.external_id = 'p:' || new.external_id) desc, p.booked_on desc
  limit 1;
  return new;
end;
$$;
revoke execute on function public.keep_event_on_booking() from public, anon, authenticated;
create trigger transactions_keep_event
  before insert on public.transactions
  for each row execute function public.keep_event_on_booking();

alter publication supabase_realtime add table public.events;
