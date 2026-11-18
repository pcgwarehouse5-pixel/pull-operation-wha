-- ตำแหน่งของคนที่จองบนแผนที่คลัง 3D (หน้าผังตำแหน่งพนักงาน)
-- หัวหน้า/แอดมินของคลังปลายทางลากวางกล่องรายคน (หรือทั้งกลุ่มตำแหน่ง) แล้วบันทึกที่นี่ · ทุกเครื่องเห็นผังเดียวกัน
-- หน่วย = พิกเซลของผังคลัง (src/lib/warehouse3d/maps.ts) · ยังไม่ลากวาง = null (หน้าเว็บวางให้อัตโนมัติตามจุดที่ตำแหน่งนั้นเคยวางล่าสุด)
-- เปลี่ยนได้ผ่านฟังก์ชัน set_pull_positions เท่านั้น (ตรวจสิทธิ์ข้างใน) · ทุกการเปลี่ยนเข้า audit log ผ่าน trigger เดิมของตาราง

alter table public.pull_bookings
  add column map_x real,
  add column map_y real,
  add column map_at timestamptz,
  add constraint pull_bookings_map_xy check (
    (map_x is null) = (map_y is null)
    and (map_x is null or (map_x between 0 and 5000 and map_y between 0 and 5000))
  );

-- หา "จุดที่ตำแหน่งนั้นเคยวางล่าสุด" ของคลัง
create index pull_bookings_map_idx on public.pull_bookings (to_warehouse_id, map_at desc) where map_x is not null;

-- p_items = [{"id": "<booking id>", "x": 1234.5, "y": 678.9}, ...] · x/y = null คือล้างตำแหน่ง (กลับไปวางอัตโนมัติ)
-- คืนจำนวนรายการที่เปลี่ยนจริง · ผิดสักรายการ = ไม่บันทึกเลยทั้งชุด
create or replace function public.set_pull_positions(p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  it jsonb;
  b public.pull_bookings;
  v_x real;
  v_y real;
  n int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'ข้อมูลตำแหน่งไม่ถูกต้อง';
  end if;
  if jsonb_array_length(p_items) > 300 then
    raise exception 'จัดตำแหน่งได้ครั้งละไม่เกิน 300 คน';
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object' or coalesce(it->>'id', '') !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'ข้อมูลตำแหน่งไม่ถูกต้อง';
    end if;
    select * into b from public.pull_bookings where id = (it->>'id')::uuid for update;
    if b.id is null or b.status <> 'booked' then
      raise exception 'ไม่พบรายการจองนี้';
    end if;
    if not public.can_supervise_warehouse(b.to_warehouse_id) then
      raise exception 'จัดตำแหน่งได้เฉพาะคลังที่จอง';
    end if;
    if b.work_date < public.pull_today() then
      raise exception 'วันที่ผ่านไปแล้ว จัดตำแหน่งไม่ได้';
    end if;
    if jsonb_typeof(coalesce(it->'x', 'null')) not in ('number', 'null') or jsonb_typeof(coalesce(it->'y', 'null')) not in ('number', 'null') then
      raise exception 'ตำแหน่งบนแผนที่ไม่ถูกต้อง';
    end if;
    v_x := (it->>'x')::real;
    v_y := (it->>'y')::real;
    if (v_x is null) <> (v_y is null) or (v_x is not null and (v_x not between 0 and 5000 or v_y not between 0 and 5000)) then
      raise exception 'ตำแหน่งบนแผนที่ไม่ถูกต้อง';
    end if;
    if v_x is not distinct from b.map_x and v_y is not distinct from b.map_y then
      continue; -- ที่เดิม ไม่ต้องบันทึก
    end if;
    update public.pull_bookings
      set map_x = v_x, map_y = v_y, map_at = case when v_x is null then null else now() end
      where id = b.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.set_pull_positions(jsonb) from public, anon;
grant execute on function public.set_pull_positions(jsonb) to authenticated;
