-- =====================================================================
-- 0021 ตารางกะ (และตารางลงเวลา/ลา/แก้เวลา/OT) โหลดเร็วขึ้น · กฎ "ใครเห็นข้อมูลของใคร" เหมือนเดิมทุกข้อ
--   เดิม: ตรวจสิทธิ์ทีละแถว (เดือนละ ~3,000 แถว × ค้นข้อมูลหลายครั้ง) → หน้าตารางกะใช้ 1.7–5.7 วินาที
--   ใหม่: หา "คนที่ฉันเห็นได้" และ "เดือนที่ประกาศแล้ว" ครั้งเดียวต่อการโหลด แล้วกรองทั้งก้อน
--   กฎเดิม (schedule_visible จาก 0016):
--     ผู้จัดการทุกคลัง / หัวหน้างานและแอดมินของคลังนั้น → เห็นทั้งหมด (รวมร่าง)
--     ตัวเอง → เดือนที่ประกาศแล้ว (ตามตารางของตัวเอง: ปกติ หรือ หัวหน้าคลัง)
--     เพื่อนร่วมคลังที่เป็นพนักงานปกติ → เดือนที่ประกาศตารางปกติแล้ว
--     เพื่อนร่วมคลังที่เป็นหัวหน้าคลัง → เฉพาะเมื่อฉันเป็นหัวหน้าคลัง และประกาศตารางหัวหน้าคลังแล้ว
-- =====================================================================

-- คนที่ฉันดูแลได้ (หัวหน้างาน/แอดมิน: คนในคลังที่ดูแล) = can_supervise_warehouse(profile_warehouse(คนนั้น))
-- ผู้จัดการทุกคลังตรวจด้วย is_global_role แยก (เห็นทุกคน)
create function public.supervised_user_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
  where public.my_role() in ('admin', 'supervisor')
    and p.warehouse_id in (select public.my_warehouse_ids())
$$;

-- (คน, เดือน) ที่ฉันเห็นได้เพราะประกาศแล้ว: ตัวเอง + เพื่อนร่วมคลังสังกัดเดียวกัน
create function public.schedule_visible_months() returns table (user_id uuid, month date)
language sql stable security definer set search_path = '' as $$
  with me as (
    select p.id, p.warehouse_id, public.is_lead(p.id) as lead
    from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active' and p.warehouse_id is not null
  ),
  peers as (
    select p.id, public.is_lead(p.id) as lead
    from public.profiles p join me on p.warehouse_id = me.warehouse_id
  ),
  pub as (
    select m.month, m.scope from public.schedule_months m join me on m.warehouse_id = me.warehouse_id
    where m.status = 'published'
  )
  select peers.id, pub.month
  from peers cross join me
  join pub on pub.scope = case when peers.lead then 'lead' else 'staff' end
  where peers.id = me.id or not peers.lead or me.lead
$$;

revoke execute on function public.supervised_user_ids(), public.schedule_visible_months() from public, anon;
grant execute on function public.supervised_user_ids(), public.schedule_visible_months() to authenticated;

-- กฎอ่านตารางกะ: คำนวณรายชื่อครั้งเดียว (subquery) ไม่เรียกฟังก์ชันทีละแถว
drop policy shift_read on public.shift_schedules;
create policy shift_read on public.shift_schedules for select to authenticated using (
  (select public.is_global_role())
  or user_id in (select public.supervised_user_ids())
  or (user_id, date_trunc('month', work_date)::date) in (select v.user_id, v.month from public.schedule_visible_months() v)
);

-- ตารางกะของเพื่อนร่วมคลัง (หน้า "ตารางกะของฉัน"): ผลเหมือนเดิม แต่ใช้รายชื่อที่คำนวณครั้งเดียว
create or replace function public.team_schedule(p_month date)
returns table (user_id uuid, first_name_th text, nickname text, "position" text, work_date date, shift_code text, holiday_work text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.first_name_th, p.nickname, p.position, s.work_date, s.shift_code, s.holiday_work
  from public.shift_schedules s
  join public.profiles p on p.id = s.user_id
  where p.status = 'active'
    and s.work_date >= date_trunc('month', p_month)::date
    and s.work_date < (date_trunc('month', p_month) + interval '1 month')::date
    and (s.user_id, date_trunc('month', s.work_date)::date) in (select v.user_id, v.month from public.schedule_visible_months() v)
  order by p.first_name_th, s.work_date
$$;

-- ---------- ตารางที่จะโตเร็วหลังเริ่มใช้จริง: ใช้รายชื่อที่คำนวณครั้งเดียวแทนการตรวจทีละแถว ----------
-- เดิม: user_id = ฉัน or can_supervise_warehouse(profile_warehouse(user_id))
drop policy punches_read on public.attendance_punches;
create policy punches_read on public.attendance_punches for select to authenticated using (
  user_id = (select auth.uid()) or ((select public.is_global_role()) or user_id in (select public.supervised_user_ids()))
);

drop policy corrections_read on public.attendance_corrections;
create policy corrections_read on public.attendance_corrections for select to authenticated using (
  user_id = (select auth.uid()) or ((select public.is_global_role()) or user_id in (select public.supervised_user_ids()))
);

drop policy leave_read on public.leave_requests;
create policy leave_read on public.leave_requests for select to authenticated using (
  user_id = (select auth.uid()) or ((select public.is_global_role()) or user_id in (select public.supervised_user_ids()))
);

drop policy quota_read on public.leave_quota_overrides;
create policy quota_read on public.leave_quota_overrides for select to authenticated using (
  user_id = (select auth.uid()) or ((select public.is_global_role()) or user_id in (select public.supervised_user_ids()))
);

drop policy ot_approvals_read on public.ot_approvals;
create policy ot_approvals_read on public.ot_approvals for select to authenticated using (
  user_id = (select auth.uid()) or ((select public.is_global_role()) or user_id in (select public.supervised_user_ids()))
);

drop policy leave_approvals_read on public.leave_approvals;
create policy leave_approvals_read on public.leave_approvals for select to authenticated using (
  exists (select 1 from public.leave_requests r where r.id = leave_approvals.request_id
          and (r.user_id = (select auth.uid()) or ((select public.is_global_role()) or r.user_id in (select public.supervised_user_ids()))))
);
