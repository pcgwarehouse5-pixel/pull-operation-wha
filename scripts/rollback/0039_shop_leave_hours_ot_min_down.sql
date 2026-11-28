-- ถอด migration 0039 กลับเป็นแบบเดิม: ไม่มีลาเป็นชั่วโมง · OT ขั้นต่ำ 60 นาทีทุกคน · ไม่มีแบบฟอร์มหน้าร้าน
-- ใช้: สำรองก่อน (node scripts/backup-db.mjs) แล้วรันไฟล์นี้ใน Supabase SQL Editor
-- ⚠ ใบลาเป็นชั่วโมงที่ยื่นไปแล้วจะถูก "ยกเลิก" (cancelled) เพราะแบบเดิมไม่รู้จัก — ตรวจรายการก่อนรัน:
--   select * from public.leave_requests where period = 'hours';
begin;

update public.leave_requests set status = 'cancelled', updated_at = now() where period = 'hours' and status <> 'cancelled';
update public.leave_requests set period = 'full', start_time = null, hours = null, days = greatest(days, 0.5) where period = 'hours';

-- ฟังก์ชันเดิม (0005 / 0022 / 0035 / 0015)
drop function public.submit_leave(text, date, date, text, text, text, uuid, time, numeric);
create function public.submit_leave(p_type text, p_start date, p_end date, p_period text, p_reason text,
                                    p_attachment text default null, p_user uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_user uuid := coalesce(p_user, v_me);
  v_days numeric;
  v_quota numeric;
  v_id uuid;
  v_period text := coalesce(p_period, 'full');
begin
  if v_me is null or public.my_role() is null then raise exception 'กรุณาเข้าสู่ระบบ'; end if;
  if v_user <> v_me and not public.can_supervise_warehouse(public.profile_warehouse(v_user)) then
    raise exception 'ไม่มีสิทธิ์ยื่นใบลาแทนพนักงานคนนี้';
  end if;
  if not exists (select 1 from public.profiles where id = v_user and status = 'active') then
    raise exception 'พนักงานคนนี้ไม่ได้อยู่ในสถานะทำงาน';
  end if;
  if not exists (select 1 from public.dropdown_options where category = 'leave_type' and value = p_type and is_active) then
    raise exception 'ไม่รู้จักประเภทการลา %', p_type;
  end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'ช่วงวันที่ไม่ถูกต้อง'; end if;
  if v_period <> 'full' and p_start <> p_end then raise exception 'ลาครึ่งวันเลือกได้วันเดียว'; end if;
  if exists (
    select 1 from public.leave_requests
    where user_id = v_user and status in ('pending', 'approved', 'cancel_requested')
      and start_date <= p_end and end_date >= p_start
      and not (start_date = end_date and p_start = p_end and period <> 'full' and v_period <> 'full' and period <> v_period)
  ) then raise exception 'มีใบลาในช่วงวันที่นี้อยู่แล้ว'; end if;
  if p_attachment is not null then
    if not (public.setting('leave.attachment_types') ? p_type) then raise exception 'ประเภทการลานี้แนบเอกสารไม่ได้'; end if;
    if split_part(p_attachment, '/', 1) <> v_user::text then raise exception 'ไฟล์แนบไม่ถูกต้อง'; end if;
  end if;
  v_days := public.leave_day_count(v_user, p_start, p_end, v_period);
  if v_days <= 0 then raise exception 'ช่วงวันที่เลือกไม่มีวันทำงานตามตารางกะ'; end if;
  v_quota := public.leave_quota(v_user, extract(year from p_start)::integer, p_type);
  insert into public.leave_requests (user_id, leave_type, start_date, end_date, period, days, reason, attachment_path,
                                     steps_required, over_quota, created_by)
  values (v_user, p_type, p_start, p_end, v_period, v_days, nullif(trim(coalesce(p_reason, '')), ''), p_attachment,
          case when v_days >= public.setting_num('leave.exec_approval_min_days', p_start, 4) then 2 else 1 end,
          v_quota is not null and public.leave_used(v_user, extract(year from p_start)::integer, p_type) + v_days > v_quota,
          v_me)
  returning id into v_id;
  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, new_data)
  values (v_me, 'leave_submit', 'leave_requests', v_id::text, public.profile_warehouse(v_user),
          jsonb_build_object('user_id', v_user, 'type', p_type, 'start', p_start, 'end', p_end, 'period', v_period, 'days', v_days));
  return v_id;
end $$;
revoke all on function public.submit_leave(text, date, date, text, text, text, uuid) from public, anon;
grant execute on function public.submit_leave(text, date, date, text, text, text, uuid) to authenticated;

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

-- OT: กลับไปอ่าน ot.min_minutes เป็นตัวเลขเดียว (ลบค่าแยกประเภทที่เริ่ม 1 ธ.ค. 2569)
delete from public.app_settings where key = 'ot.min_minutes' and jsonb_typeof(value) = 'object';
create or replace function public.ot_min_minutes(p_type text, p_date date) returns numeric
language sql stable security definer set search_path = '' as $$ select public.setting_num('ot.min_minutes', p_date, 60) $$;
-- (ot_rows_core ยังเรียก ot_min_minutes ได้ ผลเท่ากับแบบเดิมทุกอย่าง)

drop function public.leave_form_rows(uuid, integer);
delete from public.app_settings where key in ('leave.hours_per_day', 'leave.hour_step_minutes', 'leave.hourly_types', 'shop.shift_form', 'shop.leave_form');

alter table public.leave_requests drop constraint leave_requests_hours_period_check;
alter table public.leave_requests drop constraint leave_requests_period_check;
alter table public.leave_requests add constraint leave_requests_period_check check (period in ('full', 'morning', 'afternoon'));
alter table public.leave_requests drop column hours;
alter table public.leave_requests drop column start_time;
-- คอลัมน์ days คงเป็น numeric ไว้ (ลดกลับอาจปัดเศษข้อมูล)

update public.units set modules = array(select m from unnest(modules) m where m not in ('leave_hours', 'shop_forms'));
create or replace function public.save_unit(p_id uuid, p_code text, p_name text, p_modules text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_mods text[] := coalesce((select array_agg(distinct m order by m) from unnest(coalesce(p_modules, '{}')) m), '{}');
begin
  if not public.unit_unfenced() then raise exception 'เพิ่ม/แก้หน่วยงานได้เฉพาะผู้ดูแลระบบสูงสุด'; end if;
  if char_length(v_name) not between 1 and 100 then raise exception 'กรุณาใส่ชื่อหน่วยงาน (ไม่เกิน 100 ตัวอักษร)'; end if;
  if not (v_mods <@ array['pull']::text[]) then raise exception 'เมนูเสริมไม่ถูกต้อง'; end if;
  if p_id is null then
    if v_code !~ '^[A-Z0-9_-]{2,20}$' then raise exception 'รหัสหน่วยงานใช้ A-Z 0-9 _ - ยาว 2-20 ตัว เช่น SHOP5'; end if;
    if exists (select 1 from public.units where code = v_code) then raise exception 'รหัสหน่วยงาน % มีอยู่แล้ว', v_code; end if;
    insert into public.units (code, name, modules) values (v_code, v_name, v_mods) returning id into v_id;
  else
    update public.units set name = v_name, modules = v_mods, updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then raise exception 'ไม่พบหน่วยงานนี้'; end if;
  end if;
  return v_id;
end $$;
alter table public.units drop constraint units_modules_check;
alter table public.units add constraint units_modules_check check (modules <@ array['pull']::text[]);
drop function public.user_has_module(uuid, text);
-- วันที่เริ่มงาน (profiles.hire_date) เก็บไว้ ไม่ลบ (ไม่กระทบระบบเดิม)

delete from app_private.migrations where name = '0039_shop_leave_hours_ot_min.sql';
commit;
