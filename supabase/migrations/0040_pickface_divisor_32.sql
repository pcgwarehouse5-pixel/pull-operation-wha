-- =====================================================================
-- 0040 (ผู้ใช้แก้ 28 พ.ย. 2569): งานเติม Pickface คลัง 5 — 1 พาเลท = 32 ชิ้น (เดิมตั้ง 10)
--   ยอดเติม = ยอดจ่ายรวม × 40% ÷ 32  เช่น 10,000 ชิ้น → 4,000 ชิ้น → 125 พาเลท
--   แก้กฎที่เริ่ม 28 พ.ย. 2569 (วันเดียวกับที่เริ่มแตกยอด) ยอดที่กรอกไว้วันนั้นคิดใหม่ทันที
--   ทำเฉพาะเมื่อกฎยังเป็นค่าเดิม (40% ÷ 10) — ถ้าแก้ในหน้าตั้งค่าไปแล้ว ไม่ทับ
-- ถอดกลับ: update public.pull_type_splits set divisor = 10 where ... (ดูท้ายไฟล์)
-- =====================================================================
update public.pull_type_splits s
set divisor = 32,
    note = 'ผู้ใช้แก้ 28 พ.ย. 2569: งานเติม 1 พาเลท = 32 ชิ้น'
from public.pull_workload_types t
join public.warehouses w on w.id = t.warehouse_id
where s.type_id = t.id
  and w.code = 'WH5' and t.name = 'งานเติม Pickface' and t.deleted_at is null
  and s.effective_from = '2026-11-28' and s.share_pct = 40 and s.divisor = 10;

-- ถอดกลับ (ถ้าจำเป็น):
-- update public.pull_type_splits s set divisor = 10 from public.pull_workload_types t join public.warehouses w on w.id = t.warehouse_id
-- where s.type_id = t.id and w.code = 'WH5' and t.name = 'งานเติม Pickface' and s.effective_from = '2026-11-28' and s.divisor = 32;
