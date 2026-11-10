-- One payday per budget month. When both partners press "Payday" a couple of
-- days apart, the second press must not start another month (that left a
-- two-day "month" in between). mark_payday() checks for a payday already
-- marked within 15 days (the window in packages/shared/src/dates.ts):
--   p_move = false → nothing changes; the existing payday comes back
--   p_move = true  → the existing payday moves to p_date
-- Clients now go through this function; the table keeps delete for "Undo".

create function public.mark_payday(p_household_id uuid, p_date date, p_move boolean default false)
returns table (starts_on date, created_by uuid, created boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.paydays;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  -- Two presses at the same moment: the second waits for the first.
  perform 1 from public.households where id = p_household_id for update;

  select * into v_existing from public.paydays p
  where p.household_id = p_household_id and abs(p.starts_on - p_date) <= 15
  order by abs(p.starts_on - p_date) limit 1;

  if found and (not p_move or v_existing.starts_on = p_date) then
    return query select v_existing.starts_on, v_existing.created_by, false;
    return;
  end if;
  if found then
    delete from public.paydays p
    where p.household_id = p_household_id and p.starts_on = v_existing.starts_on;
  end if;

  insert into public.paydays (household_id, starts_on, created_by)
  values (p_household_id, p_date, auth.uid());
  return query select p_date, auth.uid(), true;
end;
$$;

revoke execute on function public.mark_payday(uuid, date, boolean) from public, anon;
grant execute on function public.mark_payday(uuid, date, boolean) to authenticated;
revoke insert, update on public.paydays from authenticated;
