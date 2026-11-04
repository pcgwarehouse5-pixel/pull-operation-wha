// อัปเดตฐานข้อมูล Supabase ด้วยไฟล์ใน supabase/migrations ที่ยังไม่เคยรัน (รันซ้ำได้ปลอดภัย)
// ใช้: npm run db:setup   (ต้องมี SUPABASE_DB_URL ในไฟล์ .env.local)
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {
  console.error("ไม่พบไฟล์ .env.local (คัดลอกจาก .env.example แล้วใส่ค่า)");
  process.exit(1);
}

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("ยังไม่ได้ใส่ SUPABASE_DB_URL ใน .env.local");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

// ตารางจดว่ารันไฟล์ไหนไปแล้ว (อยู่ใน schema แยก ไม่เปิดผ่าน API)
await client.query(`
  create schema if not exists app_private;
  revoke all on schema app_private from public;
  create table if not exists app_private.migrations (name text primary key, applied_at timestamptz not null default now());
`);
const done = new Set((await client.query(`select name from app_private.migrations`)).rows.map((r) => r.name));

const dir = "supabase/migrations";
const pending = fs.readdirSync(dir).filter((x) => x.endsWith(".sql") && !done.has(x)).sort();
if (pending.length === 0) console.log("ฐานข้อมูลเป็นเวอร์ชันล่าสุดแล้ว");
for (const f of pending) {
  process.stdout.write(`กำลังรัน ${f} ... `);
  // ทั้งไฟล์สำเร็จทั้งหมด หรือไม่เปลี่ยนอะไรเลย
  try {
    await client.query("begin");
    await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
    await client.query(`insert into app_private.migrations (name) values ($1)`, [f]);
    await client.query("commit");
    console.log("เสร็จ");
  } catch (e) {
    await client.query("rollback");
    console.log("ไม่สำเร็จ");
    console.error(e.message);
    await client.end();
    process.exit(1);
  }
}
await client.end();
