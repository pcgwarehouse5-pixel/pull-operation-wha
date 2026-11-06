-- =====================================================================
-- 0005 ลงเวลา (Check In/Out ด้วย GPS ต้องอยู่ในรัศมีคลัง) + คำขอแก้เวลา + ใบลา + ค่าตั้งค่าที่มีวันที่เริ่มใช้
-- เวลาที่บันทึกใช้นาฬิกาของเซิร์ฟเวอร์เสมอ / วันที่และเวลาใช้เขตเวลา Asia/Bangkok
-- =====================================================================

-- ---------- ค่าตั้งค่า (กฎ อัตรา โควตา) พร้อมวันที่เริ่มใช้ ----------
create table public.app_settings (
  key text not null check (key ~ '^[a-z_.]{3,60}$'),
  effective_from date not null,
  value jsonb not null,
  note text check (char_length(note) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (key, effective_from)
);

-- ค่าเริ่มต้น (แก้ได้ในหน้าตั้งค่า โดยเพิ่มค่าใหม่พร้อมวันที่เริ่มใช้)
insert into public.app_settings (key, effective_from, value, note) values
  ('attendance.late_grace_minutes', '2000-01-01', '0', 'ค่าเริ่มต้น: ไม่มีเวลาผ่อนผัน'),
  ('attendance.early_leave_grace_minutes', '2000-01-01', '0', 'ค่าเริ่มต้น: ไม่มีเวลาผ่อนผัน'),
  ('attendance.max_gps_accuracy_m', '2000-01-01', '150', 'ความคลาดเคลื่อน GPS สูงสุดที่ยอมรับ'),
  ('attendance.no_out_after_hours', '2000-01-01', '4', 'เลยเวลาเลิกกะกี่ชั่วโมงจึงถือว่าลืมออก'),
  ('attendance.correction_max_days', '2000-01-01', '31', 'ขอแก้เวลาย้อนหลังได้ไม่เกินกี่วัน'),
  ('leave.exec_approval_min_days', '2000-01-01', '4', 'ลาตั้งแต่กี่วันต้องให้ผู้บริหารอนุมัติต่อ (ตามแอปเดิม)'),
  ('leave.quota', '2000-01-01', '{"sick": 30, "personal": 6, "vacation": 6, "maternity": 90, "ordination": 30}', 'ตามแอปเดิม ตรวจกับกฎหมายล่าสุดก่อนใช้'),
  ('leave.attachment_types', '2000-01-01', '["sick"]', 'ประเภทลาที่แนบเอกสารได้');

create function public.setting(p_key text, p_date date default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from public.app_settings
  where key = p_key and effective_from <= coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date)
  order by effective_from desc
  limit 1
$$;

create function public.setting_num(p_key text, p_date date, p_default numeric) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((public.setting(p_key, p_date) #>> '{}')::numeric, p_default)
$$;

-- ---------- ตัวช่วย ----------
create function public.distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8
language sql immutable set search_path = '' as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- เวลาเริ่ม/เลิกของรหัสกะ (นาทีจากเที่ยงคืน; กะข้ามวัน เลิก > 1440) ไม่มีเวลา = ไม่ใช่กะทำงาน
create function public.shift_minutes(p_code text, out start_min integer, out end_min integer)
language sql stable security definer set search_path = '' as $$
  select s, case when e <= s then e + 1440 else e end
  from (
    select split_part(extra ->> 'start_time', ':', 1)::integer * 60 + split_part(extra ->> 'start_time', ':', 2)::integer as s,
           split_part(extra ->> 'end_time', ':', 1)::integer * 60 + split_part(extra ->> 'end_time', ':', 2)::integer as e
    from public.dropdown_options
    where category = 'shift_type' and value = p_code
      and extra ->> 'start_time' ~ '^\d{1,2}:\d{2}$' and extra ->> 'end_time' ~ '^\d{1,2}:\d{2}$'
  ) x
$$;

-- เวลาจริงของนาทีที่ m ของวันทำงาน (ตามเวลาไทย)
create function public.local_ts(p_date date, p_min integer) returns timestamptz
language sql immutable set search_path = '' as $$
  select (p_date + make_interval(mins => p_min)) at time zone 'Asia/Bangkok'
$$;

-- =====================================================================
-- ลงเวลา
-- =====================================================================
create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null,
  check_in time,
  check_out time,
  reason text not null check (char_length(trim(reason)) between 1 and 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 300),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (check_in is not null or check_out is not null)
);
create unique index attendance_corrections_one_pending on public.attendance_corrections (user_id, work_date) where status = 'pending';

create table public.attendance_punches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('in', 'out')),
  punched_at timestamptz not null default now(),
  work_date date not null,
  warehouse_id uuid references public.warehouses (id) on delete set null,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  distance_m double precision,
  correction_id uuid references public.attendance_corrections (id) on delete set null,
  created_at timestamptz not null default now()
);
create index attendance_punches_user_date on public.attendance_punches (user_id, work_date);
create index attendance_punches_date on public.attendance_punches (work_date);

-- วันทำงานของการกด: หลังเที่ยงคืนแต่ยังอยู่ในกะดึกของเมื่อวาน = นับเป็นเมื่อวาน
create function public.resolve_work_date(p_user uuid, p_at timestamptz, p_kind text) returns date
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (p_at at time zone 'Asia/Bangkok')::date;
  v_code text;
  v_start integer;
  v_end integer;
begin
  select shift_code into v_code from public.shift_schedules where user_id = p_user and work_date = v_today - 1;
  select start_min, end_min into v_start, v_end from public.shift_minutes(v_code);
  if v_end > 1440 then
    if p_kind = 'in' and p_at < public.local_ts(v_today - 1, v_end) then
      return v_today - 1;
    end if;
    if p_kind = 'out' and p_at < public.local_ts(v_today - 1, v_end)
         + make_interval(hours => public.setting_num('attendance.no_out_after_hours', v_today, 4)::integer) then
      return v_today - 1;
    end if;
  end if;
  return v_today;
end $$;

-- แกนของการกดเข้า/ออก (เรียกผ่าน punch() เท่านั้น; แยกไว้ให้เทสต์กำหนดเวลาได้)
create function public.punch_core(p_user uuid, p_kind text, p_at timestamptz, p_lat float8, p_lng float8, p_acc float8)
returns public.attendance_punches
language plpgsql security definer set search_path = '' as $$
declare
  v_prof public.profiles%rowtype;
  v_today date := (p_at at time zone 'Asia/Bangkok')::date;
  v_wh uuid;
  v_radius integer;
  v_dist float8;
  v_last public.attendance_punches%rowtype;
  v_wd date;
  v_row public.attendance_punches%rowtype;
begin
  select * into v_prof from public.profiles where id = p_user and status = 'active';
  if not found then
    raise exception 'ไม่พบบัญชี หรือบัญชีถูกปิด';
  end if;
  if p_kind not in ('in', 'out') then
    raise exception 'ประเภทการลงเวลาไม่ถูกต้อง';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'ไม่ได้รับตำแหน่ง GPS กรุณาเปิดตำแหน่งที่ตั้งแล้วลองใหม่';
  end if;
  if p_acc is not null and p_acc > public.setting_num('attendance.max_gps_accuracy_m', v_today, 150) then
    raise exception 'สัญญาณ GPS ยังไม่แม่นพอ (คลาดเคลื่อนประมาณ % เมตร) ลองใหม่ในที่โล่ง', round(p_acc);
  end if;

  -- คลังที่ใกล้ที่สุดในคลังที่สังกัด/ดูแล
  select w.id, w.checkin_radius_m, public.distance_m(p_lat, p_lng, w.latitude, w.longitude)
  into v_wh, v_radius, v_dist
  from public.warehouses w
  where w.is_active and w.latitude is not null and w.longitude is not null
    and (w.id = v_prof.warehouse_id or w.id in (select uw.warehouse_id from public.user_warehouses uw where uw.user_id = p_user))
  order by 3
  limit 1;
  if v_wh is null then
    raise exception 'คลังของคุณยังไม่ได้ตั้งพิกัด แจ้งแอดมินคลังให้ตั้งพิกัดในหน้า "คลัง"';
  end if;
  if v_dist > v_radius then
    raise exception 'อยู่นอกพื้นที่คลัง (ห่าง % เมตร ต้องอยู่ในรัศมี % เมตร) ลงเวลาไม่ได้', round(v_dist), v_radius;
  end if;

  select * into v_last from public.attendance_punches
  where user_id = p_user and punched_at > p_at - interval '20 hours' and punched_at <= p_at
  order by punched_at desc limit 1;

  if p_kind = 'out' then
    if found and v_last.kind = 'out' and p_at - v_last.punched_at < interval '2 minutes' then
      raise exception 'บันทึกออกงานไปแล้ว';
    end if;
    v_wd := case when found and v_last.kind = 'in' then v_last.work_date else public.resolve_work_date(p_user, p_at, 'out') end;
  else
    v_wd := public.resolve_work_date(p_user, p_at, 'in');
    if found and v_last.kind = 'in' and v_last.work_date = v_wd then
      raise exception 'บันทึกเข้างานแล้ว (กดออกงานก่อนจึงจะเข้างานใหม่ได้)';
    end if;
  end if;

  insert into public.attendance_punches (user_id, kind, punched_at, work_date, warehouse_id, latitude, longitude, accuracy_m, distance_m)
  values (p_user, p_kind, p_at, v_wd, v_wh, p_lat, p_lng, p_acc, round(v_dist::numeric, 1))
  returning * into v_row;
  return v_row;
end $$;

-- กดเข้า/ออกงาน (ใช้เวลาเซิร์ฟเวอร์)
create function public.punch(p_kind text, p_lat float8, p_lng float8, p_accuracy float8 default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.attendance_punches%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'กรุณาเข้าสู่ระบบ';
  end if;
  v_row := public.punch_core((select auth.uid()), p_kind, now(), p_lat, p_lng, p_accuracy);
  return jsonb_build_object('kind', v_row.kind, 'work_date', v_row.work_date, 'punched_at', v_row.punched_at,
                            'distance_m', v_row.distance_m, 'warehouse_id', v_row.warehouse_id);
end $$;

-- ขอแก้เวลา (ลืมกด / GPS ใช้ไม่ได้) — หัวหน้างานยื่นแทนพนักงานได้
create function public.request_correction(p_date date, p_in time, p_out time, p_reason text, p_user uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_user uuid := coalesce(p_user, v_me);
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_id uuid;
begin
  if v_me is null or public.my_role() is null then
    raise exception 'กรุณาเข้าสู่ระบบ';
  end if;
  if v_user <> v_me and not public.can_supervise_warehouse(public.profile_warehouse(v_user)) then
    raise exception 'ไม่มีสิทธิ์ขอแก้เวลาแทนพนักงานคนนี้';
  end if;
  if p_date is null or p_date > v_today then
    raise exception 'ขอแก้เวลาล่วงหน้าไม่ได้';
  end if;
  if p_date < v_today - public.setting_num('attendance.correction_max_days', v_today, 31)::integer then
    raise exception 'ขอแก้เวลาย้อนหลังได้ไม่เกิน % วัน', public.setting_num('attendance.correction_max_days', v_today, 31);
  end if;
  if p_in is null and p_out is null then
    raise exception 'ใส่เวลาเข้าหรือเวลาออกอย่างน้อย 1 อย่าง';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'กรุณาระบุเหตุผล';
  end if;
  if exists (select 1 from public.attendance_corrections where user_id = v_user and work_date = p_date and status = 'pending') then
    raise exception 'มีคำขอแก้เวลาของวันนี้รออนุมัติอยู่แล้ว';
  end if;
  insert into public.attendance_corrections (user_id, work_date, check_in, check_out, reason, created_by)
  values (v_user, p_date, p_in, p_out, trim(p_reason), v_me)
  returning id into v_id;
  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, new_data)
  values (v_me, 'correction_request', 'attendance_corrections', v_id::text, public.profile_warehouse(v_user),
          jsonb_build_object('user_id', v_user, 'date', p_date, 'in', p_in, 'out', p_out, 'reason', trim(p_reason)));
  return v_id;
end $$;

create function public.cancel_correction(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.attendance_corrections set status = 'cancelled', decided_at = now(), decided_by = (select auth.uid())
  where id = p_id and status = 'pending' and (user_id = (select auth.uid()) or created_by = (select auth.uid()));
  if not found then
    raise exception 'ยกเลิกไม่ได้ (ไม่ใช่คำขอของคุณ หรือดำเนินการไปแล้ว)';
  end if;
end $$;

-- อนุมัติ/ไม่อนุมัติคำขอแก้เวลา (อนุมัติแล้วล็อก ระบบเพิ่มเวลาให้)
create function public.decide_correction(p_id uuid, p_approve boolean, p_note text default null) returns void
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
  if not public.can_supervise_warehouse(public.profile_warehouse(v_c.user_id)) then
    raise exception 'ไม่มีสิทธิ์อนุมัติคำขอของพนักงานคนนี้';
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
      -- เวลาออกเช้ากว่าเวลาเข้า (หรือกะดึก) = เช้าวันถัดไป
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

-- =====================================================================
-- ใบลา
-- =====================================================================
create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  leave_type text not null,
  start_date date not null,
  end_date date not null,
  period text not null default 'full' check (period in ('full', 'morning', 'afternoon')),
  days numeric(5, 1) not null check (days > 0),
  reason text check (char_length(reason) <= 500),
  attachment_path text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'cancel_requested')),
  steps_required integer not null default 1 check (steps_required between 1 and 2),
  steps_done integer not null default 0,
  over_quota boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (end_date - start_date <= 180),
  check (period = 'full' or start_date = end_date)
);
create index leave_requests_user on public.leave_requests (user_id, start_date);
create index leave_requests_status on public.leave_requests (status);

-- ลายเซ็น/ประวัติการอนุมัติของแต่ละใบ
create table public.leave_approvals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.leave_requests (id) on delete cascade,
  step integer not null,
  action text not null check (action in ('approve', 'reject', 'cancel_request', 'cancel_approve', 'cancel_reject')),
  actor_id uuid,
  actor_name text,
  actor_role text,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index leave_approvals_request on public.leave_approvals (request_id);

-- โควตารายคน (แทนค่ามาตรฐานในหน้าตั้งค่า)
create table public.leave_quota_overrides (
  user_id uuid not null references public.profiles (id) on delete cascade,
  year integer not null check (year between 2000 and 2100),
  leave_type text not null,
  days numeric(5, 1) not null check (days >= 0 and days <= 366),
  note text check (char_length(note) <= 200),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (user_id, year, leave_type)
);

-- นับวันลา: เฉพาะวันทำงานตามตารางกะ (ไม่นับ OFF/HOL) / วันที่ยังไม่มีตารางกะ นับยกเว้นวันนักขัตฤกษ์
create function public.leave_day_count(p_user uuid, p_start date, p_end date, p_period text) returns numeric
language sql stable security definer set search_path = '' as $$
  select count(*) * case when p_period = 'full' then 1.0 else 0.5 end
  from generate_series(p_start, p_end, interval '1 day') g
  left join public.shift_schedules s on s.user_id = p_user and s.work_date = g::date
  where case
    when s.id is not null then (select m.start_min from public.shift_minutes(s.shift_code) m) is not null
    else not exists (select 1 from public.holidays h where h.holiday_date = g::date)
  end
$$;

create function public.leave_quota(p_user uuid, p_year integer, p_type text) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select days from public.leave_quota_overrides where user_id = p_user and year = p_year and leave_type = p_type),
    (public.setting('leave.quota', make_date(p_year, 12, 31)) ->> p_type)::numeric
  )
$$;

create function public.leave_used(p_user uuid, p_year integer, p_type text, p_exclude uuid default null) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(days), 0) from public.leave_requests
  where user_id = p_user and leave_type = p_type and extract(year from start_date) = p_year
    and status in ('pending', 'approved', 'cancel_requested') and id is distinct from p_exclude
$$;

-- ดูจำนวนวันก่อนยื่น
create function public.leave_days_preview(p_start date, p_end date, p_period text, p_user uuid default null) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := coalesce(p_user, (select auth.uid()));
begin
  if v_user <> (select auth.uid()) and not public.can_supervise_warehouse(public.profile_warehouse(v_user)) then
    raise exception 'ไม่มีสิทธิ์';
  end if;
  return public.leave_day_count(v_user, p_start, p_end, coalesce(p_period, 'full'));
end $$;

-- ยื่นใบลา (หัวหน้างานยื่นแทนพนักงานได้)
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
  if v_period <> 'full' and p_start <> p_end then
    raise exception 'ลาครึ่งวันเลือกได้วันเดียว';
  end if;
  if exists (
    select 1 from public.leave_requests
    where user_id = v_user and status in ('pending', 'approved', 'cancel_requested')
      and start_date <= p_end and end_date >= p_start
      and not (start_date = end_date and p_start = p_end and period <> 'full' and v_period <> 'full' and period <> v_period)
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
  v_days := public.leave_day_count(v_user, p_start, p_end, v_period);
  if v_days <= 0 then
    raise exception 'ช่วงวันที่เลือกไม่มีวันทำงานตามตารางกะ';
  end if;
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

create function public.leave_actor_name() returns text
language sql stable security definer set search_path = '' as $$
  select first_name_th || coalesce(' ' || last_name_th, '') from public.profiles where id = (select auth.uid())
$$;

-- อนุมัติ / ตีกลับ (รวมคำขอยกเลิกใบที่อนุมัติแล้ว)
-- ขั้น 1: หัวหน้างาน/แอดมินของคลัง (หรือผู้บริหาร) · ขั้น 2 (ลาตั้งแต่ N วัน): ผู้บริหาร
-- ผู้บริหารอนุมัติขั้นแรกเอง = ครบทุกขั้น · อนุมัติใบของตัวเองไม่ได้
create function public.decide_leave(p_id uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_r public.leave_requests%rowtype;
  v_status text;
  v_done integer;
  v_action text;
begin
  select * into v_r from public.leave_requests where id = p_id for update;
  if not found then
    raise exception 'ไม่พบใบลา';
  end if;
  if v_r.user_id = v_me then
    raise exception 'อนุมัติใบลาของตัวเองไม่ได้';
  end if;
  if not public.can_supervise_warehouse(public.profile_warehouse(v_r.user_id)) then
    raise exception 'ไม่มีสิทธิ์อนุมัติใบลาของพนักงานคนนี้';
  end if;
  if not p_approve and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'กรุณาระบุเหตุผล';
  end if;

  if v_r.status = 'pending' then
    if v_r.steps_done >= 1 and not public.is_global_role() then
      raise exception 'ขั้นนี้ต้องให้ผู้บริหารอนุมัติ';
    end if;
    if p_approve then
      v_done := case when public.is_global_role() then v_r.steps_required else v_r.steps_done + 1 end;
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

-- ยกเลิกใบลา: ยังไม่อนุมัติ = ยกเลิกทันที / อนุมัติแล้ว = ส่งคำขอยกเลิกให้ผู้อนุมัติ
create function public.cancel_leave(p_id uuid, p_reason text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_r public.leave_requests%rowtype;
  v_status text;
begin
  select * into v_r from public.leave_requests where id = p_id for update;
  if not found or (v_r.user_id <> v_me and v_r.created_by is distinct from v_me) then
    raise exception 'ไม่พบใบลาของคุณ';
  end if;
  if v_r.status = 'pending' then
    v_status := 'cancelled';
  elsif v_r.status = 'approved' then
    if nullif(trim(coalesce(p_reason, '')), '') is null then
      raise exception 'กรุณาระบุเหตุผลที่ขอยกเลิก';
    end if;
    v_status := 'cancel_requested';
  else
    raise exception 'ใบลานี้ยกเลิกไม่ได้';
  end if;
  update public.leave_requests set status = v_status, updated_at = now() where id = p_id;
  insert into public.leave_approvals (request_id, step, action, actor_id, actor_name, actor_role, note)
  values (p_id, 0, 'cancel_request', v_me, public.leave_actor_name(), public.my_role()::text, nullif(trim(coalesce(p_reason, '')), ''));
  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, new_data)
  values (v_me, 'leave_cancel', 'leave_requests', p_id::text, public.profile_warehouse(v_r.user_id),
          jsonb_build_object('status', v_status, 'reason', p_reason));
  return v_status;
end $$;

-- วันลาคงเหลือรายประเภท
create function public.leave_balance(p_year integer, p_user uuid default null)
returns table (leave_type text, label text, quota numeric, approved numeric, pending numeric, remaining numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := coalesce(p_user, (select auth.uid()));
begin
  if v_user <> (select auth.uid()) and not public.can_supervise_warehouse(public.profile_warehouse(v_user)) then
    raise exception 'ไม่มีสิทธิ์';
  end if;
  return query
  select o.value, o.label, q.quota,
         coalesce(sum(r.days) filter (where r.status in ('approved', 'cancel_requested')), 0),
         coalesce(sum(r.days) filter (where r.status = 'pending'), 0),
         q.quota - coalesce(sum(r.days) filter (where r.status in ('approved', 'cancel_requested', 'pending')), 0)
  from public.dropdown_options o
  cross join lateral (select public.leave_quota(v_user, p_year, o.value) as quota) q
  left join public.leave_requests r
    on r.user_id = v_user and r.leave_type = o.value and extract(year from r.start_date) = p_year
  where o.category = 'leave_type' and o.is_active
  group by o.value, o.label, o.sort_order, q.quota
  order by o.sort_order, o.label;
end $$;

-- =====================================================================
-- สถานะการเข้างานรายวัน (ตารางกะ + เวลาจริง + ใบลา) คำนวณในฐานข้อมูลที่เดียว
-- status: ok | late | early | late_early | working | no_out | no_in | absent | waiting | upcoming
--         | leave | leave_half | off | off_worked | no_shift | no_shift_worked
-- =====================================================================
create function public.attendance_rows_core(p_users uuid[], p_from date, p_to date, p_now timestamptz)
returns table (
  user_id uuid, work_date date, shift_code text, shift_start timestamptz, shift_end timestamptz,
  first_in timestamptz, last_out timestamptz, punch_count integer, leave_type text, leave_period text,
  status text, late_min integer, early_min integer, pending_correction boolean
)
language sql stable security definer set search_path = '' as $$
  with d as (
    select u as uid, g::date as wd from unnest(p_users) u, generate_series(p_from, p_to, interval '1 day') g
  ), s as (
    select d.uid, d.wd, ss.shift_code, m.start_min, m.end_min,
           public.local_ts(d.wd, m.start_min) as st, public.local_ts(d.wd, m.end_min) as en
    from d
    left join public.shift_schedules ss on ss.user_id = d.uid and ss.work_date = d.wd
    left join lateral public.shift_minutes(ss.shift_code) m on true
  ), p as (
    select ap.user_id, ap.work_date,
           min(ap.punched_at) filter (where ap.kind = 'in') as fi,
           max(ap.punched_at) filter (where ap.kind = 'out') as lo,
           count(*)::integer as n
    from public.attendance_punches ap
    where ap.user_id = any (p_users) and ap.work_date between p_from and p_to
    group by 1, 2
  ), l as (
    select distinct on (lr.user_id, g::date) lr.user_id, g::date as wd, lr.leave_type, lr.period
    from public.leave_requests lr, generate_series(lr.start_date, lr.end_date, interval '1 day') g
    where lr.user_id = any (p_users) and lr.status in ('approved', 'cancel_requested')
      and lr.end_date >= p_from and lr.start_date <= p_to
    order by lr.user_id, g::date, lr.period
  ), x as (
    select s.*, p.fi, p.lo, coalesce(p.n, 0) as n, l.leave_type, l.period,
           public.setting_num('attendance.late_grace_minutes', s.wd, 0) as grace,
           public.setting_num('attendance.early_leave_grace_minutes', s.wd, 0) as egrace,
           public.setting_num('attendance.no_out_after_hours', s.wd, 4) as noout
    from s
    left join p on p.user_id = s.uid and p.work_date = s.wd
    left join l on l.user_id = s.uid and l.wd = s.wd
  ), y as (
    select x.*,
           case when x.fi is not null and x.st is not null and x.fi > x.st + make_interval(mins => x.grace::integer)
                then ceil(extract(epoch from x.fi - x.st) / 60)::integer else 0 end as late,
           case when x.lo is not null and x.en is not null and x.lo < x.en - make_interval(mins => x.egrace::integer)
                then ceil(extract(epoch from x.en - x.lo) / 60)::integer else 0 end as early
    from x
  )
  select y.uid, y.wd, y.shift_code, y.st, y.en, y.fi, y.lo, y.n, y.leave_type, y.period,
    case
      when y.leave_type is not null and y.period = 'full' then 'leave'
      when y.leave_type is not null then 'leave_half'
      when y.shift_code is not null and y.start_min is null then case when y.n > 0 then 'off_worked' else 'off' end
      when y.shift_code is null then case when y.n > 0 then 'no_shift_worked' else 'no_shift' end
      when y.fi is null and y.lo is not null then 'no_in'
      when y.fi is null and p_now < y.st then 'upcoming'
      when y.fi is null and p_now < y.en then 'waiting'
      when y.fi is null then 'absent'
      when y.lo is null and p_now < y.en + make_interval(hours => y.noout::integer) then 'working'
      when y.lo is null then 'no_out'
      when y.late > 0 and y.early > 0 then 'late_early'
      when y.late > 0 then 'late'
      when y.early > 0 then 'early'
      else 'ok'
    end,
    y.late, y.early,
    exists (select 1 from public.attendance_corrections c where c.user_id = y.uid and c.work_date = y.wd and c.status = 'pending')
  from y
  order by y.uid, y.wd
$$;

-- การเข้างานของฉัน
create function public.my_attendance(p_from date, p_to date)
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
  -- กะของเดือนที่ยังเป็นร่างไม่แสดงให้พนักงานเห็น (สถานะยังคำนวณตามปกติ)
  return query
  select r.user_id, r.work_date,
         case when v_sup or public.is_month_published(public.profile_warehouse(r.user_id), r.work_date) then r.shift_code end,
         case when v_sup or public.is_month_published(public.profile_warehouse(r.user_id), r.work_date) then r.shift_start end,
         case when v_sup or public.is_month_published(public.profile_warehouse(r.user_id), r.work_date) then r.shift_end end,
         r.first_in, r.last_out, r.punch_count, r.leave_type, r.leave_period, r.status, r.late_min, r.early_min, r.pending_correction
  from public.attendance_rows_core(array[(select auth.uid())], p_from, p_to, now()) r;
end $$;

-- การเข้างานของคลัง (หัวหน้างานขึ้นไป)
create function public.warehouse_attendance(p_wh uuid, p_from date, p_to date)
returns table (
  user_id uuid, work_date date, shift_code text, shift_start timestamptz, shift_end timestamptz,
  first_in timestamptz, last_out timestamptz, punch_count integer, leave_type text, leave_period text,
  status text, late_min integer, early_min integer, pending_correction boolean,
  employee_code text, first_name_th text, last_name_th text, nickname text, "position" text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_users uuid[];
begin
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ดูการเข้างานของคลังนี้';
  end if;
  if p_to - p_from > 62 then
    raise exception 'เลือกช่วงได้ไม่เกิน 62 วัน';
  end if;
  select array_agg(id) into v_users from public.profiles p
  where p.warehouse_id = p_wh
    and ((p.status = 'active' and not p.exclude_from_shift)
         or exists (select 1 from public.attendance_punches a where a.user_id = p.id and a.work_date between p_from and p_to)
         or exists (select 1 from public.shift_schedules s where s.user_id = p.id and s.work_date between p_from and p_to));
  return query
  select r.*, p.employee_code, p.first_name_th, p.last_name_th, p.nickname, p.position
  from public.attendance_rows_core(coalesce(v_users, '{}'), p_from, p_to, now()) r
  join public.profiles p on p.id = r.user_id
  order by p.position nulls last, p.employee_code, r.work_date;
end $$;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.app_settings enable row level security;
alter table public.attendance_punches enable row level security;
alter table public.attendance_corrections enable row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_approvals enable row level security;
alter table public.leave_quota_overrides enable row level security;
revoke all on public.app_settings, public.attendance_punches, public.attendance_corrections,
  public.leave_requests, public.leave_approvals, public.leave_quota_overrides from anon;

-- ค่าตั้งค่า: ทุกคนอ่านได้ / ผู้บริหารและผู้ดูแลระบบสูงสุดแก้ได้ (มีผลทุกคลัง)
create policy app_settings_read on public.app_settings for select to authenticated using (true);
create policy app_settings_write on public.app_settings for all to authenticated
  using ((select public.is_global_role())) with check ((select public.is_global_role()));
create trigger app_settings_audit after insert or update or delete on public.app_settings
  for each row execute function public.audit_row();

-- เวลาเข้า-ออก: เจ้าของ + หัวหน้างานขึ้นไปของคลัง / เขียนได้ผ่านคำสั่งเท่านั้น
create policy punches_read on public.attendance_punches for select to authenticated
  using (user_id = (select auth.uid()) or public.can_supervise_warehouse(public.profile_warehouse(user_id)));
revoke insert, update, delete on public.attendance_punches from authenticated;

create policy corrections_read on public.attendance_corrections for select to authenticated
  using (user_id = (select auth.uid()) or public.can_supervise_warehouse(public.profile_warehouse(user_id)));
revoke insert, update, delete on public.attendance_corrections from authenticated;

create policy leave_read on public.leave_requests for select to authenticated
  using (user_id = (select auth.uid()) or public.can_supervise_warehouse(public.profile_warehouse(user_id)));
revoke insert, update, delete on public.leave_requests from authenticated;

create policy leave_approvals_read on public.leave_approvals for select to authenticated using (
  exists (select 1 from public.leave_requests r where r.id = request_id
          and (r.user_id = (select auth.uid()) or public.can_supervise_warehouse(public.profile_warehouse(r.user_id))))
);
revoke insert, update, delete on public.leave_approvals from authenticated;

-- โควตารายคน: เจ้าของ/หัวหน้าดูได้ แอดมินขึ้นไปของคลังแก้ได้
create policy quota_read on public.leave_quota_overrides for select to authenticated
  using (user_id = (select auth.uid()) or public.can_supervise_warehouse(public.profile_warehouse(user_id)));
create policy quota_write on public.leave_quota_overrides for all to authenticated
  using (public.can_manage_warehouse(public.profile_warehouse(user_id)))
  with check (public.can_manage_warehouse(public.profile_warehouse(user_id)));
create trigger leave_quota_overrides_audit after insert or update or delete on public.leave_quota_overrides
  for each row execute function public.audit_row();

-- =====================================================================
-- สิทธิ์เรียกฟังก์ชัน
-- =====================================================================
revoke execute on function
  public.setting(text, date), public.setting_num(text, date, numeric), public.distance_m(float8, float8, float8, float8),
  public.shift_minutes(text), public.local_ts(date, integer), public.resolve_work_date(uuid, timestamptz, text),
  public.punch_core(uuid, text, timestamptz, float8, float8, float8), public.punch(text, float8, float8, float8),
  public.request_correction(date, time, time, text, uuid), public.cancel_correction(uuid), public.decide_correction(uuid, boolean, text),
  public.leave_day_count(uuid, date, date, text), public.leave_quota(uuid, integer, text), public.leave_used(uuid, integer, text, uuid),
  public.leave_days_preview(date, date, text, uuid), public.submit_leave(text, date, date, text, text, text, uuid),
  public.leave_actor_name(), public.decide_leave(uuid, boolean, text), public.cancel_leave(uuid, text),
  public.leave_balance(integer, uuid), public.attendance_rows_core(uuid[], date, date, timestamptz),
  public.my_attendance(date, date), public.warehouse_attendance(uuid, date, date)
  from public, anon;
grant execute on function
  public.setting(text, date), public.punch(text, float8, float8, float8),
  public.request_correction(date, time, time, text, uuid), public.cancel_correction(uuid), public.decide_correction(uuid, boolean, text),
  public.leave_days_preview(date, date, text, uuid), public.submit_leave(text, date, date, text, text, text, uuid),
  public.decide_leave(uuid, boolean, text), public.cancel_leave(uuid, text), public.leave_balance(integer, uuid),
  public.my_attendance(date, date), public.warehouse_attendance(uuid, date, date)
  to authenticated;
revoke execute on function
  public.setting_num(text, date, numeric), public.distance_m(float8, float8, float8, float8), public.shift_minutes(text),
  public.local_ts(date, integer), public.resolve_work_date(uuid, timestamptz, text), public.punch_core(uuid, text, timestamptz, float8, float8, float8),
  public.leave_day_count(uuid, date, date, text), public.leave_quota(uuid, integer, text), public.leave_used(uuid, integer, text, uuid),
  public.leave_actor_name(), public.attendance_rows_core(uuid[], date, date, timestamptz)
  from authenticated;

-- =====================================================================
-- ไฟล์แนบใบลา (ใบรับรองแพทย์) — ที่เก็บแบบปิด เห็นเฉพาะเจ้าของและหัวหน้า/ผู้อนุมัติของคลัง
-- (ข้ามส่วนนี้ในฐานข้อมูลจำลองที่ไม่มี storage)
-- =====================================================================
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('leave-attachments', 'leave-attachments', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  execute $p$
    create policy leave_files_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'leave-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text)
  $p$;
  execute $p$
    create policy leave_files_read on storage.objects for select to authenticated
    using (bucket_id = 'leave-attachments' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.can_supervise_warehouse(public.profile_warehouse(((storage.foldername(name))[1])::uuid))
    ))
  $p$;
  execute $p$
    create policy leave_files_delete on storage.objects for delete to authenticated
    using (bucket_id = 'leave-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text
           and not exists (select 1 from public.leave_requests r where r.attachment_path = name))
  $p$;
end $$;
