-- คลังกลาง: คนที่ถูกจองไว้ "อีกกะ" ของวันเดียวกัน ให้ขึ้นว่า ไม่พร้อม (เดิมขึ้น จองแล้ว/ติดภารกิจ และถูกนับในกำลังคนของกะที่ดูอยู่)
--   ตัวอย่าง: ดูกะดึก WH5 → คนกะเช้าที่จองเข้า WH5 ไปแล้ว = ไม่พร้อม · "จองกะเช้าแล้ว · WH5"
--   ยังคงกฎเดิม 1 คน จองได้ 1 คลังต่อวัน (จองซ้ำไม่ได้ เพราะสถานะไม่ใช่ "พร้อม")
--   แก้เฉพาะสถานะ/เหตุผลที่แสดง ตาราง สิทธิ์ และหน้าจอเหมือนเดิม
create or replace function public.pull_pool(p_to_wh uuid, p_date date, p_shift text)
returns table (user_id uuid, employee_code text, name text, nickname text, emp_position text, warehouse_id uuid, warehouse_code text,
               shift_code text, start_min integer, status text, reason text, skills text[],
               booking_id uuid, booked_to uuid, booked_to_code text, booked_skill text)
language plpgsql stable security definer set search_path = '' as $$
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
end $$;

revoke execute on function public.pull_pool(uuid, date, text) from public, anon;
grant execute on function public.pull_pool(uuid, date, text) to authenticated;
