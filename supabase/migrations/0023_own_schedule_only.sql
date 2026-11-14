-- =====================================================================
-- 0023 พนักงานเห็นเฉพาะตารางกะของตัวเอง (ไม่เห็นกะของเพื่อนร่วมคลัง) · PDPA: จำกัดคนที่เห็นข้อมูล
--   เดิม: พนักงานเห็นกะของเพื่อนร่วมคลังสังกัดเดียวกันในเดือนที่ประกาศแล้ว
--   ใหม่: พนักงานเห็นเฉพาะกะของตัวเองในเดือนที่ประกาศแล้ว (ตามตารางของตัวเอง: ปกติ หรือ หัวหน้าคลัง)
--   ไม่เปลี่ยน: หัวหน้างาน/แอดมินเห็นทั้งคลังที่ดูแล (รวมร่าง) · ผู้จัดการเห็นทุกคลัง
-- =====================================================================

-- (คน, เดือน) ที่ฉันเห็นได้เพราะประกาศแล้ว: เฉพาะตัวเอง
create or replace function public.schedule_visible_months() returns table (user_id uuid, month date)
language sql stable security definer set search_path = '' as $$
  select p.id, m.month
  from public.profiles p
  join public.schedule_months m
    on m.warehouse_id = p.warehouse_id
   and m.status = 'published'
   and m.scope = case when public.is_lead(p.id) then 'lead' else 'staff' end
  where p.id = (select auth.uid()) and p.status = 'active' and p.warehouse_id is not null
$$;

-- ฟังก์ชันตรวจรายแถวแบบเดิม (ไม่ได้ใช้ในกฎอ่านแล้ว) ปรับให้ผลตรงกันเพื่อไม่ให้สับสน
create or replace function public.schedule_visible(p_user uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.can_supervise_warehouse(public.profile_warehouse(p_user)) then true
    when public.my_role() is null then false
    when p_user = (select auth.uid()) then public.is_published_for(p_user, p_date)
    else false
  end
$$;
