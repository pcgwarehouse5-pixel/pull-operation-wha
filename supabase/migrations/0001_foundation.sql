-- =====================================================================
-- 0001 พื้นฐาน: คลัง, ผู้ใช้/พนักงาน, บทบาทและสิทธิ์, ตัวเลือกตั้งค่า, ประวัติการใช้งาน
-- หลักการ: สิทธิ์ทั้งหมดตรวจในฐานข้อมูล (RLS + ฟังก์ชัน) ไม่พึ่งหน้าจอ
-- =====================================================================

-- บทบาท 5 ระดับ (เรียงจากน้อยไปมาก)
create type public.app_role as enum ('employee', 'supervisor', 'admin', 'executive', 'super_admin');

-- ---------------------------------------------------------------------
-- คลัง
-- ---------------------------------------------------------------------
create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  address text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  checkin_radius_m integer not null default 200 check (checkin_radius_m between 20 and 5000),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouses_code_format check (code ~ '^[A-Z0-9_-]{2,20}$')
);
create unique index warehouses_code_key on public.warehouses (code);

-- ---------------------------------------------------------------------
-- ผู้ใช้ = พนักงาน (1 บัญชีต่อ 1 คน) id เดียวกับบัญชีล็อกอิน
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  employee_code text not null check (employee_code ~ '^[A-Za-z0-9._-]{1,30}$'),
  title text,
  first_name_th text not null,
  last_name_th text,
  nickname text,
  position text,
  department text,
  employment_type text,
  salary_code text,
  birth_date date,
  phone text,
  line_id text,
  avatar_url text,
  warehouse_id uuid references public.warehouses (id) on delete restrict,
  role public.app_role not null default 'employee',
  status text not null default 'active' check (status in ('active', 'resigned')),
  resigned_date date,
  must_change_password boolean not null default true,
  -- ตัวเลือกที่โมดูลถัดไปใช้ (มาจากแอปเดิม)
  exclude_from_shift boolean not null default false,
  show_in_org_chart boolean not null default true,
  ot_eligible boolean not null default true,
  travel_eligible boolean not null default false,
  show_in_ot_report boolean not null default true,
  auto_check_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- รหัสพนักงานห้ามซ้ำ (แอปเดิมเคยซ้ำข้ามคลัง)
create unique index profiles_employee_code_key on public.profiles (lower(employee_code));
create index profiles_warehouse_idx on public.profiles (warehouse_id);

-- คลังเพิ่มเติมที่หัวหน้างาน/แอดมินดูแล (นอกจากคลังหลักของตัวเอง)
create table public.user_warehouses (
  user_id uuid not null references public.profiles (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, warehouse_id)
);
create index user_warehouses_wh_idx on public.user_warehouses (warehouse_id);

-- ---------------------------------------------------------------------
-- ตัวเลือกตั้งค่า (ตำแหน่ง, ประเภทพนักงาน, รหัสกะ, ประเภทลา ฯลฯ)
-- ---------------------------------------------------------------------
create table public.dropdown_options (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category ~ '^[a-z_]{2,40}$'),
  value text not null,
  label text not null,
  sort_order integer not null default 0,
  extra jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category, value)
);

-- ---------------------------------------------------------------------
-- ประวัติการใช้งาน (เขียนได้เฉพาะระบบ แก้/ลบไม่ได้)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  table_name text,
  record_id text,
  warehouse_id uuid,
  old_data jsonb,
  new_data jsonb
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_wh_idx on public.audit_logs (warehouse_id);

-- =====================================================================
-- ฟังก์ชันตรวจสิทธิ์ (ใช้ใน RLS) ผู้ที่ลาออกแล้วไม่มีสิทธิ์ใดๆ
-- =====================================================================
create function public.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and p.status = 'active'
$$;

create function public.role_rank(r public.app_role) returns integer
language sql immutable set search_path = '' as $$
  select case r when 'employee' then 1 when 'supervisor' then 2 when 'admin' then 3
                when 'executive' then 4 when 'super_admin' then 5 end
$$;

-- ผู้บริหาร / ผู้ดูแลระบบสูงสุด เห็นและจัดการได้ทุกคลัง
create function public.is_global_role() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() in ('executive', 'super_admin'), false)
$$;

-- คลังหลัก + คลังเพิ่มเติมของผู้ใช้ที่ล็อกอินอยู่
create function public.my_warehouse_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.warehouse_id from public.profiles p
  where p.id = (select auth.uid()) and p.status = 'active' and p.warehouse_id is not null
  union
  select uw.warehouse_id from public.user_warehouses uw
  join public.profiles p on p.id = uw.user_id
  where uw.user_id = (select auth.uid()) and p.status = 'active'
$$;

-- จัดการได้แบบแอดมิน (แอดมินของคลังนั้น, ผู้บริหาร, ผู้ดูแลระบบสูงสุด)
create function public.can_manage_warehouse(p_wh uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.my_role() in ('executive', 'super_admin') then true
    when public.my_role() = 'admin' then coalesce(p_wh in (select public.my_warehouse_ids()), false)
    else false
  end
$$;

-- ดูแลได้แบบหัวหน้างานขึ้นไป
create function public.can_supervise_warehouse(p_wh uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.my_role() in ('executive', 'super_admin') then true
    when public.my_role() in ('admin', 'supervisor') then coalesce(p_wh in (select public.my_warehouse_ids()), false)
    else false
  end
$$;

-- =====================================================================
-- Triggers
-- =====================================================================
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger warehouses_touch before update on public.warehouses
  for each row execute function public.touch_updated_at();
create trigger dropdown_options_touch before update on public.dropdown_options
  for each row execute function public.touch_updated_at();

-- พนักงานแก้ข้อมูลตัวเองได้เฉพาะช่องติดต่อ (ปิดช่องโหว่ของแอปเดิม)
create function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  -- งานฝั่งเซิร์ฟเวอร์/สคริปต์ (ไม่มีผู้ใช้ล็อกอิน) ผ่านได้
  if (select auth.uid()) is null then
    return new;
  end if;
  if not public.can_manage_warehouse(old.warehouse_id) then
    if (new.employee_code, new.title, new.first_name_th, new.last_name_th, new.position, new.department,
        new.employment_type, new.salary_code, new.birth_date, new.warehouse_id, new.role, new.status,
        new.resigned_date, new.must_change_password, new.exclude_from_shift, new.show_in_org_chart,
        new.ot_eligible, new.travel_eligible, new.show_in_ot_report, new.auto_check_in)
       is distinct from
       (old.employee_code, old.title, old.first_name_th, old.last_name_th, old.position, old.department,
        old.employment_type, old.salary_code, old.birth_date, old.warehouse_id, old.role, old.status,
        old.resigned_date, old.must_change_password, old.exclude_from_shift, old.show_in_org_chart,
        old.ot_eligible, old.travel_eligible, old.show_in_ot_report, old.auto_check_in) then
      raise exception 'แก้ได้เฉพาะชื่อเล่น เบอร์โทร LINE ID และรูปของตัวเอง';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- บันทึกประวัติทุกการเพิ่ม/แก้/ลบ
create function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_id text;
  v_wh uuid;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  -- ไม่บันทึกการบันทึกซ้ำที่ไม่มีอะไรเปลี่ยน
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'user_id', v_old ->> 'user_id');
  if tg_table_name = 'warehouses' then
    v_wh := v_id::uuid;
  else
    v_wh := coalesce(v_new ->> 'warehouse_id', v_old ->> 'warehouse_id')::uuid;
  end if;
  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, old_data, new_data)
  values ((select auth.uid()), lower(tg_op), tg_table_name, v_id, v_wh, v_old, v_new);
  return coalesce(new, old);
end $$;

create trigger warehouses_audit after insert or update or delete on public.warehouses
  for each row execute function public.audit_row();
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function public.audit_row();
create trigger user_warehouses_audit after insert or update or delete on public.user_warehouses
  for each row execute function public.audit_row();
create trigger dropdown_options_audit after insert or update or delete on public.dropdown_options
  for each row execute function public.audit_row();

-- =====================================================================
-- คำสั่งที่หน้าจอเรียกใช้ (ตรวจสิทธิ์ข้างในทุกครั้ง)
-- =====================================================================

-- กำหนดบทบาทและคลังของผู้ใช้
-- แอดมิน: ให้ได้ พนักงาน/หัวหน้างาน ในคลังตัวเอง
-- ผู้บริหาร: ให้ได้ถึงแอดมิน ทุกคลัง
-- ผู้ดูแลระบบสูงสุด: ให้ได้ทุกบทบาท
create function public.set_user_access(p_user uuid, p_role public.app_role, p_home uuid, p_extra uuid[] default '{}')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.app_role := public.my_role();
  v_target public.profiles%rowtype;
  v_max integer;
  v_wh uuid;
begin
  if v_me is null or public.role_rank(v_me) < 3 then
    raise exception 'ไม่มีสิทธิ์กำหนดบทบาทผู้ใช้';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'เปลี่ยนบทบาทหรือคลังของตัวเองไม่ได้';
  end if;
  select * into v_target from public.profiles where id = p_user for update;
  if not found then
    raise exception 'ไม่พบผู้ใช้';
  end if;
  if not public.can_manage_warehouse(v_target.warehouse_id) then
    raise exception 'ไม่มีสิทธิ์จัดการผู้ใช้คลังนี้';
  end if;
  -- จัดการได้เฉพาะคนที่บทบาทต่ำกว่าตัวเอง (ยกเว้นผู้ดูแลระบบสูงสุด)
  if v_me <> 'super_admin' and public.role_rank(v_target.role) >= public.role_rank(v_me) then
    raise exception 'จัดการผู้ใช้ที่บทบาทเท่ากับหรือสูงกว่าคุณไม่ได้';
  end if;
  v_max := case v_me when 'admin' then 2 when 'executive' then 3 else 5 end;
  if public.role_rank(p_role) > v_max then
    raise exception 'คุณกำหนดบทบาทนี้ไม่ได้';
  end if;
  if v_target.role = 'super_admin' and p_role <> 'super_admin'
     and (select count(*) from public.profiles where role = 'super_admin' and status = 'active') <= 1 then
    raise exception 'ต้องมีผู้ดูแลระบบสูงสุดอย่างน้อย 1 คน';
  end if;
  if p_home is not null and not public.can_manage_warehouse(p_home) then
    raise exception 'ไม่มีสิทธิ์ย้ายผู้ใช้ไปคลังนี้';
  end if;
  foreach v_wh in array coalesce(p_extra, '{}') loop
    if not public.can_manage_warehouse(v_wh) then
      raise exception 'ไม่มีสิทธิ์มอบคลังนี้';
    end if;
  end loop;

  update public.profiles set role = p_role, warehouse_id = p_home where id = p_user;

  -- คลังเพิ่มเติม: แก้เฉพาะคลังที่ตัวเองดูแล คลังอื่นคงไว้
  delete from public.user_warehouses
  where user_id = p_user
    and public.can_manage_warehouse(warehouse_id)
    and not (warehouse_id = any (coalesce(p_extra, '{}')));
  insert into public.user_warehouses (user_id, warehouse_id)
  select p_user, x from unnest(coalesce(p_extra, '{}')) as x
  where x is distinct from p_home
  on conflict do nothing;
  delete from public.user_warehouses where user_id = p_user and warehouse_id = p_home;
end $$;

-- ตรวจว่าผู้ใช้ที่ล็อกอินอยู่จัดการบัญชีนี้ได้ไหม (ใช้ก่อนรีเซ็ตรหัสผ่าน)
create function public.can_manage_user(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles t
    where t.id = p_user
      and t.id <> (select auth.uid())
      and public.can_manage_warehouse(t.warehouse_id)
      and (public.my_role() = 'super_admin' or public.role_rank(t.role) < public.role_rank(public.my_role()))
  )
$$;

-- บันทึกการเข้าสู่ระบบ
create function public.log_login() returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id)
  select p.id, 'login', 'profiles', p.id::text, p.warehouse_id
  from public.profiles p where p.id = (select auth.uid());
$$;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.warehouses enable row level security;
alter table public.profiles enable row level security;
alter table public.user_warehouses enable row level security;
alter table public.dropdown_options enable row level security;
alter table public.audit_logs enable row level security;

-- คนที่ไม่ได้ล็อกอินเข้าถึงไม่ได้เลย
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- คลัง: ทุกคนที่ล็อกอินดูได้ / ผู้ดูแลระบบสูงสุดเพิ่ม-แก้-ลบ
create policy warehouses_read on public.warehouses for select to authenticated using (true);
create policy warehouses_write on public.warehouses for all to authenticated
  using ((select public.my_role()) = 'super_admin')
  with check ((select public.my_role()) = 'super_admin');

-- ผู้ใช้: เห็นตัวเอง / หัวหน้างานขึ้นไปเห็นคนในคลังที่ดูแล / ผู้บริหารเห็นทุกคน
create policy profiles_read on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or (select public.is_global_role())
  or ((select public.my_role()) in ('supervisor', 'admin') and warehouse_id in (select public.my_warehouse_ids()))
);
create policy profiles_update on public.profiles for update to authenticated using (
  id = (select auth.uid())
  or (select public.is_global_role())
  or ((select public.my_role()) = 'admin' and warehouse_id in (select public.my_warehouse_ids()))
) with check (
  id = (select auth.uid())
  or (select public.is_global_role())
  or ((select public.my_role()) = 'admin' and warehouse_id in (select public.my_warehouse_ids()))
);
-- เพิ่ม/ลบบัญชีทำผ่านเซิร์ฟเวอร์เท่านั้น / บทบาท คลัง สถานะ แก้ผ่านคำสั่งเฉพาะ
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (title, first_name_th, last_name_th, nickname, position, department, employment_type,
              salary_code, birth_date, phone, line_id, avatar_url, exclude_from_shift, show_in_org_chart,
              ot_eligible, travel_eligible, show_in_ot_report, auto_check_in)
  on public.profiles to authenticated;

-- คลังเพิ่มเติม: ดูได้ (แก้ผ่าน set_user_access)
create policy user_warehouses_read on public.user_warehouses for select to authenticated using (
  user_id = (select auth.uid()) or (select public.is_global_role())
  or ((select public.my_role()) in ('supervisor', 'admin') and warehouse_id in (select public.my_warehouse_ids()))
);
revoke insert, update, delete on public.user_warehouses from authenticated;

-- ตัวเลือกตั้งค่า: ทุกคนดูได้ / แอดมินขึ้นไปแก้ได้
create policy dropdown_read on public.dropdown_options for select to authenticated using (true);
create policy dropdown_write on public.dropdown_options for all to authenticated
  using ((select public.my_role()) in ('admin', 'executive', 'super_admin'))
  with check ((select public.my_role()) in ('admin', 'executive', 'super_admin'));

-- ประวัติ: ดูของตัวเอง / แอดมินดูของคลังที่ดูแล / ผู้บริหารดูทั้งหมด / ห้ามแก้ห้ามลบ
create policy audit_read on public.audit_logs for select to authenticated using (
  actor_id = (select auth.uid())
  or (select public.is_global_role())
  or ((select public.my_role()) = 'admin' and warehouse_id in (select public.my_warehouse_ids()))
);
revoke insert, update, delete on public.audit_logs from authenticated;

-- =====================================================================
-- สิทธิ์เรียกฟังก์ชัน: ปิดจากทุกคน แล้วเปิดเฉพาะที่ต้องใช้ให้คนที่ล็อกอิน
-- =====================================================================
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.my_role(), public.role_rank(public.app_role), public.is_global_role(), public.my_warehouse_ids(),
  public.can_manage_warehouse(uuid), public.can_supervise_warehouse(uuid),
  public.set_user_access(uuid, public.app_role, uuid, uuid[]), public.can_manage_user(uuid), public.log_login()
  to authenticated;
