-- =====================================================================
-- 0010 Pull Operation: ตั้งค่าก่อนดึงคน (ตามสไลด์ "ตรรกะก่อนดึงคน")
--   1) ทักษะที่แต่ละคลังดึงได้      pull_skills
--   2) Productivity ต่อคนต่อชั่วโมง   pull_task_rates (มีวันที่เริ่มใช้ เก็บประวัติ)
--   3) ประเภทงาน ↔ ทักษะ             pull_workload_types + pull_tasks
--   4) ชั่วโมงทำงานต่อกะ             pull_shift_hours (มีวันที่เริ่มใช้)
-- ทักษะอ้างด้วย "ชื่อทักษะ" (ทักษะชื่อเดียวกันอยู่ได้หลายตำแหน่งในตาราง skills)
-- Productivity ผูกกับคู่ (ประเภทงาน, ทักษะ) จึงใช้หน่วยเดียวกับประเภทงานเสมอ กรอกผิดหน่วยไม่ได้
-- แก้ค่าผ่านคำสั่งในฐานข้อมูลเท่านั้น (ตรวจสิทธิ์ข้างใน + บันทึกประวัติ)
-- =====================================================================

-- หน่วยนับปริมาณงาน (เพิ่มได้ที่หน้าตั้งค่าตัวเลือก)
insert into public.dropdown_options (category, value, label, sort_order) values
  ('pull_unit', 'pallet', 'พาเลท', 1),
  ('pull_unit', 'piece', 'ชิ้น', 2)
on conflict (category, value) do nothing;

create table public.pull_skills (
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  skill_name text not null check (char_length(skill_name) between 1 and 80),
  sort_order integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (warehouse_id, skill_name)
);

create table public.pull_workload_types (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  unit text not null check (char_length(unit) between 1 and 40),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (warehouse_id, name)
);

create table public.pull_tasks (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  workload_type_id uuid not null references public.pull_workload_types (id) on delete cascade,
  skill_name text not null check (char_length(skill_name) between 1 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workload_type_id, skill_name)
);
create index pull_tasks_wh_idx on public.pull_tasks (warehouse_id);

create table public.pull_task_rates (
  task_id uuid not null references public.pull_tasks (id) on delete cascade,
  effective_from date not null,
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  per_hour numeric(10, 2) not null check (per_hour > 0 and per_hour <= 100000),
  note text check (char_length(note) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (task_id, effective_from)
);
create index pull_task_rates_wh_idx on public.pull_task_rates (warehouse_id);

create table public.pull_shift_hours (
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  shift text not null check (shift in ('morning', 'night')),
  effective_from date not null,
  hours numeric(4, 2) not null check (hours > 0 and hours <= 24),
  note text check (char_length(note) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (warehouse_id, shift, effective_from)
);

create trigger pull_workload_types_touch before update on public.pull_workload_types
  for each row execute function public.touch_updated_at();
create trigger pull_tasks_touch before update on public.pull_tasks
  for each row execute function public.touch_updated_at();

create trigger pull_skills_audit after insert or update or delete on public.pull_skills
  for each row execute function public.audit_row();
create trigger pull_workload_types_audit after insert or update or delete on public.pull_workload_types
  for each row execute function public.audit_row();
create trigger pull_tasks_audit after insert or update or delete on public.pull_tasks
  for each row execute function public.audit_row();
create trigger pull_task_rates_audit after insert or update or delete on public.pull_task_rates
  for each row execute function public.audit_row();
create trigger pull_shift_hours_audit after insert or update or delete on public.pull_shift_hours
  for each row execute function public.audit_row();

-- =====================================================================
-- ค่าที่ใช้ ณ วันที่หนึ่ง (ค่าล่าสุดที่เริ่มใช้ไม่เกินวันนั้น)
-- =====================================================================
create function public.pull_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Bangkok')::date
$$;

create function public.pull_rate_at(p_task uuid, p_date date) returns numeric
language sql stable security definer set search_path = '' as $$
  select r.per_hour from public.pull_task_rates r
  where r.task_id = p_task and r.effective_from <= p_date
  order by r.effective_from desc limit 1
$$;

create function public.pull_hours_at(p_wh uuid, p_shift text, p_date date) returns numeric
language sql stable security definer set search_path = '' as $$
  select h.hours from public.pull_shift_hours h
  where h.warehouse_id = p_wh and h.shift = p_shift and h.effective_from <= p_date
  order by h.effective_from desc limit 1
$$;

-- วันที่เริ่มใช้ต้องเป็นวันนี้หรืออนาคต (ไม่ย้อนแก้ผลของวันที่ผ่านไปแล้ว) ยกเว้นผู้ดูแลระบบสูงสุด
create function public.pull_check_from(p_from date) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null then
    raise exception 'กรุณาเลือกวันที่เริ่มใช้';
  end if;
  if p_from < public.pull_today() and public.my_role() is distinct from 'super_admin' then
    raise exception 'วันที่เริ่มใช้ต้องเป็นวันนี้หรือวันถัดไป (ไม่ย้อนหลัง)';
  end if;
end $$;

-- =====================================================================
-- คำสั่งที่หน้าจอเรียกใช้ (แอดมินของคลังนั้น ผู้บริหาร ผู้ดูแลระบบสูงสุด)
-- =====================================================================

-- ขั้นที่ 1: ทักษะที่คลังดึงได้ (ส่งรายการทั้งหมดมาแทนของเดิม เรียงตามลำดับที่ส่ง)
create function public.set_pull_skills(p_wh uuid, p_skills text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_bad text;
begin
  if not public.can_manage_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ตั้งค่าของคลังนี้';
  end if;
  if cardinality(coalesce(p_skills, '{}')) > 200 then
    raise exception 'เลือกทักษะได้ไม่เกิน 200 รายการ';
  end if;
  select s into v_bad from unnest(coalesce(p_skills, '{}')) s
  where not exists (select 1 from public.skills k where k.name = s and k.is_active) limit 1;
  if v_bad is not null then
    raise exception 'ไม่พบทักษะ "%" ในรายการทักษะ', v_bad;
  end if;
  delete from public.pull_skills where warehouse_id = p_wh and skill_name <> all (coalesce(p_skills, '{}'));
  insert into public.pull_skills (warehouse_id, skill_name, sort_order)
  select p_wh, s, min(o)::integer from unnest(coalesce(p_skills, '{}')) with ordinality as t (s, o) group by s
  on conflict (warehouse_id, skill_name) do update set sort_order = excluded.sort_order
  where public.pull_skills.sort_order is distinct from excluded.sort_order;
end $$;

-- ขั้นที่ 3: เพิ่ม/แก้ประเภทงาน (หน่วยแก้ไม่ได้หลังตั้ง Productivity แล้ว เพราะตัวเลขเดิมเป็นหน่วยเดิม)
create function public.save_pull_workload_type(p_id uuid, p_wh uuid, p_name text, p_unit text, p_sort integer, p_active boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.pull_workload_types;
  v_id uuid;
begin
  if not public.can_manage_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ตั้งค่าของคลังนี้';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'กรุณาใส่ชื่อประเภทงาน';
  end if;
  if not exists (select 1 from public.dropdown_options o where o.category = 'pull_unit' and o.value = p_unit and o.is_active) then
    raise exception 'ไม่พบหน่วยนับนี้ (เพิ่มได้ที่หน้าตั้งค่าตัวเลือก หมวดหน่วยนับปริมาณงาน)';
  end if;
  if exists (select 1 from public.pull_workload_types t where t.warehouse_id = p_wh and t.name = btrim(p_name) and t.id is distinct from p_id) then
    raise exception 'มีประเภทงานชื่อนี้ในคลังนี้แล้ว';
  end if;
  if p_id is null then
    insert into public.pull_workload_types (warehouse_id, name, unit, sort_order, is_active)
    values (p_wh, btrim(p_name), p_unit, coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into v_id;
    return v_id;
  end if;
  select * into v_old from public.pull_workload_types where id = p_id;
  if v_old.id is null or v_old.warehouse_id <> p_wh then
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

-- ขั้นที่ 3: ทักษะที่ใช้ทำงานประเภทนี้ (ทักษะที่เอาออกจะถูกปิด แต่ประวัติ Productivity ยังอยู่)
create function public.set_pull_type_skills(p_type uuid, p_skills text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_wh uuid;
  v_bad text;
begin
  select warehouse_id into v_wh from public.pull_workload_types where id = p_type;
  if v_wh is null then
    raise exception 'ไม่พบประเภทงานนี้';
  end if;
  if not public.can_manage_warehouse(v_wh) then
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

-- ขั้นที่ 2: บันทึก Productivity หลายแถวพร้อมกัน ด้วยวันที่เริ่มใช้เดียวกัน
-- p_rates = [{"task_id": "...", "per_hour": 30}, ...]
create function public.set_pull_rates(p_wh uuid, p_from date, p_rates jsonb, p_note text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  v_task uuid;
  v_val numeric;
  n integer := 0;
begin
  if not public.can_manage_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ตั้งค่าของคลังนี้';
  end if;
  perform public.pull_check_from(p_from);
  if jsonb_typeof(p_rates) is distinct from 'array' or jsonb_array_length(p_rates) = 0 then
    raise exception 'ไม่มีค่าที่จะบันทึก';
  end if;
  for r in select * from jsonb_array_elements(p_rates) loop
    v_task := (r ->> 'task_id')::uuid;
    v_val := (r ->> 'per_hour')::numeric;
    if not exists (select 1 from public.pull_tasks k where k.id = v_task and k.warehouse_id = p_wh) then
      raise exception 'ไม่พบงานนี้ในคลังที่เลือก';
    end if;
    if v_val is null or v_val <= 0 or v_val > 100000 then
      raise exception 'Productivity ต้องมากกว่า 0 และไม่เกิน 100,000';
    end if;
    insert into public.pull_task_rates (task_id, effective_from, warehouse_id, per_hour, note)
    values (v_task, p_from, p_wh, round(v_val, 2), nullif(btrim(coalesce(p_note, '')), ''))
    on conflict (task_id, effective_from) do update set per_hour = excluded.per_hour, note = excluded.note,
      created_by = (select auth.uid()), created_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- ขั้นที่ 4: ชั่วโมงทำงานต่อกะ (เช้า/ดึก) ของคลัง
create function public.set_pull_shift_hours(p_wh uuid, p_from date, p_morning numeric, p_night numeric, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v record;
begin
  if not public.can_manage_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ตั้งค่าของคลังนี้';
  end if;
  perform public.pull_check_from(p_from);
  for v in select * from (values ('morning', p_morning), ('night', p_night)) as t (shift, hours) loop
    if v.hours is null or v.hours <= 0 or v.hours > 24 then
      raise exception 'ชั่วโมงต่อกะต้องมากกว่า 0 และไม่เกิน 24';
    end if;
    insert into public.pull_shift_hours (warehouse_id, shift, effective_from, hours, note)
    values (p_wh, v.shift, p_from, round(v.hours, 2), nullif(btrim(coalesce(p_note, '')), ''))
    on conflict (warehouse_id, shift, effective_from) do update set hours = excluded.hours, note = excluded.note,
      created_by = (select auth.uid()), created_at = now();
  end loop;
end $$;

-- ลบค่าที่ตั้งล่วงหน้าไว้ผิด (ลบได้เฉพาะค่าที่ยังไม่ถึงวันเริ่มใช้)
create function public.delete_pull_future(p_kind text, p_wh uuid, p_from date, p_task uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ตั้งค่าของคลังนี้';
  end if;
  if p_from <= public.pull_today() then
    raise exception 'ลบได้เฉพาะค่าที่ยังไม่ถึงวันเริ่มใช้ (ค่าที่เริ่มใช้แล้วให้บันทึกค่าใหม่แทน)';
  end if;
  if p_kind = 'rate' then
    delete from public.pull_task_rates where task_id = p_task and warehouse_id = p_wh and effective_from = p_from;
  elsif p_kind = 'hours' then
    delete from public.pull_shift_hours where warehouse_id = p_wh and effective_from = p_from;
  else
    raise exception 'ไม่รู้จักชนิดค่า';
  end if;
end $$;

-- จำนวนพนักงานที่มีแต่ละทักษะ แยกคลัง (ตัวเลขรวมเท่านั้น ไม่มีรายชื่อ) สำหรับหัวหน้างานขึ้นไป
create function public.pull_skill_counts() returns table (warehouse_id uuid, skill_name text, people integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(public.role_rank(public.my_role()), 0) < 2 then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลนี้';
  end if;
  return query
  select p.warehouse_id, k.name, count(distinct p.id)::integer
  from public.employee_skills es
  join public.skills k on k.id = es.skill_id
  join public.profiles p on p.id = es.user_id
  where p.status = 'active' and p.warehouse_id is not null
  group by p.warehouse_id, k.name;
end $$;

-- =====================================================================
-- สิทธิ์: อ่านได้ตั้งแต่หัวหน้างานของคลังนั้น / แก้ผ่านคำสั่งด้านบนเท่านั้น
-- =====================================================================
alter table public.pull_skills enable row level security;
alter table public.pull_workload_types enable row level security;
alter table public.pull_tasks enable row level security;
alter table public.pull_task_rates enable row level security;
alter table public.pull_shift_hours enable row level security;

revoke all on public.pull_skills, public.pull_workload_types, public.pull_tasks, public.pull_task_rates, public.pull_shift_hours from anon;
revoke insert, update, delete on public.pull_skills, public.pull_workload_types, public.pull_tasks, public.pull_task_rates, public.pull_shift_hours from authenticated;

-- ทักษะที่แต่ละคลังดึงได้ หัวหน้างานทุกคลังเห็นกันได้ (ใช้ดูตารางคลัง × ทักษะ)
create policy pull_skills_read on public.pull_skills for select to authenticated
  using (coalesce(public.role_rank((select public.my_role())), 0) >= 2);
create policy pull_types_read on public.pull_workload_types for select to authenticated
  using ((select public.can_supervise_warehouse(warehouse_id)));
create policy pull_tasks_read on public.pull_tasks for select to authenticated
  using ((select public.can_supervise_warehouse(warehouse_id)));
create policy pull_rates_read on public.pull_task_rates for select to authenticated
  using ((select public.can_supervise_warehouse(warehouse_id)));
create policy pull_hours_read on public.pull_shift_hours for select to authenticated
  using ((select public.can_supervise_warehouse(warehouse_id)));

revoke execute on function
  public.pull_today(), public.pull_rate_at(uuid, date), public.pull_hours_at(uuid, text, date), public.pull_check_from(date),
  public.set_pull_skills(uuid, text[]), public.save_pull_workload_type(uuid, uuid, text, text, integer, boolean),
  public.set_pull_type_skills(uuid, text[]), public.set_pull_rates(uuid, date, jsonb, text),
  public.set_pull_shift_hours(uuid, date, numeric, numeric, text), public.delete_pull_future(text, uuid, date, uuid),
  public.pull_skill_counts()
from public, anon;
grant execute on function
  public.pull_today(), public.pull_rate_at(uuid, date), public.pull_hours_at(uuid, text, date),
  public.set_pull_skills(uuid, text[]), public.save_pull_workload_type(uuid, uuid, text, text, integer, boolean),
  public.set_pull_type_skills(uuid, text[]), public.set_pull_rates(uuid, date, jsonb, text),
  public.set_pull_shift_hours(uuid, date, numeric, numeric, text), public.delete_pull_future(text, uuid, date, uuid),
  public.pull_skill_counts()
to authenticated;

-- =====================================================================
-- ค่าเริ่มต้น (ใส่เฉพาะเมื่อมีคลังและทักษะตรงชื่อ / แก้ได้ทั้งหมดในหน้าตั้งค่า)
-- Productivity: Excel "2024-12-02 Merge WHA 2025 Phase 2" ชีต "สรุปคน Avg" ส่วน Simulation ม.ค.-ต.ค. 68
--               คอลัมน์ "Productivity / hr." (Double Fork = CT4F)
-- ชั่วโมงต่อกะ: ค่าจากแอปเดิม (WH5 10/10, WH32 9/9)
-- ยอดโหลด/เช็คจ่ายเป็นหน่วยชิ้น หัวหน้างานกรอกยอดชิ้นเอง (ไม่แปลงหน่วย ตามแอปเดิม)
-- =====================================================================
do $$
declare
  v_note constant text := 'ค่าเริ่มต้นจาก Excel Merge WHA 2025 ชีตสรุปคน Avg (ม.ค.-ต.ค. 68)';
  v_wh uuid;
  v_type uuid;
  v_task uuid;
  d record;
  s record;
begin
  for d in
    select * from (values
      ('WH5', 'งานรับ', 'pallet', 1, '[["OP ลากรับ",32],["RT รับ(Domestics)",30],["CT4F",88],["เช็ครับ(Domestics)",60]]'),
      ('WH5', 'งานจ่าย พาเลทเต็ม', 'pallet', 2, '[["RT จ่าย(Domestics)",35],["OP ลากจ่าย",38]]'),
      ('WH5', 'งานเติม Pickface', 'pallet', 3, '[["RT เติม(Domestics)",18]]'),
      ('WH5', 'งานจ่าย Picker', 'piece', 4, '[["Picker จ่าย",180]]'),
      ('WH5', 'งานโหลดสินค้า', 'piece', 5, '[["โหลดงาน",200],["CT โหลด Domestics",800]]'),
      ('WH5', 'งานเช็คจ่าย', 'piece', 6, '[["เช็คจ่าย(Domestics)",700]]'),
      ('WH5', 'งานจ่าย Ecommerce', 'piece', 7, '[["Picker Ecommerce",60],["เช็คจ่าย Ecommerce",60]]'),
      ('WH32', 'งานรับ Export', 'pallet', 1, '[["OP ลากรับ",32],["RT รับ(Export)",30],["CT4F",88],["เช็ครับ(Export)",60]]'),
      ('WH32', 'งานจ่าย Export', 'pallet', 2, '[["RT จ่าย(Export)",35],["OP ลากจ่าย",38]]'),
      ('WH32', 'งานโหลด Export', 'piece', 3, '[["โหลดงาน",200],["CT โหลด Export",800]]'),
      ('WH32', 'งานเช็คจ่าย Export', 'piece', 4, '[["เช็คจ่าย(Export)",700]]')
    ) as t (wh, name, unit, sort, tasks)
  loop
    select id into v_wh from public.warehouses where code = d.wh;
    continue when v_wh is null;
    v_type := null; -- ถ้าชื่อซ้ำ (มีอยู่แล้ว) จะข้าม ไม่ใช้ค่าของรอบก่อน
    insert into public.pull_workload_types (warehouse_id, name, unit, sort_order)
    values (v_wh, d.name, d.unit, d.sort)
    on conflict (warehouse_id, name) do nothing
    returning id into v_type;
    continue when v_type is null;
    for s in select x ->> 0 as skill, (x ->> 1)::numeric as rate from jsonb_array_elements(d.tasks::jsonb) x loop
      continue when not exists (select 1 from public.skills k where k.name = s.skill and k.is_active);
      insert into public.pull_skills (warehouse_id, skill_name, sort_order)
      values (v_wh, s.skill, (select count(*) from public.pull_skills where warehouse_id = v_wh) + 1)
      on conflict do nothing;
      insert into public.pull_tasks (warehouse_id, workload_type_id, skill_name)
      values (v_wh, v_type, s.skill) returning id into v_task;
      insert into public.pull_task_rates (task_id, effective_from, warehouse_id, per_hour, note)
      values (v_task, '2000-01-01', v_wh, s.rate, v_note);
    end loop;
  end loop;

  for d in select * from (values ('WH5', 10), ('WH32', 9)) as t (wh, hours) loop
    select id into v_wh from public.warehouses where code = d.wh;
    continue when v_wh is null;
    insert into public.pull_shift_hours (warehouse_id, shift, effective_from, hours, note)
    values (v_wh, 'morning', '2000-01-01', d.hours, 'ค่าเริ่มต้นจากแอปเดิม'),
           (v_wh, 'night', '2000-01-01', d.hours, 'ค่าเริ่มต้นจากแอปเดิม')
    on conflict do nothing;
  end loop;
end $$;
