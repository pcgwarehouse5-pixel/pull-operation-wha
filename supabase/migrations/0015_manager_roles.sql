-- =====================================================================
-- 0015 สิทธิ์ของบทบาทผู้จัดการ + ลำดับอนุมัติ "ระดับถัดไปอนุมัติ" + ผู้จัดการฝ่ายขึ้นไปไม่ลงเวลา
--
-- ลำดับ: พนักงาน 1 < หัวหน้างาน 2 < แอดมินคลัง 3 < ผู้จัดการแผนก 4 < ผู้จัดการฝ่าย 5
--        < รองผู้จัดการทั่วไป 6 < ผู้จัดการทั่วไป 7 < ผู้ดูแลระบบสูงสุด 9 (ผู้บริหารเดิม = 4 เลิกใช้)
-- ผู้จัดการทุกระดับ: ทำได้ทุกอย่าง ทุกคลัง (เหมือนผู้ดูแลระบบสูงสุด) ให้บทบาทได้ต่ำกว่าตัวเอง 1 ระดับลงไป
-- อนุมัติ: พนักงาน ← หัวหน้างาน/แอดมินของคลัง · หัวหน้างาน/แอดมิน ← ผู้จัดการแผนกขึ้นไป · ผู้จัดการแผนก ← ผู้จัดการฝ่ายขึ้นไป
--          ลาตั้งแต่ N วัน: ขั้นที่ 2 ต้องเป็นผู้จัดการแผนกขึ้นไป (ผู้จัดการอนุมัติขั้นแรก = ครบ) · ห้ามอนุมัติของตัวเอง
-- ผู้จัดการฝ่ายขึ้นไป: ไม่อยู่ในตารางกะ ไม่ลงเวลา ไม่มี OT/เบี้ยขยัน/ค่าเดินทาง ไม่ใช้ระบบลา
-- =====================================================================

-- ---------- ระดับและกลุ่มบทบาท ----------
create or replace function public.role_rank(r public.app_role) returns integer
language sql immutable set search_path = '' as $$
  select case r when 'employee' then 1 when 'supervisor' then 2 when 'admin' then 3
                when 'executive' then 4 when 'dept_manager' then 4 when 'division_manager' then 5
                when 'deputy_gm' then 6 when 'gm' then 7 when 'super_admin' then 9 end
$$;

-- เห็นและจัดการได้ทุกคลัง: ผู้จัดการทุกระดับ (+ ผู้บริหารเดิม และผู้ดูแลระบบสูงสุด)
create or replace function public.is_global_role() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.role_rank(public.my_role()) >= 4, false)
$$;

-- ผู้จัดการ (ทำได้ทุกอย่างเหมือนผู้ดูแลระบบสูงสุด เช่น เพิ่ม/แก้คลัง แก้ตารางกะหัวหน้าคลัง)
create function public.is_manager_role() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() in ('dept_manager', 'division_manager', 'deputy_gm', 'gm', 'super_admin'), false)
$$;

-- บทบาทที่ไม่ลงเวลา/ไม่อยู่ในตารางกะ/ไม่มี OT/ไม่ใช้ระบบลา
create function public.no_timekeeping(r public.app_role) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(r in ('division_manager', 'deputy_gm', 'gm', 'executive', 'super_admin'), false)
$$;

create function public.user_role(p_user uuid) returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = p_user
$$;

create or replace function public.can_manage_warehouse(p_wh uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.is_global_role() then true
    when public.my_role() = 'admin' then coalesce(p_wh in (select public.my_warehouse_ids()), false)
    else false
  end
$$;

create or replace function public.can_supervise_warehouse(p_wh uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.is_global_role() then true
    when public.my_role() in ('admin', 'supervisor') then coalesce(p_wh in (select public.my_warehouse_ids()), false)
    else false
  end
$$;

-- ---------- กำหนดบทบาท ----------
-- แอดมิน: ถึงหัวหน้างาน (คลังตัวเอง) · ผู้จัดการแผนก: ถึงแอดมิน · ผู้จัดการฝ่าย: ถึงผู้จัดการแผนก
-- รองผู้จัดการทั่วไป: ถึงผู้จัดการฝ่าย · ผู้จัดการทั่วไป: ถึงรองผู้จัดการทั่วไป · ผู้ดูแลระบบสูงสุด: ทุกบทบาท
create or replace function public.set_user_access(p_user uuid, p_role public.app_role, p_home uuid, p_extra uuid[] default '{}')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.app_role := public.my_role();
  v_target public.profiles%rowtype;
  v_max integer;
  v_wh uuid;
begin
  if v_me is null or public.role_rank(v_me) < 3 then
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
  v_max := case v_me when 'admin' then 2 when 'executive' then 3 when 'dept_manager' then 3 when 'division_manager' then 4
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
end $$;

-- ---------- สิทธิ์แก้ข้อมูลตั้งค่า (ผู้จัดการทำได้ทุกอย่าง) ----------
drop policy warehouses_write on public.warehouses;
create policy warehouses_write on public.warehouses for all to authenticated
  using ((select public.is_manager_role())) with check ((select public.is_manager_role()));

drop policy dropdown_write on public.dropdown_options;
create policy dropdown_write on public.dropdown_options for all to authenticated
  using (coalesce(public.role_rank((select public.my_role())), 0) >= 3)
  with check (coalesce(public.role_rank((select public.my_role())), 0) >= 3);

drop policy skills_write on public.skills;
create policy skills_write on public.skills for all to authenticated
  using (coalesce(public.role_rank((select public.my_role())), 0) >= 3)
  with check (coalesce(public.role_rank((select public.my_role())), 0) >= 3);

drop policy holidays_write on public.holidays;
create policy holidays_write on public.holidays for all to authenticated
  using (coalesce(public.role_rank((select public.my_role())), 0) >= 3)
  with check (coalesce(public.role_rank((select public.my_role())), 0) >= 3);

-- ---------- ผู้จัดการฝ่ายขึ้นไป: ไม่ลงเวลา ไม่อยู่ในตารางกะ ไม่มี OT ไม่ใช้ระบบลา ----------
-- ตั้งค่าช่องในทะเบียนให้อัตโนมัติ (การคำนวณลงเวลา/OT/เบี้ยขยัน/ค่าเดินทาง ใช้ช่องเหล่านี้อยู่แล้ว)
create function public.profile_role_flags() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.no_timekeeping(new.role) then
    new.exclude_from_shift := true;
    new.ot_eligible := false;
    new.travel_eligible := false;
    new.show_in_ot_report := false;
    new.auto_check_in := false;
  end if;
  return new;
end $$;
create trigger profiles_role_flags before insert or update on public.profiles
  for each row execute function public.profile_role_flags();

-- เลื่อนขึ้นเป็นผู้จัดการฝ่ายขึ้นไป: ลบกะตั้งแต่วันนี้เป็นต้นไป (กะที่ผ่านมาเก็บไว้เป็นประวัติ)
create function public.profile_role_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.no_timekeeping(new.role) and not public.no_timekeeping(old.role) then
    delete from public.shift_schedules where user_id = new.id and work_date >= (now() at time zone 'Asia/Bangkok')::date;
  end if;
  return new;
end $$;
create trigger profiles_role_cleanup after update of role on public.profiles
  for each row execute function public.profile_role_cleanup();

-- กันข้อมูลใหม่ของบทบาทที่ไม่ลงเวลา
create function public.no_timekeeping_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.no_timekeeping(public.user_role(new.user_id)) then
    if tg_table_name = 'shift_schedules' then
      return null; -- ข้ามเงียบๆ (ไม่ให้การบันทึกทั้งชุดล้ม)
    elsif tg_table_name = 'leave_requests' then
      raise exception 'ตำแหน่งนี้ไม่ใช้ระบบลาในแอป';
    else
      raise exception 'ตำแหน่งนี้ไม่ต้องลงเวลาทำงาน';
    end if;
  end if;
  return new;
end $$;
create trigger attendance_punches_no_timekeeping before insert on public.attendance_punches
  for each row execute function public.no_timekeeping_guard();
create trigger attendance_corrections_no_timekeeping before insert on public.attendance_corrections
  for each row execute function public.no_timekeeping_guard();
create trigger leave_requests_no_timekeeping before insert on public.leave_requests
  for each row execute function public.no_timekeeping_guard();
create trigger shift_schedules_no_timekeeping before insert or update on public.shift_schedules
  for each row execute function public.no_timekeeping_guard();

-- ปุ่มลงเวลา: บอกตั้งแต่แรกว่าตำแหน่งนี้ไม่ต้องลงเวลา
create or replace function public.punch(p_kind text, p_lat float8, p_lng float8, p_accuracy float8 default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.attendance_punches%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'กรุณาเข้าสู่ระบบ';
  end if;
  if public.no_timekeeping(public.my_role()) then
    raise exception 'ตำแหน่งนี้ไม่ต้องลงเวลาทำงาน';
  end if;
  v_row := public.punch_core((select auth.uid()), p_kind, now(), p_lat, p_lng, p_accuracy);
  return jsonb_build_object('kind', v_row.kind, 'work_date', v_row.work_date, 'punched_at', v_row.punched_at,
                            'distance_m', v_row.distance_m, 'warehouse_id', v_row.warehouse_id);
end $$;

-- ตั้งค่าช่องให้คนที่ถือบทบาทนี้อยู่แล้ว (เช่น ผู้ดูแลระบบสูงสุด)
update public.profiles set role = role where public.no_timekeeping(role);

-- ---------- ลำดับอนุมัติ ----------
-- ระดับต่ำสุดที่อนุมัติคำขอของบทบาทนี้ได้
create function public.approval_min_rank(r public.app_role) returns integer
language sql immutable set search_path = '' as $$
  select case r when 'employee' then 2 when 'supervisor' then 4 when 'admin' then 4 when 'dept_manager' then 5 else 99 end
$$;

-- ผู้ใช้ที่ล็อกอินอยู่อนุมัติคำขอของคนนี้ได้ไหม (ระดับสูงกว่า + ถึงระดับขั้นต่ำ + ดูแลคลังนั้น)
create function public.can_approve_user(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles t
    where t.id = p_user and t.id <> (select auth.uid())
      and public.role_rank(public.my_role()) >= public.approval_min_rank(t.role)
      and public.role_rank(public.my_role()) > public.role_rank(t.role)
      and (public.is_global_role() or t.warehouse_id in (select public.my_warehouse_ids()))
  )
$$;

-- ใครควรได้แจ้งเตือนเมื่อคนนี้ยื่นคำขอ: ระดับที่อนุมัติได้ต่ำสุด
-- พนักงาน → หัวหน้างาน/แอดมินของคลัง (ไม่มี → ระดับถัดไป) · ผู้ดูแลระบบสูงสุดได้รับเมื่อไม่มีคนอื่น
-- p_min = บังคับระดับขั้นต่ำ (เช่น ขั้นที่ 2 ของใบลา = 4)
create function public.approvers_for(p_user uuid, p_min integer default null) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with t as (select * from public.profiles where id = p_user),
  e as (
    select p.id, public.role_rank(p.role) as rk, p.role
    from public.profiles p, t
    where p.status = 'active' and p.id <> t.id
      and public.role_rank(p.role) >= greatest(public.approval_min_rank(t.role), coalesce(p_min, 0))
      and public.role_rank(p.role) > public.role_rank(t.role)
      and (public.role_rank(p.role) >= 4 or p.warehouse_id = t.warehouse_id
           or exists (select 1 from public.user_warehouses uw where uw.user_id = p.id and uw.warehouse_id = t.warehouse_id))
  ),
  pick as (
    select (p_min is null and (select role from t) = 'employee' and exists (select 1 from e where rk in (2, 3))) as local,
           coalesce((select min(rk) from e where role <> 'super_admin'), (select min(rk) from e)) as top
  )
  select e.id from e, pick
  where (pick.local and e.rk in (2, 3)) or (not pick.local and e.rk = pick.top)
$$;

-- อนุมัติ / ตีกลับใบลา
create or replace function public.decide_leave(p_id uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_r public.leave_requests%rowtype;
  v_status text;
  v_done integer;
  v_action text;
  v_mgr boolean := coalesce(public.role_rank(public.my_role()) >= 4, false);
begin
  select * into v_r from public.leave_requests where id = p_id for update;
  if not found then
    raise exception 'ไม่พบใบลา';
  end if;
  if v_r.user_id = v_me then
    raise exception 'อนุมัติใบลาของตัวเองไม่ได้';
  end if;
  if not public.can_approve_user(v_r.user_id) then
    raise exception 'ไม่มีสิทธิ์อนุมัติใบลาของคนนี้ (ต้องเป็นระดับที่สูงกว่า)';
  end if;
  if not p_approve and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'กรุณาระบุเหตุผล';
  end if;

  if v_r.status = 'pending' then
    if v_r.steps_done >= 1 and not v_mgr then
      raise exception 'ขั้นนี้ต้องให้ผู้จัดการแผนกขึ้นไปอนุมัติ';
    end if;
    if p_approve then
      v_done := case when v_mgr then v_r.steps_required else v_r.steps_done + 1 end;
      v_status := case when v_done >= v_r.steps_required then 'approved' else 'pending' end;
      v_action := 'approve';
    else
      v_done := v_r.steps_done;
      v_status := 'rejected';
      v_action := 'reject';
    end if;
  elsif v_r.status = 'cancel_requested' then
    v_done := v_r.steps_done;
    v_status := case when p_approve then 'cancelled' else 'approved' end;
    v_action := case when p_approve then 'cancel_approve' else 'cancel_reject' end;
  else
    raise exception 'ใบลานี้ดำเนินการไปแล้ว';
  end if;

  update public.leave_requests set status = v_status, steps_done = v_done, updated_at = now() where id = p_id;
  insert into public.leave_approvals (request_id, step, action, actor_id, actor_name, actor_role, note)
  values (p_id, v_r.steps_done + 1, v_action, v_me, public.leave_actor_name(), public.my_role()::text, nullif(trim(coalesce(p_note, '')), ''));
  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, old_data, new_data)
  values (v_me, 'leave_' || v_action, 'leave_requests', p_id::text, public.profile_warehouse(v_r.user_id),
          jsonb_build_object('status', v_r.status), jsonb_build_object('status', v_status, 'note', p_note));
  return v_status;
end $$;

-- อนุมัติ/ไม่อนุมัติคำขอแก้เวลา
create or replace function public.decide_correction(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_c public.attendance_corrections%rowtype;
  v_start integer;
  v_in timestamptz;
  v_out timestamptz;
begin
  select * into v_c from public.attendance_corrections where id = p_id for update;
  if not found or v_c.status <> 'pending' then
    raise exception 'ไม่พบคำขอ หรือดำเนินการไปแล้ว';
  end if;
  if v_c.user_id = v_me then
    raise exception 'อนุมัติคำขอของตัวเองไม่ได้';
  end if;
  if not public.can_approve_user(v_c.user_id) then
    raise exception 'ไม่มีสิทธิ์อนุมัติคำขอของคนนี้ (ต้องเป็นระดับที่สูงกว่า)';
  end if;
  if not p_approve and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'กรุณาระบุเหตุผลที่ไม่อนุมัติ';
  end if;

  update public.attendance_corrections
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = v_me, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_id;

  if p_approve then
    select start_min into v_start
    from public.shift_schedules s, public.shift_minutes(s.shift_code)
    where s.user_id = v_c.user_id and s.work_date = v_c.work_date;
    if v_c.check_in is not null then
      v_in := (v_c.work_date + v_c.check_in) at time zone 'Asia/Bangkok';
      insert into public.attendance_punches (user_id, kind, punched_at, work_date, warehouse_id, correction_id)
      values (v_c.user_id, 'in', v_in, v_c.work_date, public.profile_warehouse(v_c.user_id), v_c.id);
    end if;
    if v_c.check_out is not null then
      v_out := (v_c.work_date + v_c.check_out) at time zone 'Asia/Bangkok';
      if (v_in is not null and v_out <= v_in)
         or (v_in is null and v_start is not null and extract(epoch from v_c.check_out) / 60 < v_start) then
        v_out := v_out + interval '1 day';
      end if;
      insert into public.attendance_punches (user_id, kind, punched_at, work_date, warehouse_id, correction_id)
      values (v_c.user_id, 'out', v_out, v_c.work_date, public.profile_warehouse(v_c.user_id), v_c.id);
    end if;
  end if;

  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, new_data)
  values (v_me, case when p_approve then 'correction_approve' else 'correction_reject' end, 'attendance_corrections',
          p_id::text, public.profile_warehouse(v_c.user_id),
          jsonb_build_object('user_id', v_c.user_id, 'date', v_c.work_date, 'in', v_c.check_in, 'out', v_c.check_out, 'note', p_note));
end $$;

-- อนุมัติ/ไม่อนุมัติ OT
create or replace function public.decide_ot(p_items jsonb, p_approve boolean, p_note text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  it record;
  o record;
  v_n integer := 0;
  v_wh uuid;
begin
  if v_me is null or public.my_role() is null then
    raise exception 'กรุณาเข้าสู่ระบบ';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 3000 then
    raise exception 'ข้อมูลไม่ถูกต้อง';
  end if;
  if not p_approve and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'กรุณาระบุเหตุผลที่ไม่อนุมัติ';
  end if;
  for it in select distinct x.user_id, x.work_date from jsonb_to_recordset(p_items) as x(user_id uuid, work_date date) loop
    if it.user_id = v_me then
      raise exception 'อนุมัติ OT ของตัวเองไม่ได้';
    end if;
    v_wh := public.profile_warehouse(it.user_id);
    if not public.can_approve_user(it.user_id) then
      raise exception 'ไม่มีสิทธิ์อนุมัติ OT ของคนนี้ (ต้องเป็นระดับที่สูงกว่า)';
    end if;
    select * into o from public.ot_rows_core(array[it.user_id], it.work_date, it.work_date, now()) limit 1;
    continue when not found;
    insert into public.ot_approvals (user_id, work_date, normal_hours, normal_rate, ot_hours, ot_rate, status, note, decided_by, decided_by_name)
    values (it.user_id, it.work_date, o.normal_hours, o.normal_rate, o.ot_hours, o.ot_rate,
            case when p_approve then 'approved' else 'rejected' end, nullif(trim(coalesce(p_note, '')), ''), v_me, public.leave_actor_name())
    on conflict (user_id, work_date) do update
    set normal_hours = excluded.normal_hours, normal_rate = excluded.normal_rate, ot_hours = excluded.ot_hours, ot_rate = excluded.ot_rate,
        status = excluded.status, note = excluded.note, decided_by = excluded.decided_by, decided_by_name = excluded.decided_by_name, decided_at = now();
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    insert into public.audit_logs (actor_id, action, table_name, warehouse_id, new_data)
    values (v_me, case when p_approve then 'ot_approve' else 'ot_reject' end, 'ot_approvals', v_wh,
            jsonb_build_object('items', p_items, 'count', v_n, 'note', p_note));
  end if;
  return v_n;
end $$;

-- ---------- แจ้งเตือนให้ผู้อนุมัติที่ถูกระดับ ----------
create or replace function public.leave_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := public.short_name(new.user_id);
  v_type text := coalesce((select label from public.dropdown_options where category = 'leave_type' and value = new.leave_type), new.leave_type);
  v_what text := 'ลา' || v_type || ' ' || trim(to_char(new.days, 'FM990.0')) || ' วัน (' || public.thai_day(new.start_date)
                 || case when new.end_date > new.start_date then ' – ' || public.thai_day(new.end_date) else '' end || ')';
  a uuid;
begin
  if tg_op = 'INSERT' then
    for a in select public.approvers_for(new.user_id) loop
      perform public.notify(a, 'leave_pending', 'ใบลารออนุมัติ: ' || v_name, v_what, '/leave/approvals', 'leave:' || new.id || ':new:' || a);
    end loop;
    return new;
  end if;
  if new.status = 'pending' and new.steps_done > old.steps_done then
    for a in select public.approvers_for(new.user_id, 4) loop
      perform public.notify(a, 'leave_pending', 'ใบลารอผู้จัดการอนุมัติ: ' || v_name, v_what, '/leave/approvals', 'leave:' || new.id || ':step2:' || a);
    end loop;
  elsif old.status = 'pending' and new.status in ('approved', 'rejected') then
    perform public.notify(new.user_id, 'leave_result',
      case when new.status = 'approved' then 'ใบลาได้รับการอนุมัติแล้ว' else 'ใบลาไม่ได้รับการอนุมัติ' end, v_what, '/leave',
      'leave:' || new.id || ':' || new.status);
  elsif new.status = 'cancel_requested' and old.status <> 'cancel_requested' then
    for a in select public.approvers_for(new.user_id) loop
      perform public.notify(a, 'leave_pending', 'ขอยกเลิกใบลา: ' || v_name, v_what, '/leave/approvals', 'leave:' || new.id || ':cancelreq:' || a || ':' || extract(epoch from now())::bigint);
    end loop;
  elsif old.status = 'cancel_requested' and new.status in ('cancelled', 'approved') then
    perform public.notify(new.user_id, 'leave_result',
      case when new.status = 'cancelled' then 'อนุมัติการยกเลิกใบลาแล้ว' else 'ไม่อนุมัติการยกเลิกใบลา' end, v_what, '/leave',
      'leave:' || new.id || ':cancel:' || new.status || ':' || extract(epoch from now())::bigint);
  end if;
  return new;
end $$;

create or replace function public.correction_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_what text := public.thai_day(new.work_date) || ' เข้า ' || coalesce(to_char(new.check_in, 'HH24:MI'), '-') || ' ออก ' || coalesce(to_char(new.check_out, 'HH24:MI'), '-');
  a uuid;
begin
  if tg_op = 'INSERT' then
    for a in select public.approvers_for(new.user_id) loop
      continue when a = new.created_by;
      perform public.notify(a, 'correction_pending', 'ขอแก้เวลา: ' || public.short_name(new.user_id), v_what, '/attendance/team', 'corr:' || new.id || ':' || a);
    end loop;
  elsif old.status = 'pending' and new.status in ('approved', 'rejected') then
    perform public.notify(new.user_id, 'correction_result',
      case when new.status = 'approved' then 'อนุมัติแก้เวลาแล้ว' else 'ไม่อนุมัติคำขอแก้เวลา' end,
      v_what || coalesce(' · ' || new.decision_note, ''), '/attendance', 'corr:' || new.id || ':' || new.status);
  end if;
  return new;
end $$;

-- ---------- สิทธิ์เรียกฟังก์ชัน ----------
revoke execute on function
  public.is_manager_role(), public.no_timekeeping(public.app_role), public.user_role(uuid), public.approval_min_rank(public.app_role),
  public.can_approve_user(uuid), public.approvers_for(uuid, integer), public.profile_role_flags(), public.profile_role_cleanup(),
  public.no_timekeeping_guard()
from public, anon;
grant execute on function public.is_manager_role(), public.no_timekeeping(public.app_role), public.can_approve_user(uuid) to authenticated;
revoke execute on function public.user_role(uuid), public.approvers_for(uuid, integer), public.profile_role_flags(),
  public.profile_role_cleanup(), public.no_timekeeping_guard() from authenticated;
