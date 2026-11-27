-- ตั้งต้นหน่วยงาน "หน้าร้านคลัง 5" (ใช้ตารางผลัด ลงเวลา ลา OT รายงาน — ไม่ใช้ Pull Operation)
--   * คลัง WH5S ใช้พิกัดและรัศมี Check In เดียวกับคลัง 5
--   * ไม่มีเบี้ยขยัน (ค่าตั้งค่า diligence.excluded_warehouses เริ่ม 1 พ.ย. 2569)
--   * หัวใบลงเวลาใช้ค่าเดียวกับคลัง 5 (เวอร์ชันใหม่ของ timesheet.form เริ่ม 1 พ.ย. 2569)
-- ทำเฉพาะฐานข้อมูลที่มีคลัง 5 อยู่แล้ว และไม่ทำซ้ำถ้ามีหน่วยงาน SHOP5 แล้ว (แก้ชื่อ/รายละเอียดภายหลังได้ในหน้า "คลัง" และหน้าตั้งค่า)
do $$
declare
  v_wh5 public.warehouses%rowtype;
  v_unit uuid;
  v_form jsonb;
begin
  select * into v_wh5 from public.warehouses where code = 'WH5';
  if v_wh5.id is null or exists (select 1 from public.units where code = 'SHOP5') then
    return;
  end if;

  insert into public.units (code, name, modules) values ('SHOP5', 'หน้าร้านคลัง 5', '{}') returning id into v_unit;

  insert into public.warehouses (code, name, address, latitude, longitude, checkin_radius_m, color, is_active, unit_id)
  values ('WH5S', 'หน้าร้านคลัง 5', v_wh5.address, v_wh5.latitude, v_wh5.longitude, v_wh5.checkin_radius_m, '#db2777', true, v_unit);

  insert into public.app_settings (key, effective_from, value, note)
  values ('diligence.excluded_warehouses', '2026-11-01', '["WH5S"]', 'หน้าร้านคลัง 5 ไม่มีเบี้ยขยัน')
  on conflict do nothing;

  v_form := public.setting('timesheet.form', '2026-11-01');
  if v_form is not null and v_form #> '{wh,WH5}' is not null then
    insert into public.app_settings (key, effective_from, value, note)
    values ('timesheet.form', '2026-11-01', jsonb_set(v_form, '{wh,WH5S}', v_form #> '{wh,WH5}'), 'เพิ่มหัวฟอร์มหน้าร้านคลัง 5 (ใช้ค่าเดียวกับคลัง 5)')
    on conflict do nothing;
  end if;
end $$;
