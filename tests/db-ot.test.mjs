// ทดสอบสูตร OT / เบี้ยขยัน / ค่าเดินทาง / รายงาน บน Postgres จำลอง — ข้อมูลสมมติทั้งหมด
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, WH5, setup, as, rows } from "./helpers.mjs";

async function base() {
  const db = await setup();
  await db.exec(`
    update public.warehouses set latitude = 13.0, longitude = 100.0, checkin_radius_m = 100 where id = '${WH5}';
    update public.profiles set employment_type = 'monthly_employee', travel_eligible = true where id = '${U.emp5}';
    update public.profiles set employment_type = 'daily_worker' where id = '${U.sup5}';
    insert into public.dropdown_options (category, value, label, extra) values
      ('shift_type', 'STD1', '08:00-17:00', '{"start_time":"08:00","end_time":"17:00"}'),
      ('shift_type', 'GN_5', '20:00-05:00', '{"start_time":"20:00","end_time":"05:00"}'),
      ('shift_type', 'OFF', 'หยุด', '{}'),
      ('shift_type', 'HOL', 'นักขัตฤกษ์', '{}'),
      ('leave_type', 'sick', 'ป่วย', '{}');
  `);
  return db;
}
const shift = (db, user, date, code, hw = null, vol = false) =>
  db.query(`insert into public.shift_schedules (user_id, work_date, shift_code, holiday_work, is_volunteer) values ($1, $2, $3, $4, $5)
            on conflict (user_id, work_date) do update set shift_code = excluded.shift_code, holiday_work = excluded.holiday_work, is_volunteer = excluded.is_volunteer`, [user, date, code, hw, vol]);
const punch = (db, user, kind, at) => db.query(`select public.punch_core($1, $2, $3::timestamptz, 13.0, 100.0, 5)`, [user, kind, at]);
const day = async (db, user, d, iIn, iOut) => {
  await punch(db, user, "in", iIn);
  await punch(db, user, "out", iOut);
};
const NOW = "2027-01-15 12:00+07";
const ot = (db, users, from, to, now = NOW) =>
  rows(db, `select user_id, work_date::text as d, day_type, normal_hours::float as nh, normal_rate::float as nr, ot_hours::float as oh, ot_rate::float as orr, approval
            from public.ot_rows_core($1::uuid[], $2, $3, $4::timestamptz) order by user_id, work_date`, [users, from, to, now]);

test("OT วันปกติ: เกินเลิกกะไม่ถึง 60 นาทีไม่นับ / ปัดลงทีละ 30 นาที / กะดึกข้ามวัน / อัตราตามประเภทพนักงาน", async () => {
  const db = await base();
  for (const d of ["2026-12-01", "2026-12-02", "2026-12-03"]) await shift(db, U.emp5, d, "STD1");
  await shift(db, U.emp5, "2026-12-04", "GN_5");
  await day(db, U.emp5, "2026-12-01", "2026-12-01 07:55+07", "2026-12-01 17:50+07"); // 50 นาที → 0
  await day(db, U.emp5, "2026-12-02", "2026-12-02 07:55+07", "2026-12-02 18:20+07"); // 80 → 1.0
  await day(db, U.emp5, "2026-12-03", "2026-12-03 07:55+07", "2026-12-03 18:45+07"); // 105 → 1.5
  await day(db, U.emp5, "2026-12-04", "2026-12-04 19:55+07", "2026-12-05 07:10+07"); // กะดึก 130 → 2.0
  await shift(db, U.sup5, "2026-12-02", "STD1");
  await day(db, U.sup5, "2026-12-02", "2026-12-02 07:55+07", "2026-12-02 19:00+07"); // รายวัน 120 → 2.0 × 1.5

  const r = await ot(db, [U.emp5, U.sup5], "2026-12-01", "2026-12-05");
  const e = r.filter((x) => x.user_id === U.emp5).map((x) => [x.d, x.oh, x.orr, x.day_type]);
  assert.deepEqual(e, [["2026-12-02", 1, 1.5, "normal"], ["2026-12-03", 1.5, 1.5, "normal"], ["2026-12-04", 2, 1.5, "normal"]]);
  const s = r.find((x) => x.user_id === U.sup5);
  assert.deepEqual([s.oh, s.orr], [2, 1.5], "คนงานรายวัน OT วันทำงาน 1.5 เท่า");

  // เปลี่ยนเกณฑ์ขั้นต่ำเป็น 30 นาที เริ่ม 3 ธ.ค. → วันที่ 1 ยังใช้ 60 นาที
  await db.exec(`insert into public.app_settings (key, effective_from, value) values ('ot.min_minutes', '2026-12-03', '30')`);
  await shift(db, U.emp5, "2026-12-07", "STD1");
  await day(db, U.emp5, "2026-12-07", "2026-12-07 07:55+07", "2026-12-07 17:40+07"); // 40 นาที → 0.5 (เกณฑ์ใหม่)
  const r2 = await ot(db, [U.emp5], "2026-12-01", "2026-12-07");
  assert.ok(!r2.some((x) => x.d === "2026-12-01"));
  assert.equal(r2.find((x) => x.d === "2026-12-07").oh, 0.5);
});

test("OT วันหยุด: ชั่วโมงปกติคิดอัตราทำงานวันหยุด ส่วนเกินคิด OT วันหยุด (หักพัก)", async () => {
  const db = await base();
  await shift(db, U.emp5, "2026-12-06", "OFF");
  await day(db, U.emp5, "2026-12-06", "2026-12-06 08:00+07", "2026-12-06 19:30+07"); // 690-60=630 → ปกติ 8 + เกิน 2.5
  await shift(db, U.emp5, "2026-12-05", "STD1", "HOL");
  await day(db, U.emp5, "2026-12-05", "2026-12-05 07:50+07", "2026-12-05 17:00+07"); // เริ่มนับ 08:00 → 480 = ปกติ 8
  await shift(db, U.sup5, "2026-12-06", "HOL");
  await day(db, U.sup5, "2026-12-06", "2026-12-06 08:00+07", "2026-12-06 12:00+07"); // 240 นาที (ไม่ถึงหักพัก) = 4 ชม. × 2
  const r = await ot(db, [U.emp5, U.sup5], "2026-12-05", "2026-12-06");
  const m = Object.fromEntries(r.map((x) => [`${x.user_id === U.emp5 ? "e" : "s"}${x.d.slice(8)}`, [x.day_type, x.nh, x.nr, x.oh, x.orr]]));
  assert.deepEqual(m.e06, ["OFF", 8, 1, 2.5, 3]);
  assert.deepEqual(m.e05, ["HOL", 8, 1, 0, null]);
  assert.deepEqual(m.s06, ["HOL", 4, 2, 0, null], "คนงานรายวันทำงานวันหยุด 2 เท่า");
});

test("OT: ไม่คิดให้คนที่ปิดคำนวณ OT และเวรอาสา", async () => {
  const db = await base();
  await shift(db, U.emp5, "2026-12-02", "STD1", null, true);
  await day(db, U.emp5, "2026-12-02", "2026-12-02 07:55+07", "2026-12-02 20:00+07");
  await shift(db, U.sup5, "2026-12-02", "STD1");
  await day(db, U.sup5, "2026-12-02", "2026-12-02 07:55+07", "2026-12-02 20:00+07");
  await db.exec(`update public.profiles set ot_eligible = false where id = '${U.sup5}'`);
  assert.equal((await ot(db, [U.emp5, U.sup5], "2026-12-02", "2026-12-02")).length, 0);
});

test("อนุมัติ OT: หัวหน้าอนุมัติ, เวลาเปลี่ยนต้องอนุมัติใหม่, อนุมัติของตัวเองไม่ได้, สิทธิ์ดู", async () => {
  const db = await base();
  await shift(db, U.emp5, "2026-12-02", "STD1");
  await day(db, U.emp5, "2026-12-02", "2026-12-02 07:55+07", "2026-12-02 19:00+07");
  const items = JSON.stringify([{ user_id: U.emp5, work_date: "2026-12-02" }]);
  await assert.rejects(as(db, U.emp5, () => db.query(`select public.decide_ot($1::jsonb, true)`, [items])), /ของตัวเอง/);
  await assert.rejects(as(db, U.admin32, () => db.query(`select public.decide_ot($1::jsonb, true)`, [items])), /ไม่มีสิทธิ์/);
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.decide_ot($1::jsonb, false, '')`, [items])), /เหตุผล/);
  assert.equal((await as(db, U.sup5, () => rows(db, `select public.decide_ot($1::jsonb, true) as n`, [items])))[0].n, 1);
  assert.equal((await ot(db, [U.emp5], "2026-12-02", "2026-12-02"))[0].approval, "approved");
  // ออกงานช้ากว่าเดิม (เช่น แก้เวลา) → ตัวเลขเปลี่ยน → ต้องอนุมัติใหม่
  await punch(db, U.emp5, "out", "2026-12-02 20:10+07");
  const after = (await ot(db, [U.emp5], "2026-12-02", "2026-12-02"))[0];
  assert.deepEqual([after.oh, after.approval], [3, "changed"]);

  assert.equal((await as(db, U.emp32, () => rows(db, `select * from public.ot_approvals`))).length, 0);
  assert.equal((await as(db, U.emp5, () => rows(db, `select * from public.ot_approvals`))).length, 1);
  await assert.rejects(as(db, U.emp5, () => db.query(`update public.ot_approvals set ot_hours = 9`)), /permission denied/);
  await assert.rejects(as(db, U.admin32, () => db.query(`select * from public.warehouse_ot($1, '2026-12-01', '2026-12-31')`, [WH5])), /ไม่มีสิทธิ์/);
  await assert.rejects(as(db, U.emp5, () => db.query(`select * from public.ot_rows_core(array[$1]::uuid[], '2026-12-01', '2026-12-31', now())`, [U.sup5])), /permission denied/);
  assert.equal((await as(db, U.emp5, () => rows(db, `select * from public.my_ot('2026-12-01', '2026-12-31')`))).length, 1);
});

test("รอบเงินเดือน: ทั้งเดือน หรือตัดรอบวันที่ 20", async () => {
  const db = await base();
  const per = (m) => rows(db, `select p_start::text as s, p_end::text as e from public.payroll_period($1)`, [m]).then((r) => r[0]);
  assert.deepEqual(await per("2026-02-10"), { s: "2026-02-01", e: "2026-02-28" });
  await db.exec(`insert into public.app_settings (key, effective_from, value) values ('payroll.cutoff_day', '2026-01-01', '20')`);
  assert.deepEqual(await per("2026-12-01"), { s: "2026-11-21", e: "2026-12-20" });
  assert.deepEqual(await per("2026-03-31"), { s: "2026-02-21", e: "2026-03-20" });
});

test("เบี้ยขยัน: ขั้นบันไดตามจำนวนเดือนติดกันที่ไม่ขาด/ลา/สาย", async () => {
  const db = await base();
  const months = ["2026-10", "2026-11", "2026-12"];
  for (const m of months) {
    for (const d of ["05", "06"]) {
      await shift(db, U.emp5, `${m}-${d}`, "STD1");
      await day(db, U.emp5, `${m}-${d}`, `${m}-${d} 07:55+07`, `${m}-${d} 17:05+07`);
      await shift(db, U.sup5, `${m}-${d}`, "STD1");
      await day(db, U.sup5, `${m}-${d}`, `${m}-${d} ${m === "2026-11" && d === "05" ? "08:10" : "07:55"}+07`, `${m}-${d} 17:05+07`);
    }
  }
  // admin5: ลาป่วยใน ธ.ค.
  for (const m of months) {
    await shift(db, U.admin5, `${m}-05`, "STD1");
    await day(db, U.admin5, `${m}-05`, `${m}-05 07:55+07`, `${m}-05 17:05+07`);
  }
  await shift(db, U.admin5, "2026-12-06", "STD1");
  await db.query(`insert into public.leave_requests (user_id, leave_type, start_date, end_date, days, status) values ($1, 'sick', '2026-12-06', '2026-12-06', 1, 'approved')`, [U.admin5]);

  const r = await rows(db, `select user_id, streak, amount::float as amount, qualified, late, leave_days::float as ld from public.diligence_core($1::uuid[], '2026-12-01', $2::timestamptz)`, [[U.emp5, U.sup5, U.admin5], NOW]);
  const by = Object.fromEntries(r.map((x) => [x.user_id, x]));
  assert.deepEqual([by[U.emp5].streak, by[U.emp5].amount], [3, 500], "ครบ 3 เดือน = ขั้นสูงสุด");
  assert.deepEqual([by[U.sup5].streak, by[U.sup5].amount], [1, 300], "สายเดือน พ.ย. → เริ่มนับใหม่");
  assert.deepEqual([by[U.admin5].qualified, by[U.admin5].amount, by[U.admin5].ld], [false, 0, 1], "ลาป่วยเดือนนี้ไม่ได้");

  // ตั้งไม่นับลาป่วยเป็นเหตุ → ได้
  await db.exec(`insert into public.app_settings (key, effective_from, value) values ('diligence.rules', '2026-12-01', '{"absent": true, "late": true, "no_punch": true, "leave_types": []}')`);
  const r2 = await rows(db, `select amount::float as a from public.diligence_core(array[$1]::uuid[], '2026-12-01', $2::timestamptz)`, [U.admin5, NOW]);
  assert.equal(r2[0].a, 500, "ธ.ค. ผ่าน และ ต.ค.–พ.ย. ไม่มีเหตุ → ครบ 3 เดือน");
});

test("ค่าเดินทาง สรุปลา และภาพรวมผู้บริหาร", async () => {
  const db = await base();
  await shift(db, U.emp5, "2026-12-01", "STD1");
  await day(db, U.emp5, "2026-12-01", "2026-12-01 07:55+07", "2026-12-01 17:05+07");
  await shift(db, U.emp5, "2026-12-10", "STD1");
  await day(db, U.emp5, "2026-12-10", "2026-12-10 07:55+07", "2026-12-10 17:05+07");
  await db.exec(`insert into public.app_settings (key, effective_from, value) values ('travel.rate_per_day', '2026-12-05', '40')`);
  const t = await as(db, U.sup5, () => rows(db, `select user_id, days, amount::float as amount from public.warehouse_travel($1, '2026-12-01', '2026-12-31')`, [WH5]));
  assert.deepEqual(t, [{ user_id: U.emp5, days: 2, amount: 70 }], "30 + 40 ตามอัตรา ณ วันนั้น / เฉพาะคนที่ได้ค่าเดินทาง");
  await assert.rejects(as(db, U.emp5, () => db.query(`select * from public.warehouse_travel($1, '2026-12-01', '2026-12-31')`, [WH5])), /ไม่มีสิทธิ์/);

  await db.query(`insert into public.leave_requests (user_id, leave_type, start_date, end_date, days, status) values ($1, 'sick', '2026-11-29', '2026-12-02', 4, 'approved')`, [U.emp5]);
  const l = await as(db, U.sup5, () => rows(db, `select leave_type, days::float as days from public.warehouse_leave_summary($1, '2026-12-01', '2026-12-31')`, [WH5]));
  assert.deepEqual(l, [{ leave_type: "sick", days: 2 }], "นับเฉพาะ 1–2 ธ.ค.");

  const dsh = await as(db, U.exec, () => rows(db, `select code, headcount from public.dashboard_summary('2026-12-10') order by code`));
  assert.deepEqual(dsh.map((x) => x.code), ["WH32", "WH5"]);
  const own = await as(db, U.sup5, () => rows(db, `select code from public.dashboard_summary('2026-12-10')`));
  assert.deepEqual(own.map((x) => x.code), ["WH5"]);
  await assert.rejects(as(db, U.emp5, () => db.query(`select * from public.dashboard_summary('2026-12-10')`)), /ไม่มีสิทธิ์/);
});
