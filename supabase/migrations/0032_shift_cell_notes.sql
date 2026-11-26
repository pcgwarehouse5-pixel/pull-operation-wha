-- =====================================================================
-- 0032 ตารางกะ: หมายเหตุรายช่อง (คล้าย Comment ใน Excel)
--   คลิกขวาที่ช่อง → เพิ่ม/แก้/ลบหมายเหตุ · ช่องที่มีหมายเหตุมีมุมแดง ชี้แล้วเห็นข้อความ
--   เห็น: หัวหน้างาน/แอดมินของคลังพนักงานคนนั้น และผู้จัดการ (คนที่เห็นตารางกะทั้งคลัง) · พนักงานไม่เห็น
--   ใส่/แก้: คนที่แก้ตารางกะของพนักงานคนนั้นได้ (ตารางหัวหน้าคลัง = ผู้จัดการ) · บันทึกประวัติทุกครั้ง (audit log)
--   แยกจากตาราง shift_schedules: ใส่หมายเหตุได้แม้ช่องยังว่าง และไม่กระทบการคิดชั่วโมง/OT
-- =====================================================================

create table public.shift_cell_notes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null,
  note text not null check (char_length(note) between 1 and 300),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (user_id, work_date)
);
create index shift_cell_notes_date_idx on public.shift_cell_notes (work_date);

create trigger shift_cell_notes_audit after insert or update or delete on public.shift_cell_notes
  for each row execute function public.audit_row();

alter table public.shift_cell_notes enable row level security;
revoke all on public.shift_cell_notes from anon;
revoke insert, update, delete on public.shift_cell_notes from authenticated;
create policy shift_cell_notes_read on public.shift_cell_notes for select to authenticated
  using ((select public.can_supervise_warehouse(public.profile_warehouse(user_id))));

-- ใส่/แก้หมายเหตุของช่อง (พนักงาน, วันที่) · ข้อความว่าง = ลบ
create function public.set_shift_cell_note(p_user uuid, p_date date, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_user is null or p_date is null then
    raise exception 'กรุณาเลือกช่อง';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'ไม่พบพนักงาน';
  end if;
  if not public.can_edit_schedule(p_user) then
    raise exception 'ไม่มีสิทธิ์ใส่หมายเหตุในตารางกะของพนักงานคนนี้';
  end if;
  if char_length(v_note) > 300 then
    raise exception 'หมายเหตุยาวได้ไม่เกิน 300 ตัวอักษร';
  end if;
  if v_note is null then
    delete from public.shift_cell_notes where user_id = p_user and work_date = p_date;
  else
    insert into public.shift_cell_notes (user_id, work_date, note) values (p_user, p_date, v_note)
    on conflict (user_id, work_date) do update
      set note = excluded.note, updated_by = auth.uid(), updated_at = now()
      where shift_cell_notes.note is distinct from excluded.note;
  end if;
end $$;

revoke execute on function public.set_shift_cell_note(uuid, date, text) from public, anon;
grant execute on function public.set_shift_cell_note(uuid, date, text) to authenticated;
