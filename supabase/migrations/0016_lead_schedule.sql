-- =====================================================================
-- 0016 ตารางกะหัวหน้าคลัง (แยกจากตารางกะปกติ)
--   หัวหน้าคลัง = ตำแหน่งในรายการ shifts.lead_positions (ค่าเริ่มต้น "Supervisor") + ผู้จัดการแผนก
--   แก้/ประกาศได้เฉพาะผู้จัดการ (ผู้จัดการแผนกขึ้นไป และผู้ดูแลระบบสูงสุด)
--   เห็นได้: หัวหน้างาน/แอดมินของคลัง (ดูอย่างเดียว) ผู้จัดการ และหัวหน้าคลังด้วยกัน (เมื่อประกาศแล้ว) · พนักงานทั่วไปไม่เห็น
--   สถานะร่าง/ประกาศ แยกจากตารางกะปกติ
-- =====================================================================

insert into public.app_settings (key, effective_from, value, note) values
  ('shifts.lead_positions', '2000-01-01', '["Supervisor"]', 'ตำแหน่งที่อยู่ในตารางกะหัวหน้าคลัง')
on conflict do nothing;

-- คนนี้อยู่ในตารางกะหัวหน้าคลังไหม
create function public.is_lead(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.role = 'dept_manager'
        or p.position = any (select jsonb_array_elements_text(coalesce(public.setting('shifts.lead_positions'), '[]'::jsonb)))
    from public.profiles p where p.id = p_user
  ), false)
$$;

create function public.schedule_scope(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when public.is_lead(p_user) then 'lead' else 'staff' end
$$;

-- ---------- สถานะประกาศแยกตามกลุ่ม ----------
alter table public.schedule_months add column scope text not null default 'staff' check (scope in ('staff', 'lead'));
alter table public.schedule_months drop constraint schedule_months_pkey;
alter table public.schedule_months add primary key (warehouse_id, month, scope);

create function public.is_month_published_scope(p_wh uuid, p_date date, p_scope text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.schedule_months
    where warehouse_id = p_wh and month = date_trunc('month', p_date)::date and scope = p_scope and status = 'published'
  )
$$;

-- เดิม: ตารางกะปกติ
create or replace function public.is_month_published(p_wh uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_month_published_scope(p_wh, p_date, 'staff')
$$;

create function public.is_published_for(p_user uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_month_published_scope(public.profile_warehouse(p_user), p_date, public.schedule_scope(p_user))
$$;

-- ---------- สิทธิ์แก้/เห็น ----------
create or replace function public.can_edit_schedule(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when public.is_lead(p_user) then public.is_manager_role()
              else public.can_supervise_warehouse(public.profile_warehouse(p_user)) end
$$;

create or replace function public.schedule_visible(p_user uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.can_supervise_warehouse(public.profile_warehouse(p_user)) then true
    when public.my_role() is null then false
    when p_user = (select auth.uid()) then public.is_published_for(p_user, p_date)
    when public.is_lead(p_user) then
      public.is_lead((select auth.uid()))
      and public.profile_warehouse(p_user) is not distinct from public.profile_warehouse((select auth.uid()))
      and public.is_month_published_scope(public.profile_warehouse(p_user), p_date, 'lead')
    when public.profile_warehouse(p_user) is not distinct from public.profile_warehouse((select auth.uid()))
      then public.is_month_published(public.profile_warehouse(p_user), p_date)
    else false
  end
$$;

-- ---------- ประกาศ / กลับเป็นร่าง ----------
create function public.set_schedule_status_scope(p_wh uuid, p_month date, p_status text, p_scope text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  if p_status not in ('draft', 'published') then
    raise exception 'สถานะไม่ถูกต้อง';
  end if;
  if p_scope not in ('staff', 'lead') then
    raise exception 'กลุ่มตารางกะไม่ถูกต้อง';
  end if;
  if p_scope = 'lead' and not public.is_manager_role() then
    raise exception 'ตารางกะหัวหน้าคลังประกาศได้เฉพาะผู้จัดการ';
  end if;
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ประกาศตารางกะของคลังนี้';
  end if;
  insert into public.schedule_months (warehouse_id, month, scope, status, published_at, published_by, updated_at)
  values (p_wh, v_month, p_scope, p_status,
          case when p_status = 'published' then now() end,
          case when p_status = 'published' then (select auth.uid()) end, now())
  on conflict (warehouse_id, month, scope) do update
  set status = excluded.status, published_at = excluded.published_at, published_by = excluded.published_by, updated_at = now();
  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, new_data)
  values ((select auth.uid()), case when p_status = 'published' then 'schedule_publish' else 'schedule_unpublish' end,
          'schedule_months', to_char(v_month, 'YYYY-MM'), p_wh, jsonb_build_object('month', v_month, 'scope', p_scope));
end $$;

create or replace function public.set_schedule_status(p_wh uuid, p_month date, p_status text) returns void
language sql security definer set search_path = '' as $$
  select public.set_schedule_status_scope(p_wh, p_month, p_status, 'staff')
$$;

-- ---------- ล้างทั้งเดือน (เฉพาะกลุ่มที่เลือก) ----------
create function public.clear_schedule_scope(p_wh uuid, p_month date, p_reason text, p_scope text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_rows jsonb;
  v_n integer;
begin
  if p_scope not in ('staff', 'lead') then
    raise exception 'กลุ่มตารางกะไม่ถูกต้อง';
  end if;
  if p_scope = 'lead' and not public.is_manager_role() then
    raise exception 'ตารางกะหัวหน้าคลังแก้ได้เฉพาะผู้จัดการ';
  end if;
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ล้างตารางกะของคลังนี้';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'กรุณาระบุเหตุผล';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', s.user_id, 'work_date', s.work_date, 'shift_code', s.shift_code,
           'holiday_work', s.holiday_work, 'is_volunteer', s.is_volunteer, 'note', s.note)), '[]'), count(*)
  into v_rows, v_n
  from public.shift_schedules s join public.profiles p on p.id = s.user_id
  where p.warehouse_id = p_wh and s.work_date >= v_from and s.work_date < v_to and public.schedule_scope(p.id) = p_scope;

  perform set_config('app.bulk', 'on', true);
  delete from public.shift_schedules s using public.profiles p
  where p.id = s.user_id and p.warehouse_id = p_wh and s.work_date >= v_from and s.work_date < v_to
    and public.schedule_scope(p.id) = p_scope;
  perform set_config('app.bulk', '', true);

  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, old_data, new_data)
  values ((select auth.uid()), 'schedule_clear', 'shift_schedules', to_char(v_from, 'YYYY-MM'), p_wh,
          jsonb_build_object('rows', v_rows), jsonb_build_object('reason', trim(p_reason), 'count', v_n, 'month', v_from, 'scope', p_scope));
  return v_n;
end $$;

create or replace function public.clear_schedule_month(p_wh uuid, p_month date, p_reason text) returns integer
language sql security definer set search_path = '' as $$
  select public.clear_schedule_scope(p_wh, p_month, p_reason, 'staff')
$$;

-- ย้อนคืนการล้าง: ใส่กลับเฉพาะช่องที่ยังว่าง และเฉพาะคนที่ผู้กดมีสิทธิ์แก้
create or replace function public.restore_schedule_month(p_audit_id bigint) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_log public.audit_logs%rowtype;
  v_n integer;
begin
  select * into v_log from public.audit_logs where id = p_audit_id and action = 'schedule_clear';
  if not found then
    raise exception 'ไม่พบรายการล้างตารางกะนี้';
  end if;
  if not public.can_supervise_warehouse(v_log.warehouse_id) then
    raise exception 'ไม่มีสิทธิ์ย้อนคืนตารางกะของคลังนี้';
  end if;
  perform set_config('app.bulk', 'on', true);
  with src as (
    select * from jsonb_to_recordset(v_log.old_data -> 'rows')
      as r(user_id uuid, work_date date, shift_code text, holiday_work text, is_volunteer boolean, note text)
  ), ins as (
    insert into public.shift_schedules (user_id, work_date, shift_code, holiday_work, is_volunteer, note)
    select r.user_id, r.work_date, r.shift_code, r.holiday_work, coalesce(r.is_volunteer, false), r.note
    from src r join public.profiles p on p.id = r.user_id
    where public.can_edit_schedule(r.user_id)
    on conflict (user_id, work_date) do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  perform set_config('app.bulk', '', true);
  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, new_data)
  values ((select auth.uid()), 'schedule_restore', 'shift_schedules', v_log.record_id, v_log.warehouse_id,
          jsonb_build_object('from_audit', p_audit_id, 'count', v_n));
  return v_n;
end $$;

-- ---------- บันทึกหลายช่อง: ทุกช่องต้องเป็นคนที่ผู้บันทึกมีสิทธิ์แก้ ----------
create or replace function public.apply_shifts(p_wh uuid, p_rows jsonb, p_source text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_n integer;
begin
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์แก้ตารางกะของคลังนี้';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then
    raise exception 'ข้อมูลไม่ถูกต้อง (ครั้งละไม่เกิน 20,000 ช่อง)';
  end if;
  create temp table if not exists pg_temp.shift_in (
    user_id uuid, work_date date, shift_code text, holiday_work text, is_volunteer boolean
  ) on commit drop;
  truncate pg_temp.shift_in;
  insert into pg_temp.shift_in
  select distinct on (r.user_id, r.work_date) r.user_id, r.work_date, nullif(trim(r.shift_code), ''),
         nullif(r.holiday_work, ''), coalesce(r.is_volunteer, false)
  from jsonb_to_recordset(p_rows) as r(user_id uuid, work_date date, shift_code text, holiday_work text, is_volunteer boolean);

  if exists (
    select 1 from pg_temp.shift_in i left join public.profiles p on p.id = i.user_id
    where p.id is null or p.warehouse_id is distinct from p_wh or i.work_date is null
  ) then
    raise exception 'มีพนักงานที่ไม่ได้อยู่ในคลังนี้ หรือวันที่ไม่ถูกต้อง';
  end if;
  if exists (select 1 from pg_temp.shift_in i where not public.can_edit_schedule(i.user_id)) then
    raise exception 'ตารางกะหัวหน้าคลังแก้ได้เฉพาะผู้จัดการ';
  end if;

  delete from pg_temp.shift_in i using public.shift_schedules s
  where s.user_id = i.user_id and s.work_date = i.work_date
    and (s.shift_code, s.holiday_work, s.is_volunteer) is not distinct from (i.shift_code, i.holiday_work, i.is_volunteer);
  delete from pg_temp.shift_in i
  where i.shift_code is null and not exists (select 1 from public.shift_schedules s where s.user_id = i.user_id and s.work_date = i.work_date);

  select count(*),
         coalesce(jsonb_agg(jsonb_build_object('user_id', i.user_id, 'work_date', i.work_date,
           'shift_code', s.shift_code, 'holiday_work', s.holiday_work, 'is_volunteer', s.is_volunteer)), '[]'),
         coalesce(jsonb_agg(jsonb_build_object('user_id', i.user_id, 'work_date', i.work_date,
           'shift_code', i.shift_code, 'holiday_work', i.holiday_work, 'is_volunteer', i.is_volunteer)), '[]')
  into v_n, v_old, v_new
  from pg_temp.shift_in i
  left join public.shift_schedules s on s.user_id = i.user_id and s.work_date = i.work_date;

  if v_n = 0 then
    return 0;
  end if;

  perform set_config('app.bulk', 'on', true);
  delete from public.shift_schedules s using pg_temp.shift_in i
  where i.shift_code is null and s.user_id = i.user_id and s.work_date = i.work_date;
  insert into public.shift_schedules (user_id, work_date, shift_code, holiday_work, is_volunteer)
  select user_id, work_date, shift_code, holiday_work, is_volunteer from pg_temp.shift_in where shift_code is not null
  on conflict (user_id, work_date) do update
  set shift_code = excluded.shift_code, holiday_work = excluded.holiday_work, is_volunteer = excluded.is_volunteer;
  perform set_config('app.bulk', '', true);

  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, old_data, new_data)
  values ((select auth.uid()), 'schedule_bulk', 'shift_schedules',
          (select to_char(min(work_date), 'YYYY-MM') from pg_temp.shift_in), p_wh,
          jsonb_build_object('rows', v_old),
          jsonb_build_object('rows', v_new, 'count', v_n, 'source', left(coalesce(p_source, ''), 40)));
  return v_n;
end $$;

-- ---------- ตารางกะเพื่อนร่วมคลัง ----------
-- พนักงาน: เห็นตารางกะปกติ (ประกาศแล้ว) · หัวหน้าคลัง: เห็นตารางกะปกติ + ตารางกะหัวหน้าคลัง (ประกาศแล้ว)
create or replace function public.team_schedule(p_month date)
returns table (user_id uuid, first_name_th text, nickname text, "position" text, work_date date, shift_code text, holiday_work text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.first_name_th, p.nickname, p.position, s.work_date, s.shift_code, s.holiday_work
  from public.shift_schedules s
  join public.profiles p on p.id = s.user_id
  where public.my_role() is not null
    and p.warehouse_id = public.profile_warehouse((select auth.uid()))
    and p.status = 'active'
    and s.work_date >= date_trunc('month', p_month)::date
    and s.work_date < (date_trunc('month', p_month) + interval '1 month')::date
    and case when public.is_lead(p.id)
             then public.is_lead((select auth.uid())) and public.is_month_published_scope(p.warehouse_id, p_month, 'lead')
             else public.is_month_published(p.warehouse_id, p_month) end
  order by p.first_name_th, s.work_date
$$;

-- ---------- การเข้างานของฉัน: ซ่อนกะของเดือนที่ยังเป็นร่าง (ตามกลุ่มของตัวเอง) ----------
create or replace function public.my_attendance(p_from date, p_to date)
returns table (
  user_id uuid, work_date date, shift_code text, shift_start timestamptz, shift_end timestamptz,
  first_in timestamptz, last_out timestamptz, punch_count integer, leave_type text, leave_period text,
  status text, late_min integer, early_min integer, pending_correction boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_sup boolean := public.can_supervise_warehouse(public.profile_warehouse((select auth.uid())));
begin
  if (select auth.uid()) is null then
    raise exception 'กรุณาเข้าสู่ระบบ';
  end if;
  if p_to - p_from > 62 then
    raise exception 'เลือกช่วงได้ไม่เกิน 62 วัน';
  end if;
  return query
  select r.user_id, r.work_date,
         case when v_sup or public.is_published_for(r.user_id, r.work_date) then r.shift_code end,
         case when v_sup or public.is_published_for(r.user_id, r.work_date) then r.shift_start end,
         case when v_sup or public.is_published_for(r.user_id, r.work_date) then r.shift_end end,
         r.first_in, r.last_out, r.punch_count, r.leave_type, r.leave_period, r.status, r.late_min, r.early_min, r.pending_correction
  from public.attendance_rows_core(array[(select auth.uid())], p_from, p_to, now()) r;
end $$;

-- ---------- แจ้งเตือนเมื่อประกาศ: แจ้งเฉพาะคนในกลุ่มนั้น ----------
create or replace function public.schedule_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p uuid;
  v_m text := (array['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'])[extract(month from new.month)::integer]
              || ' ' || (extract(year from new.month)::integer + 543)::text;
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    for p in select id from public.profiles
             where warehouse_id = new.warehouse_id and status = 'active' and not exclude_from_shift
               and public.schedule_scope(id) = new.scope loop
      perform public.notify(p, 'schedule',
        case when new.scope = 'lead' then 'ประกาศตารางกะหัวหน้าคลัง ' else 'ประกาศตารางกะ ' end || v_m || ' แล้ว',
        'ดูกะของคุณได้ที่เมนู ตารางกะของฉัน', '/my-shifts',
        'sched:' || new.scope || ':' || new.warehouse_id || ':' || new.month || ':' || extract(epoch from coalesce(new.published_at, now()))::bigint || ':' || p);
    end loop;
  end if;
  return new;
end $$;

-- ---------- สิทธิ์เรียกฟังก์ชัน ----------
revoke execute on function
  public.is_lead(uuid), public.schedule_scope(uuid), public.is_month_published_scope(uuid, date, text), public.is_published_for(uuid, date),
  public.set_schedule_status_scope(uuid, date, text, text), public.clear_schedule_scope(uuid, date, text, text)
from public, anon;
grant execute on function
  public.is_lead(uuid), public.schedule_scope(uuid), public.is_month_published_scope(uuid, date, text), public.is_published_for(uuid, date),
  public.set_schedule_status_scope(uuid, date, text, text), public.clear_schedule_scope(uuid, date, text, text)
to authenticated;
