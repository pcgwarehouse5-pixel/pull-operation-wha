-- =====================================================================
-- 0039 (ผู้ใช้กำหนด 28 พ.ย. 2569)
--   หน้าร้าน (หน่วยงาน SHOP5) เท่านั้น — เปิดด้วยเมนูเสริมของหน่วยงาน (units.modules):
--     * leave_hours : ลาเป็นชั่วโมง (ป่วย / กิจ / พักผ่อน · 8 ชม. = 1 วัน · ทีละ 1 ชม. — ตั้งค่าได้)
--     * shop_forms  : แบบฟอร์มลางานรายคน · ใบแจ้งตารางการปฏิบัติงาน · หมายเหตุ "สาย N นาที" ในใบลงเวลา
--   ทุกหน่วยงาน:
--     * เกณฑ์ขั้นต่ำ OT แยกประเภทพนักงาน (เริ่ม 1 ธ.ค. 2569): MOU ต้องเกิน 60 นาที · ประเภทอื่น 30 นาที
--       (ปัดลงทีละ 30 นาทีเหมือนเดิม) — OT ก่อนวันนั้นคิดแบบเดิมทุกอย่าง
--   + วันที่เริ่มงานของพนักงาน (ใช้ในแบบฟอร์มทั้งสอง)
-- ถอดกลับ: scripts/rollback/0039_shop_leave_hours_ot_min_down.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) เมนูเสริมของหน่วยงาน
-- ---------------------------------------------------------------------
alter table public.units drop constraint units_modules_check;
alter table public.units add constraint units_modules_check
  check (modules <@ array['pull', 'leave_hours', 'shop_forms']::text[]);
update public.units set modules = array(select distinct m from unnest(modules || '{leave_hours,shop_forms}'::text[]) m order by m)
where code = 'SHOP5';

-- หน้า "คลัง" → หน่วยงาน: ติ๊กเมนูเสริมใหม่ได้ (เหมือน 0035 ต่างแค่รายการเมนู)
create or replace function public.save_unit(p_id uuid, p_code text, p_name text, p_modules text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_mods text[] := coalesce((select array_agg(distinct m order by m) from unnest(coalesce(p_modules, '{}')) m), '{}');
begin
  if not public.unit_unfenced() then
    raise exception 'เพิ่ม/แก้หน่วยงานได้เฉพาะผู้ดูแลระบบสูงสุด';
  end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'กรุณาใส่ชื่อหน่วยงาน (ไม่เกิน 100 ตัวอักษร)';
  end if;
  if not (v_mods <@ array['pull', 'leave_hours', 'shop_forms']::text[]) then
    raise exception 'เมนูเสริมไม่ถูกต้อง';
  end if;
  if p_id is null then
    if v_code !~ '^[A-Z0-9_-]{2,20}$' then
      raise exception 'รหัสหน่วยงานใช้ A-Z 0-9 _ - ยาว 2-20 ตัว เช่น SHOP5';
    end if;
    if exists (select 1 from public.units where code = v_code) then
      raise exception 'รหัสหน่วยงาน % มีอยู่แล้ว', v_code;
    end if;
    insert into public.units (code, name, modules) values (v_code, v_name, v_mods) returning id into v_id;
  else
    update public.units set name = v_name, modules = v_mods, updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'ไม่พบหน่วยงานนี้';
    end if;
  end if;
  return v_id;
end $$;

-- พนักงานคนนี้ (ตามคลังหลัก) อยู่หน่วยงานที่เปิดเมนูนี้ไหม
create function public.user_has_module(p_user uuid, p_module text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select public.unit_has_module(p.warehouse_id, p_module) from public.profiles p where p.id = p_user), false)
$$;

-- ---------------------------------------------------------------------
-- 2) วันที่เริ่มงาน (แอดมินคลังแก้ได้ผ่านหน้าทะเบียนพนักงาน)
-- ---------------------------------------------------------------------
alter table public.profiles add column hire_date date;
grant update (hire_date) on public.profiles to authenticated;

create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if (select auth.uid()) is null then
    return new;
  end if;
  if not public.can_manage_warehouse(old.warehouse_id) then
    if (new.employee_code, new.title, new.first_name_th, new.last_name_th, new.position, new.department,
        new.employment_type, new.salary_code, new.birth_date, new.warehouse_id, new.role, new.status,
        new.resigned_date, new.must_change_password, new.exclude_from_shift, new.show_in_org_chart,
        new.ot_eligible, new.travel_eligible, new.show_in_ot_report, new.auto_check_in, new.subcontractor_company,
        new.hire_date)
       is distinct from
       (old.employee_code, old.title, old.first_name_th, old.last_name_th, old.position, old.department,
        old.employment_type, old.salary_code, old.birth_date, old.warehouse_id, old.role, old.status,
        old.resigned_date, old.must_change_password, old.exclude_from_shift, old.show_in_org_chart,
        old.ot_eligible, old.travel_eligible, old.show_in_ot_report, old.auto_check_in, old.subcontractor_company,
        old.hire_date) then
      raise exception 'แก้ได้เฉพาะชื่อเล่น เบอร์โทร LINE ID และรูปของตัวเอง';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3) ลาเป็นชั่วโมง
-- ---------------------------------------------------------------------
-- วันลามีเศษชั่วโมงได้ (1 ชม. = 0.125 วัน) · numeric ไม่กำหนดตำแหน่ง ค่าเดิมแสดงเหมือนเดิม (2.0)
alter table public.leave_requests alter column days type numeric;
alter table public.leave_requests add column start_time time;
alter table public.leave_requests add column hours numeric(4, 2) check (hours > 0 and hours <= 24);
alter table public.leave_requests drop constraint leave_requests_period_check;
alter table public.leave_requests add constraint leave_requests_period_check
  check (period in ('full', 'morning', 'afternoon', 'hours'));
alter table public.leave_requests add constraint leave_requests_hours_period_check
  check ((period = 'hours') = (hours is not null and start_time is not null));

insert into public.app_settings (key, effective_from, value, note) values
  ('leave.hours_per_day', '2000-01-01', '8', 'ลาเป็นชั่วโมง: กี่ชั่วโมงนับเป็น 1 วันลา'),
  ('leave.hour_step_minutes', '2000-01-01', '60', 'ลาเป็นชั่วโมง: ลาได้ทีละกี่นาที (60 = ทีละ 1 ชม.)'),
  ('leave.hourly_types', '2000-01-01', '["sick", "personal", "vacation"]', 'ประเภทลาที่ลาเป็นชั่วโมงได้ (เฉพาะหน่วยงานที่เปิดเมนูลาเป็นชั่วโมง)')
on conflict do nothing;

-- ยื่นใบลา: เพิ่มแบบ "ลาเป็นชั่วโมง" (p_period = 'hours' + เวลาเริ่ม + จำนวนชั่วโมง)
drop function public.submit_leave(text, date, date, text, text, text, uuid);
create function public.submit_leave(p_type text, p_start date, p_end date, p_period text, p_reason text,
                                    p_attachment text default null, p_user uuid default null,
                                    p_start_time time default null, p_hours numeric default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_user uuid := coalesce(p_user, v_me);
  v_days numeric;
  v_quota numeric;
  v_id uuid;
  v_period text := coalesce(p_period, 'full');
  v_hpd numeric;
  v_step numeric;
  v_end_time time;
begin
  if v_me is null or public.my_role() is null then
    raise exception 'กรุณาเข้าสู่ระบบ';
  end if;
  if v_user <> v_me and not public.can_supervise_warehouse(public.profile_warehouse(v_user)) then
    raise exception 'ไม่มีสิทธิ์ยื่นใบลาแทนพนักงานคนนี้';
  end if;
  if not exists (select 1 from public.profiles where id = v_user and status = 'active') then
    raise exception 'พนักงานคนนี้ไม่ได้อยู่ในสถานะทำงาน';
  end if;
  if not exists (select 1 from public.dropdown_options where category = 'leave_type' and value = p_type and is_active) then
    raise exception 'ไม่รู้จักประเภทการลา %', p_type;
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'ช่วงวันที่ไม่ถูกต้อง';
  end if;
  if v_period not in ('full', 'morning', 'afternoon', 'hours') then
    raise exception 'รูปแบบการลาไม่ถูกต้อง';
  end if;
  if v_period <> 'full' and p_start <> p_end then
    raise exception '%', case when v_period = 'hours' then 'ลาเป็นชั่วโมงเลือกได้วันเดียว' else 'ลาครึ่งวันเลือกได้วันเดียว' end;
  end if;

  if v_period = 'hours' then
    if not public.user_has_module(v_user, 'leave_hours') then
      raise exception 'หน่วยงานนี้ยังไม่เปิดให้ลาเป็นชั่วโมง';
    end if;
    if not coalesce(public.setting('leave.hourly_types', p_start) ? p_type, false) then
      raise exception 'ประเภทการลานี้ลาเป็นชั่วโมงไม่ได้';
    end if;
    v_hpd := public.setting_num('leave.hours_per_day', p_start, 8);
    v_step := public.setting_num('leave.hour_step_minutes', p_start, 60);
    if p_start_time is null then
      raise exception 'กรุณาเลือกเวลาเริ่มลา';
    end if;
    if p_hours is null or p_hours <= 0 or p_hours >= v_hpd then
      raise exception 'ลาเป็นชั่วโมงได้ไม่ถึง % ชั่วโมง (ถ้าครบให้ลาเต็มวัน)', trim(to_char(v_hpd, 'FM990.##'));
    end if;
    if mod(round(p_hours * 60), greatest(v_step, 1)) <> 0 then
      raise exception 'ลาได้ทีละ % นาที', v_step;
    end if;
    if public.leave_day_count(v_user, p_start, p_start, 'full') <= 0 then
      raise exception 'วันที่เลือกไม่ใช่วันทำงานตามตารางกะ';
    end if;
    v_end_time := p_start_time + make_interval(mins => round(p_hours * 60)::integer);
    if v_end_time <= p_start_time then
      raise exception 'ช่วงเวลาลาข้ามเที่ยงคืนไม่ได้';
    end if;
    v_days := round(p_hours / v_hpd, 3);
  end if;

  -- ซ้อนกับใบลาเดิมไม่ได้ (ครึ่งเช้า+ครึ่งบ่าย และลาชั่วโมงที่เวลาไม่ทับกัน ยังยื่นวันเดียวกันได้)
  if exists (
    select 1 from public.leave_requests r
    where r.user_id = v_user and r.status in ('pending', 'approved', 'cancel_requested')
      and r.start_date <= p_end and r.end_date >= p_start
      and not (r.start_date = r.end_date and p_start = p_end and r.period in ('morning', 'afternoon')
               and v_period in ('morning', 'afternoon') and r.period <> v_period)
      and not (r.period = 'hours' and v_period = 'hours'
               and (r.start_time + make_interval(mins => round(r.hours * 60)::integer) <= p_start_time
                    or v_end_time <= r.start_time))
  ) then
    raise exception 'มีใบลาในช่วงวันที่นี้อยู่แล้ว';
  end if;
  if p_attachment is not null then
    if not (public.setting('leave.attachment_types') ? p_type) then
      raise exception 'ประเภทการลานี้แนบเอกสารไม่ได้';
    end if;
    if split_part(p_attachment, '/', 1) <> v_user::text then
      raise exception 'ไฟล์แนบไม่ถูกต้อง';
    end if;
  end if;
  if v_period <> 'hours' then
    v_days := public.leave_day_count(v_user, p_start, p_end, v_period);
  end if;
  if v_days <= 0 then
    raise exception 'ช่วงวันที่เลือกไม่มีวันทำงานตามตารางกะ';
  end if;
  v_quota := public.leave_quota(v_user, extract(year from p_start)::integer, p_type);

  insert into public.leave_requests (user_id, leave_type, start_date, end_date, period, days, start_time, hours, reason,
                                     attachment_path, steps_required, over_quota, created_by)
  values (v_user, p_type, p_start, p_end, v_period, v_days,
          case when v_period = 'hours' then p_start_time end, case when v_period = 'hours' then p_hours end,
          nullif(trim(coalesce(p_reason, '')), ''), p_attachment,
          case when v_days >= public.setting_num('leave.exec_approval_min_days', p_start, 4) then 2 else 1 end,
          v_quota is not null and public.leave_used(v_user, extract(year from p_start)::integer, p_type) + v_days > v_quota,
          v_me)
  returning id into v_id;
  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, new_data)
  values (v_me, 'leave_submit', 'leave_requests', v_id::text, public.profile_warehouse(v_user),
          jsonb_build_object('user_id', v_user, 'type', p_type, 'start', p_start, 'end', p_end, 'period', v_period, 'days', v_days,
                             'start_time', case when v_period = 'hours' then p_start_time end,
                             'hours', case when v_period = 'hours' then p_hours end));
  return v_id;
end $$;

-- ข้อความแจ้งเตือนใบลา: ลาเป็นชั่วโมงบอกเป็นชั่วโมงและช่วงเวลา
create or replace function public.leave_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := public.short_name(new.user_id);
  v_type text := coalesce((select label from public.dropdown_options where category = 'leave_type' and value = new.leave_type), new.leave_type);
  v_what text := 'ลา' || v_type || ' ' ||
                 case when new.period = 'hours'
                   then trim(to_char(new.hours, 'FM990.##')) || ' ชม. (' || public.thai_day(new.start_date) || ' '
                        || to_char(new.start_time, 'HH24:MI') || '–'
                        || to_char(new.start_time + make_interval(mins => round(new.hours * 60)::integer), 'HH24:MI') || ')'
                   else trim(to_char(new.days, 'FM990.0')) || ' วัน (' || public.thai_day(new.start_date)
                        || case when new.end_date > new.start_date then ' – ' || public.thai_day(new.end_date) else '' end || ')'
                 end;
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

-- แบบฟอร์มลางานรายคน (หัวหน้างานขึ้นไป · หน่วยงานที่เปิด shop_forms): ใบลาที่อนุมัติแล้วของปีนั้น
create function public.leave_form_rows(p_wh uuid, p_year integer)
returns table (user_id uuid, request_id uuid, leave_type text, start_date date, end_date date, period text,
               start_time time, hours numeric, days numeric, reason text, approved_by text, approved_at timestamptz,
               vacation_quota numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ดูรายงานของคลังนี้';
  end if;
  if not public.unit_has_module(p_wh, 'shop_forms') then
    raise exception 'หน่วยงานนี้ไม่ได้เปิดแบบฟอร์มลางาน';
  end if;
  return query
  select p.id, r.id, r.leave_type, r.start_date, r.end_date, r.period, r.start_time, r.hours, r.days, r.reason,
         ap.actor_name, ap.created_at, public.leave_quota(p.id, p_year, 'vacation')
  from public.profiles p
  left join public.leave_requests r
    on r.user_id = p.id and r.status in ('approved', 'cancel_requested') and extract(year from r.start_date) = p_year
  left join lateral (
    select a.actor_name, a.created_at from public.leave_approvals a
    where a.request_id = r.id and a.action = 'approve' order by a.step desc, a.created_at desc limit 1
  ) ap on true
  where p.warehouse_id = p_wh
  order by p.employee_code, r.start_date nulls first, r.start_time nulls first;
end $$;

-- ---------------------------------------------------------------------
-- 4) เกณฑ์ขั้นต่ำ OT แยกประเภทพนักงาน
--    ค่า ot.min_minutes เป็นตัวเลข (ทุกคนเท่ากัน · แบบเดิม) หรือ {"default": 30, "mou": 60}
-- ---------------------------------------------------------------------
create function public.ot_min_minutes(p_type text, p_date date) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb := public.setting('ot.min_minutes', p_date);
begin
  if v is null then
    return 60;
  end if;
  if jsonb_typeof(v) = 'number' then
    return (v #>> '{}')::numeric;
  end if;
  return coalesce((v ->> coalesce(p_type, ''))::numeric, (v ->> 'default')::numeric, 60);
end $$;

insert into public.app_settings (key, effective_from, value, note) values
  ('ot.min_minutes', '2026-12-01', '{"default": 30, "mou": 60}',
   'ผู้ใช้กำหนด 28 พ.ย. 2569: MOU ต้องเกินเวลาเลิกกะครบ 60 นาที · ประเภทอื่นครบ 30 นาที (ปัดลงทีละ 30 นาที)')
on conflict do nothing;

CREATE OR REPLACE FUNCTION public.ot_rows_core(p_users uuid[], p_from date, p_to date, p_now timestamp with time zone)
 RETURNS TABLE(user_id uuid, work_date date, day_type text, shift_code text, first_in timestamp with time zone, last_out timestamp with time zone, normal_hours numeric, normal_rate numeric, ot_hours numeric, ot_rate numeric, approval text, decided_by_name text, decided_at timestamp with time zone, note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_hw text;
  v_vol boolean;
  v_type text;
  v_elig boolean;
  v_day text;
  v_min numeric; v_step numeric; v_cap numeric; v_brk numeric; v_brk_after numeric; v_hol_h numeric;
  v_worked numeric; v_cap_min numeric; v_norm_min numeric;
  v_nh numeric; v_oh numeric; v_nr numeric; v_or numeric;
  a public.ot_approvals%rowtype;
begin
  for r in select * from public.attendance_rows_core(p_users, p_from, p_to, p_now) x
           where x.first_in is not null and x.last_out is not null and x.last_out > x.first_in
  loop
    select s.holiday_work, s.is_volunteer into v_hw, v_vol
    from public.shift_schedules s where s.user_id = r.user_id and s.work_date = r.work_date;
    select p.employment_type, p.ot_eligible into v_type, v_elig from public.profiles p where p.id = r.user_id;
    if not coalesce(v_elig, true) or coalesce(v_vol, false) then
      continue;
    end if;
    v_day := case
      when v_hw is not null then v_hw
      when r.shift_start is not null and exists (select 1 from public.holidays h where h.holiday_date = r.work_date) then 'HOL'
      when r.shift_code is not null and r.shift_start is null then
        case
          when exists (select 1 from public.dropdown_options o where o.category = 'shift_type' and o.value = r.shift_code
                       and coalesce((o.extra ->> 'no_ot')::boolean, false)) then null
          when r.shift_code = 'HOL' or exists (select 1 from public.holidays h where h.holiday_date = r.work_date) then 'HOL'
          else 'OFF'
        end
      when r.shift_start is not null then 'normal'
      else null
    end;
    continue when v_day is null;

    -- ใหม่ (0039): เกณฑ์ขั้นต่ำตามประเภทพนักงาน
    v_min := public.ot_min_minutes(v_type, r.work_date);
    v_step := public.setting_num('ot.round_minutes', r.work_date, 30);
    v_cap := public.setting_num('ot.max_hours_per_day', r.work_date, 16);
    v_nh := 0; v_oh := 0; v_nr := null; v_or := null;

    if v_day = 'normal' then
      v_oh := public.ot_round(extract(epoch from r.last_out - r.shift_end) / 60, v_min, v_step, v_cap);
      v_or := public.ot_rate(v_type, r.work_date, 'workday');
    else
      v_brk := public.setting_num('ot.break_minutes', r.work_date, 60);
      v_brk_after := public.setting_num('ot.break_after_minutes', r.work_date, 480);
      v_hol_h := public.setting_num('ot.holiday_normal_hours', r.work_date, 8);
      v_worked := extract(epoch from r.last_out - greatest(r.first_in, coalesce(r.shift_start, r.first_in))) / 60;
      if v_worked >= v_brk_after then
        v_worked := v_worked - v_brk;
      end if;
      v_cap_min := case
        when r.shift_start is not null then extract(epoch from r.shift_end - r.shift_start) / 60
             - case when extract(epoch from r.shift_end - r.shift_start) / 60 >= v_brk_after then v_brk else 0 end
        else v_hol_h * 60
      end;
      v_norm_min := greatest(0, least(v_worked, v_cap_min));
      v_nh := least(floor(v_norm_min / greatest(v_step, 1)) * greatest(v_step, 1) / 60.0, v_cap);
      v_oh := public.ot_round(v_worked - v_norm_min, v_min, v_step, v_cap);
      v_nr := public.ot_rate(v_type, r.work_date, 'holiday_normal');
      v_or := public.ot_rate(v_type, r.work_date, 'holiday_ot');
    end if;
    continue when v_nh <= 0 and v_oh <= 0;

    select * into a from public.ot_approvals oa where oa.user_id = r.user_id and oa.work_date = r.work_date;
    user_id := r.user_id; work_date := r.work_date; day_type := v_day; shift_code := r.shift_code;
    first_in := r.first_in; last_out := r.last_out;
    normal_hours := v_nh; normal_rate := case when v_nh > 0 then v_nr end;
    ot_hours := v_oh; ot_rate := case when v_oh > 0 then v_or end;
    approval := case
      when a.user_id is null then 'pending'
      when a.normal_hours = v_nh and a.ot_hours = v_oh
           and a.normal_rate is not distinct from (case when v_nh > 0 then v_nr end)
           and a.ot_rate is not distinct from (case when v_oh > 0 then v_or end) then a.status
      else 'changed'
    end;
    decided_by_name := a.decided_by_name; decided_at := a.decided_at; note := a.note;
    return next;
  end loop;
end $function$;

-- ---------------------------------------------------------------------
-- 5) ข้อความในแบบฟอร์มหน้าร้าน (แก้ได้ที่ ตั้งค่าตัวเลือก → กฎและอัตรา → แบบฟอร์มหน้าร้าน)
-- ---------------------------------------------------------------------
insert into public.app_settings (key, effective_from, value, note) values
  ('shop.shift_form', '2000-01-01', jsonb_build_object(
     'company', 'บริษัท เพอร์เฟค คอมพาเนียน กรุ๊ป จำกัด [401]',
     'title', 'แบบแจ้งตารางการปฏิบัติงานพนักงาน',
     'group', 'ฝ่ายบริการลูกค้า',
     'signer_name', 'นายมนัส เจริญขำ',
     'signer_title', 'ผจก.ทั่วไป ฝ่ายบริการลูกค้า',
     'signer_role', 'ผู้บังคับบัญชา',
     'codes', jsonb_build_object('STD1', '1'),
     'legend', 'กะ 2 (17.00 - 01.00 น.)    กะ 3 (01.00 - 08.00 น.)    * หากเข้านอกเหนือจาก กะ ปกติ ให้ใส่เป็นเวลาเข้าทำงาน'),
   'ใบแจ้งตารางการปฏิบัติงาน (หน้าร้าน) ตามฟอร์ม 11.SETกะ · codes = รหัสกะที่แสดงเป็นตัวเลขกะ นอกนั้นแสดงชั่วโมงเข้างาน'),
  ('shop.leave_form', '2000-01-01', jsonb_build_object(
     'group', 'กลุ่มธุรกิจสัตว์เลี้ยง',
     'title', 'แบบฟอร์มลางาน',
     'company', 'เพอร์เฟค คอมพาเนียน กรุ๊ป จำกัด',
     'dept', 'ฝ่ายขาย'),
   'แบบฟอร์มลางานรายคน (หน้าร้าน) ตามไฟล์ แบบฟอร์มลางาน.xlsx · dept = สังกัด เมื่อพนักงานไม่มีแผนกในทะเบียน')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 6) สิทธิ์ฟังก์ชัน
-- ---------------------------------------------------------------------
revoke all on function public.user_has_module(uuid, text), public.ot_min_minutes(text, date),
  public.submit_leave(text, date, date, text, text, text, uuid, time, numeric),
  public.leave_form_rows(uuid, integer) from public, anon;
revoke all on function public.user_has_module(uuid, text), public.ot_min_minutes(text, date) from authenticated;
grant execute on function public.submit_leave(text, date, date, text, text, text, uuid, time, numeric),
  public.leave_form_rows(uuid, integer) to authenticated;
