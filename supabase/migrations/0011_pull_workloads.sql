-- =====================================================================
-- 0011 Pull Operation: ยอดงานประจำวัน + คำนวณคนที่ต้องการ (สไลด์ "ตรรกะก่อนดึงคน" ขั้นที่ 5–6)
--   คนที่ต้องการ = ปริมาณงาน ÷ (ชั่วโมงต่อกะ × Productivity)
--   ทักษะเดียวหลายงาน = รวมผลทุกงานก่อน แล้วปัดขึ้นครั้งเดียว
--   ข้อมูลไม่ครบ = ไม่แสดงตัวเลข (ไม่ตีเป็น 0)
-- สูตรเดียวกันอยู่ใน src/lib/pull.ts (ผลตัวอย่างก่อนบันทึก) และมีเทสต์คุมทั้งสองฝั่ง
-- =====================================================================

create table public.pull_workloads (
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  work_date date not null,
  shift text not null check (shift in ('morning', 'night')),
  workload_type_id uuid not null references public.pull_workload_types (id) on delete cascade,
  volume numeric(14, 2) not null check (volume >= 0 and volume <= 10000000),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (workload_type_id, work_date, shift)
);
create index pull_workloads_wh_date_idx on public.pull_workloads (warehouse_id, work_date);

create trigger pull_workloads_audit after insert or update or delete on public.pull_workloads
  for each row execute function public.audit_row();

alter table public.pull_workloads enable row level security;
revoke all on public.pull_workloads from anon;
revoke insert, update, delete on public.pull_workloads from authenticated;
create policy pull_workloads_read on public.pull_workloads for select to authenticated
  using ((select public.can_supervise_warehouse(warehouse_id)));

-- บันทึกยอดงานของคลัง/วัน/กะ (หัวหน้างานขึ้นไปของคลังนั้น)
-- p_items = [{"type_id": "...", "volume": 400}, ...]  volume = null คือ "ยังไม่กรอก" (ลบค่าที่เคยกรอก)
-- วันที่ผ่านไปแล้ว แก้ได้เฉพาะแอดมินขึ้นไป · ล่วงหน้าได้ไม่เกิน 90 วัน
create function public.save_pull_workloads(p_wh uuid, p_date date, p_shift text, p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  v_type uuid;
  v_vol numeric;
  n integer := 0;
begin
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์บันทึกยอดงานของคลังนี้';
  end if;
  if p_shift is null or p_shift not in ('morning', 'night') then
    raise exception 'กรุณาเลือกกะ';
  end if;
  if p_date is null then
    raise exception 'กรุณาเลือกวันที่';
  end if;
  if p_date < public.pull_today() and not public.can_manage_warehouse(p_wh) then
    raise exception 'วันที่ผ่านไปแล้ว แก้ยอดงานได้เฉพาะแอดมินคลัง';
  end if;
  if p_date > public.pull_today() + 90 then
    raise exception 'กรอกล่วงหน้าได้ไม่เกิน 90 วัน';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'ข้อมูลยอดงานไม่ถูกต้อง';
  end if;
  for r in select * from jsonb_array_elements(p_items) loop
    v_type := (r ->> 'type_id')::uuid;
    if not exists (select 1 from public.pull_workload_types t where t.id = v_type and t.warehouse_id = p_wh and t.is_active) then
      raise exception 'ไม่พบประเภทงานนี้ในคลังที่เลือก';
    end if;
    if r -> 'volume' is null or jsonb_typeof(r -> 'volume') = 'null' then
      delete from public.pull_workloads where workload_type_id = v_type and work_date = p_date and shift = p_shift;
    else
      v_vol := (r ->> 'volume')::numeric;
      if v_vol < 0 or v_vol > 10000000 then
        raise exception 'ยอดงานต้องไม่ติดลบ และไม่เกิน 10,000,000';
      end if;
      insert into public.pull_workloads (warehouse_id, work_date, shift, workload_type_id, volume)
      values (p_wh, p_date, p_shift, v_type, round(v_vol, 2))
      on conflict (workload_type_id, work_date, shift) do update
      set volume = excluded.volume, updated_by = (select auth.uid()), updated_at = now()
      where public.pull_workloads.volume is distinct from excluded.volume;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- รายละเอียดการคำนวณทีละงาน (ทักษะ × ประเภทงาน) ณ คลัง/วัน/กะ
-- fte = ยอดงาน ÷ (ชั่วโมง × Productivity) / ขาดค่าใดค่าหนึ่ง = null
create function public.pull_requirement_rows(p_wh uuid, p_date date, p_shift text)
returns table (skill_name text, skill_order integer, workload_type_id uuid, type_name text, type_order integer, unit text,
               volume numeric, hours numeric, per_hour numeric, fte numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_hours numeric;
begin
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลของคลังนี้';
  end if;
  v_hours := public.pull_hours_at(p_wh, p_shift, p_date);
  return query
  select k.skill_name, ps.sort_order, t.id, t.name, t.sort_order, t.unit, w.volume, v_hours, x.per_hour,
         case when w.volume is not null and v_hours > 0 and x.per_hour > 0 then w.volume / (v_hours * x.per_hour) end
  from public.pull_tasks k
  join public.pull_workload_types t on t.id = k.workload_type_id and t.is_active
  join public.pull_skills ps on ps.warehouse_id = k.warehouse_id and ps.skill_name = k.skill_name
  left join public.pull_workloads w on w.workload_type_id = t.id and w.work_date = p_date and w.shift = p_shift
  cross join lateral (select public.pull_rate_at(k.id, p_date) as per_hour) x
  where k.warehouse_id = p_wh and k.is_active
  order by ps.sort_order, t.sort_order;
end $$;

-- คนที่ต้องการต่อทักษะ: รวม fte ทุกงานของทักษะ แล้วปัดขึ้นครั้งเดียว (กันเศษทศนิยมเล็กมากจากการหาร)
-- complete = ข้อมูลครบทุกงานของทักษะนั้น / missing = เหตุผลที่ยังคำนวณไม่ได้
create function public.pull_requirements(p_wh uuid, p_date date, p_shift text)
returns table (skill_name text, skill_order integer, fte numeric, required integer, complete boolean, missing text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลของคลังนี้';
  end if;
  return query
  with rr as (select * from public.pull_requirement_rows(p_wh, p_date, p_shift)),
  skills as (select ps.skill_name, ps.sort_order from public.pull_skills ps where ps.warehouse_id = p_wh)
  select s.skill_name, s.sort_order,
    case when count(r.skill_name) > 0 and bool_and(r.fte is not null) then round(sum(r.fte), 4) end,
    case when count(r.skill_name) > 0 and bool_and(r.fte is not null) then greatest(0, ceil(sum(r.fte) - 0.000000001))::integer end,
    count(r.skill_name) > 0 and bool_and(r.fte is not null),
    case
      when count(r.skill_name) = 0 then 'ยังไม่ผูกประเภทงาน'
      when bool_or(r.hours is null) then 'ยังไม่ตั้งชั่วโมงต่อกะ'
      when bool_or(r.per_hour is null) then 'ยังไม่ตั้ง Productivity'
      when bool_or(r.volume is null) then 'ยังไม่กรอกยอดงาน'
    end
  from skills s
  left join rr r on r.skill_name = s.skill_name
  group by s.skill_name, s.sort_order
  order by s.sort_order;
end $$;

revoke execute on function
  public.save_pull_workloads(uuid, date, text, jsonb), public.pull_requirement_rows(uuid, date, text), public.pull_requirements(uuid, date, text)
from public, anon;
grant execute on function
  public.save_pull_workloads(uuid, date, text, jsonb), public.pull_requirement_rows(uuid, date, text), public.pull_requirements(uuid, date, text)
to authenticated;
