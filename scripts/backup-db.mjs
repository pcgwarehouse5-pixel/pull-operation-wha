// สำรองข้อมูลตารางในฐานข้อมูลจริงเป็นไฟล์ JSON ในเครื่อง (โฟลเดอร์ backups/ ไม่ขึ้น GitHub เพราะมีข้อมูลพนักงาน)
// ใช้: node scripts/backup-db.mjs   (ทำก่อนแก้โครงสร้างฐานข้อมูลทุกครั้ง)
// กู้คืน: ใช้ไฟล์ JSON นี้นำเข้ากลับ (ให้ผู้ดูแลระบบช่วยทำ) หรือใช้การกู้คืนของ Supabase
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

process.loadEnvFile(".env.local");
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const tables = (
  await c.query(`select tablename from pg_tables where schemaname = 'public' order by 1`)
).rows.map((r) => r.tablename);
const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "medium" }).format(new Date()).replace(/[: ]/g, "-");
const dir = path.join("backups", `db-${stamp}`);
fs.mkdirSync(dir, { recursive: true });
const summary = {};
for (const t of tables) {
  const { rows } = await c.query(`select * from public.${JSON.stringify(t).slice(1, -1)}`);
  fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(rows, null, 1));
  summary[t] = rows.length;
}
const migrations = (await c.query(`select name from app_private.migrations order by name`)).rows.map((r) => r.name);
fs.writeFileSync(path.join(dir, "_summary.json"), JSON.stringify({ at: new Date().toISOString(), migrations, rows: summary }, null, 1));
await c.end();
console.log(`สำรองแล้วที่ ${dir}`);
console.log(JSON.stringify(summary));
