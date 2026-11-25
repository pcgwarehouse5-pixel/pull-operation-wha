-- =====================================================================
-- 0029 ลบประเภทงาน (หน้าตั้งค่า Pull → ผูกประเภทงาน) แบบเก็บประวัติ
--   ลบแล้ว: หายจากทุกหน้า ไม่ใช้คำนวณอีก · ยอดงานที่เคยบันทึกและ Productivity ยังเก็บไว้ (ไม่ลบตามแบบ cascade)
--   สร้างประเภทงานชื่อเดิมใหม่ได้ · บันทึกประวัติการแก้ไขผ่าน trigger audit เดิม
-- =====================================================================
alter table public.pull_workload_types
  add column deleted_at timestamptz,
  add column deleted_by uuid;

-- ชื่อห้ามซ้ำเฉพาะประเภทงานที่ยังไม่ถูกลบ
alter table public.pull_workload_types drop constraint pull_workload_types_warehouse_id_name_key;
create unique index pull_workload_types_live_name on public.pull_workload_types (warehouse_id, name) where deleted_at is null;

create function public.delete_pull_workload_type(p_id uuid) returns void
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

revoke execute on function public.delete_pull_workload_type(uuid) from public, anon;
grant execute on function public.delete_pull_workload_type(uuid) to authenticated;

-- บันทึกประเภทงาน: ชื่อซ้ำนับเฉพาะที่ยังไม่ถูกลบ · แก้ประเภทงานที่ลบแล้วไม่ได้
create or replace function public.save_pull_workload_type(p_id uuid, p_wh uuid, p_name text, p_unit text, p_sort integer, p_active boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.pull_workload_types;
  v_id uuid;
begin
  if not public.can_config_pull(p_wh) then
    raise exception 'ไม่มีสิทธิ์ตั้งค่าของคลังนี้';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'กรุณาใส่ชื่อประเภทงาน';
  end if;
  if not exists (select 1 from public.dropdown_options o where o.category = 'pull_unit' and o.value = p_unit and o.is_active) then
    raise exception 'ไม่พบหน่วยนับนี้ (เพิ่มได้ที่หน้าตั้งค่าตัวเลือก หมวดหน่วยนับปริมาณงาน)';
  end if;
  if exists (select 1 from public.pull_workload_types t where t.warehouse_id = p_wh and t.name = btrim(p_name) and t.deleted_at is null and t.id is distinct from p_id) then
    raise exception 'มีประเภทงานชื่อนี้ในคลังนี้แล้ว';
  end if;
  if p_id is null then
    insert into public.pull_workload_types (warehouse_id, name, unit, sort_order, is_active)
    values (p_wh, btrim(p_name), p_unit, coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into v_id;
    return v_id;
  end if;
  select * into v_old from public.pull_workload_types where id = p_id;
  if v_old.id is null or v_old.warehouse_id <> p_wh or v_old.deleted_at is not null then
    raise exception 'ไม่พบประเภทงานนี้ในคลังที่เลือก';
  end if;
  if v_old.unit <> p_unit and exists (
    select 1 from public.pull_task_rates r join public.pull_tasks k on k.id = r.task_id where k.workload_type_id = p_id
  ) then
    raise exception 'เปลี่ยนหน่วยไม่ได้ เพราะตั้ง Productivity เป็นหน่วยเดิมไว้แล้ว ให้สร้างประเภทงานใหม่แทน';
  end if;
  update public.pull_workload_types
  set name = btrim(p_name), unit = p_unit, sort_order = coalesce(p_sort, sort_order), is_active = coalesce(p_active, is_active)
  where id = p_id;
  return p_id;
end $$;

-- ผูกทักษะ: ประเภทงานที่ลบแล้วผูกใหม่ไม่ได้
create or replace function public.set_pull_type_skills(p_type uuid, p_skills text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_wh uuid;
  v_bad text;
begin
  select warehouse_id into v_wh from public.pull_workload_types where id = p_type and deleted_at is null;
  if v_wh is null then
    raise exception 'ไม่พบประเภทงานนี้';
  end if;
  if not public.can_config_pull(v_wh) then
    raise exception 'ไม่มีสิทธิ์ตั้งค่าของคลังนี้';
  end if;
  select s into v_bad from unnest(coalesce(p_skills, '{}')) s
  where not exists (select 1 from public.pull_skills ps where ps.warehouse_id = v_wh and ps.skill_name = s) limit 1;
  if v_bad is not null then
    raise exception 'ทักษะ "%" ยังไม่ได้เปิดให้คลังนี้ดึง (ตั้งในขั้นที่ 1 ก่อน)', v_bad;
  end if;
  update public.pull_tasks set is_active = (skill_name = any (coalesce(p_skills, '{}')))
  where workload_type_id = p_type and is_active is distinct from (skill_name = any (coalesce(p_skills, '{}')));
  insert into public.pull_tasks (warehouse_id, workload_type_id, skill_name)
  select distinct v_wh, p_type, s from unnest(coalesce(p_skills, '{}')) s
  on conflict (workload_type_id, skill_name) do nothing;
end $$;
