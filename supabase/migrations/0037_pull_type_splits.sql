-- =====================================================================
-- 0037 Pull Operation: แตกยอดงานอัตโนมัติ (27 พ.ย. 2569)
--   หัวหน้าคลังกรอกยอดหลักครั้งเดียว (เช่น "ยอดจ่ายรวม" เป็นชิ้น) แล้วระบบแตกเป็นยอดของประเภทงานย่อยให้เอง
--   ยอดของประเภทงานย่อย = ยอดหลัก × สัดส่วน% ÷ ตัวหาร
--     เช่น จ่าย 10,000 ชิ้น → งานจ่าย พาเลทเต็ม 60% ÷ 32 = 187.5 พาเลท · งานเติม Pickface 40% ÷ 10 = 400 พาเลท
--          งานจ่าย Picker 40% ÷ 1 = 4,000 ชิ้น · งานโหลด/เช็คจ่าย 100% ÷ 1 = 10,000 ชิ้น
--   กฎมีวันที่เริ่มใช้ (เก็บประวัติ) · กฎที่ไม่มียอดหลัก (source = null) = กลับไปกรอกเองตั้งแต่วันนั้น
--   ยอดหลักต้องเป็นประเภทงานที่กรอกเอง (ไม่แตกต่อเป็นทอดๆ)
-- สูตรเดียวกันอยู่ใน src/lib/pull.ts (effectiveVolumes) และมีเทสต์คุมทั้งสองฝั่ง
-- =====================================================================

create table public.pull_type_splits (
  type_id uuid not null references public.pull_workload_types (id) on delete cascade,
  effective_from date not null,
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  source_type_id uuid references public.pull_workload_types (id) on delete cascade,
  share_pct numeric(6, 2) check (share_pct > 0 and share_pct <= 100),
  divisor numeric(10, 2) check (divisor > 0 and divisor <= 100000),
  note text check (char_length(note) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (type_id, effective_from),
  check ((source_type_id is null and share_pct is null and divisor is null)
      or (source_type_id is not null and share_pct is not null and divisor is not null)),
  check (source_type_id is distinct from type_id)
);
create index pull_type_splits_wh_idx on public.pull_type_splits (warehouse_id);
create index pull_type_splits_source_idx on public.pull_type_splits (source_type_id);

create trigger pull_type_splits_audit after insert or update or delete on public.pull_type_splits
  for each row execute function public.audit_row();

alter table public.pull_type_splits enable row level security;
revoke all on public.pull_type_splits from anon;
revoke insert, update, delete on public.pull_type_splits from authenticated;
create policy pull_splits_read on public.pull_type_splits for select to authenticated
  using ((select public.can_supervise_warehouse(warehouse_id)));
create policy unit_fence on public.pull_type_splits as restrictive for all to authenticated
  using ((select public.unit_unfenced()) or warehouse_id in (select public.unit_warehouse_ids()))
  with check ((select public.unit_unfenced()) or warehouse_id in (select public.unit_warehouse_ids()));

-- ---------- กฎที่ใช้ ณ วันที่ (ค่าล่าสุดที่เริ่มใช้ไม่เกินวันนั้น) ----------
create function public.pull_split_at(p_type uuid, p_date date) returns public.pull_type_splits
language sql stable security definer set search_path = '' as $$
  select s.* from public.pull_type_splits s
  where s.type_id = p_type and s.effective_from <= p_date
  order by s.effective_from desc limit 1
$$;

-- ยอดงานที่ใช้คำนวณ: ประเภทงานที่แตกจากยอดหลัก = ยอดหลัก × % ÷ ตัวหาร / อื่นๆ = ยอดที่กรอก · ยังไม่กรอก = null
create function public.pull_volume_at(p_type uuid, p_date date, p_shift text) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.pull_type_splits;
begin
  s := public.pull_split_at(p_type, p_date);
  if s.source_type_id is null then
    return (select w.volume from public.pull_workloads w where w.workload_type_id = p_type and w.work_date = p_date and w.shift = p_shift);
  end if;
  return (select w.volume * s.share_pct / 100 / s.divisor from public.pull_workloads w
          where w.workload_type_id = s.source_type_id and w.work_date = p_date and w.shift = p_shift);
end $$;

-- ประเภทงานนี้เป็นยอดหลักของงานอื่นอยู่ (กฎปัจจุบันหรือที่ตั้งล่วงหน้า)
create function public.pull_is_split_source(p_type uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pull_type_splits s
    where s.source_type_id = p_type
      and (s.effective_from > public.pull_today() or s.effective_from = (
        select max(x.effective_from) from public.pull_type_splits x where x.type_id = s.type_id and x.effective_from <= public.pull_today()))
  )
$$;

-- ---------- สูตรคำนวณคน: ใช้ยอดงานจาก pull_volume_at (เดิมอ่านยอดที่กรอกตรงๆ) ----------
create or replace function public.pull_requirement_rows_core(p_wh uuid, p_date date, p_shift text)
returns table (skill_name text, skill_order integer, workload_type_id uuid, type_name text, type_order integer, unit text,
               volume numeric, hours numeric, per_hour numeric, fte numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_hours numeric;
begin
  v_hours := public.pull_hours_at(p_wh, p_shift, p_date);
  return query
  select k.skill_name, ps.sort_order, t.id, t.name, t.sort_order, t.unit, v.volume, v_hours, x.per_hour,
         case when v.volume is not null and v_hours > 0 and x.per_hour > 0 then v.volume / (v_hours * x.per_hour) end
  from public.pull_tasks k
  join public.pull_workload_types t on t.id = k.workload_type_id and t.is_active
  join public.pull_skills ps on ps.warehouse_id = k.warehouse_id and ps.skill_name = k.skill_name
  cross join lateral (select public.pull_volume_at(t.id, p_date, p_shift) as volume) v
  cross join lateral (select public.pull_rate_at(k.id, p_date) as per_hour) x
  where k.warehouse_id = p_wh and k.is_active
  order by ps.sort_order, t.sort_order;
end $$;

-- ---------- ตั้งกฎแตกยอด (แอดมินคลังขึ้นไป) ----------
-- p_source = null คือ "กรอกเอง" ตั้งแต่วันที่เริ่มใช้
create function public.set_pull_type_split(p_type uuid, p_from date, p_source uuid, p_share numeric, p_divisor numeric, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_type public.pull_workload_types;
  v_src public.pull_workload_types;
begin
  select * into v_type from public.pull_workload_types where id = p_type and deleted_at is null;
  if v_type.id is null then
    raise exception 'ไม่พบประเภทงานนี้';
  end if;
  if not public.can_config_pull(v_type.warehouse_id) then
    raise exception 'ไม่มีสิทธิ์ตั้งค่าของคลังนี้';
  end if;
  perform public.pull_check_from(p_from);
  if p_source is null then
    -- กลับไปกรอกเอง: ถ้าไม่เคยมีกฎเลย ก็ไม่ต้องบันทึกอะไร
    if not exists (select 1 from public.pull_type_splits s where s.type_id = p_type) then
      return;
    end if;
    insert into public.pull_type_splits (type_id, effective_from, warehouse_id, source_type_id, share_pct, divisor, note)
    values (p_type, p_from, v_type.warehouse_id, null, null, null, nullif(btrim(coalesce(p_note, '')), ''))
    on conflict (type_id, effective_from) do update set source_type_id = null, share_pct = null, divisor = null,
      note = excluded.note, created_by = (select auth.uid()), created_at = now();
    return;
  end if;
  select * into v_src from public.pull_workload_types where id = p_source and deleted_at is null;
  if v_src.id is null or v_src.warehouse_id <> v_type.warehouse_id then
    raise exception 'ไม่พบยอดหลักนี้ในคลังเดียวกัน';
  end if;
  if p_source = p_type then
    raise exception 'ยอดหลักต้องเป็นประเภทงานอื่น';
  end if;
  if exists (select 1 from public.pull_type_splits s where s.type_id = p_source and s.source_type_id is not null) then
    raise exception '“%” แตกยอดมาจากงานอื่นอยู่แล้ว ใช้เป็นยอดหลักไม่ได้ (เลือกประเภทงานที่กรอกเอง)', v_src.name;
  end if;
  if exists (select 1 from public.pull_type_splits s where s.source_type_id = p_type) then
    raise exception '“%” เป็นยอดหลักของงานอื่นอยู่ จึงแตกยอดจากงานอื่นไม่ได้', v_type.name;
  end if;
  if p_share is null or p_share <= 0 or p_share > 100 then
    raise exception 'สัดส่วนต้องมากกว่า 0 และไม่เกิน 100%%';
  end if;
  if p_divisor is null or p_divisor <= 0 or p_divisor > 100000 then
    raise exception 'ตัวหารต้องมากกว่า 0 (ใส่ 1 ถ้าใช้ยอดเดิมไม่แปลงหน่วย)';
  end if;
  insert into public.pull_type_splits (type_id, effective_from, warehouse_id, source_type_id, share_pct, divisor, note)
  values (p_type, p_from, v_type.warehouse_id, p_source, round(p_share, 2), round(p_divisor, 2), nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (type_id, effective_from) do update set source_type_id = excluded.source_type_id, share_pct = excluded.share_pct,
    divisor = excluded.divisor, note = excluded.note, created_by = (select auth.uid()), created_at = now();
end $$;

-- ลบกฎที่ตั้งล่วงหน้าไว้ผิด (เฉพาะที่ยังไม่ถึงวันเริ่มใช้)
create function public.delete_pull_type_split(p_type uuid, p_from date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_wh uuid;
begin
  select warehouse_id into v_wh from public.pull_workload_types where id = p_type;
  if v_wh is null or not public.can_config_pull(v_wh) then
    raise exception 'ไม่มีสิทธิ์ตั้งค่าของคลังนี้';
  end if;
  if p_from <= public.pull_today() then
    raise exception 'ลบได้เฉพาะค่าที่ยังไม่ถึงวันเริ่มใช้ (ค่าที่เริ่มใช้แล้วให้บันทึกค่าใหม่แทน)';
  end if;
  delete from public.pull_type_splits where type_id = p_type and effective_from = p_from;
end $$;

-- ---------- บันทึกยอดงาน: ประเภทงานที่แตกจากยอดหลัก ไม่ต้องกรอก (กันกรอกซ้ำซ้อน) ----------
create or replace function public.save_pull_workloads(p_wh uuid, p_date date, p_shift text, p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  v_type uuid;
  v_vol numeric;
  v_name text;
  n integer := 0;
begin
  if not public.can_supervise_warehouse(p_wh) then
    raise exception 'ไม่มีสิทธิ์บันทึกยอดงานของคลังนี้';
  end if;
  if p_shift is null or p_shift not in ('morning', 'night') then
    raise exception 'กรุณาเลือกกะ';
  end if;
  if p_date is null then
    raise exception 'กรุณาเลือกวันที่';
  end if;
  if p_date < public.pull_today() and not public.can_manage_warehouse(p_wh) then
    raise exception 'วันที่ผ่านไปแล้ว แก้ยอดงานได้เฉพาะแอดมินคลัง';
  end if;
  if p_date > public.pull_today() + 90 then
    raise exception 'กรอกล่วงหน้าได้ไม่เกิน 90 วัน';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'ข้อมูลยอดงานไม่ถูกต้อง';
  end if;
  for r in select * from jsonb_array_elements(p_items) loop
    v_type := (r ->> 'type_id')::uuid;
    select t.name into v_name from public.pull_workload_types t where t.id = v_type and t.warehouse_id = p_wh and t.is_active;
    if v_name is null then
      raise exception 'ไม่พบประเภทงานนี้ในคลังที่เลือก';
    end if;
    if (public.pull_split_at(v_type, p_date)).source_type_id is not null then
      raise exception 'ยอดของ “%” ระบบแตกจากยอดหลักให้อัตโนมัติ ไม่ต้องกรอก', v_name;
    end if;
    if r -> 'volume' is null or jsonb_typeof(r -> 'volume') = 'null' then
      delete from public.pull_workloads where workload_type_id = v_type and work_date = p_date and shift = p_shift;
    else
      v_vol := (r ->> 'volume')::numeric;
      if v_vol < 0 or v_vol > 10000000 then
        raise exception 'ยอดงานต้องไม่ติดลบ และไม่เกิน 10,000,000';
      end if;
      insert into public.pull_workloads (warehouse_id, work_date, shift, workload_type_id, volume)
      values (p_wh, p_date, p_shift, v_type, round(v_vol, 2))
      on conflict (workload_type_id, work_date, shift) do update
      set volume = excluded.volume, updated_by = (select auth.uid()), updated_at = now()
      where public.pull_workloads.volume is distinct from excluded.volume;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- ลบประเภทงาน: ห้ามลบยอดหลักที่งานอื่นยังใช้อยู่ ----------
create or replace function public.delete_pull_workload_type(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_type public.pull_workload_types;
begin
  select * into v_type from public.pull_workload_types where id = p_id and deleted_at is null;
  if v_type.id is null then
    raise exception 'ไม่พบประเภทงานนี้ (อาจถูกลบไปแล้ว)';
  end if;
  if not public.can_config_pull(v_type.warehouse_id) then
    raise exception 'ไม่มีสิทธิ์ตั้งค่าของคลังนี้';
  end if;
  if public.pull_is_split_source(p_id) then
    raise exception '“%” เป็นยอดหลักที่งานอื่นแตกยอดไปใช้ ให้เปลี่ยนที่มาของยอดในงานเหล่านั้นก่อน', v_type.name;
  end if;
  update public.pull_tasks set is_active = false where workload_type_id = p_id and is_active;
  update public.pull_workload_types
  set deleted_at = now(), deleted_by = (select auth.uid()), is_active = false
  where id = p_id;
end $$;

revoke execute on function
  public.pull_split_at(uuid, date), public.pull_volume_at(uuid, date, text), public.pull_is_split_source(uuid),
  public.set_pull_type_split(uuid, date, uuid, numeric, numeric, text), public.delete_pull_type_split(uuid, date)
from public, anon;
-- ฟังก์ชันแกนอ่านยอดงานโดยไม่ตรวจสิทธิ์ → หน้าเว็บเรียกตรงไม่ได้
revoke execute on function public.pull_split_at(uuid, date), public.pull_volume_at(uuid, date, text), public.pull_is_split_source(uuid) from authenticated;
grant execute on function public.set_pull_type_split(uuid, date, uuid, numeric, numeric, text), public.delete_pull_type_split(uuid, date) to authenticated;

-- =====================================================================
-- ค่าเริ่มต้นคลัง 5 (ผู้ใช้กำหนด 27 พ.ย. 2569) เริ่มใช้ 28 พ.ย. 2569 · แก้ได้ที่ ตั้งค่า Pull → ผูกประเภทงาน
--   งานรับ กรอกเป็นพาเลทเหมือนเดิม · งานจ่าย Ecommerce กรอกเป็นชิ้นแยกต่างหากเหมือนเดิม
--   เพิ่มยอดหลัก "ยอดจ่ายรวม" (ชิ้น) แล้วแตกเป็น:
--     งานจ่าย พาเลทเต็ม (RT จ่าย, OP ลากจ่าย)  60% ÷ 32
--     งานเติม Pickface (RT เติม)               40% ÷ 10
--     งานจ่าย Picker (Picker จ่าย)             40% ÷ 1
--     งานโหลดสินค้า / งานเช็คจ่าย              100% ÷ 1
-- =====================================================================
do $$
declare
  v_note constant text := 'ค่าเริ่มต้น: หัวหน้าคลังกรอกยอดจ่ายรวมเป็นชิ้น (ผู้ใช้กำหนด 27 พ.ย. 2569)';
  v_from constant date := '2026-11-28';
  v_wh uuid;
  v_src uuid;
  v_type uuid;
  d record;
begin
  select id into v_wh from public.warehouses where code = 'WH5';
  if v_wh is null or exists (select 1 from public.pull_type_splits where warehouse_id = v_wh) then
    return;
  end if;
  select id into v_src from public.pull_workload_types where warehouse_id = v_wh and name = 'ยอดจ่ายรวม' and deleted_at is null;
  if v_src is null then
    update public.pull_workload_types set sort_order = sort_order + 1
    where warehouse_id = v_wh and deleted_at is null and sort_order >= 2;
    insert into public.pull_workload_types (warehouse_id, name, unit, sort_order)
    values (v_wh, 'ยอดจ่ายรวม', 'piece', 2)
    returning id into v_src;
  end if;
  for d in
    select * from (values
      ('งานจ่าย พาเลทเต็ม', 60::numeric, 32::numeric),
      ('งานเติม Pickface', 40, 10),
      ('งานจ่าย Picker', 40, 1),
      ('งานโหลดสินค้า', 100, 1),
      ('งานเช็คจ่าย', 100, 1)
    ) as t (name, share, divisor)
  loop
    select id into v_type from public.pull_workload_types where warehouse_id = v_wh and name = d.name and deleted_at is null;
    continue when v_type is null;
    insert into public.pull_type_splits (type_id, effective_from, warehouse_id, source_type_id, share_pct, divisor, note)
    values (v_type, v_from, v_wh, v_src, d.share, d.divisor, v_note);
  end loop;
end $$;
