-- =====================================================================
-- 0017 ยกสถานะ "ประกาศแล้ว" ของเดือนเดิมไปให้ตารางกะหัวหน้าคลังด้วย
--   ก่อนแยกตาราง หัวหน้าคลังเห็นกะตัวเองจากตารางปกติที่ประกาศแล้ว
--   ถ้าไม่ยกไป หัวหน้าคลังจะมองไม่เห็นกะของเดือนที่ประกาศไปแล้ว
--   ไม่ส่งแจ้งเตือนซ้ำ (ปิดทริกเกอร์แจ้งเตือนเฉพาะระหว่างคำสั่งนี้)
-- =====================================================================
alter table public.schedule_months disable trigger schedule_months_notify;

insert into public.schedule_months (warehouse_id, month, scope, status, published_at, published_by, updated_at)
select warehouse_id, month, 'lead', status, published_at, published_by, now()
from public.schedule_months
where scope = 'staff' and status = 'published'
on conflict (warehouse_id, month, scope) do nothing;

alter table public.schedule_months enable trigger schedule_months_notify;
