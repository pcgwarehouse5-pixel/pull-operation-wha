-- =====================================================================
-- 0018 ลำดับรายชื่อพนักงานในแต่ละกลุ่มตำแหน่ง (หน้าตารางกะ)
--   หัวหน้าลากชื่อคนที่เข้าผลัดเดียวกันมาไว้ใกล้กันได้ · บันทึกต่อคลัง ใช้ร่วมกันทุกคนในคลัง
--   เก็บเป็นรายการ id เรียงลำดับ คนที่ไม่อยู่ในรายการเรียงตามรหัสพนักงานต่อท้ายกลุ่ม
-- =====================================================================
alter table public.schedule_group_order
  add column members uuid[] not null default '{}' check (cardinality(members) <= 5000);

create function public.set_member_order(p_wh uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_members uuid[];
begin
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์จัดลำดับรายชื่อของคลังนี้';
  end if;
  if cardinality(coalesce(p_members, '{}')) > 5000 then
    raise exception 'รายชื่อเกิน 5,000 คน';
  end if;
  -- เก็บเฉพาะคนที่อยู่ในคลังนี้ ตามลำดับที่ส่งมา (ตัดรายการซ้ำ)
  select coalesce(array_agg(m.id order by m.ord), '{}') into v_members
  from (
    select distinct on (u.id) u.id, u.ord
    from unnest(coalesce(p_members, '{}')) with ordinality as u(id, ord)
    join public.profiles p on p.id = u.id and p.warehouse_id = p_wh
    order by u.id, u.ord
  ) m;
  insert into public.schedule_group_order (warehouse_id, members, updated_by, updated_at)
  values (p_wh, v_members, (select auth.uid()), now())
  on conflict (warehouse_id) do update
  set members = excluded.members, updated_by = excluded.updated_by, updated_at = now();
end $$;

revoke execute on function public.set_member_order(uuid, uuid[]) from public, anon;
grant execute on function public.set_member_order(uuid, uuid[]) to authenticated;
