-- ย้อนกลับ migration 0034_units (ถอดหน่วยงานและรั้วกั้นข้อมูล กลับเป็นแบบก่อน 27 พ.ย. 2569)
-- ใช้เมื่อจำเป็นเท่านั้น: สำรองก่อน (node scripts/backup-db.mjs) แล้วรันไฟล์นี้ใน Supabase SQL Editor
-- ข้อควรระวัง: ถ้าสร้างหน่วยงาน/คลังหน้าร้านไปแล้ว คลังและพนักงานยังอยู่ แต่จะกลับไปเห็นข้ามกันได้เหมือนเดิม
begin;
do $$
declare t text;
begin
  foreach t in array array['warehouses', 'profiles', 'user_warehouses', 'employee_skills', 'shift_schedules', 'shift_cell_notes',
    'attendance_punches', 'attendance_corrections', 'leave_requests', 'leave_quota_overrides', 'ot_approvals', 'notifications',
    'pull_bookings', 'pull_leftover_notes', 'headcount_budgets', 'schedule_months', 'schedule_group_order', 'pull_skills',
    'pull_workload_types', 'pull_tasks', 'pull_task_rates', 'pull_shift_hours', 'pull_workloads', 'audit_logs'] loop
    execute format('drop policy if exists unit_fence on public.%I', t);
  end loop;
end $$;
drop trigger if exists warehouses_unit_guard on public.warehouses;
drop trigger if exists pull_bookings_unit_guard on public.pull_bookings;
drop trigger if exists app_settings_unit_guard on public.app_settings;
drop trigger if exists dropdown_options_unit_guard on public.dropdown_options;
drop trigger if exists skills_unit_guard on public.skills;
drop trigger if exists holidays_unit_guard on public.holidays;
drop trigger if exists announcements_unit_guard on public.announcements;

-- ฟังก์ชันเดิมก่อน 0034
CREATE OR REPLACE FUNCTION public.can_manage_warehouse(p_wh uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when public.is_global_role() then true
    when public.my_role() in ('admin', 'supervisor') then coalesce(p_wh in (select public.my_warehouse_ids()), false)
    else false
  end
$function$;

CREATE OR REPLACE FUNCTION public.can_supervise_warehouse(p_wh uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when public.is_global_role() then true
    when public.my_role() in ('admin', 'supervisor') then coalesce(p_wh in (select public.my_warehouse_ids()), false)
    else false
  end
$function$;

CREATE OR REPLACE FUNCTION public.can_config_pull(p_wh uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when public.is_global_role() then true
    when public.my_role() = 'admin' then coalesce(p_wh in (select public.my_warehouse_ids()), false)
    else false
  end
$function$;

CREATE OR REPLACE FUNCTION public.can_edit_schedule(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when public.is_lead(p_user) then public.is_manager_role()
              else public.can_supervise_warehouse(public.profile_warehouse(p_user)) end
$function$;

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

CREATE OR REPLACE FUNCTION public.pull_pool(p_to_wh uuid, p_date date, p_shift text)
 RETURNS TABLE(user_id uuid, employee_code text, name text, nickname text, emp_position text, warehouse_id uuid, warehouse_code text, shift_code text, start_min integer, status text, reason text, skills text[], booking_id uuid, booked_to uuid, booked_to_code text, booked_skill text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.can_supervise_warehouse(p_to_wh) then
    raise exception 'ไม่มีสิทธิ์ดูคลังกลางของคลังนี้';
  end if;
  if p_shift is null or p_shift not in ('morning', 'night') then
    raise exception 'กรุณาเลือกกะ';
  end if;
  return query
  select p.id, p.employee_code, btrim(p.first_name_th || ' ' || coalesce(p.last_name_th, '')), p.nickname, p.position,
         p.warehouse_id, w.code, s.shift_code, m.start_min,
         case
           when b.id is not null and b.shift = p_shift and b.to_warehouse_id = p_to_wh then 'booked_here'
           when b.id is not null and b.shift = p_shift then 'busy'
           when b.id is not null then 'unavailable'
           when lv.on_leave then 'unavailable'
           when s.shift_code is null or m.start_min is null or public.pull_shift_of(s.shift_code, p_date) is distinct from p_shift then 'unavailable'
           else 'ready'
         end,
         case
           when b.id is not null and b.shift = p_shift and b.to_warehouse_id = p_to_wh then 'จองเข้าคลังนี้แล้ว'
           when b.id is not null and b.shift = p_shift then 'ถูกจองโดย ' || bw.code
           when b.id is not null then 'จอง' || case when b.shift = 'morning' then 'กะเช้า' else 'กะดึก' end || 'แล้ว · ' || bw.code
           when lv.on_leave then 'ลา'
           when s.shift_code is null then 'ไม่มีกะในวันนี้'
           when m.start_min is null then 'วันหยุด (' || s.shift_code || ')'
           when public.pull_shift_of(s.shift_code, p_date) is distinct from p_shift then
             case when p_shift = 'morning' then 'เข้ากะดึก' else 'เข้ากะเช้า' end
         end,
         coalesce(sk.names, '{}'),
         b.id, b.to_warehouse_id, bw.code, b.skill_name
  from public.profiles p
  join public.warehouses w on w.id = p.warehouse_id and w.is_active
  left join public.shift_schedules s on s.user_id = p.id and s.work_date = p_date
  left join lateral (select x.start_min from public.shift_minutes(s.shift_code) x) m on true
  left join lateral (
    select exists (
      select 1 from public.leave_requests l
      where l.user_id = p.id and p_date between l.start_date and l.end_date and l.status in ('pending', 'approved', 'cancel_requested')
    ) as on_leave
  ) lv on true
  left join public.pull_bookings b on b.user_id = p.id and b.work_date = p_date and b.status = 'booked'
  left join public.warehouses bw on bw.id = b.to_warehouse_id
  left join lateral (
    select array_agg(distinct k.name order by k.name) as names
    from public.employee_skills es join public.skills k on k.id = es.skill_id
    where es.user_id = p.id
  ) sk on true
  where p.status = 'active' and p.role in ('employee', 'supervisor')
  order by w.code, m.start_min nulls last, p.employee_code;
end $function$;

CREATE OR REPLACE FUNCTION public.pull_skill_counts()
 RETURNS TABLE(warehouse_id uuid, skill_name text, people integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(public.role_rank(public.my_role()), 0) < 2 then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลนี้';
  end if;
  return query
  select p.warehouse_id, k.name, count(distinct p.id)::integer
  from public.employee_skills es
  join public.skills k on k.id = es.skill_id
  join public.profiles p on p.id = es.user_id
  where p.status = 'active' and p.warehouse_id is not null
  group by p.warehouse_id, k.name;
end $function$;

CREATE OR REPLACE FUNCTION public.can_approve_user(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles t
    where t.id = p_user and t.id <> (select auth.uid())
      and public.role_rank(public.my_role()) >= public.approval_min_rank(t.role)
      and public.role_rank(public.my_role()) > public.role_rank(t.role)
      and (public.is_global_role() or t.warehouse_id in (select public.my_warehouse_ids()))
  )
$function$;

CREATE OR REPLACE FUNCTION public.approvers_for(p_user uuid, p_min integer DEFAULT NULL::integer)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.diligence_core(p_users uuid[], p_month date, p_now timestamp with time zone)
 RETURNS TABLE(user_id uuid, period_start date, period_end date, absent integer, late integer, no_punch integer, leave_days numeric, streak integer, amount numeric, qualified boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

alter table public.warehouses drop column if exists unit_id;
drop table if exists public.units;
drop function if exists public.warehouse_unit_guard(), public.shared_config_guard(), public.pull_booking_unit_guard(),
  public.my_modules(), public.in_default_unit(), public.unit_has_module(uuid, text), public.wh_in_my_units(uuid),
  public.shares_unit(uuid, uuid), public.in_my_units(uuid), public.unit_unfenced(), public.unit_user_ids(),
  public.user_unit_ids(uuid), public.unit_warehouse_ids(), public.my_unit_ids(), public.default_unit_id();
delete from public.app_settings where key = 'diligence.excluded_warehouses';
delete from app_private.migrations where name = '0034_units.sql';
commit;
