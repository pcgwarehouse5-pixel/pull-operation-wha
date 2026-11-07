-- =====================================================================
-- 0009 ลำดับกลุ่มตำแหน่งในหน้าตารางกะ (บันทึกต่อคลัง ใช้ร่วมกันทุกคนในคลัง)
-- =====================================================================
create table public.schedule_group_order (
  warehouse_id uuid primary key references public.warehouses (id) on delete cascade,
  positions text[] not null default '{}' check (cardinality(positions) <= 200),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- หัวหน้างานขึ้นไปของคลังนั้นจัดลำดับได้
create function public.set_group_order(p_wh uuid, p_positions text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์จัดลำดับกลุ่มของคลังนี้';
  end if;
  insert into public.schedule_group_order (warehouse_id, positions, updated_by, updated_at)
  values (p_wh, coalesce(p_positions, '{}'), (select auth.uid()), now())
  on conflict (warehouse_id) do update
  set positions = excluded.positions, updated_by = excluded.updated_by, updated_at = now();
end $$;

alter table public.schedule_group_order enable row level security;
revoke all on public.schedule_group_order from anon;
create policy group_order_read on public.schedule_group_order for select to authenticated
  using (public.can_supervise_warehouse(warehouse_id));
revoke insert, update, delete on public.schedule_group_order from authenticated;

revoke execute on function public.set_group_order(uuid, text[]) from public, anon;
grant execute on function public.set_group_order(uuid, text[]) to authenticated;
