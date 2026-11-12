-- =====================================================================
-- 0020 หัวหน้างาน (หัวหน้าคลัง) ทำงานได้เท่าแอดมินคลัง ในคลังที่ดูแล
--   ได้เพิ่ม: แก้ทะเบียน/ทักษะ/อัตรากำลัง เพิ่มพนักงาน กำหนดบทบาท (ถึงหัวหน้างาน) รีเซ็ตรหัส
--            ตั้งค่าตัวเลือก (ตำแหน่ง รหัสกะ ประเภทลา วันหยุด) โควตาลารายคน ประวัติการใช้งาน Dashboard ผู้บริหาร
--   ยังไม่ได้ (ตามที่ตกลง): ตั้งค่า Pull (ทักษะที่ดึงได้ Productivity ประเภทงาน ชั่วโมงต่อกะ) = แอดมินขึ้นไปเท่าเดิม
--            ตารางกะหัวหน้าคลัง = ผู้จัดการเท่าเดิม · การอนุมัติลา/แก้เวลา/OT ตามลำดับเดิม (ไม่แก้)
--   ข้อมูล: พนักงานตำแหน่ง Supervisor ที่ยังเป็นบทบาทพนักงาน → หัวหน้างาน (บันทึกในประวัติอัตโนมัติ)
-- ฟังก์ชันด้านล่างคัดลอกจากนิยามปัจจุบัน แก้เฉพาะบรรทัดตรวจสิทธิ์
-- =====================================================================

-- จัดการคลัง (ทะเบียน ผู้ใช้ โควตาลา ฯลฯ): ผู้จัดการทุกคลัง / แอดมินและหัวหน้างาน เฉพาะคลังที่ดูแล
create or replace function public.can_manage_warehouse(p_wh uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.is_global_role() then true
    when public.my_role() in ('admin', 'supervisor') then coalesce(p_wh in (select public.my_warehouse_ids()), false)
    else false
  end
$$;

-- ตั้งค่า Pull: ผู้จัดการทุกคลัง / แอดมิน เฉพาะคลังที่ดูแล (หัวหน้างานไม่ได้)
create function public.can_config_pull(p_wh uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.is_global_role() then true
    when public.my_role() = 'admin' then coalesce(p_wh in (select public.my_warehouse_ids()), false)
    else false
  end
$$;
revoke execute on function public.can_config_pull(uuid) from public, anon;
grant execute on function public.can_config_pull(uuid) to authenticated;


-- ---------- ตั้งค่า Pull ใช้ can_config_pull (แอดมินขึ้นไปเท่าเดิม) ----------

CREATE OR REPLACE FUNCTION public.set_pull_skills(p_wh uuid, p_skills text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_bad text;
begin
  if not public.can_config_pull(p_wh) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.set_pull_rates(p_wh uuid, p_from date, p_rates jsonb, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r jsonb;
  v_task uuid;
  v_val numeric;
  n integer := 0;
begin
  if not public.can_config_pull(p_wh) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.set_pull_shift_hours(p_wh uuid, p_from date, p_morning numeric, p_night numeric, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  if not public.can_config_pull(p_wh) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.set_pull_type_skills(p_type uuid, p_skills text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_wh uuid;
  v_bad text;
begin
  select warehouse_id into v_wh from public.pull_workload_types where id = p_type;
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
end $function$;

CREATE OR REPLACE FUNCTION public.save_pull_workload_type(p_id uuid, p_wh uuid, p_name text, p_unit text, p_sort integer, p_active boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.delete_pull_future(p_kind text, p_wh uuid, p_from date, p_task uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.can_config_pull(p_wh) then
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
end $function$;

-- ---------- Dashboard ผู้บริหาร: หัวหน้างานขึ้นไป (เดิมแอดมินขึ้นไป) ----------

CREATE OR REPLACE FUNCTION public.pull_network(p_from date, p_to date, p_shift text)
 RETURNS TABLE(work_day date, wh_id uuid, wh_code text, wh_name text, pool_count integer, on_leave integer, need integer, complete boolean, short integer, booked integer, pulled_in integer, lent_out integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(public.role_rank(public.my_role()), 0) < 2 then
    raise exception 'ไม่มีสิทธิ์ดู Dashboard ผู้บริหาร';
  end if;
  if p_shift is null or p_shift not in ('morning', 'night', 'all') then
    raise exception 'กะไม่ถูกต้อง';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 31 then
    raise exception 'ช่วงวันที่ต้องไม่เกิน 31 วัน';
  end if;
  return query
  with grid as (
    select d::date as g_day, s.g_shift, w.id as g_wh, w.code as g_code, w.name as g_name
    from generate_series(p_from, p_to, interval '1 day') d
    cross join (select unnest(case when p_shift = 'all' then array['morning', 'night'] else array[p_shift] end) as g_shift) s
    cross join public.warehouses w
    where w.is_active
  )
  select g.g_day, g.g_wh, g.g_code, g.g_name,
    sum(pc.n)::integer,
    max(lv.n)::integer,
    case when bool_and(rq.r_complete) then sum(rq.r_need)::integer end,
    coalesce(bool_and(rq.r_complete), false),
    case when bool_and(rq.r_complete) then sum(rq.r_short)::integer end,
    sum(bk.n_booked)::integer, sum(bk.n_in)::integer, sum(bk.n_out)::integer
  from grid g
  cross join lateral (
    select count(*) as n
    from public.profiles p
    join public.shift_schedules sc on sc.user_id = p.id and sc.work_date = g.g_day
    where p.warehouse_id = g.g_wh and p.status = 'active' and p.role in ('employee', 'supervisor')
      and public.pull_shift_of(sc.shift_code, g.g_day) = g.g_shift
      and not exists (
        select 1 from public.leave_requests l
        where l.user_id = p.id and g.g_day between l.start_date and l.end_date and l.status in ('pending', 'approved', 'cancel_requested')
      )
  ) pc
  cross join lateral (
    select count(distinct l.user_id) as n
    from public.leave_requests l join public.profiles p on p.id = l.user_id
    where p.warehouse_id = g.g_wh and p.status = 'active' and g.g_day between l.start_date and l.end_date
      and l.status in ('pending', 'approved', 'cancel_requested')
  ) lv
  cross join lateral (
    select coalesce(sum(r.required), 0) as r_need,
           coalesce(bool_and(r.complete), false) as r_complete,
           coalesce(sum(greatest(0, r.required - (
             select count(*) from public.pull_bookings b
             where b.to_warehouse_id = g.g_wh and b.work_date = g.g_day and b.shift = g.g_shift and b.status = 'booked' and b.skill_name = r.skill_name
           ))), 0) as r_short
    from public.pull_requirements_core(g.g_wh, g.g_day, g.g_shift) r
  ) rq
  cross join lateral (
    select count(*) filter (where b.to_warehouse_id = g.g_wh) as n_booked,
           count(*) filter (where b.to_warehouse_id = g.g_wh and b.from_warehouse_id is distinct from g.g_wh) as n_in,
           count(*) filter (where b.from_warehouse_id = g.g_wh and b.to_warehouse_id <> g.g_wh) as n_out
    from public.pull_bookings b
    where b.work_date = g.g_day and b.shift = g.g_shift and b.status = 'booked'
      and (b.to_warehouse_id = g.g_wh or b.from_warehouse_id = g.g_wh)
  ) bk
  group by g.g_day, g.g_wh, g.g_code, g.g_name
  order by g.g_day, g.g_code;
end $function$;

-- ---------- กำหนดบทบาท: หัวหน้างานให้บทบาทได้ถึงหัวหน้างาน (เท่าแอดมิน) จัดการได้เฉพาะคนที่ระดับต่ำกว่า ----------

CREATE OR REPLACE FUNCTION public.set_user_access(p_user uuid, p_role app_role, p_home uuid, p_extra uuid[] DEFAULT '{}'::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me public.app_role := public.my_role();
  v_target public.profiles%rowtype;
  v_max integer;
  v_wh uuid;
begin
  if v_me is null or public.role_rank(v_me) < 2 then
    raise exception 'ไม่มีสิทธิ์กำหนดบทบาทผู้ใช้';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'เปลี่ยนบทบาทหรือคลังของตัวเองไม่ได้';
  end if;
  select * into v_target from public.profiles where id = p_user for update;
  if not found then
    raise exception 'ไม่พบผู้ใช้';
  end if;
  if not public.can_manage_warehouse(v_target.warehouse_id) then
    raise exception 'ไม่มีสิทธิ์จัดการผู้ใช้คลังนี้';
  end if;
  if v_me <> 'super_admin' and public.role_rank(v_target.role) >= public.role_rank(v_me) then
    raise exception 'จัดการผู้ใช้ที่บทบาทเท่ากับหรือสูงกว่าคุณไม่ได้';
  end if;
  if p_role = 'executive' and v_me <> 'super_admin' and v_target.role <> 'executive' then
    raise exception 'บทบาทผู้บริหารเลิกใช้แล้ว ใช้บทบาทผู้จัดการแทน';
  end if;
  v_max := case v_me when 'supervisor' then 2 when 'admin' then 2 when 'executive' then 3 when 'dept_manager' then 3 when 'division_manager' then 4
                     when 'deputy_gm' then 5 when 'gm' then 6 else 9 end;
  if public.role_rank(p_role) > v_max then
    raise exception 'คุณกำหนดบทบาทนี้ไม่ได้';
  end if;
  if v_target.role = 'super_admin' and p_role <> 'super_admin'
     and (select count(*) from public.profiles where role = 'super_admin' and status = 'active') <= 1 then
    raise exception 'ต้องมีผู้ดูแลระบบสูงสุดอย่างน้อย 1 คน';
  end if;
  if p_home is not null and not public.can_manage_warehouse(p_home) then
    raise exception 'ไม่มีสิทธิ์ย้ายผู้ใช้ไปคลังนี้';
  end if;
  foreach v_wh in array coalesce(p_extra, '{}') loop
    if not public.can_manage_warehouse(v_wh) then
      raise exception 'ไม่มีสิทธิ์มอบคลังนี้';
    end if;
  end loop;

  update public.profiles set role = p_role, warehouse_id = p_home where id = p_user;

  delete from public.user_warehouses
  where user_id = p_user
    and public.can_manage_warehouse(warehouse_id)
    and not (warehouse_id = any (coalesce(p_extra, '{}')));
  insert into public.user_warehouses (user_id, warehouse_id)
  select p_user, x from unnest(coalesce(p_extra, '{}')) as x
  where x is distinct from p_home
  on conflict do nothing;
  delete from public.user_warehouses where user_id = p_user and warehouse_id = p_home;
end $function$;

-- ---------- สิทธิ์ในตาราง ----------
drop policy dropdown_write on public.dropdown_options;
create policy dropdown_write on public.dropdown_options for all to authenticated
  using (coalesce(public.role_rank((select public.my_role())), 0) >= 2)
  with check (coalesce(public.role_rank((select public.my_role())), 0) >= 2);

drop policy skills_write on public.skills;
create policy skills_write on public.skills for all to authenticated
  using (coalesce(public.role_rank((select public.my_role())), 0) >= 2)
  with check (coalesce(public.role_rank((select public.my_role())), 0) >= 2);

drop policy holidays_write on public.holidays;
create policy holidays_write on public.holidays for all to authenticated
  using (coalesce(public.role_rank((select public.my_role())), 0) >= 2)
  with check (coalesce(public.role_rank((select public.my_role())), 0) >= 2);

drop policy headcount_write on public.headcount_budgets;
create policy headcount_write on public.headcount_budgets for all to authenticated
  using ((select public.is_global_role()) or ((select public.my_role()) in ('admin', 'supervisor') and warehouse_id in (select public.my_warehouse_ids())))
  with check ((select public.is_global_role()) or ((select public.my_role()) in ('admin', 'supervisor') and warehouse_id in (select public.my_warehouse_ids())));

drop policy profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.is_global_role())
         or ((select public.my_role()) in ('admin', 'supervisor') and warehouse_id in (select public.my_warehouse_ids())))
  with check (id = (select auth.uid()) or (select public.is_global_role())
         or ((select public.my_role()) in ('admin', 'supervisor') and warehouse_id in (select public.my_warehouse_ids())));

drop policy audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select to authenticated
  using (actor_id = (select auth.uid()) or (select public.is_global_role())
         or ((select public.my_role()) in ('admin', 'supervisor') and warehouse_id in (select public.my_warehouse_ids())));

-- ---------- ข้อมูล: หัวหน้าคลัง (ตำแหน่ง Supervisor) ที่ยังเป็นบทบาทพนักงาน → หัวหน้างาน ----------
-- (ทริกเกอร์ประวัติการใช้งานบันทึกค่าเดิมไว้ กู้คืนได้จากหน้า "ประวัติการใช้งาน" หรือไฟล์สำรอง)
update public.profiles set role = 'supervisor'
where role = 'employee' and position = 'Supervisor' and status = 'active';
