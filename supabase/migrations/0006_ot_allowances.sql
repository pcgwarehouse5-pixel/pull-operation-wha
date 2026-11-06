-- =====================================================================
-- 0006 OT (คำนวณจากเวลาจริง + หัวหน้าอนุมัติ) / เบี้ยขยัน / ค่าเดินทาง / รายงาน
-- ผลเป็น "ชั่วโมงแยกตามอัตรา" และจำนวนเงินเบี้ยขยัน/ค่าเดินทาง (ไม่เก็บเงินเดือนในแอป)
-- อัตราและกฎทั้งหมดอยู่ใน app_settings พร้อมวันที่เริ่มใช้
-- =====================================================================

insert into public.app_settings (key, effective_from, value, note) values
  ('ot.min_minutes', '2000-01-01', '60', 'ไม่นับ OT ถ้าเกินเวลาเลิกกะไม่ถึงค่านี้ (ตามที่บริษัทเลือก)'),
  ('ot.round_minutes', '2000-01-01', '30', 'ปัดลงทีละกี่นาที'),
  ('ot.max_hours_per_day', '2000-01-01', '16', 'เพดานกันคำนวณผิด'),
  ('ot.break_minutes', '2000-01-01', '60', 'หักพักเมื่อทำงานวันหยุดครบตามเวลาที่กำหนด'),
  ('ot.break_after_minutes', '2000-01-01', '480', 'ทำงานวันหยุดครบกี่นาทีจึงหักพัก'),
  ('ot.holiday_normal_hours', '2000-01-01', '8', 'ชั่วโมงปกติของการทำงานวันหยุด เมื่อกะไม่มีเวลาเข้า-ออก'),
  ('ot.rates', '2000-01-01',
   '{"default": {"workday": 1.5, "holiday_normal": 1, "holiday_ot": 3}, "daily_worker": {"workday": 1.5, "holiday_normal": 2, "holiday_ot": 3}}',
   'ตามแอปเดิม (คนงานรายวัน OT วันทำงานปรับเป็น 1.5) ตรวจกับกฎหมายล่าสุดก่อนใช้'),
  ('payroll.cutoff_day', '2000-01-01', '0', '0 = ตัดรอบสิ้นเดือน / 20 = รอบ 21 ของเดือนก่อน ถึง 20'),
  ('diligence.steps', '2000-01-01', '[300, 400, 500]', 'ขั้นบันไดตามแอปเดิม (บาท/เดือน)'),
  ('diligence.rules', '2000-01-01', '{"absent": true, "late": true, "no_punch": true, "leave_types": ["sick", "personal", "vacation", "maternity", "ordination", "absent"]}', 'เหตุที่ทำให้ไม่ได้เบี้ยขยัน'),
  ('diligence.employment_types', '2000-01-01', '[]', 'ว่าง = ทุกประเภท'),
  ('travel.rate_per_day', '2000-01-01', '30', 'บาท/วันที่มาทำงาน (ตามแอปเดิม)')
on conflict do nothing;

-- ผลอนุมัติ OT (เก็บตัวเลขตอนอนุมัติ ถ้าเวลาจริงเปลี่ยนภายหลัง ต้องอนุมัติใหม่)
create table public.ot_approvals (
  user_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null,
  normal_hours numeric(5, 1) not null default 0,
  normal_rate numeric(4, 2),
  ot_hours numeric(5, 1) not null default 0,
  ot_rate numeric(4, 2),
  status text not null check (status in ('approved', 'rejected')),
  note text check (char_length(note) <= 300),
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz not null default now(),
  primary key (user_id, work_date)
);

-- ปัดเศษ: น้อยกว่าขั้นต่ำ = 0 / ปัดลงทีละ step นาที / มีเพดาน
create function public.ot_round(p_minutes numeric, p_min numeric, p_step numeric, p_cap numeric) returns numeric
language sql immutable set search_path = '' as $$
  select case
    when p_minutes is null or p_minutes < greatest(p_min, 1) then 0
    else least(floor(p_minutes / greatest(p_step, 1)) * greatest(p_step, 1) / 60.0, p_cap)
  end
$$;

-- อัตราของประเภทพนักงานนั้น ณ วันที่ (ไม่มีกำหนดเฉพาะ = default)
create function public.ot_rate(p_type text, p_date date, p_kind text) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (public.setting('ot.rates', p_date) -> coalesce(p_type, '') ->> p_kind)::numeric,
    (public.setting('ot.rates', p_date) -> 'default' ->> p_kind)::numeric
  )
$$;

-- แกนคำนวณ OT รายวัน (เฉพาะวันที่มีทั้งเวลาเข้าและออก และมีชั่วโมง > 0)
-- วันปกติ: เวลาหลังเลิกกะ / วันหยุด (OFF/HOL หรือกะที่ติดทำงานวันหยุด): ชั่วโมงปกติ + ส่วนเกิน
create function public.ot_rows_core(p_users uuid[], p_from date, p_to date, p_now timestamptz)
returns table (
  user_id uuid, work_date date, day_type text, shift_code text, first_in timestamptz, last_out timestamptz,
  normal_hours numeric, normal_rate numeric, ot_hours numeric, ot_rate numeric,
  approval text, decided_by_name text, decided_at timestamptz, note text
)
language plpgsql stable security definer set search_path = '' as $$
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
      when r.shift_code is not null and r.shift_start is null then
        case when r.shift_code = 'HOL' or exists (select 1 from public.holidays h where h.holiday_date = r.work_date) then 'HOL' else 'OFF' end
      when r.shift_start is not null then 'normal'
      else null
    end;
    continue when v_day is null;

    v_min := public.setting_num('ot.min_minutes', r.work_date, 60);
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
end $$;

-- OT ของคลัง (หัวหน้างานขึ้นไป)
create function public.warehouse_ot(p_wh uuid, p_from date, p_to date)
returns table (
  user_id uuid, work_date date, day_type text, shift_code text, first_in timestamptz, last_out timestamptz,
  normal_hours numeric, normal_rate numeric, ot_hours numeric, ot_rate numeric,
  approval text, decided_by_name text, decided_at timestamptz, note text,
  employee_code text, first_name_th text, last_name_th text, nickname text, "position" text, salary_code text, employment_type text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_users uuid[];
begin
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ดู OT ของคลังนี้';
  end if;
  if p_to - p_from > 62 then
    raise exception 'เลือกช่วงได้ไม่เกิน 62 วัน';
  end if;
  select array_agg(p.id) into v_users from public.profiles p
  where p.warehouse_id = p_wh
    and exists (select 1 from public.attendance_punches a where a.user_id = p.id and a.work_date between p_from and p_to);
  return query
  select o.*, p.employee_code, p.first_name_th, p.last_name_th, p.nickname, p.position, p.salary_code, p.employment_type
  from public.ot_rows_core(coalesce(v_users, '{}'), p_from, p_to, now()) o
  join public.profiles p on p.id = o.user_id
  order by p.position nulls last, p.employee_code, o.work_date;
end $$;

-- OT ของฉัน
create function public.my_ot(p_from date, p_to date)
returns table (
  user_id uuid, work_date date, day_type text, shift_code text, first_in timestamptz, last_out timestamptz,
  normal_hours numeric, normal_rate numeric, ot_hours numeric, ot_rate numeric,
  approval text, decided_by_name text, decided_at timestamptz, note text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'กรุณาเข้าสู่ระบบ';
  end if;
  if p_to - p_from > 62 then
    raise exception 'เลือกช่วงได้ไม่เกิน 62 วัน';
  end if;
  return query select * from public.ot_rows_core(array[(select auth.uid())], p_from, p_to, now());
end $$;

-- อนุมัติ/ไม่อนุมัติ OT หลายรายการ: p_items = [{user_id, work_date}] (บันทึกตัวเลขที่คำนวณได้ ณ ตอนนั้น)
create function public.decide_ot(p_items jsonb, p_approve boolean, p_note text default null) returns integer
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
    if not public.can_supervise_warehouse(v_wh) then
      raise exception 'ไม่มีสิทธิ์อนุมัติ OT ของพนักงานคนนี้';
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

-- =====================================================================
-- รอบเงินเดือน / เบี้ยขยัน / ค่าเดินทาง / สรุปลา
-- =====================================================================
-- รอบของเดือน p_month: ตัดรอบวันที่ N → (N+1 ของเดือนก่อน) ถึง N ของเดือนนั้น / 0 = ทั้งเดือน
create function public.payroll_period(p_month date, out p_start date, out p_end date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_m date := date_trunc('month', p_month)::date;
  v_cut integer := public.setting_num('payroll.cutoff_day', v_m, 0)::integer;
begin
  if v_cut between 1 and 28 then
    p_start := (v_m - interval '1 month')::date + v_cut;
    p_end := v_m + v_cut - 1;
  else
    p_start := v_m;
    p_end := (v_m + interval '1 month - 1 day')::date;
  end if;
end $$;

create function public.diligence_core(p_users uuid[], p_month date, p_now timestamptz)
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
      from public.attendance_rows_core(array[u], t.p_start, least(t.p_end, (p_now at time zone 'Asia/Bangkok')::date), p_now) x;
      v_clean := c.work_shifts > 0
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

create function public.warehouse_diligence(p_wh uuid, p_month date)
returns table (user_id uuid, period_start date, period_end date, absent integer, late integer, no_punch integer,
               leave_days numeric, streak integer, amount numeric, qualified boolean,
               employee_code text, first_name_th text, last_name_th text, nickname text, "position" text, salary_code text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_users uuid[];
begin
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ดูรายงานของคลังนี้';
  end if;
  select array_agg(pp.id order by pp.employee_code) into v_users from public.profiles pp
  where pp.warehouse_id = p_wh and pp.status = 'active' and not pp.exclude_from_shift;
  return query
  select d.*, p.employee_code, p.first_name_th, p.last_name_th, p.nickname, p.position, p.salary_code
  from public.diligence_core(coalesce(v_users, '{}'), p_month, now()) d
  join public.profiles p on p.id = d.user_id
  order by p.position nulls last, p.employee_code;
end $$;

-- ค่าเดินทาง: วันที่มาทำงานจริง (มีเวลาเข้าหรือออก) × อัตรา ณ วันนั้น เฉพาะคนที่ติ๊ก "ได้ค่าเดินทาง"
create function public.warehouse_travel(p_wh uuid, p_from date, p_to date)
returns table (user_id uuid, days integer, amount numeric, employee_code text, first_name_th text, last_name_th text,
               nickname text, "position" text, salary_code text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ดูรายงานของคลังนี้';
  end if;
  if p_to - p_from > 62 then
    raise exception 'เลือกช่วงได้ไม่เกิน 62 วัน';
  end if;
  return query
  with d as (
    select a.user_id, a.work_date from public.attendance_punches a
    join public.profiles p on p.id = a.user_id
    where p.warehouse_id = p_wh and p.travel_eligible and a.work_date between p_from and p_to
    group by 1, 2
  )
  select p.id, count(d.work_date)::integer,
         coalesce(sum(public.setting_num('travel.rate_per_day', d.work_date, 0)), 0),
         p.employee_code, p.first_name_th, p.last_name_th, p.nickname, p.position, p.salary_code
  from public.profiles p
  left join d on d.user_id = p.id
  where p.warehouse_id = p_wh and p.travel_eligible and (p.status = 'active' or d.user_id is not null)
  group by p.id
  order by p.position nulls last, p.employee_code;
end $$;

-- สรุปวันลาที่อนุมัติในช่วงวันที่ (นับเฉพาะส่วนที่อยู่ในช่วง)
create function public.warehouse_leave_summary(p_wh uuid, p_from date, p_to date)
returns table (user_id uuid, leave_type text, days numeric, requests integer, employee_code text, first_name_th text,
               last_name_th text, nickname text, "position" text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ดูรายงานของคลังนี้';
  end if;
  return query
  select r.user_id, r.leave_type,
         sum(case when r.start_date >= p_from and r.end_date <= p_to then r.days
                  else public.leave_day_count(r.user_id, greatest(r.start_date, p_from), least(r.end_date, p_to), r.period) end),
         count(*)::integer, p.employee_code, p.first_name_th, p.last_name_th, p.nickname, p.position
  from public.leave_requests r
  join public.profiles p on p.id = r.user_id
  where p.warehouse_id = p_wh and r.status in ('approved', 'cancel_requested')
    and r.start_date <= p_to and r.end_date >= p_from
  group by r.user_id, r.leave_type, p.employee_code, p.first_name_th, p.last_name_th, p.nickname, p.position
  order by p.employee_code, r.leave_type;
end $$;

-- ภาพรวมผู้บริหาร: ต่อคลังที่ดูแล วันนี้ + ตั้งแต่ต้นเดือน
create function public.dashboard_summary(p_date date)
returns table (warehouse_id uuid, code text, name text, headcount integer, scheduled integer, present integer,
               late integer, waiting integer, absent integer, on_leave integer,
               mtd_absent integer, mtd_leave_days numeric, mtd_ot_hours numeric, mtd_ot_pending integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  w record;
  v_users uuid[];
  v_from date := date_trunc('month', p_date)::date;
begin
  if public.my_role() is null or public.role_rank(public.my_role()) < 2 then
    raise exception 'ไม่มีสิทธิ์';
  end if;
  for w in select ww.id, ww.code, ww.name from public.warehouses ww where ww.is_active and public.can_supervise_warehouse(ww.id) order by ww.code loop
    select array_agg(pp.id) into v_users from public.profiles pp where pp.warehouse_id = w.id and pp.status = 'active' and not pp.exclude_from_shift;
    v_users := coalesce(v_users, '{}');
    warehouse_id := w.id; code := w.code; name := w.name; headcount := cardinality(v_users);
    select count(*) filter (where x.shift_start is not null)::integer,
           count(*) filter (where x.first_in is not null)::integer,
           count(*) filter (where x.late_min > 0)::integer,
           count(*) filter (where x.status = 'waiting')::integer,
           count(*) filter (where x.status = 'absent')::integer,
           count(*) filter (where x.status in ('leave', 'leave_half'))::integer
    into scheduled, present, late, waiting, absent, on_leave
    from public.attendance_rows_core(v_users, p_date, p_date, now()) x;
    select count(*) filter (where x.status = 'absent')::integer,
           coalesce(sum(case when x.status = 'leave' then 1 when x.status = 'leave_half' then 0.5 else 0 end), 0)
    into mtd_absent, mtd_leave_days
    from public.attendance_rows_core(v_users, v_from, p_date, now()) x;
    select coalesce(sum(o.normal_hours + o.ot_hours) filter (where o.approval = 'approved'), 0),
           count(*) filter (where o.approval in ('pending', 'changed'))::integer
    into mtd_ot_hours, mtd_ot_pending
    from public.ot_rows_core(v_users, v_from, p_date, now()) o;
    return next;
  end loop;
end $$;

-- =====================================================================
-- RLS + สิทธิ์
-- =====================================================================
alter table public.ot_approvals enable row level security;
revoke all on public.ot_approvals from anon;
create policy ot_approvals_read on public.ot_approvals for select to authenticated
  using (user_id = (select auth.uid()) or public.can_supervise_warehouse(public.profile_warehouse(user_id)));
revoke insert, update, delete on public.ot_approvals from authenticated;

revoke execute on function
  public.ot_round(numeric, numeric, numeric, numeric), public.ot_rate(text, date, text),
  public.ot_rows_core(uuid[], date, date, timestamptz), public.warehouse_ot(uuid, date, date), public.my_ot(date, date),
  public.decide_ot(jsonb, boolean, text), public.payroll_period(date), public.diligence_core(uuid[], date, timestamptz),
  public.warehouse_diligence(uuid, date), public.warehouse_travel(uuid, date, date),
  public.warehouse_leave_summary(uuid, date, date), public.dashboard_summary(date)
  from public, anon;
grant execute on function
  public.warehouse_ot(uuid, date, date), public.my_ot(date, date), public.decide_ot(jsonb, boolean, text),
  public.payroll_period(date), public.warehouse_diligence(uuid, date), public.warehouse_travel(uuid, date, date),
  public.warehouse_leave_summary(uuid, date, date), public.dashboard_summary(date)
  to authenticated;
revoke execute on function
  public.ot_round(numeric, numeric, numeric, numeric), public.ot_rate(text, date, text),
  public.ot_rows_core(uuid[], date, date, timestamptz), public.diligence_core(uuid[], date, timestamptz)
  from authenticated;
