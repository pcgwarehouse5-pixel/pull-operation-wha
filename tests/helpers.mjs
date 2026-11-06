// ตัวช่วยร่วมของเทสต์ฐานข้อมูล: Postgres จำลอง + ผู้ใช้ทดสอบ 7 บทบาท (ไม่แตะ Supabase จริง)
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// ผู้ใช้ทดสอบ (id สมมติ)
export const U = {
  super: "00000000-0000-0000-0000-000000000001",
  exec: "00000000-0000-0000-0000-000000000002",
  admin5: "00000000-0000-0000-0000-000000000003",
  admin32: "00000000-0000-0000-0000-000000000004",
  sup5: "00000000-0000-0000-0000-000000000005",
  emp5: "00000000-0000-0000-0000-000000000006",
  emp32: "00000000-0000-0000-0000-000000000007",
};
export const WH5 = "10000000-0000-0000-0000-000000000005";
export const WH32 = "10000000-0000-0000-0000-000000000032";

// จำลองส่วนที่ Supabase มีให้อยู่แล้ว (schema auth, บทบาท anon/authenticated, สิทธิ์ตั้งต้น)
export const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

export async function setup() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await db.exec(fs.readFileSync(new URL(f, dir), "utf8"));
  }
  // เทสต์ส่วนใหญ่จำลองว่าเริ่มใช้ลงเวลาในแอปแล้ว (เทสต์วันเริ่มใช้ลบค่านี้เอง)
  await db.exec(`insert into public.app_settings (key, effective_from, value) values ('attendance.go_live_date', '2000-01-02', '"2000-01-02"')`);
  // งานตั้งต้นทำแบบ "เซิร์ฟเวอร์" (ไม่มีผู้ใช้ล็อกอิน) เหมือนสคริปต์ย้ายข้อมูล
  await db.exec(`
    insert into public.warehouses (id, code, name) values ('${WH5}', 'WH5', 'คลัง 5'), ('${WH32}', 'WH32', 'คลัง 32');
  `);
  const people = [
    [U.super, "SA01", "super_admin", null],
    [U.exec, "EX01", "executive", null],
    [U.admin5, "A5", "admin", WH5],
    [U.admin32, "A32", "admin", WH32],
    [U.sup5, "S5", "supervisor", WH5],
    [U.emp5, "E5", "employee", WH5],
    [U.emp32, "E32", "employee", WH32],
  ];
  for (const [id, code, role, wh] of people) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${code.toLowerCase()}@wha.local`]);
    await db.query(
      `insert into public.profiles (id, employee_code, first_name_th, role, warehouse_id) values ($1, $2, $3, $4, $5)`,
      [id, code, `ชื่อ ${code}`, role, wh],
    );
  }
  return db;
}

// ทำคำสั่งในนามผู้ใช้คนหนึ่ง (เหมือนเรียกจากแอปหลังล็อกอิน)
export async function as(db, uid, fn) {
  await db.exec(`set role ${uid ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

export const rows = async (db, sql, params) => (await db.query(sql, params)).rows;
export const codesSeenBy = (db, uid) =>
  as(db, uid, async () => (await rows(db, `select employee_code from public.profiles order by employee_code`)).map((r) => r.employee_code));

