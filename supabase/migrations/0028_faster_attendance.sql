-- =====================================================================
-- 0028 คำนวณสถานะลงเวลาเร็วขึ้น · กฎและผลลัพธ์เหมือนเดิมทุกข้อ
--   เดิม: ทุกแถว (คน × วัน) เรียกอ่านค่าตั้งค่า 3 ครั้ง อ่านเวลารหัสกะ แปลงเวลา 2 ครั้ง และค้นคำขอแก้เวลา
--   ใหม่: อ่านค่าตั้งค่าครั้งเดียวต่อวัน อ่านเวลาครั้งเดียวต่อรหัสกะ และรวมคำขอแก้เวลาไว้ก่อน
--   ใช้กับ: หน้าหลัก ลงเวลา ติดตามการเข้างาน ตารางกะ (ขาดงาน) OT เบี้ยขยัน
-- =====================================================================
create or replace function public.attendance_rows_core(p_users uuid[], p_from date, p_to date, p_now timestamptz)
returns table (
  user_id uuid, work_date date, shift_code text, shift_start timestamptz, shift_end timestamptz,
  first_in timestamptz, last_out timestamptz, punch_count integer, leave_type text, leave_period text,
  status text, late_min integer, early_min integer, pending_correction boolean
)
language sql stable security definer set search_path = '' as $$
  with g as (
    select (public.setting('attendance.go_live_date') #>> '{}')::date as live
  ), days as materialized (
    -- ค่าตั้งค่าตามวันที่เริ่มใช้: อ่านครั้งเดียวต่อวัน
    select ds::date as wd,
           public.setting_num('attendance.late_grace_minutes', ds::date, 0) as grace,
           public.setting_num('attendance.early_leave_grace_minutes', ds::date, 0) as egrace,
           public.setting_num('attendance.no_out_after_hours', ds::date, 4) as noout
    from generate_series(p_from, p_to, interval '1 day') ds
  ), codes as materialized (
    -- เวลาเข้า-ออกของรหัสกะ: อ่านครั้งเดียวต่อรหัส
    select c.code, m.start_min, m.end_min
    from (
      select distinct ss.shift_code as code from public.shift_schedules ss
      where ss.user_id = any (p_users) and ss.work_date between p_from and p_to
    ) c
    left join lateral public.shift_minutes(c.code) m on true
  ), s as (
    select u as uid, d.wd, d.grace, d.egrace, d.noout, ss.shift_code, c.start_min, c.end_min,
           (d.wd + make_interval(mins => c.start_min)) at time zone 'Asia/Bangkok' as st,
           (d.wd + make_interval(mins => c.end_min)) at time zone 'Asia/Bangkok' as en
    from unnest(p_users) u
    cross join days d
    left join public.shift_schedules ss on ss.user_id = u and ss.work_date = d.wd
    left join codes c on c.code = ss.shift_code
  ), p as (
    select ap.user_id, ap.work_date,
           min(ap.punched_at) filter (where ap.kind = 'in') as fi,
           max(ap.punched_at) filter (where ap.kind = 'out') as lo,
           count(*)::integer as n
    from public.attendance_punches ap
    where ap.user_id = any (p_users) and ap.work_date between p_from and p_to
    group by 1, 2
  ), l as (
    select distinct on (lr.user_id, ld::date) lr.user_id, ld::date as wd, lr.leave_type, lr.period
    from public.leave_requests lr, generate_series(lr.start_date, lr.end_date, interval '1 day') ld
    where lr.user_id = any (p_users) and lr.status in ('approved', 'cancel_requested')
      and lr.end_date >= p_from and lr.start_date <= p_to
    order by lr.user_id, ld::date, lr.period
  ), pc as (
    select distinct ac.user_id, ac.work_date
    from public.attendance_corrections ac
    where ac.status = 'pending' and ac.user_id = any (p_users) and ac.work_date between p_from and p_to
  ), x as (
    select s.*, p.fi, p.lo, coalesce(p.n, 0) as n, l.leave_type, l.period, pc.user_id is not null as has_fix
    from s
    left join p on p.user_id = s.uid and p.work_date = s.wd
    left join l on l.user_id = s.uid and l.wd = s.wd
    left join pc on pc.user_id = s.uid and pc.work_date = s.wd
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
    y.late, y.early, y.has_fix
  from y
  order by y.uid, y.wd
$$;
