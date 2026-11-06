-- =====================================================================
-- 0008 วันเริ่มใช้ลงเวลาในแอป
-- ก่อนวันนี้ (หรือยังไม่ได้ตั้ง): วันที่ไม่มีเวลาเข้า-ออก = "ยังไม่เริ่มใช้" ไม่นับขาดงาน
-- ไม่แจ้งเตือนลืมลงเวลา/ขาดงานติดต่อกัน ไม่เข้างานอัตโนมัติ และไม่คิดเบี้ยขยัน
-- (กันตารางกะเดิมที่ย้ายมาจากแอปเก่าซึ่งไม่มีเวลาเข้า-ออก ถูกนับเป็นขาดงานทั้งหมด)
-- =====================================================================
insert into public.app_settings (key, effective_from, value, note) values
  ('attendance.go_live_date', '2000-01-01', 'null', 'ยังไม่ตั้ง = ยังไม่เริ่มนับขาดงาน/แจ้งเตือน/เบี้ยขยัน')
on conflict do nothing;

create or replace function public.attendance_rows_core(p_users uuid[], p_from date, p_to date, p_now timestamptz)
returns table (
  user_id uuid, work_date date, shift_code text, shift_start timestamptz, shift_end timestamptz,
  first_in timestamptz, last_out timestamptz, punch_count integer, leave_type text, leave_period text,
  status text, late_min integer, early_min integer, pending_correction boolean
)
language sql stable security definer set search_path = '' as $$
  with g as (
    select (public.setting('attendance.go_live_date') #>> '{}')::date as live
  ), d as (
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
      when y.n = 0 and ((select live from g) is null or y.wd < (select live from g)) then 'not_tracked'
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

create or replace function public.diligence_core(p_users uuid[], p_month date, p_now timestamptz)
returns table (user_id uuid, period_start date, period_end date, absent integer, late integer, no_punch integer,
               leave_days numeric, streak integer, amount numeric, qualified boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_steps jsonb;
  v_rules jsonb;
  v_types jsonb;
  v_n integer;
  k integer;
  per record;
  u uuid;
  v_streak integer;
  v_clean boolean;
  v_first boolean;
  c record;
  v_amt numeric;
  t record;
  v_live date := (public.setting('attendance.go_live_date') #>> '{}')::date;
begin
  select * into per from public.payroll_period(p_month);
  v_steps := coalesce(public.setting('diligence.steps', per.p_end), '[]');
  v_rules := coalesce(public.setting('diligence.rules', per.p_end), '{}');
  v_types := coalesce(public.setting('diligence.employment_types', per.p_end), '[]');
  v_n := greatest(jsonb_array_length(v_steps), 1);
  foreach u in array p_users loop
    if jsonb_array_length(v_types) > 0
       and not exists (select 1 from public.profiles p where p.id = u and v_types ? coalesce(p.employment_type, '')) then
      continue;
    end if;
    v_streak := 0;
    v_first := true;
    -- ย้อนจากรอบนี้ไปทีละรอบ (นับได้สูงสุดเท่าจำนวนขั้น)
    for k in 0 .. v_n - 1 loop
      select * into t from public.payroll_period((date_trunc('month', p_month) - make_interval(months => k))::date);
      select
        count(*) filter (where x.status = 'absent')::integer as absent,
        count(*) filter (where x.late_min > 0)::integer as late,
        count(*) filter (where x.status in ('no_out', 'no_in'))::integer as no_punch,
        coalesce(sum(case when x.status = 'leave' then 1 when x.status = 'leave_half' then 0.5 else 0 end)
          filter (where coalesce(v_rules -> 'leave_types', '[]') ? x.leave_type), 0) as leave_days,
        count(*) filter (where x.shift_start is not null)::integer as work_shifts
      into c
      from public.attendance_rows_core(array[u], greatest(t.p_start, coalesce(v_live, t.p_start)), least(t.p_end, (p_now at time zone 'Asia/Bangkok')::date), p_now) x;
      v_clean := v_live is not null and t.p_end >= v_live and c.work_shifts > 0
        and not (coalesce((v_rules ->> 'absent')::boolean, true) and c.absent > 0)
        and not (coalesce((v_rules ->> 'late')::boolean, true) and c.late > 0)
        and not (coalesce((v_rules ->> 'no_punch')::boolean, true) and c.no_punch > 0)
        and c.leave_days = 0;
      if v_first then
        user_id := u; period_start := t.p_start; period_end := t.p_end;
        absent := c.absent; late := c.late; no_punch := c.no_punch; leave_days := c.leave_days;
        qualified := v_clean;
        v_first := false;
      end if;
      exit when not v_clean;
      v_streak := v_streak + 1;
    end loop;
    streak := v_streak;
    v_amt := case when v_streak > 0 then (v_steps ->> (least(v_streak, jsonb_array_length(v_steps)) - 1))::numeric else 0 end;
    amount := coalesce(v_amt, 0);
    return next;
  end loop;
end $$;

create or replace function public.run_jobs_at(p_now timestamptz) returns jsonb
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
  v_live date := (public.setting('attendance.go_live_date') #>> '{}')::date;
begin
  if v_live is null or v_today < v_live then
    return jsonb_build_object('skipped', 'ยังไม่ถึงวันเริ่มใช้ลงเวลาในแอป');
  end if;
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
    continue when r.on_leave or r.work_date < v_live;
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
      continue when v_cnt < v_streak or v_streak < 1 or v_dates[v_cnt] < v_live;
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
        greatest(v_today - 7, v_live), v_today - 1, p_now) o
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

-- ลบแจ้งเตือน "ขาดงานติดต่อกัน" ที่เกิดจากตารางกะเดิม (ก่อนเริ่มใช้ลงเวลา) ซึ่งไม่ถูกต้อง
delete from public.notifications where kind = 'absent_streak';
