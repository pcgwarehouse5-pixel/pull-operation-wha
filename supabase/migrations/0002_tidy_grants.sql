-- 0002 เก็บสิทธิ์ให้แน่นขึ้น
-- 1) ฟังก์ชันที่ใช้เป็น trigger ภายในระบบ ไม่ต้องให้ผู้ใช้เรียกได้
revoke execute on function public.audit_row(), public.profiles_guard(), public.touch_updated_at() from authenticated;

-- 2) ตาราง/ฟังก์ชันที่สร้างในอนาคต: ปิดสิทธิ์คนที่ไม่ได้ล็อกอินเป็นค่าเริ่มต้น
--    (แต่ละไฟล์ยังต้องเปิด RLS และให้สิทธิ์เฉพาะที่ต้องใช้เหมือนเดิม)
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;
