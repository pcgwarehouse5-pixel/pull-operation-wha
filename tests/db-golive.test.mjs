// ทดสอบวันเริ่มใช้ลงเวลาในแอป: ก่อนเริ่มใช้ไม่นับขาดงาน ไม่แจ้งเตือน ไม่คิดเบี้ยขยัน
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, setup, rows } from "./helpers.mjs";

async function base(live) {
  const db = await setup();
  await db.exec(`
    delete from public.app_settings where key = 'attendance.go_live_date' and effective_from = '2000-01-02';
    insert into public.dropdown_options (category, value, label, extra) values ('shift_type', 'STD1', '08:00-17:00', '{"start_time":"08:00","end_time":"17:00"}');
  `);
  if (live) await db.query(`insert into public.app_settings (key, effective_from, value) values ('attendance.go_live_date', '2000-01-02', $1::jsonb)`, [JSON.stringify(live)]);
  for (const d of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-12-01", "2026-12-02", "2026-12-03"]) {
    await db.query(`insert into public.shift_schedules (user_id, work_date, shift_code) values ($1, $2, 'STD1')`, [U.emp5, d]);
  }
  return db;
}
const statuses = (db, from, to) =>
  rows(db, `select work_date::text as d, status from public.attendance_rows_core(array[$1]::uuid[], $2, $3, '2026-12-10 12:00+07')`, [U.emp5, from, to]).then((r) => r.map((x) => x.status));

test("ยังไม่ตั้งวันเริ่มใช้: ไม่มีใครถูกนับขาด ไม่แจ้งเตือน ไม่ได้เบี้ยขยัน", async () => {
  const db = await base(null);
  assert.deepEqual(await statuses(db, "2026-11-02", "2026-11-04"), ["not_tracked", "not_tracked", "not_tracked"]);
  const j = (await rows(db, `select public.run_jobs_at('2026-12-10 10:00+07') as r`))[0].r;
  assert.ok(j.skipped);
  assert.equal((await rows(db, `select count(*)::int as c from public.notifications`))[0].c, 0);
  const d = await rows(db, `select amount::float as a, qualified from public.diligence_core(array[$1]::uuid[], '2026-12-01', '2026-12-31 12:00+07')`, [U.emp5]);
  assert.deepEqual(d, [{ a: 0, qualified: false }]);
});

test("ตั้งวันเริ่มใช้ 1 ธ.ค.: ก่อนหน้า = ยังไม่เริ่มใช้ / หลังจากนั้นนับขาดและแจ้งเตือนตามปกติ", async () => {
  const db = await base("2026-12-01");
  assert.deepEqual(await statuses(db, "2026-11-02", "2026-11-04"), ["not_tracked", "not_tracked", "not_tracked"]);
  assert.deepEqual(await statuses(db, "2026-12-01", "2026-12-03"), ["absent", "absent", "absent"]);
  const j = (await rows(db, `select public.run_jobs_at('2026-12-10 10:00+07') as r`))[0].r;
  assert.equal(j.absent_streak, 1, "ขาด 1–3 ธ.ค. (หลังวันเริ่มใช้) แจ้งได้");
  // ขาดงานที่คร่อมวันเริ่มใช้ไม่แจ้ง
  const db2 = await base("2026-12-02");
  const j2 = (await rows(db2, `select public.run_jobs_at('2026-12-10 10:00+07') as r`))[0].r;
  assert.equal(j2.absent_streak, 0, "3 วันล่าสุดมี 1 ธ.ค. ซึ่งก่อนวันเริ่มใช้");
});
