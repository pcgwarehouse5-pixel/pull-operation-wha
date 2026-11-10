-- =====================================================================
-- 0014 บทบาทผู้จัดการ 4 ระดับ (ต่อจากแอดมินคลัง)
--   dept_manager      = ผู้จัดการแผนก
--   division_manager  = ผู้จัดการฝ่าย
--   deputy_gm         = รองผู้จัดการทั่วไป
--   gm                = ผู้จัดการทั่วไป
-- แยกไฟล์ไว้เพราะค่าใหม่ของ enum ต้องบันทึกก่อน จึงจะใช้ในไฟล์ถัดไปได้
-- บทบาท "ผู้บริหาร" (executive) เลิกใช้ (ไม่มีใครถือ) แต่คงค่าไว้ในฐานข้อมูล
-- =====================================================================
alter type public.app_role add value if not exists 'dept_manager';
alter type public.app_role add value if not exists 'division_manager';
alter type public.app_role add value if not exists 'deputy_gm';
alter type public.app_role add value if not exists 'gm';
