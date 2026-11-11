-- =====================================================================
-- 0019 แจ้งพนักงานเรื่องตำแหน่งงานประจำวันและเวลาพัก (เมนูใหม่ "ตำแหน่งงานวันนี้" /my-position)
--   จัดลงงานในคลังตัวเอง   → "หัวหน้าจัดตำแหน่งงานให้คุณ" (เดิมเขียนว่า "ไปช่วยงาน" ทุกกรณี)
--   จองไปคลังอื่น           → "คุณถูกจองไปช่วยงาน" เหมือนเดิม
--   ตั้ง/เปลี่ยนเวลาพัก      → "เวลาพักของคุณ" (ใหม่ · ล้างเวลาพักไม่แจ้ง)
--   ทุกแจ้งเตือนลิงก์ไปหน้า /my-position · กฎการจองและสิทธิ์เหมือนเดิมทุกอย่าง
-- =====================================================================

create or replace function public.book_pull(p_to_wh uuid, p_date date, p_shift text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  v_user uuid;
  v_skill text;
  v_row record;
  v_id uuid;
  v_to text;
  v_ok integer := 0;
  v_conf jsonb := '[]'::jsonb;
  v_appr uuid;
  v_when text;
begin
  if not public.can_supervise_warehouse(p_to_wh) then
    raise exception 'ไม่มีสิทธิ์จองคนเข้าคลังนี้';
  end if;
  if p_shift is null or p_shift not in ('morning', 'night') then
    raise exception 'กรุณาเลือกกะ';
  end if;
  if p_date is null or p_date < public.pull_today() then
    raise exception 'จองย้อนหลังไม่ได้ (เลือกวันนี้หรือวันถัดไป)';
  end if;
  if p_date > public.pull_today() + 60 then
    raise exception 'จองล่วงหน้าได้ไม่เกิน 60 วัน';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ยังไม่ได้เลือกพนักงาน';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'จองได้ครั้งละไม่เกิน 200 คน';
  end if;
  select code into v_to from public.warehouses where id = p_to_wh;
  v_when := public.pull_date_th(p_date) || ' ' || case when p_shift = 'morning' then 'กะเช้า' else 'กะดึก' end;

  for r in select * from jsonb_array_elements(p_items) loop
    v_user := (r ->> 'user_id')::uuid;
    v_skill := r ->> 'skill';
    select * into v_row from public.pull_pool(p_to_wh, p_date, p_shift) pp where pp.user_id = v_user;
    if v_row.user_id is null then
      v_conf := v_conf || jsonb_build_object('user_id', v_user, 'reason', 'ไม่อยู่ในคลังกลาง');
      continue;
    end if;
    if not exists (select 1 from public.pull_skills ps where ps.warehouse_id = p_to_wh and ps.skill_name = v_skill) then
      v_conf := v_conf || jsonb_build_object('user_id', v_user, 'name', v_row.name, 'reason', 'คลังนี้ไม่ได้เปิดทักษะ ' || coalesce(v_skill, '-'));
      continue;
    end if;
    if not (v_skill = any (v_row.skills)) then
      v_conf := v_conf || jsonb_build_object('user_id', v_user, 'name', v_row.name, 'reason', 'ไม่มีทักษะ ' || v_skill);
      continue;
    end if;
    if v_row.status <> 'ready' then
      v_conf := v_conf || jsonb_build_object('user_id', v_user, 'name', v_row.name, 'reason', v_row.reason);
      continue;
    end if;
    v_id := null;
    insert into public.pull_bookings (work_date, shift, user_id, from_warehouse_id, to_warehouse_id, skill_name)
    values (p_date, p_shift, v_user, v_row.warehouse_id, p_to_wh, v_skill)
    on conflict do nothing
    returning id into v_id;
    if v_id is null then
      v_conf := v_conf || jsonb_build_object('user_id', v_user, 'name', v_row.name, 'reason', 'เพิ่งถูกจองไปเมื่อสักครู่');
      continue;
    end if;
    v_ok := v_ok + 1;
    if v_row.warehouse_id is distinct from p_to_wh then
      perform public.notify(v_user, 'pull_booked', 'คุณถูกจองไปช่วยงาน',
        v_when || ' · คลัง ' || v_to || ' · ' || v_skill, '/my-position', 'pull_booked:' || v_id);
      for v_appr in select public.warehouse_approvers(v_row.warehouse_id) loop
        perform public.notify(v_appr, 'pull_source', 'พนักงานถูกดึงไปช่วยคลังอื่น',
          v_row.name || ' (' || v_row.warehouse_code || ') → ' || v_to || ' · ' || v_when || ' · ' || v_skill, '/pull', 'pull_source:' || v_id || ':' || v_appr);
      end loop;
    else
      perform public.notify(v_user, 'pull_placed', 'หัวหน้าจัดตำแหน่งงานให้คุณ',
        v_when || ' · คลัง ' || v_to || ' · ' || v_skill, '/my-position', 'pull_booked:' || v_id);
    end if;
  end loop;
  return jsonb_build_object('booked', v_ok, 'conflicts', v_conf);
end $$;

create or replace function public.cancel_pull_booking(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.pull_bookings;
  v_to text;
begin
  select * into b from public.pull_bookings where id = p_id;
  if b.id is null then
    raise exception 'ไม่พบรายการจองนี้';
  end if;
  if not public.can_supervise_warehouse(b.to_warehouse_id) then
    raise exception 'ยกเลิกได้เฉพาะคลังที่จอง';
  end if;
  if b.status <> 'booked' then
    raise exception 'รายการนี้ถูกยกเลิกไปแล้ว';
  end if;
  if b.work_date < public.pull_today() then
    raise exception 'วันที่ผ่านไปแล้ว ยกเลิกไม่ได้';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'กรุณาเลือกเหตุผลการยกเลิก';
  end if;
  update public.pull_bookings
  set status = 'cancelled', cancelled_by = (select auth.uid()), cancelled_at = now(), cancel_reason = left(btrim(p_reason), 200)
  where id = p_id;
  select code into v_to from public.warehouses where id = b.to_warehouse_id;
  perform public.notify(b.user_id, 'pull_cancelled',
    case when b.from_warehouse_id is distinct from b.to_warehouse_id then 'ยกเลิกการไปช่วยงาน' else 'ยกเลิกตำแหน่งงานที่จัดไว้' end,
    public.pull_date_th(b.work_date) || ' ' || case when b.shift = 'morning' then 'กะเช้า' else 'กะดึก' end || ' · คลัง ' || v_to || ' · ' || b.skill_name,
    '/my-position', 'pull_cancelled:' || p_id);
end $$;

create or replace function public.set_pull_break(p_id uuid, p_time text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.pull_bookings;
  v_new time;
  v_to text;
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
  v_new := case when p_time is null or btrim(p_time) = '' then null else btrim(p_time)::time end;
  if v_new is not distinct from b.break_time then
    return; -- ค่าเดิม ไม่ต้องบันทึกหรือแจ้งซ้ำ
  end if;
  update public.pull_bookings set break_time = v_new where id = p_id;
  if v_new is not null then
    select code into v_to from public.warehouses where id = b.to_warehouse_id;
    perform public.notify(b.user_id, 'pull_break', 'เวลาพักของคุณ: พัก ' || to_char(v_new, 'HH24:MI'),
      public.pull_date_th(b.work_date) || ' ' || case when b.shift = 'morning' then 'กะเช้า' else 'กะดึก' end || ' · คลัง ' || v_to || ' · ' || b.skill_name,
      '/my-position', 'pull_break:' || p_id || ':' || extract(epoch from clock_timestamp())::text);
  end if;
end $$;

-- สิทธิ์เหมือนเดิม (create or replace คงสิทธิ์เดิมไว้ ประกาศซ้ำให้ชัด)
revoke execute on function public.book_pull(uuid, date, text, jsonb), public.cancel_pull_booking(uuid, text), public.set_pull_break(uuid, text) from public, anon;
grant execute on function public.book_pull(uuid, date, text, jsonb), public.cancel_pull_booking(uuid, text), public.set_pull_break(uuid, text) to authenticated;
