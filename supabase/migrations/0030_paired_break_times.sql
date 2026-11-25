-- =====================================================================
-- 0030 เวลาพัก 2 รอบ แยกผลัดเช้า/ดึก (หน้าผังตำแหน่งพนักงาน)
--   เลือกเวลาพักรอบแรกครั้งเดียว ระบบรู้รอบที่ 2 เอง (ตั้ง/แก้ได้ที่ ตั้งค่าตัวเลือก → เวลาพัก (Pull))
--   extra ของตัวเลือก: shift = morning/night · second = เวลาพักรอบ 2 · second_note = หมายเหตุรอบ 2
--   ผลัดเช้า 11:00 → 16:30 · 12:00 → 17:00 · 13:00 → 17:30 (รอบ 2 = พักก่อนเริ่ม OT)
--   ผลัดดึก  23:30 → 02:00 · 00:00 → 03:00 · 00:30 → 04:00
-- =====================================================================
update public.dropdown_options o
set extra = o.extra || v.extra::jsonb
from (values
  ('11:00', '{"shift":"morning","second":"16:30","second_note":"ก่อนเริ่ม OT"}'),
  ('12:00', '{"shift":"morning","second":"17:00","second_note":"ก่อนเริ่ม OT"}'),
  ('13:00', '{"shift":"morning","second":"17:30","second_note":"ก่อนเริ่ม OT"}')
) as v(value, extra)
where o.category = 'pull_break_time' and o.value = v.value;

insert into public.dropdown_options (category, value, label, sort_order, extra) values
  ('pull_break_time', '23:30', 'พัก 23:30', 11, '{"shift":"night","second":"02:00"}'),
  ('pull_break_time', '00:00', 'พัก 00:00', 12, '{"shift":"night","second":"03:00"}'),
  ('pull_break_time', '00:30', 'พัก 00:30', 13, '{"shift":"night","second":"04:00"}')
on conflict (category, value) do update set extra = public.dropdown_options.extra || excluded.extra;

-- แจ้งพนักงานพร้อมเวลาพักรอบ 2 (ตามตัวเลือกของผลัดนั้น) เช่น "เวลาพักของคุณ: พัก 11:00 และ 16:30 (ก่อนเริ่ม OT)"
create or replace function public.set_pull_break(p_id uuid, p_time text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.pull_bookings;
  v_new time;
  v_to text;
  v_second text;
  v_note text;
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
    select nullif(o.extra ->> 'second', ''), nullif(o.extra ->> 'second_note', '') into v_second, v_note
    from public.dropdown_options o
    where o.category = 'pull_break_time' and o.value = to_char(v_new, 'HH24:MI') and o.is_active
      and coalesce(o.extra ->> 'shift', b.shift) = b.shift
    limit 1;
    select code into v_to from public.warehouses where id = b.to_warehouse_id;
    perform public.notify(b.user_id, 'pull_break',
      'เวลาพักของคุณ: พัก ' || to_char(v_new, 'HH24:MI')
        || coalesce(' และ ' || v_second || coalesce(' (' || v_note || ')', ''), ''),
      public.pull_round_th(b.work_date, b.shift) || ' · คลัง ' || v_to || ' · ' || b.skill_name,
      '/my-position', 'pull_break:' || p_id || ':' || extract(epoch from clock_timestamp())::text);
  end if;
end $$;
