-- เพิ่ม/แก้หน่วยงานจากหน้า "คลัง" (เฉพาะผู้ดูแลระบบสูงสุด) — บันทึกประวัติผ่าน units_audit
-- รหัสหน่วยงานตั้งครั้งเดียวตอนสร้าง (แก้ได้แค่ชื่อและเมนูเสริม)
create function public.save_unit(p_id uuid, p_code text, p_name text, p_modules text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_mods text[] := coalesce((select array_agg(distinct m order by m) from unnest(coalesce(p_modules, '{}')) m), '{}');
begin
  if not public.unit_unfenced() then
    raise exception 'เพิ่ม/แก้หน่วยงานได้เฉพาะผู้ดูแลระบบสูงสุด';
  end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'กรุณาใส่ชื่อหน่วยงาน (ไม่เกิน 100 ตัวอักษร)';
  end if;
  if not (v_mods <@ array['pull']::text[]) then
    raise exception 'เมนูเสริมไม่ถูกต้อง';
  end if;
  if p_id is null then
    if v_code !~ '^[A-Z0-9_-]{2,20}$' then
      raise exception 'รหัสหน่วยงานใช้ A-Z 0-9 _ - ยาว 2-20 ตัว เช่น SHOP5';
    end if;
    if exists (select 1 from public.units where code = v_code) then
      raise exception 'รหัสหน่วยงาน % มีอยู่แล้ว', v_code;
    end if;
    insert into public.units (code, name, modules) values (v_code, v_name, v_mods) returning id into v_id;
  else
    update public.units set name = v_name, modules = v_mods, updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'ไม่พบหน่วยงานนี้';
    end if;
  end if;
  return v_id;
end $$;

revoke execute on function public.save_unit(uuid, text, text, text[]) from public, anon;
grant execute on function public.save_unit(uuid, text, text, text[]) to authenticated;
