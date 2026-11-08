-- =====================================================================
-- 0012 Pull Operation: คลังกลางและการจองคน (ไฟล์ "Pull-Operation Operation & Dashboard" หน้า 1–2)
--   คลังกลาง = พนักงาน/หัวหน้างานที่ยังทำงานอยู่ของทุกคลังที่เปิดใช้ (คลังที่มีผู้ใช้ในระบบ)
--   พร้อม     = มีกะทำงานในกะนั้น (ตามตารางกะ) ไม่ได้ลา และยังไม่ถูกจอง
--   1 คน จองได้ 1 คลังต่อวัน (ฐานข้อมูลกันจองซ้ำ) · จองได้ทันทีไม่ต้องให้คลังต้นทางอนุมัติ (แจ้งเตือนคลังต้นทาง)
--   ยกเลิกต้องมีเหตุผล · วันที่ผ่านไปแล้วจอง/ยกเลิกไม่ได้
-- =====================================================================

-- กะเช้า/กะดึก แยกจากเวลาเข้างานของรหัสกะ (ตั้งได้ในหน้ากฎและอัตรา ค่าเริ่มต้นตามแอปเดิม: เข้างาน 06:00–13:59 = กะเช้า)
insert into public.app_settings (key, effective_from, value, note) values
  ('pull.morning_from_hour', '2000-01-01', '6', 'ตามแอปเดิม: เข้างานตั้งแต่ 06:00 นับเป็นกะเช้า'),
  ('pull.morning_to_hour', '2000-01-01', '13', 'ตามแอปเดิม: เข้างานถึง 13:59 นับเป็นกะเช้า หลังจากนั้นเป็นกะดึก')
on conflict do nothing;

-- เหตุผลการยกเลิกจอง (แก้ได้ที่หน้าตั้งค่าตัวเลือก)
insert into public.dropdown_options (category, value, label, sort_order) values
  ('pull_cancel_reason', 'less_work', 'งานลดลง', 1),
  ('pull_cancel_reason', 'plan_change', 'เปลี่ยนแผนกำลังคน', 2),
  ('pull_cancel_reason', 'not_ready', 'พนักงานไม่พร้อม', 3),
  ('pull_cancel_reason', 'mistake', 'จองผิด', 4),
  ('pull_cancel_reason', 'other', 'อื่น ๆ', 5)
on conflict (category, value) do nothing;

create table public.pull_bookings (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  shift text not null check (shift in ('morning', 'night')),
  user_id uuid not null references public.profiles (id) on delete cascade,
  from_warehouse_id uuid references public.warehouses (id) on delete set null,
  to_warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  skill_name text not null check (char_length(skill_name) between 1 and 80),
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  break_time time, -- เวลาพัก (ใช้ในหน้าผังตำแหน่ง ช่วงถัดไป)
  booked_by uuid default auth.uid(),
  booked_at timestamptz not null default now(),
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 200)
);
create unique index pull_bookings_one_per_day on public.pull_bookings (work_date, user_id) where status = 'booked';
create index pull_bookings_to_idx on public.pull_bookings (to_warehouse_id, work_date);
create index pull_bookings_from_idx on public.pull_bookings (from_warehouse_id, work_date);

create trigger pull_bookings_audit after insert or update or delete on public.pull_bookings
  for each row execute function public.audit_row();

alter table public.pull_bookings enable row level security;
revoke all on public.pull_bookings from anon;
revoke insert, update, delete on public.pull_bookings from authenticated;
-- เห็นได้: คลังปลายทาง / คลังต้นทาง (หัวหน้างานขึ้นไป) / ตัวพนักงานเอง
create policy pull_bookings_read on public.pull_bookings for select to authenticated using (
  user_id = (select auth.uid())
  or (select public.can_supervise_warehouse(to_warehouse_id))
  or (from_warehouse_id is not null and (select public.can_supervise_warehouse(from_warehouse_id)))
);

-- กะเช้า/กะดึก ของรหัสกะ ณ วันที่ (รหัสที่ไม่มีเวลา เช่น OFF HOL = null คือไม่ได้ทำงาน)
create function public.pull_shift_of(p_code text, p_date date) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when m.start_min between public.setting_num('pull.morning_from_hour', p_date, 6) * 60
                         and public.setting_num('pull.morning_to_hour', p_date, 13) * 60 + 59 then 'morning'
    else 'night' end
  from public.shift_minutes(p_code) m
  where m.start_min is not null
$$;

create function public.pull_date_th(p_date date) returns text
language sql immutable set search_path = '' as $$
  select to_char(p_date, 'DD/MM/') || (extract(year from p_date)::integer + 543)::text
$$;

-- รายชื่อคลังกลาง พร้อมสถานะของวัน/กะ สำหรับคลังปลายทาง (หัวหน้างานขึ้นไปของคลังปลายทาง)
-- status: ready = พร้อม / booked_here = จองเข้าคลังนี้แล้ว / busy = ติดภารกิจ (จองโดยคลังอื่น) / unavailable = ไม่พร้อม (ดู reason)
create function public.pull_pool(p_to_wh uuid, p_date date, p_shift text)
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
           when b.id is not null and b.to_warehouse_id = p_to_wh then 'booked_here'
           when b.id is not null then 'busy'
           when lv.on_leave then 'unavailable'
           when s.shift_code is null or m.start_min is null or public.pull_shift_of(s.shift_code, p_date) is distinct from p_shift then 'unavailable'
           else 'ready'
         end,
         case
           when b.id is not null and b.to_warehouse_id = p_to_wh then 'จองเข้าคลังนี้แล้ว'
           when b.id is not null then 'ถูกจองโดย ' || bw.code
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

-- จองคนเข้าคลังปลายทาง (บันทึกได้ทีละหลายคน คนที่จองไม่ได้จะส่งกลับพร้อมเหตุผล คนอื่นยังบันทึกได้)
-- p_items = [{"user_id": "...", "skill": "RT รับ(Domestics)"}, ...]
create function public.book_pull(p_to_wh uuid, p_date date, p_shift text, p_items jsonb) returns jsonb
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
    perform public.notify(v_user, 'pull_booked', 'คุณถูกจองไปช่วยงาน',
      v_when || ' · คลัง ' || v_to || ' · ' || v_skill, '/my-shifts', 'pull_booked:' || v_id);
    if v_row.warehouse_id is distinct from p_to_wh then
      for v_appr in select public.warehouse_approvers(v_row.warehouse_id) loop
        perform public.notify(v_appr, 'pull_source', 'พนักงานถูกดึงไปช่วยคลังอื่น',
          v_row.name || ' (' || v_row.warehouse_code || ') → ' || v_to || ' · ' || v_when || ' · ' || v_skill, '/pull', 'pull_source:' || v_id || ':' || v_appr);
      end loop;
    end if;
  end loop;
  return jsonb_build_object('booked', v_ok, 'conflicts', v_conf);
end $$;

-- ยกเลิกการจอง (คลังปลายทาง หัวหน้างานขึ้นไป) ต้องมีเหตุผล
create function public.cancel_pull_booking(p_id uuid, p_reason text) returns void
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
  perform public.notify(b.user_id, 'pull_cancelled', 'ยกเลิกการไปช่วยงาน',
    public.pull_date_th(b.work_date) || ' ' || case when b.shift = 'morning' then 'กะเช้า' else 'กะดึก' end || ' · คลัง ' || v_to || ' · ' || b.skill_name,
    '/my-shifts', 'pull_cancelled:' || p_id);
end $$;

revoke execute on function
  public.pull_shift_of(text, date), public.pull_date_th(date), public.pull_pool(uuid, date, text),
  public.book_pull(uuid, date, text, jsonb), public.cancel_pull_booking(uuid, text)
from public, anon;
grant execute on function public.pull_pool(uuid, date, text), public.book_pull(uuid, date, text, jsonb), public.cancel_pull_booking(uuid, text)
to authenticated;
revoke execute on function public.pull_shift_of(text, date), public.pull_date_th(date) from authenticated;
