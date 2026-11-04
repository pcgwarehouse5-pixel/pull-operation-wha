// ตรวจการเชื่อมต่อ Supabase แบบอ่านอย่างเดียว (แสดงแค่สถานะ ไม่แสดงค่าลับ)
// ใช้: npm run db:check
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
process.loadEnvFile(".env.local");
const e = process.env;
const anon = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const r1 = await anon.auth.getSession();
console.log("anon key:", r1.error ? "ERROR " + r1.error.message : "OK");
const admin = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const r2 = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
console.log("secret key (admin API):", r2.error ? "ERROR " + r2.error.message : `OK (users in project: ${r2.data.users.length ? "มีอยู่แล้ว" : "0"})`);
const c = new pg.Client({ connectionString: e.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
try {
  await c.connect();
  const v = await c.query("select version(), current_setting('TimeZone') tz");
  const t = await c.query("select count(*)::int n from information_schema.tables where table_schema='public'");
  const m = await c.query("select to_regclass('app_private.migrations') is not null as has");
  console.log("database:", "OK", v.rows[0].version.split(" ").slice(0, 2).join(" "), "| public tables:", t.rows[0].n, "| migrations table:", m.rows[0].has);
  await c.end();
} catch (err) {
  console.log("database: ERROR", err.message.replace(/postgres(ql)?:\/\/\S+/g, "[url]"));
}
