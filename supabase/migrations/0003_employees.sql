-- =====================================================================
-- 0003 ทะเบียนพนักงาน: ทักษะ, อัตรากำลังรายคลัง, ลาออก/คืนสภาพ
-- =====================================================================

-- บริษัทต้นสังกัด (แรงงานรับเหมา)
alter table public.profiles add column subcontractor_company text;

-- ---------------------------------------------------------------------
-- รายการทักษะ แยกตามตำแหน่ง (เช่น RT: RT ยกรับ, RT ยกจ่าย)
-- ---------------------------------------------------------------------
create table public.skills (
  id uuid primary key default gen_random_uuid(),
  position text not null,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (position, name)
);

-- ทักษะของพนักงาน
create table public.employee_skills (
  user_id uuid not null references public.profiles (id) on delete cascade,
  skill_id uuid not null references public.skills (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, skill_id)
);
create index employee_skills_skill_idx on public.employee_skills (skill_id);

-- ---------------------------------------------------------------------
-- อัตรากำลัง: จำนวนคนที่ควรมีต่อตำแหน่ง แยกตามคลัง
-- ---------------------------------------------------------------------
create table public.headcount_budgets (
  id uuid not null default gen_random_uuid() unique,
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  position text not null,
  budget_count integer not null default 0 check (budget_count between 0 and 10000),
  updated_at timestamptz not null default now(),
  primary key (warehouse_id, position)
);

create trigger skills_touch before update on public.skills
  for each row execute function public.touch_updated_at();
create trigger headcount_budgets_touch before update on public.headcount_budgets
  for each row execute function public.touch_updated_at();
create trigger skills_audit after insert or update or delete on public.skills
  for each row execute function public.audit_row();
create trigger headcount_budgets_audit after insert or update or delete on public.headcount_budgets
  for each row execute function public.audit_row();

-- พนักงานแก้บริษัทต้นสังกัดของตัวเองไม่ได้ (เพิ่มช่องใหม่เข้ากฎเดิม)
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if (select auth.uid()) is null then
    return new;
  end if;
  if not public.can_manage_warehouse(old.warehouse_id) then
    if (new.employee_code, new.title, new.first_name_th, new.last_name_th, new.position, new.department,
        new.employment_type, new.salary_code, new.birth_date, new.warehouse_id, new.role, new.status,
        new.resigned_date, new.must_change_password, new.exclude_from_shift, new.show_in_org_chart,
        new.ot_eligible, new.travel_eligible, new.show_in_ot_report, new.auto_check_in, new.subcontractor_company)
       is distinct from
       (old.employee_code, old.title, old.first_name_th, old.last_name_th, old.position, old.department,
        old.employment_type, old.salary_code, old.birth_date, old.warehouse_id, old.role, old.status,
        old.resigned_date, old.must_change_password, old.exclude_from_shift, old.show_in_org_chart,
        old.ot_eligible, old.travel_eligible, old.show_in_ot_report, old.auto_check_in, old.subcontractor_company) then
      raise exception 'แก้ได้เฉพาะชื่อเล่น เบอร์โทร LINE ID และรูปของตัวเอง';
    end if;
  end if;
  return new;
end $$;

grant update (subcontractor_company) on public.profiles to authenticated;

-- =====================================================================
-- คำสั่ง (ตรวจสิทธิ์ข้างใน)
-- =====================================================================

-- กำหนดทักษะของพนักงานทั้งชุด (แอดมินของคลังนั้น / ผู้บริหาร / ผู้ดูแลระบบสูงสุด)
create function public.set_employee_skills(p_user uuid, p_skill_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_wh uuid;
  v_old jsonb;
  v_new jsonb;
begin
  select warehouse_id into v_wh from public.profiles where id = p_user;
  if not found then
    raise exception 'ไม่พบพนักงาน';
  end if;
  if not public.can_manage_warehouse(v_wh) then
    raise exception 'ไม่มีสิทธิ์แก้ทักษะของพนักงานคนนี้';
  end if;
  select coalesce(jsonb_agg(s.name order by s.name), '[]') into v_old
  from public.employee_skills es join public.skills s on s.id = es.skill_id where es.user_id = p_user;

  delete from public.employee_skills where user_id = p_user and not (skill_id = any (coalesce(p_skill_ids, '{}')));
  insert into public.employee_skills (user_id, skill_id)
  select p_user, x from unnest(coalesce(p_skill_ids, '{}')) as x
  on conflict do nothing;

  select coalesce(jsonb_agg(s.name order by s.name), '[]') into v_new
  from public.employee_skills es join public.skills s on s.id = es.skill_id where es.user_id = p_user;
  if v_old is distinct from v_new then
    insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, old_data, new_data)
    values ((select auth.uid()), 'skills_update', 'profiles', p_user::text, v_wh,
            jsonb_build_object('skills', v_old), jsonb_build_object('skills', v_new));
  end if;
end $$;

-- ลาออก / คืนสภาพ (ข้อมูลยังอยู่ครบ) — การปิด/เปิดล็อกอินทำต่อที่เซิร์ฟเวอร์
create function public.set_employee_status(p_user uuid, p_status text, p_date date default null, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_t public.profiles%rowtype;
begin
  if p_status not in ('active', 'resigned') then
    raise exception 'สถานะไม่ถูกต้อง';
  end if;
  if not public.can_manage_user(p_user) then
    raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะพนักงานคนนี้';
  end if;
  select * into v_t from public.profiles where id = p_user for update;
  if v_t.status = p_status then
    raise exception 'พนักงานมีสถานะนี้อยู่แล้ว';
  end if;
  if p_status = 'resigned' then
    if p_date is null then
      raise exception 'กรุณาระบุวันที่ลาออก';
    end if;
    if nullif(trim(coalesce(p_reason, '')), '') is null then
      raise exception 'กรุณาระบุเหตุผล';
    end if;
  end if;

  update public.profiles
  set status = p_status, resigned_date = case when p_status = 'resigned' then p_date else null end
  where id = p_user;

  insert into public.audit_logs (actor_id, action, table_name, record_id, warehouse_id, new_data)
  values ((select auth.uid()), case when p_status = 'resigned' then 'resign' else 'reinstate' end, 'profiles', p_user::text,
          v_t.warehouse_id, jsonb_build_object('employee_code', v_t.employee_code, 'date', p_date, 'reason', nullif(trim(coalesce(p_reason, '')), '')));
end $$;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.skills enable row level security;
alter table public.employee_skills enable row level security;
alter table public.headcount_budgets enable row level security;
revoke all on public.skills, public.employee_skills, public.headcount_budgets from anon;

-- ทักษะ: ทุกคนดูรายการได้ / แอดมินขึ้นไปแก้รายการได้
create policy skills_read on public.skills for select to authenticated using (true);
create policy skills_write on public.skills for all to authenticated
  using ((select public.my_role()) in ('admin', 'executive', 'super_admin'))
  with check ((select public.my_role()) in ('admin', 'executive', 'super_admin'));

-- ทักษะของพนักงาน: เห็นของตัวเอง / หัวหน้างานขึ้นไปเห็นคนในคลังที่ดูแล / แก้ผ่าน set_employee_skills เท่านั้น
create policy employee_skills_read on public.employee_skills for select to authenticated using (
  user_id = (select auth.uid())
  or (select public.is_global_role())
  or user_id in (
    select p.id from public.profiles p
    where (select public.my_role()) in ('supervisor', 'admin') and p.warehouse_id in (select public.my_warehouse_ids())
  )
);
revoke insert, update, delete on public.employee_skills from authenticated;

-- อัตรากำลัง: หัวหน้างานขึ้นไปดูคลังที่ดูแล / แอดมินขึ้นไปแก้คลังที่ดูแล
create policy headcount_read on public.headcount_budgets for select to authenticated using (
  (select public.is_global_role())
  or ((select public.my_role()) in ('supervisor', 'admin') and warehouse_id in (select public.my_warehouse_ids()))
);
create policy headcount_write on public.headcount_budgets for all to authenticated
  using ((select public.is_global_role()) or ((select public.my_role()) = 'admin' and warehouse_id in (select public.my_warehouse_ids())))
  with check ((select public.is_global_role()) or ((select public.my_role()) = 'admin' and warehouse_id in (select public.my_warehouse_ids())));

-- สิทธิ์เรียกฟังก์ชัน
revoke execute on function public.set_employee_skills(uuid, uuid[]), public.set_employee_status(uuid, text, date, text) from public, anon;
grant execute on function public.set_employee_skills(uuid, uuid[]), public.set_employee_status(uuid, text, date, text) to authenticated;
revoke execute on function public.profiles_guard() from public, anon, authenticated;
