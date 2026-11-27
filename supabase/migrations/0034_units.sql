-- หน่วยงาน (เช่น คลังสินค้า WHA / หน้าร้านคลัง 5) ใช้แอปและลิงก์เดียวกัน แต่ข้อมูลไม่ข้ามหน่วยงาน
-- หลักการ:
--   * ทุกคลังสังกัด 1 หน่วยงาน (คลังเดิมทั้งหมดอยู่หน่วยงานตั้งต้น WHA)
--   * ผู้ใช้อยู่ในหน่วยงานของคลังหลัก + คลังเพิ่มเติมของตัวเอง (คนที่ไม่มีคลังหลัก เช่น ผู้จัดการฝ่ายขึ้นไป = หน่วยงานตั้งต้น)
--   * "เห็นทุกคลัง" ของผู้จัดการ = ทุกคลังในหน่วยงานของตัวเอง; ผู้ดูแลระบบสูงสุดเห็นทุกหน่วยงาน
--   * กั้นด้วย "รั้ว" (restrictive policy) ซ้อนบนกฎเดิม ไม่แก้กฎเดิม — ถอดรั้วได้ด้วย scripts/rollback/0034_units_down.sql
--   * เมนูที่หน่วยงานใช้ได้เก็บใน units.modules (ตอนนี้มี 'pull' = ระบบดึงคน)

-- ---------------------------------------------------------------------
-- 1) ตารางหน่วยงาน + ผูกคลัง
-- ---------------------------------------------------------------------
create table public.units (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  modules text[] not null default '{}' check (modules <@ array['pull']::text[]),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index units_code_key on public.units (code);
create unique index units_one_default on public.units (is_default) where is_default;

insert into public.units (code, name, modules, is_default) values ('WHA', 'คลังสินค้า WHA', '{pull}', true);

alter table public.warehouses add column unit_id uuid references public.units (id);
update public.warehouses set unit_id = (select id from public.units where is_default);
create index warehouses_unit_idx on public.warehouses (unit_id);

create trigger units_audit after insert or update or delete on public.units
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- 2) ฟังก์ชันขอบเขตหน่วยงาน (security definer อ่านข้ามกฎได้ ไม่วนกลับเข้ารั้ว)
-- ---------------------------------------------------------------------
create function public.default_unit_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.units where is_default limit 1
$$;

-- หน่วยงานของผู้ใช้ที่ล็อกอินอยู่
create function public.my_unit_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.units u
  where (select public.my_role()) = 'super_admin'
     or u.id in (select w.unit_id from public.warehouses w where w.id in (select public.my_warehouse_ids()))
     or (u.is_default and (select public.my_role()) is not null and not exists (select 1 from public.my_warehouse_ids()))
$$;

-- คลังทั้งหมดในหน่วยงานของผู้ใช้
create function public.unit_warehouse_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select w.id from public.warehouses w where w.unit_id in (select public.my_unit_ids())
$$;

-- หน่วยงานของผู้ใช้คนหนึ่ง (ทุกสถานะ เพื่อดูประวัติย้อนหลังได้)
create function public.user_unit_ids(p_user uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select w.unit_id from public.profiles p join public.warehouses w on w.id = p.warehouse_id where p.id = p_user
  union
  select w.unit_id from public.user_warehouses uw join public.warehouses w on w.id = uw.warehouse_id where uw.user_id = p_user
  union
  select public.default_unit_id() where exists (select 1 from public.profiles p where p.id = p_user and p.warehouse_id is null)
$$;

-- ผู้ใช้ทุกคนในหน่วยงานของผู้ใช้ที่ล็อกอินอยู่
create function public.unit_user_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
  where (select public.my_role()) = 'super_admin'
     or p.warehouse_id in (select public.unit_warehouse_ids())
     or (p.warehouse_id is null and (select public.default_unit_id()) in (select public.my_unit_ids()))
  union
  select uw.user_id from public.user_warehouses uw where uw.warehouse_id in (select public.unit_warehouse_ids())
$$;

-- ผู้ดูแลระบบสูงสุด: ไม่ติดรั้วหน่วยงาน
create function public.unit_unfenced() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'super_admin', false)
$$;

create function public.in_my_units(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_user = (select auth.uid()), false) or coalesce(p_user in (select public.unit_user_ids()), false)
$$;

create function public.shares_unit(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_unit_ids(p_a) a where a in (select public.user_unit_ids(p_b)))
$$;

-- คลังนี้อยู่ในหน่วยงานของผู้ใช้ไหม (คลังว่าง = หน่วยงานตั้งต้น)
create function public.wh_in_my_units(p_wh uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(case when p_wh is null then (select public.default_unit_id()) in (select public.my_unit_ids())
                       else p_wh in (select public.unit_warehouse_ids()) end, false)
$$;

create function public.unit_has_module(p_wh uuid, p_module text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p_module = any (u.modules) from public.warehouses w join public.units u on u.id = w.unit_id where w.id = p_wh), false)
$$;

-- ผู้ใช้อยู่หน่วยงานตั้งต้นไหม (ใช้กั้นการแก้ข้อมูลกลาง เช่น อัตรา กฎ รหัสกะ วันหยุด ประกาศ)
create function public.in_default_unit() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select public.default_unit_id()) in (select public.my_unit_ids()), false)
$$;

-- เมนูที่ผู้ใช้เปิดได้ (รวมทุกหน่วยงานที่สังกัด) สำหรับหน้าเว็บ
create function public.my_modules() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct m order by m), '{}')
  from public.units u cross join lateral unnest(u.modules) m
  where u.id in (select public.my_unit_ids())
$$;

-- ---------------------------------------------------------------------
-- 3) คลังใหม่ได้หน่วยงานอัตโนมัติ / ย้ายคลังข้ามหน่วยงานได้เฉพาะผู้ดูแลระบบสูงสุด
-- ---------------------------------------------------------------------
create function public.warehouse_unit_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.unit_id is null then
    new.unit_id := coalesce(
      (select u.id from public.units u where u.id in (select public.my_unit_ids()) order by u.is_default desc, u.code limit 1),
      public.default_unit_id());
  end if;
  if tg_op = 'UPDATE' and new.unit_id is distinct from old.unit_id
     and (select auth.uid()) is not null and not public.unit_unfenced() then
    raise exception 'ย้ายคลังไปหน่วยงานอื่นได้เฉพาะผู้ดูแลระบบสูงสุด';
  end if;
  return new;
end $$;
create trigger warehouses_unit_guard before insert or update on public.warehouses
  for each row execute function public.warehouse_unit_guard();
alter table public.warehouses alter column unit_id set not null;

-- ข้อมูลกลางที่ทุกหน่วยงานใช้ร่วมกัน: แก้ได้เฉพาะคนในหน่วยงานตั้งต้น (และงานอัตโนมัติของระบบ)
create function public.shared_config_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not public.in_default_unit() then
    raise exception 'ข้อมูลกลางนี้แก้ได้เฉพาะผู้ดูแลของหน่วยงานหลัก';
  end if;
  return coalesce(new, old);
end $$;
create trigger app_settings_unit_guard before insert or update or delete on public.app_settings
  for each row execute function public.shared_config_guard();
create trigger dropdown_options_unit_guard before insert or update or delete on public.dropdown_options
  for each row execute function public.shared_config_guard();
create trigger skills_unit_guard before insert or update or delete on public.skills
  for each row execute function public.shared_config_guard();
create trigger holidays_unit_guard before insert or update or delete on public.holidays
  for each row execute function public.shared_config_guard();
create trigger announcements_unit_guard before insert or update or delete on public.announcements
  for each row execute function public.shared_config_guard();

-- จองคนได้เฉพาะคลังที่ใช้ระบบดึงคน และคนกับคลังปลายทางต้องอยู่หน่วยงานเดียวกัน
create function public.pull_booking_unit_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.unit_has_module(new.to_warehouse_id, 'pull') then
    raise exception 'คลังนี้ไม่ได้ใช้ระบบดึงคน';
  end if;
  if not exists (
    select 1 from public.profiles p
    join public.warehouses w on w.id = p.warehouse_id
    join public.warehouses t on t.id = new.to_warehouse_id
    where p.id = new.user_id and w.unit_id = t.unit_id
  ) then
    raise exception 'ดึงคนข้ามหน่วยงานไม่ได้';
  end if;
  return new;
end $$;
create trigger pull_bookings_unit_guard before insert or update of user_id, to_warehouse_id on public.pull_bookings
  for each row execute function public.pull_booking_unit_guard();

-- ---------------------------------------------------------------------
-- 4) สิทธิ์ระดับคลัง: ผู้จัดการ "ทุกคลัง" = ทุกคลังในหน่วยงานตัวเอง
-- ---------------------------------------------------------------------
create or replace function public.can_manage_warehouse(p_wh uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.my_role() = 'super_admin' then true
    when public.is_global_role() then public.wh_in_my_units(p_wh)
    when public.my_role() in ('admin', 'supervisor') then coalesce(p_wh in (select public.my_warehouse_ids()), false)
    else false
  end
$$;

create or replace function public.can_supervise_warehouse(p_wh uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.my_role() = 'super_admin' then true
    when public.is_global_role() then public.wh_in_my_units(p_wh)
    when public.my_role() in ('admin', 'supervisor') then coalesce(p_wh in (select public.my_warehouse_ids()), false)
    else false
  end
$$;

-- ตั้งค่า Pull: ต้องเป็นคลังที่ใช้ระบบดึงคนด้วย
create or replace function public.can_config_pull(p_wh uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.unit_has_module(p_wh, 'pull') and case
    when public.my_role() = 'super_admin' then true
    when public.is_global_role() then public.wh_in_my_units(p_wh)
    when public.my_role() = 'admin' then coalesce(p_wh in (select public.my_warehouse_ids()), false)
    else false
  end
$$;

-- ตารางกะหัวหน้าคลัง: ผู้จัดการแก้ได้เฉพาะหัวหน้าในหน่วยงานตัวเอง
create or replace function public.can_edit_schedule(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when public.is_lead(p_user) then public.is_manager_role() and public.in_my_units(p_user)
              else public.can_supervise_warehouse(public.profile_warehouse(p_user)) end
$$;

-- ---------------------------------------------------------------------
-- 5) ฟังก์ชันที่ดึงข้อมูลหลายคลัง/ส่งแจ้งเตือน (สร้างจากของเดิม เพิ่มเงื่อนไขหน่วยงาน)
--    + เบี้ยขยัน: ข้ามพนักงานของคลังที่อยู่ในค่าตั้งค่า diligence.excluded_warehouses
-- ---------------------------------------------------------------------
insert into public.app_settings (key, effective_from, value, note) values
  ('diligence.excluded_warehouses', '2000-01-01', '[]', 'รหัสคลังที่ไม่มีเบี้ยขยัน (ว่าง = ทุกคลังมีเบี้ยขยัน)');

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
    where w.is_active and w.id in (select public.unit_warehouse_ids()) and public.unit_has_module(w.id, 'pull')
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
  if not public.unit_has_module(p_to_wh, 'pull') then
    raise exception 'คลังนี้ไม่ได้ใช้ระบบดึงคน';
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
    and w.unit_id = (select tw.unit_id from public.warehouses tw where tw.id = p_to_wh)
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
    and p.warehouse_id in (select public.unit_warehouse_ids())
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
      and ((public.is_global_role() and public.in_my_units(t.id)) or t.warehouse_id in (select public.my_warehouse_ids()))
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
      and ((public.role_rank(p.role) >= 4 and (p.role = 'super_admin' or public.shares_unit(p.id, t.id))) or p.warehouse_id = t.warehouse_id
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
  v_skip_wh jsonb;
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
  v_skip_wh := coalesce(public.setting('diligence.excluded_warehouses', per.p_end), '[]');
  v_n := greatest(jsonb_array_length(v_steps), 1);
  foreach u in array p_users loop
    if jsonb_array_length(v_types) > 0
       and not exists (select 1 from public.profiles p where p.id = u and v_types ? coalesce(p.employment_type, '')) then
      continue;
    end if;
    if jsonb_array_length(v_skip_wh) > 0
       and exists (select 1 from public.profiles p join public.warehouses w on w.id = p.warehouse_id where p.id = u and v_skip_wh ? w.code) then
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

-- ---------------------------------------------------------------------
-- 6) รั้วหน่วยงาน (restrictive policy: ต้องผ่านทั้งกฎเดิม "และ" รั้วนี้)
-- ---------------------------------------------------------------------
alter table public.units enable row level security;
revoke all on public.units from anon;
revoke insert, update, delete on public.units from authenticated;
create policy units_read on public.units for select to authenticated
  using ((select public.unit_unfenced()) or id in (select public.my_unit_ids()));

-- คลัง: เห็น/แก้ได้เฉพาะคลังในหน่วยงานตัวเอง
create policy unit_fence on public.warehouses as restrictive for all to authenticated
  using ((select public.unit_unfenced()) or id in (select public.unit_warehouse_ids()))
  with check ((select public.unit_unfenced()) or unit_id in (select public.my_unit_ids()));

-- พนักงาน
create policy unit_fence on public.profiles as restrictive for all to authenticated
  using (id = (select auth.uid()) or (select public.unit_unfenced()) or id in (select public.unit_user_ids()))
  with check (id = (select auth.uid()) or (select public.unit_unfenced()) or id in (select public.unit_user_ids()));

-- ตารางที่ผูกกับพนักงาน (user_id)
do $$
declare t text;
begin
  foreach t in array array['user_warehouses', 'employee_skills', 'shift_schedules', 'shift_cell_notes',
                           'attendance_punches', 'attendance_corrections', 'leave_requests', 'leave_quota_overrides',
                           'ot_approvals', 'notifications', 'pull_bookings', 'pull_leftover_notes'] loop
    execute format($p$
      create policy unit_fence on public.%I as restrictive for all to authenticated
        using (user_id = (select auth.uid()) or (select public.unit_unfenced()) or user_id in (select public.unit_user_ids()))
        with check (user_id = (select auth.uid()) or (select public.unit_unfenced()) or user_id in (select public.unit_user_ids()))
    $p$, t);
  end loop;
  -- ตารางที่ผูกกับคลัง (warehouse_id)
  foreach t in array array['headcount_budgets', 'schedule_months', 'schedule_group_order',
                           'pull_skills', 'pull_workload_types', 'pull_tasks', 'pull_task_rates', 'pull_shift_hours', 'pull_workloads'] loop
    execute format($p$
      create policy unit_fence on public.%I as restrictive for all to authenticated
        using ((select public.unit_unfenced()) or warehouse_id in (select public.unit_warehouse_ids()))
        with check ((select public.unit_unfenced()) or warehouse_id in (select public.unit_warehouse_ids()))
    $p$, t);
  end loop;
end $$;

-- ประวัติการใช้งาน: ของคลังในหน่วยงาน หรือรายการที่ไม่ผูกคลังซึ่งคนในหน่วยงานเป็นผู้ทำ
create policy unit_fence on public.audit_logs as restrictive for all to authenticated
  using ((select public.unit_unfenced()) or warehouse_id in (select public.unit_warehouse_ids())
         or (warehouse_id is null and (actor_id is null or actor_id in (select public.unit_user_ids()))));

-- ---------------------------------------------------------------------
-- 7) สิทธิ์เรียกฟังก์ชัน
-- ---------------------------------------------------------------------
revoke execute on function
  public.default_unit_id(), public.my_unit_ids(), public.unit_warehouse_ids(), public.user_unit_ids(uuid),
  public.unit_user_ids(), public.unit_unfenced(), public.in_my_units(uuid), public.shares_unit(uuid, uuid),
  public.wh_in_my_units(uuid), public.unit_has_module(uuid, text), public.in_default_unit(), public.my_modules(),
  public.warehouse_unit_guard(), public.shared_config_guard(), public.pull_booking_unit_guard()
from public, anon;
grant execute on function
  public.default_unit_id(), public.my_unit_ids(), public.unit_warehouse_ids(), public.unit_user_ids(),
  public.unit_unfenced(), public.in_my_units(uuid), public.wh_in_my_units(uuid), public.unit_has_module(uuid, text),
  public.in_default_unit(), public.my_modules()
to authenticated;
