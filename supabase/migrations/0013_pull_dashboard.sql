-- =====================================================================
-- 0013 Pull Operation: Dashboard ผู้บริหาร + ผังตำแหน่งพนักงาน (ไฟล์ "Pull-Operation Operation & Dashboard" หน้า 3–4)
--   pull_network  = ภาพรวมทุกคลังต่อวัน (ตัวเลขรวมเท่านั้น ไม่มีรายชื่อ) สำหรับแอดมินขึ้นไป
--   set_pull_break = ตั้งเวลาพักของคนที่จองแล้ว (ใช้ในหน้าผังตำแหน่งตอนประชุมเช้า)
-- แยกสูตรคำนวณคนออกเป็นฟังก์ชันแกน (ไม่ตรวจสิทธิ์ เรียกตรงไม่ได้) เพื่อให้ภาพรวมทุกคลังใช้สูตรเดียวกันทุกที่
-- =====================================================================

-- เวลาพักที่เลือกได้ (แก้/เพิ่มได้ที่หน้าตั้งค่าตัวเลือก เช่น เพิ่มเวลาพักของกะดึก)
insert into public.dropdown_options (category, value, label, sort_order) values
  ('pull_break_time', '11:00', 'พัก 11:00', 1),
  ('pull_break_time', '12:00', 'พัก 12:00', 2),
  ('pull_break_time', '13:00', 'พัก 13:00', 3)
on conflict (category, value) do nothing;

-- ---------- ฟังก์ชันแกน (สูตรเดิมจาก 0011 ย้ายมาไว้ที่นี่) ----------
create function public.pull_requirement_rows_core(p_wh uuid, p_date date, p_shift text)
returns table (skill_name text, skill_order integer, workload_type_id uuid, type_name text, type_order integer, unit text,
               volume numeric, hours numeric, per_hour numeric, fte numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_hours numeric;
begin
  v_hours := public.pull_hours_at(p_wh, p_shift, p_date);
  return query
  select k.skill_name, ps.sort_order, t.id, t.name, t.sort_order, t.unit, w.volume, v_hours, x.per_hour,
         case when w.volume is not null and v_hours > 0 and x.per_hour > 0 then w.volume / (v_hours * x.per_hour) end
  from public.pull_tasks k
  join public.pull_workload_types t on t.id = k.workload_type_id and t.is_active
  join public.pull_skills ps on ps.warehouse_id = k.warehouse_id and ps.skill_name = k.skill_name
  left join public.pull_workloads w on w.workload_type_id = t.id and w.work_date = p_date and w.shift = p_shift
  cross join lateral (select public.pull_rate_at(k.id, p_date) as per_hour) x
  where k.warehouse_id = p_wh and k.is_active
  order by ps.sort_order, t.sort_order;
end $$;

create function public.pull_requirements_core(p_wh uuid, p_date date, p_shift text)
returns table (skill_name text, skill_order integer, fte numeric, required integer, complete boolean, missing text)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
  with rr as (select * from public.pull_requirement_rows_core(p_wh, p_date, p_shift)),
  skills as (select ps.skill_name, ps.sort_order from public.pull_skills ps where ps.warehouse_id = p_wh)
  select s.skill_name, s.sort_order,
    case when count(r.skill_name) > 0 and bool_and(r.fte is not null) then round(sum(r.fte), 4) end,
    case when count(r.skill_name) > 0 and bool_and(r.fte is not null) then greatest(0, ceil(sum(r.fte) - 0.000000001))::integer end,
    count(r.skill_name) > 0 and bool_and(r.fte is not null),
    case
      when count(r.skill_name) = 0 then 'ยังไม่ผูกประเภทงาน'
      when bool_or(r.hours is null) then 'ยังไม่ตั้งชั่วโมงต่อกะ'
      when bool_or(r.per_hour is null) then 'ยังไม่ตั้ง Productivity'
      when bool_or(r.volume is null) then 'ยังไม่กรอกยอดงาน'
    end
  from skills s
  left join rr r on r.skill_name = s.skill_name
  group by s.skill_name, s.sort_order
  order by s.sort_order;
end $$;

-- ฟังก์ชันเดิมที่หน้าจอเรียก: ตรวจสิทธิ์แล้วใช้ฟังก์ชันแกน (ผลเหมือนเดิมทุกอย่าง)
create or replace function public.pull_requirement_rows(p_wh uuid, p_date date, p_shift text)
returns table (skill_name text, skill_order integer, workload_type_id uuid, type_name text, type_order integer, unit text,
               volume numeric, hours numeric, per_hour numeric, fte numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลของคลังนี้';
  end if;
  return query select * from public.pull_requirement_rows_core(p_wh, p_date, p_shift);
end $$;

create or replace function public.pull_requirements(p_wh uuid, p_date date, p_shift text)
returns table (skill_name text, skill_order integer, fte numeric, required integer, complete boolean, missing text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลของคลังนี้';
  end if;
  return query select * from public.pull_requirements_core(p_wh, p_date, p_shift);
end $$;

-- ---------- ภาพรวมทุกคลัง (Dashboard ผู้บริหาร) ----------
-- ต่อวัน ต่อคลัง: กำลังคนในคลังกลาง (คนของคลังที่เข้ากะนั้น ไม่ได้ลา) / ลา / ความต้องการ / จองแล้ว / ดึงจากคลังอื่น / ถูกดึงไป / ยังขาด
-- need = null เมื่อคลังนั้นยังคำนวณไม่ครบ (ไม่ตีเป็น 0) · p_shift = morning / night / all (รวม 2 กะ)
create function public.pull_network(p_from date, p_to date, p_shift text)
returns table (work_day date, wh_id uuid, wh_code text, wh_name text, pool_count integer, on_leave integer,
               need integer, complete boolean, short integer, booked integer, pulled_in integer, lent_out integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(public.role_rank(public.my_role()), 0) < 3 then
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
end $$;

-- ---------- เวลาพัก (หน้าผังตำแหน่ง) ----------
create function public.set_pull_break(p_id uuid, p_time text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.pull_bookings;
begin
  select * into b from public.pull_bookings where id = p_id;
  if b.id is null or b.status <> 'booked' then
    raise exception 'ไม่พบรายการจองนี้';
  end if;
  if not public.can_supervise_warehouse(b.to_warehouse_id) then
    raise exception 'ตั้งเวลาพักได้เฉพาะคลังที่จอง';
  end if;
  if b.work_date < public.pull_today() then
    raise exception 'วันที่ผ่านไปแล้ว แก้เวลาพักไม่ได้';
  end if;
  if p_time is not null and btrim(p_time) <> '' and btrim(p_time) !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'เวลาพักไม่ถูกต้อง (ใช้รูปแบบ HH:MM)';
  end if;
  update public.pull_bookings
  set break_time = case when p_time is null or btrim(p_time) = '' then null else btrim(p_time)::time end
  where id = p_id;
end $$;

revoke execute on function
  public.pull_requirement_rows_core(uuid, date, text), public.pull_requirements_core(uuid, date, text),
  public.pull_network(date, date, text), public.set_pull_break(uuid, text)
from public, anon;
revoke execute on function public.pull_requirement_rows_core(uuid, date, text), public.pull_requirements_core(uuid, date, text) from authenticated;
grant execute on function public.pull_network(date, date, text), public.set_pull_break(uuid, text) to authenticated;
