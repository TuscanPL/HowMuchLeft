-- Secret goals: a goal only one partner can see (saving up for a surprise).
-- Its monthly amount still comes off the shared pocket, so both of you see the
-- same number; the other partner only sees one "Private savings" total, never
-- the goal's name, target or progress. Enforced here, not just in the app.

alter table public.goals
  -- Null: a shared goal. Set: only this person can see it.
  add column private_to uuid references public.profiles (id) on delete cascade;

drop policy goals_all on public.goals;
create policy goals_select on public.goals for select to authenticated
  using (public.is_household_member(household_id)
         and (private_to is null or private_to = auth.uid()));
create policy goals_insert on public.goals for insert to authenticated
  with check (public.is_household_member(household_id)
              and (private_to is null or private_to = auth.uid()));
create policy goals_update on public.goals for update to authenticated
  using (public.is_household_member(household_id)
         and (private_to is null or private_to = auth.uid()))
  with check (public.is_household_member(household_id)
              and (private_to is null or private_to = auth.uid()));
create policy goals_delete on public.goals for delete to authenticated
  using (public.is_household_member(household_id)
         and (private_to is null or private_to = auth.uid()));

-- What the other partner's secret goals take off the pocket this month: one
-- total, the same sum the pocket uses for goals (see packages/shared/src/pocket.ts).
create function public.private_goals_monthly(p_household_id uuid)
returns numeric
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return coalesce((
    select sum(least(g.monthly_contribution, g.target - g.saved))
    from public.goals g
    where g.household_id = p_household_id
      and g.private_to is not null
      and g.private_to <> auth.uid()
      and g.saved < g.target
  ), 0);
end;
$$;

revoke execute on function public.private_goals_monthly(uuid) from public, anon;
grant execute on function public.private_goals_monthly(uuid) to authenticated;
