-- =====================================================================
-- 0038: ท่ออ่านอย่างเดียว ส่งรายชื่อ + ตำแหน่งพนักงาน ให้แอป Warehouse Ops (ผู้ใช้กำหนด 28/11/2026)
--   แอป Warehouse Ops กดปุ่ม "ดึงรายชื่อจาก WHA Workforce" → เรียกฟังก์ชันนี้พร้อมรหัสลับ
--   ส่งออกได้เฉพาะ: รหัสพนักงาน · ชื่อ · ชื่อ-นามสกุล · ตำแหน่ง · รหัสคลัง · สถานะ (ทำงาน/ลาออก)
--   ของคลัง WH5 และ WH32 เท่านั้น (ไม่รวมหน้าร้าน WH5S) — ไม่มีเบอร์โทร เงินเดือน วันเกิด หรือข้อมูลอื่น
--   รหัสลับเก็บเป็นค่า hash (SHA-256) ใน app_private (API เข้าไม่ถึง) · ตัวรหัสจริงอยู่ใน env ของ Warehouse Ops
--   เปลี่ยนรหัสลับ = update app_private.integration_tokens ด้วย hash ใหม่ แล้วเปลี่ยน env ฝั่ง Warehouse Ops
-- รันซ้ำได้
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists app_private;

create table if not exists app_private.integration_tokens (
  name       text primary key,
  token_hash text not null,
  created_at timestamptz not null default now()
);
revoke all on app_private.integration_tokens from public, anon, authenticated;

insert into app_private.integration_tokens (name, token_hash)
values ('warehouse_ops', '688c3432f0fa15fd8cf2f7e95e0d5c56eccc620e9668912e3cf3ead6bc26733e')
on conflict (name) do nothing;

drop function if exists public.ops_employee_feed(text);
create function public.ops_employee_feed(p_token text)
returns table (employee_code text, first_name text, full_name text, job_position text, warehouse_code text, status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_token is null or length(p_token) < 32 or not exists (
    select 1 from app_private.integration_tokens t
    where t.name = 'warehouse_ops'
      and t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  ) then
    raise exception 'ไม่มีสิทธิ์อ่านรายชื่อพนักงาน' using errcode = '42501';
  end if;

  return query
  select p.employee_code,
         btrim(p.first_name_th),
         btrim(concat_ws(' ', btrim(p.first_name_th), nullif(btrim(p.last_name_th), ''))),
         nullif(btrim(p.position), ''),
         w.code,
         p.status
  from public.profiles p
  join public.warehouses w on w.id = p.warehouse_id
  where w.code in ('WH5', 'WH32')
  order by w.code, p.employee_code;
end;
$$;
revoke all on function public.ops_employee_feed(text) from public;
grant execute on function public.ops_employee_feed(text) to anon, authenticated;

-- ---------- ตรวจผล (ควรได้ true ทุกบรรทัด) ----------
select 'มีรหัสลับของ Warehouse Ops' as check_name,
       exists (select 1 from app_private.integration_tokens where name = 'warehouse_ops') as ok
union all
select 'มีฟังก์ชันส่งรายชื่อ (ตรวจรหัสลับในฟังก์ชัน)',
       exists (select 1 from pg_proc where proname = 'ops_employee_feed' and prosecdef)
union all
select 'ตารางรหัสลับ API เข้าไม่ถึง',
       not has_table_privilege('anon', 'app_private.integration_tokens', 'select');
