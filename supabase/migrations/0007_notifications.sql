-- =====================================================================
-- 0007 แจ้งเตือนในแอป (กระดิ่ง) + งานอัตโนมัติทุก 15 นาที (pg_cron)
-- แจ้งเมื่อ: มีใบลา/คำขอแก้เวลารออนุมัติ, ได้ผลอนุมัติ, ประกาศตารางกะ, ยังไม่ลงเวลา, ลืมออก,
--            ขาดงานติดต่อกัน, OT รออนุมัติ / Check In อัตโนมัติตามกะ (เฉพาะคนที่ติ๊กไว้)
-- =====================================================================

insert into public.app_settings (key, effective_from, value, note) values
  ('notify.missing_in_minutes', '2000-01-01', '30', 'กะเริ่มแล้วกี่นาทียังไม่ลงเวลา จึงแจ้งเตือนพนักงาน'),
  ('notify.absent_streak_days', '2000-01-01', '3', 'ขาดงานติดต่อกันกี่วันทำงาน จึงแจ้งหัวหน้า/แอดมิน'),
  ('notify.daily_hour', '2000-01-01', '9', 'แจ้งสรุปประจำวัน (ขาดงานติดต่อกัน / OT รออนุมัติ) หลังเวลานี้')
on conflict do nothing;

alter table public.attendance_punches add column is_auto boolean not null default false;

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null check (char_length(title) <= 200),
  body text check (char_length(body) <= 500),
  link text check (link ~ '^/[a-z0-9/_-]*$'),
  dedup_key text unique,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user on public.notifications (user_id, created_at desc);

-- ส่งแจ้งเตือน (ซ้ำ dedup_key เดิม = ไม่ส่งซ้ำ)
create function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_dedup text default null)
returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body, link, dedup_key)
  select p_user, p_kind, left(p_title, 200), left(p_body, 500), p_link, p_dedup
  where exists (select 1 from public.profiles where id = p_user and status = 'active')
  on conflict (dedup_key) do nothing
$$;

-- ผู้อนุมัติของคลัง: หัวหน้างาน/แอดมินที่สังกัดหรือดูแลคลังนั้น
create function public.warehouse_approvers(p_wh uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
  where p.status = 'active' and p.role in ('supervisor', 'admin')
    and (p.warehouse_id = p_wh or exists (select 1 from public.user_warehouses uw where uw.user_id = p.id and uw.warehouse_id = p_wh))
$$;

create function public.global_approvers() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.profiles where status = 'active' and role in ('executive', 'super_admin')
$$;

create function public.short_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select first_name_th || coalesce(' (' || nickname || ')', '') from public.profiles where id = p_user
$$;

create function public.thai_day(p_date date) returns text
language sql immutable set search_path = '' as $$
  select extract(day from p_date)::text || ' '
    || (array['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'])[extract(month from p_date)::integer]
$$;

-- ---------- ใบลา ----------
create function public.leave_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_wh uuid := public.profile_warehouse(new.user_id);
  v_name text := public.short_name(new.user_id);
  v_type text := coalesce((select label from public.dropdown_options where category = 'leave_type' and value = new.leave_type), new.leave_type);
  v_what text := 'ลา' || v_type || ' ' || trim(to_char(new.days, 'FM990.0')) || ' วัน (' || public.thai_day(new.start_date)
                 || case when new.end_date > new.start_date then ' – ' || public.thai_day(new.end_date) else '' end || ')';
  a uuid;
begin
  if tg_op = 'INSERT' then
    for a in select public.warehouse_approvers(v_wh) loop
      continue when a = new.user_id;
      perform public.notify(a, 'leave_pending', 'ใบลารออนุมัติ: ' || v_name, v_what, '/leave/approvals', 'leave:' || new.id || ':new:' || a);
    end loop;
    return new;
  end if;
  if new.status = 'pending' and new.steps_done > old.steps_done then
    for a in select public.global_approvers() loop
      continue when a = new.user_id;
      perform public.notify(a, 'leave_pending', 'ใบลารอผู้บริหารอนุมัติ: ' || v_name, v_what, '/leave/approvals', 'leave:' || new.id || ':step2:' || a);
    end loop;
  elsif old.status = 'pending' and new.status in ('approved', 'rejected') then
    perform public.notify(new.user_id, 'leave_result',
      case when new.status = 'approved' then 'ใบลาได้รับการอนุมัติแล้ว' else 'ใบลาไม่ได้รับการอนุมัติ' end, v_what, '/leave',
      'leave:' || new.id || ':' || new.status);
  elsif new.status = 'cancel_requested' and old.status <> 'cancel_requested' then
    for a in select public.warehouse_approvers(v_wh) loop
      continue when a = new.user_id;
      perform public.notify(a, 'leave_pending', 'ขอยกเลิกใบลา: ' || v_name, v_what, '/leave/approvals', 'leave:' || new.id || ':cancelreq:' || a || ':' || extract(epoch from now())::bigint);
    end loop;
  elsif old.status = 'cancel_requested' and new.status in ('cancelled', 'approved') then
    perform public.notify(new.user_id, 'leave_result',
      case when new.status = 'cancelled' then 'อนุมัติการยกเลิกใบลาแล้ว' else 'ไม่อนุมัติการยกเลิกใบลา' end, v_what, '/leave',
      'leave:' || new.id || ':cancel:' || new.status || ':' || extract(epoch from now())::bigint);
  end if;
  return new;
end $$;
create trigger leave_requests_notify after insert or update of status, steps_done on public.leave_requests
  for each row execute function public.leave_notify();

-- ---------- คำขอแก้เวลา ----------
create function public.correction_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_what text := public.thai_day(new.work_date) || ' เข้า ' || coalesce(to_char(new.check_in, 'HH24:MI'), '-') || ' ออก ' || coalesce(to_char(new.check_out, 'HH24:MI'), '-');
  a uuid;
begin
  if tg_op = 'INSERT' then
    for a in select public.warehouse_approvers(public.profile_warehouse(new.user_id)) loop
      continue when a = new.user_id or a = new.created_by;
      perform public.notify(a, 'correction_pending', 'ขอแก้เวลา: ' || public.short_name(new.user_id), v_what, '/attendance/team', 'corr:' || new.id || ':' || a);
    end loop;
  elsif old.status = 'pending' and new.status in ('approved', 'rejected') then
    perform public.notify(new.user_id, 'correction_result',
      case when new.status = 'approved' then 'อนุมัติแก้เวลาแล้ว' else 'ไม่อนุมัติคำขอแก้เวลา' end,
      v_what || coalesce(' · ' || new.decision_note, ''), '/attendance', 'corr:' || new.id || ':' || new.status);
  end if;
  return new;
end $$;
create trigger attendance_corrections_notify after insert or update of status on public.attendance_corrections
  for each row execute function public.correction_notify();

-- ---------- ประกาศตารางกะ ----------
create function public.schedule_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p uuid;
  v_m text := (array['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'])[extract(month from new.month)::integer]
              || ' ' || (extract(year from new.month)::integer + 543)::text;
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    for p in select id from public.profiles where warehouse_id = new.warehouse_id and status = 'active' and not exclude_from_shift loop
      perform public.notify(p, 'schedule', 'ประกาศตารางกะ ' || v_m || ' แล้ว', 'ดูกะของคุณได้ที่เมนู ตารางกะของฉัน', '/my-shifts',
        'sched:' || new.warehouse_id || ':' || new.month || ':' || extract(epoch from coalesce(new.published_at, now()))::bigint || ':' || p);
    end loop;
  end if;
  return new;
end $$;
create trigger schedule_months_notify after insert or update of status on public.schedule_months
  for each row execute function public.schedule_notify();

-- =====================================================================
-- งานอัตโนมัติ (เรียกทุก 15 นาที) — แยกเวลาไว้ให้เทสต์ได้
-- =====================================================================
create function public.run_jobs_at(p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (p_now at time zone 'Asia/Bangkok')::date;
  v_hour integer := extract(hour from p_now at time zone 'Asia/Bangkok')::integer;
  v_miss integer := public.setting_num('notify.missing_in_minutes', v_today, 30)::integer;
  v_noout integer := public.setting_num('attendance.no_out_after_hours', v_today, 4)::integer;
  v_streak integer := public.setting_num('notify.absent_streak_days', v_today, 3)::integer;
  v_daily boolean := v_hour >= public.setting_num('notify.daily_hour', v_today, 9);
  r record;
  a uuid;
  n_in integer := 0; n_out integer := 0; n_auto integer := 0; n_abs integer := 0; n_ot integer := 0;
  v_dates date[];
  v_cnt integer;
begin
  -- กะของวันนี้และเมื่อวาน (กะดึก) ที่มีเวลาเข้า-ออก
  for r in
    select s.user_id, s.work_date, s.shift_code, m.start_min, m.end_min, p.auto_check_in, p.warehouse_id,
           public.local_ts(s.work_date, m.start_min) as st, public.local_ts(s.work_date, m.end_min) as en,
           exists (select 1 from public.attendance_punches x where x.user_id = s.user_id and x.work_date = s.work_date and x.kind = 'in') as has_in,
           exists (select 1 from public.attendance_punches x where x.user_id = s.user_id and x.work_date = s.work_date and x.kind = 'out') as has_out,
           exists (select 1 from public.leave_requests l where l.user_id = s.user_id and l.status in ('approved', 'cancel_requested')
                   and s.work_date between l.start_date and l.end_date) as on_leave
    from public.shift_schedules s
    join public.profiles p on p.id = s.user_id and p.status = 'active'
    cross join lateral public.shift_minutes(s.shift_code) m
    where s.work_date between v_today - 1 and v_today and m.start_min is not null
  loop
    continue when r.on_leave;
    -- Check In อัตโนมัติ (เฉพาะคนที่ติ๊กในทะเบียน) ที่เวลาเริ่มกะ
    if r.auto_check_in and not r.has_in and p_now >= r.st and p_now < r.en then
      insert into public.attendance_punches (user_id, kind, punched_at, work_date, warehouse_id, is_auto)
      values (r.user_id, 'in', r.st, r.work_date, r.warehouse_id, true);
      perform public.notify(r.user_id, 'auto_check_in', 'ระบบลงเวลาเข้างานอัตโนมัติแล้ว',
        'กะ ' || r.shift_code || ' เวลา ' || to_char(r.st at time zone 'Asia/Bangkok', 'HH24:MI') || ' น.', '/attendance', 'auto:' || r.user_id || ':' || r.work_date);
      n_auto := n_auto + 1;
      continue;
    end if;
    -- ยังไม่ลงเวลาเข้า
    if not r.has_in and not r.has_out and p_now >= r.st + make_interval(mins => v_miss) and p_now < r.en then
      perform public.notify(r.user_id, 'missing_in', 'ยังไม่ได้ลงเวลาเข้างาน',
        'กะ ' || r.shift_code || ' เริ่ม ' || to_char(r.st at time zone 'Asia/Bangkok', 'HH24:MI') || ' น. ถ้ามาแล้วให้กดเข้างาน หรือขอแก้เวลา',
        '/attendance', 'miss_in:' || r.user_id || ':' || r.work_date);
      n_in := n_in + 1;
    end if;
    -- ลืมลงเวลาออก
    if r.has_in and not r.has_out and p_now >= r.en + make_interval(hours => v_noout) and p_now < r.en + interval '30 hours' then
      perform public.notify(r.user_id, 'missing_out', 'ลืมลงเวลาออกงาน?',
        public.thai_day(r.work_date) || ' กะ ' || r.shift_code || ' ยังไม่มีเวลาออก กด "ขอแก้เวลา" ให้หัวหน้าอนุมัติ',
        '/attendance', 'miss_out:' || r.user_id || ':' || r.work_date);
      n_out := n_out + 1;
    end if;
  end loop;

  if v_daily then
    -- ขาดงานติดต่อกัน N วันทำงาน (วันทำงานตามตารางกะล่าสุด N วันก่อนวันนี้ ไม่มีเวลาเข้า-ออกและไม่ได้ลา)
    for r in select p.id, p.warehouse_id from public.profiles p where p.status = 'active' and p.warehouse_id is not null loop
      select array_agg(d order by d desc), count(*) into v_dates, v_cnt from (
        select s.work_date as d from public.shift_schedules s, public.shift_minutes(s.shift_code) m
        where s.user_id = r.id and s.work_date < v_today and s.work_date >= v_today - 60 and m.start_min is not null
        order by s.work_date desc limit v_streak
      ) z;
      continue when v_cnt < v_streak or v_streak < 1;
      continue when exists (select 1 from public.attendance_punches x where x.user_id = r.id and x.work_date = any (v_dates));
      continue when exists (select 1 from public.leave_requests l, unnest(v_dates) dd
                            where l.user_id = r.id and l.status in ('approved', 'cancel_requested') and dd between l.start_date and l.end_date);
      continue when exists (select 1 from public.attendance_corrections c where c.user_id = r.id and c.work_date = any (v_dates) and c.status = 'pending');
      for a in select public.warehouse_approvers(r.warehouse_id) loop
        perform public.notify(a, 'absent_streak', public.short_name(r.id) || ' ขาดงานติดต่อกัน ' || v_cnt || ' วันทำงาน',
          'วันที่ ' || (select string_agg(public.thai_day(x), ', ' order by x) from unnest(v_dates) x)
          || ' — ตรวจสอบเหตุผลกับพนักงานก่อน และปรึกษาฝ่ายบุคคล/นักกฎหมายแรงงานก่อนดำเนินการใดๆ',
          '/attendance/team', 'absent:' || r.id || ':' || v_dates[1] || ':' || a);
      end loop;
      n_abs := n_abs + 1;
    end loop;

    -- OT รออนุมัติ (7 วันล่าสุด) สรุปวันละครั้งให้ผู้อนุมัติของคลัง
    for r in select w.id from public.warehouses w where w.is_active loop
      select count(*) into v_cnt from public.ot_rows_core(
        (select coalesce(array_agg(p.id), '{}') from public.profiles p where p.warehouse_id = r.id and p.status = 'active'),
        v_today - 7, v_today - 1, p_now) o
      where o.approval in ('pending', 'changed');
      continue when v_cnt = 0;
      for a in select public.warehouse_approvers(r.id) loop
        perform public.notify(a, 'ot_pending', 'มี OT รออนุมัติ ' || v_cnt || ' รายการ', 'ช่วง 7 วันที่ผ่านมา', '/ot', 'ot:' || r.id || ':' || v_today || ':' || a);
      end loop;
      n_ot := n_ot + v_cnt;
    end loop;
  end if;

  return jsonb_build_object('missing_in', n_in, 'missing_out', n_out, 'auto_check_in', n_auto, 'absent_streak', n_abs, 'ot_pending', n_ot);
end $$;

create function public.run_jobs() returns jsonb
language sql security definer set search_path = '' as $$
  select public.run_jobs_at(now());
$$;

-- อ่านแล้ว (ของตัวเองเท่านั้น; ไม่ระบุ = อ่านทั้งหมด)
create function public.mark_notifications_read(p_ids bigint[] default null) returns integer
language sql security definer set search_path = '' as $$
  with u as (
    update public.notifications set read_at = now()
    where user_id = (select auth.uid()) and read_at is null and (p_ids is null or id = any (p_ids))
    returning 1
  )
  select count(*)::integer from u
$$;

-- =====================================================================
-- RLS + สิทธิ์
-- =====================================================================
alter table public.notifications enable row level security;
revoke all on public.notifications from anon;
create policy notifications_read on public.notifications for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.notifications from authenticated;

revoke execute on function
  public.notify(uuid, text, text, text, text, text), public.warehouse_approvers(uuid), public.global_approvers(),
  public.short_name(uuid), public.thai_day(date), public.leave_notify(), public.correction_notify(), public.schedule_notify(),
  public.run_jobs_at(timestamptz), public.run_jobs(), public.mark_notifications_read(bigint[])
  from public, anon, authenticated;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;

-- ตั้งงานทุก 15 นาที (มีเฉพาะบน Supabase จริง)
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    return;
  end if;
  begin
    create extension if not exists pg_cron;
    perform cron.schedule('wha-jobs', '*/15 * * * *', 'select public.run_jobs()');
  exception when others then
    raise notice 'ตั้งงานอัตโนมัติไม่สำเร็จ: %', sqlerrm;
  end;
end $$;
