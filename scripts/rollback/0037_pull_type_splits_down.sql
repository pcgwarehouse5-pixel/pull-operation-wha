-- ถอด migration 0037 (แตกยอดงานอัตโนมัติ) กลับเป็นแบบเดิม: หัวหน้ากรอกยอดทุกประเภทงานเอง
-- ใช้: สำรองก่อน (node scripts/backup-db.mjs) แล้วรันไฟล์นี้ใน Supabase SQL Editor
-- หลังถอด: ประเภทงาน "ยอดจ่ายรวม" ของคลัง 5 ถูกลบแบบเก็บประวัติ · ยอดงานที่กรอกไว้ยังอยู่ในตาราง pull_workloads
begin;

-- สูตรคำนวณคนแบบเดิม (0013): อ่านยอดที่กรอกตรงๆ
create or replace function public.pull_requirement_rows_core(p_wh uuid, p_date date, p_shift text)
returns table (skill_name text, skill_order integer, workload_type_id uuid, type_name text, type_order integer, unit text,
               volume numeric, hours numeric, per_hour numeric, fte numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_hours numeric;
begin
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

-- บันทึกยอดงานแบบเดิม (0011)
create or replace function public.save_pull_workloads(p_wh uuid, p_date date, p_shift text, p_items jsonb) returns integer
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

-- ลบประเภทงานแบบเดิม (0029)
create or replace function public.delete_pull_workload_type(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_type public.pull_workload_types;
begin
  select * into v_type from public.pull_workload_types where id = p_id and deleted_at is null;
  if v_type.id is null then
    raise exception 'ไม่พบประเภทงานนี้ (อาจถูกลบไปแล้ว)';
  end if;
  if not public.can_config_pull(v_type.warehouse_id) then
    raise exception 'ไม่มีสิทธิ์ตั้งค่าของคลังนี้';
  end if;
  update public.pull_tasks set is_active = false where workload_type_id = p_id and is_active;
  update public.pull_workload_types
  set deleted_at = now(), deleted_by = (select auth.uid()), is_active = false
  where id = p_id;
end $$;

drop function public.set_pull_type_split(uuid, date, uuid, numeric, numeric, text);
drop function public.delete_pull_type_split(uuid, date);
drop function public.pull_is_split_source(uuid);
drop function public.pull_volume_at(uuid, date, text);
drop function public.pull_split_at(uuid, date);
drop table public.pull_type_splits;

update public.pull_workload_types set deleted_at = now(), is_active = false
where name = 'ยอดจ่ายรวม' and deleted_at is null and warehouse_id = (select id from public.warehouses where code = 'WH5');

delete from app_private.migrations where name = '0037_pull_type_splits.sql';
commit;
