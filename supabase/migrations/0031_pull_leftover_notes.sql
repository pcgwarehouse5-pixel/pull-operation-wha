-- =====================================================================
-- 0031 Pull Operation: หมายเหตุ "คนที่เหลือ" หลังทั้ง 2 คลังจองแล้ว
--   หน้าสรุปกำลังพลแสดงคนที่ยังพร้อม (ไม่ได้ถูกจอง) ของทุกคลัง
--   หัวหน้าคลังของพนักงานคนนั้นใส่หมายเหตุว่าจะให้ไปทำอะไร · หัวหน้างานขึ้นไปทุกคลังเห็นหมายเหตุ
--   แก้ได้เฉพาะวันนี้ถึงล่วงหน้า 60 วัน · ลบหมายเหตุ = ส่งข้อความว่าง · บันทึกประวัติทุกครั้ง (audit log)
-- =====================================================================

create table public.pull_leftover_notes (
  work_date date not null,
  shift text not null check (shift in ('morning', 'night')),
  user_id uuid not null references public.profiles (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  note text not null check (char_length(note) between 1 and 200),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (work_date, shift, user_id)
);

create trigger pull_leftover_notes_audit after insert or update or delete on public.pull_leftover_notes
  for each row execute function public.audit_row();

alter table public.pull_leftover_notes enable row level security;
revoke all on public.pull_leftover_notes from anon;
revoke insert, update, delete on public.pull_leftover_notes from authenticated;
create policy pull_leftover_notes_read on public.pull_leftover_notes for select to authenticated
  using ((select coalesce(public.role_rank(public.my_role()), 0)) >= 2);

-- ใส่/แก้/ลบหมายเหตุให้พนักงานหลายคนพร้อมกัน (ข้อความเดียวกัน) · คืนจำนวนคนที่บันทึก
create function public.set_pull_leftover_notes(p_date date, p_shift text, p_users uuid[], p_note text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_user uuid;
  v_wh uuid;
  n integer := 0;
begin
  if p_shift is null or p_shift not in ('morning', 'night') then
    raise exception 'กรุณาเลือกกะ';
  end if;
  if p_date is null or p_date < public.pull_today() then
    raise exception 'ใส่หมายเหตุได้ตั้งแต่วันนี้เป็นต้นไป';
  end if;
  if p_date > public.pull_today() + 60 then
    raise exception 'ใส่หมายเหตุล่วงหน้าได้ไม่เกิน 60 วัน';
  end if;
  if p_users is null or cardinality(p_users) = 0 then
    raise exception 'กรุณาเลือกพนักงาน';
  end if;
  if cardinality(p_users) > 300 then
    raise exception 'เลือกได้ครั้งละไม่เกิน 300 คน';
  end if;
  if char_length(v_note) > 200 then
    raise exception 'หมายเหตุยาวได้ไม่เกิน 200 ตัวอักษร';
  end if;
  foreach v_user in array p_users loop
    select warehouse_id into v_wh from public.profiles where id = v_user and status = 'active';
    if v_wh is null then
      raise exception 'ไม่พบพนักงาน';
    end if;
    if not public.can_supervise_warehouse(v_wh) then
      raise exception 'ใส่หมายเหตุได้เฉพาะพนักงานคลังที่คุณดูแล';
    end if;
    if v_note is null then
      delete from public.pull_leftover_notes where work_date = p_date and shift = p_shift and user_id = v_user;
    else
      insert into public.pull_leftover_notes (work_date, shift, user_id, warehouse_id, note)
      values (p_date, p_shift, v_user, v_wh, v_note)
      on conflict (work_date, shift, user_id) do update
        set note = excluded.note, warehouse_id = excluded.warehouse_id, updated_by = auth.uid(), updated_at = now()
        where pull_leftover_notes.note is distinct from excluded.note;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.set_pull_leftover_notes(date, text, uuid[], text) from public, anon;
grant execute on function public.set_pull_leftover_notes(date, text, uuid[], text) to authenticated;
