-- =====================================================================
-- 0004 ตารางกะ: กะรายวัน, สถานะประกาศรายเดือน, ปฏิทินวันหยุด
-- ชั่วโมง OT ไม่อยู่ที่นี่ (คำนวณจากเวลาเข้า-ออกจริงในโมดูลลงเวลา/OT)
-- =====================================================================

-- ปฏิทินวันหยุดนักขัตฤกษ์ (ใช้ทุกคลัง)
create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name text not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now()
);

-- สถานะตารางกะของแต่ละคลังแต่ละเดือน: ร่าง (เห็นเฉพาะหัวหน้า) / ประกาศแล้ว (พนักงานเห็น)
create table public.schedule_months (
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  published_by uuid,
  updated_at timestamptz not null default now(),
  primary key (warehouse_id, month)
);

-- กะรายวันของพนักงาน (1 คน 1 วัน 1 รายการ)
create table public.shift_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null,
  shift_code text not null,
  holiday_work text check (holiday_work in ('OFF', 'HOL')), -- ทำงานในวันหยุดประจำสัปดาห์ / วันนักขัตฤกษ์
  is_volunteer boolean not null default false,
  note text check (char_length(note) <= 200),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_date)
);
create index shift_schedules_date_idx on public.shift_schedules (work_date);

-- =====================================================================
-- ฟังก์ชันตรวจสิทธิ์
-- =====================================================================
create function public.profile_warehouse(p_user uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select warehouse_id from public.profiles where id = p_user
$$;

-- แก้ตารางกะของพนักงานคนนี้ได้ไหม (หัวหน้างานขึ้นไปของคลังที่พนักงานสังกัด)
create function public.can_edit_schedule(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_supervise_warehouse(public.profile_warehouse(p_user))
$$;

create function public.is_month_published(p_wh uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.schedule_months
    where warehouse_id = p_wh and month = date_trunc('month', p_date)::date and status = 'published'
  )
$$;

-- เห็นกะของพนักงานคนนี้ในวันนี้ไหม
-- หัวหน้างานขึ้นไป: เห็นคลังที่ดูแลเสมอ / พนักงาน: เห็นของตัวเองและเพื่อนร่วมคลัง เฉพาะเดือนที่ประกาศแล้ว
create function public.schedule_visible(p_user uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.can_supervise_warehouse(public.profile_warehouse(p_user)) then true
    when public.my_role() is null then false
    when public.profile_warehouse(p_user) is not distinct from public.profile_warehouse((select auth.uid()))
      then public.is_month_published(public.profile_warehouse(p_user), p_date)
    else false
  end
$$;

-- =====================================================================
-- Triggers
-- =====================================================================
-- ตรวจรหัสกะต้องมีในหน้าตั้งค่า และบันทึกว่าใครแก้ล่าสุด
create function public.shift_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.dropdown_options where category = 'shift_type' and value = new.shift_code) then
    raise exception 'ไม่รู้จักรหัสกะ %', new.shift_code;
  end if;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end $$;

create trigger shift_schedules_guard before insert or update on public.shift_schedules
  for each row execute function public.shift_guard();

-- บันทึกประวัติเฉพาะการเปลี่ยน/ลบกะ (การวางกะครั้งแรกไม่บันทึกทีละช่อง เพื่อไม่ให้ประวัติรกเกินไป)
create function public.shift_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.bulk', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and (new.shift_code, new.holiday_work, new.is_volunteer) is not distinct from (old.shift_code, old.holiday_work, old.is_volunteer) then
    return new;
  end if;
  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, old_data, new_data)
  values (
    (select auth.uid()),
    case when tg_op = 'DELETE' then 'shift_delete' else 'shift_change' end,
    'shift_schedules',
    old.user_id::text,
    public.profile_warehouse(old.user_id),
    jsonb_build_object('date', old.work_date, 'shift', old.shift_code, 'holiday_work', old.holiday_work),
    case when tg_op = 'DELETE' then null else jsonb_build_object('date', new.work_date, 'shift', new.shift_code, 'holiday_work', new.holiday_work) end
  );
  return coalesce(new, old);
end $$;

create trigger shift_schedules_audit after update or delete on public.shift_schedules
  for each row execute function public.shift_audit();

create trigger holidays_audit after insert or update or delete on public.holidays
  for each row execute function public.audit_row();

-- =====================================================================
-- คำสั่ง (ตรวจสิทธิ์ข้างใน)
-- =====================================================================

-- ประกาศ / กลับเป็นร่าง
create function public.set_schedule_status(p_wh uuid, p_month date, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  if p_status not in ('draft', 'published') then
    raise exception 'สถานะไม่ถูกต้อง';
  end if;
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ประกาศตารางกะของคลังนี้';
  end if;
  insert into public.schedule_months (warehouse_id, month, status, published_at, published_by, updated_at)
  values (p_wh, v_month, p_status,
          case when p_status = 'published' then now() end,
          case when p_status = 'published' then (select auth.uid()) end, now())
  on conflict (warehouse_id, month) do update
  set status = excluded.status, published_at = excluded.published_at, published_by = excluded.published_by, updated_at = now();
  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, new_data)
  values ((select auth.uid()), case when p_status = 'published' then 'schedule_publish' else 'schedule_unpublish' end,
          'schedule_months', to_char(v_month, 'YYYY-MM'), p_wh, jsonb_build_object('month', v_month));
end $$;

-- ล้างตารางกะทั้งเดือนของคลัง (เก็บสำเนาไว้ในประวัติ ย้อนคืนได้)
create function public.clear_schedule_month(p_wh uuid, p_month date, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_rows jsonb;
  v_n integer;
begin
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
  where p.warehouse_id = p_wh and s.work_date >= v_from and s.work_date < v_to;

  perform set_config('app.bulk', 'on', true);
  delete from public.shift_schedules s using public.profiles p
  where p.id = s.user_id and p.warehouse_id = p_wh and s.work_date >= v_from and s.work_date < v_to;
  perform set_config('app.bulk', '', true);

  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, old_data, new_data)
  values ((select auth.uid()), 'schedule_clear', 'shift_schedules', to_char(v_from, 'YYYY-MM'), p_wh,
          jsonb_build_object('rows', v_rows), jsonb_build_object('reason', trim(p_reason), 'count', v_n, 'month', v_from));
  return v_n;
end $$;

-- ย้อนคืนการล้างตารางกะ (ใส่กลับเฉพาะช่องที่ยังว่าง)
create function public.restore_schedule_month(p_audit_id bigint) returns integer
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

-- บันทึกกะหลายช่องพร้อมกัน (หน้าตารางกะ / วางกะอัตโนมัติ / นำเข้าไฟล์)
-- p_rows = [{user_id, work_date, shift_code (null = ลบ), holiday_work, is_volunteer}]
-- เก็บค่าเดิมของทุกช่องที่เปลี่ยนไว้ในประวัติ 1 รายการ เพื่อย้อนกลับได้
create function public.apply_shifts(p_wh uuid, p_rows jsonb, p_source text) returns integer
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

  -- เฉพาะช่องที่เปลี่ยนจริง
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

-- ย้อนกลับการบันทึกหลายช่อง (คืนค่าเดิมเฉพาะช่องที่ยังไม่มีใครแก้ต่อ)
create function public.undo_shift_bulk(p_audit_id bigint) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_log public.audit_logs%rowtype;
  v_rows jsonb;
  v_n integer;
begin
  select * into v_log from public.audit_logs where id = p_audit_id and action = 'schedule_bulk';
  if not found then
    raise exception 'ไม่พบรายการนี้';
  end if;
  if not public.can_supervise_warehouse(v_log.warehouse_id) then
    raise exception 'ไม่มีสิทธิ์ย้อนกลับตารางกะของคลังนี้';
  end if;
  if exists (select 1 from public.audit_logs where action = 'schedule_undo' and (new_data ->> 'from_audit')::bigint = p_audit_id) then
    raise exception 'รายการนี้ย้อนกลับไปแล้ว';
  end if;
  -- ค่าเดิมของช่องที่ค่าปัจจุบันยังตรงกับที่บันทึกไว้
  select coalesce(jsonb_agg(o.value), '[]') into v_rows
  from jsonb_array_elements(v_log.old_data -> 'rows') o
  join jsonb_array_elements(v_log.new_data -> 'rows') n
    on n.value ->> 'user_id' = o.value ->> 'user_id' and n.value ->> 'work_date' = o.value ->> 'work_date'
  left join public.shift_schedules s
    on s.user_id = (o.value ->> 'user_id')::uuid and s.work_date = (o.value ->> 'work_date')::date
  where s.shift_code is not distinct from n.value ->> 'shift_code'
    and s.holiday_work is not distinct from n.value ->> 'holiday_work';
  v_n := public.apply_shifts(v_log.warehouse_id, v_rows, 'undo');
  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, new_data)
  values ((select auth.uid()), 'schedule_undo', 'shift_schedules', v_log.record_id, v_log.warehouse_id,
          jsonb_build_object('from_audit', p_audit_id, 'count', v_n));
  return v_n;
end $$;

-- ประวัติการบันทึกหลายช่อง/ล้างเดือนของคลัง (หัวหน้างานดูได้ เพื่อกดย้อนกลับ)
create function public.schedule_history(p_wh uuid, p_month date)
returns table (id bigint, created_at timestamptz, action text, actor_name text, count integer, source text, reason text, undone boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.created_at, a.action,
         coalesce(p.first_name_th || coalesce(' (' || p.nickname || ')', ''), 'ระบบ'),
         coalesce((a.new_data ->> 'count')::integer, 0),
         a.new_data ->> 'source', a.new_data ->> 'reason',
         exists (select 1 from public.audit_logs u
                 where u.action in ('schedule_undo', 'schedule_restore') and (u.new_data ->> 'from_audit')::bigint = a.id)
  from public.audit_logs a
  left join public.profiles p on p.id = a.actor_id
  where public.can_supervise_warehouse(p_wh)
    and a.warehouse_id = p_wh
    and a.action in ('schedule_bulk', 'schedule_clear')
    and a.record_id = to_char(p_month, 'YYYY-MM')
  order by a.id desc
  limit 30
$$;

-- ตารางกะของเพื่อนร่วมคลัง (เฉพาะชื่อ ชื่อเล่น ตำแหน่ง และกะ) สำหรับพนักงานทั่วไป เฉพาะเดือนที่ประกาศแล้ว
create function public.team_schedule(p_month date)
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
    and public.is_month_published(p.warehouse_id, p_month)
  order by p.first_name_th, s.work_date
$$;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.holidays enable row level security;
alter table public.schedule_months enable row level security;
alter table public.shift_schedules enable row level security;
revoke all on public.holidays, public.schedule_months, public.shift_schedules from anon;

create policy holidays_read on public.holidays for select to authenticated using (true);
create policy holidays_write on public.holidays for all to authenticated
  using ((select public.my_role()) in ('admin', 'executive', 'super_admin'))
  with check ((select public.my_role()) in ('admin', 'executive', 'super_admin'));

create policy schedule_months_read on public.schedule_months for select to authenticated using (
  public.can_supervise_warehouse(warehouse_id) or warehouse_id = public.profile_warehouse((select auth.uid()))
);
revoke insert, update, delete on public.schedule_months from authenticated;

create policy shift_read on public.shift_schedules for select to authenticated
  using (public.schedule_visible(user_id, work_date));
create policy shift_insert on public.shift_schedules for insert to authenticated
  with check (public.can_edit_schedule(user_id));
create policy shift_update on public.shift_schedules for update to authenticated
  using (public.can_edit_schedule(user_id)) with check (public.can_edit_schedule(user_id));
create policy shift_delete on public.shift_schedules for delete to authenticated
  using (public.can_edit_schedule(user_id));

-- สิทธิ์เรียกฟังก์ชัน
revoke execute on function
  public.profile_warehouse(uuid), public.can_edit_schedule(uuid), public.is_month_published(uuid, date),
  public.schedule_visible(uuid, date), public.set_schedule_status(uuid, date, text),
  public.clear_schedule_month(uuid, date, text), public.restore_schedule_month(bigint), public.team_schedule(date),
  public.apply_shifts(uuid, jsonb, text), public.undo_shift_bulk(bigint), public.schedule_history(uuid, date),
  public.shift_guard(), public.shift_audit()
  from public, anon;
revoke execute on function public.shift_guard(), public.shift_audit() from authenticated;
grant execute on function
  public.profile_warehouse(uuid), public.can_edit_schedule(uuid), public.is_month_published(uuid, date),
  public.schedule_visible(uuid, date), public.set_schedule_status(uuid, date, text),
  public.clear_schedule_month(uuid, date, text), public.restore_schedule_month(bigint), public.team_schedule(date),
  public.apply_shifts(uuid, jsonb, text), public.undo_shift_bulk(bigint), public.schedule_history(uuid, date)
  to authenticated;
