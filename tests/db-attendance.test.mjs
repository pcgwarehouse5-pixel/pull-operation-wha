// ทดสอบโมดูล 3 (ลงเวลา) และ 4 (ลา) บน Postgres จำลอง — ข้อมูลสมมติทั้งหมด
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, WH5, setup, as, rows } from "./helpers.mjs";

// คลัง 5 อยู่ที่พิกัดสมมติ 13.0, 100.0 รัศมี 100 ม. / คลัง 32 ยังไม่ตั้งพิกัด
const IN = [13.0, 100.0]; // ตรงคลัง
const NEAR = [13.0005, 100.0]; // ห่างประมาณ 56 ม.
const FAR = [13.01, 100.0]; // ห่างประมาณ 1.1 กม.

async function base() {
  const db = await setup();
  await db.exec(`
    update public.warehouses set latitude = 13.0, longitude = 100.0, checkin_radius_m = 100 where id = '${WH5}';
    insert into public.dropdown_options (category, value, label, extra) values
      ('shift_type', 'STD1', '08:00-17:00', '{"start_time":"08:00","end_time":"17:00"}'),
      ('shift_type', 'GN_5', '20:00-05:00', '{"start_time":"20:00","end_time":"05:00"}'),
      ('shift_type', 'OFF', 'หยุด', '{}'),
      ('shift_type', 'HOL', 'นักขัตฤกษ์', '{}'),
      ('leave_type', 'sick', 'ป่วย', '{}'),
      ('leave_type', 'personal', 'กิจ', '{}'),
      ('leave_type', 'vacation', 'พักผ่อน', '{}');
  `);
  return db;
}
const shift = (db, user, date, code) =>
  db.query(`insert into public.shift_schedules (user_id, work_date, shift_code) values ($1, $2, $3)`, [user, date, code]);
// กดลงเวลาด้วยเวลาที่กำหนด (แกนเดียวกับปุ่มในแอป)
const punchAt = (db, user, kind, at, [lat, lng] = IN, acc = 10) =>
  rows(db, `select kind, work_date::text as wd, distance_m from public.punch_core($1, $2, $3::timestamptz, $4, $5, $6)`, [user, kind, at, lat, lng, acc]).then((r) => r[0]);
const status = (db, user, from, to, now) =>
  rows(db, `select work_date::text as d, status, late_min, early_min, shift_code from public.attendance_rows_core(array[$1]::uuid[], $2, $3, $4::timestamptz)`, [user, from, to, now]);

test("ลงเวลา: ต้องอยู่ในรัศมีคลัง GPS แม่นพอ และคลังต้องตั้งพิกัดแล้ว", async () => {
  const db = await base();
  const r = await punchAt(db, U.emp5, "in", "2026-12-03 07:55+07", NEAR);
  assert.equal(r.wd, "2026-12-03");
  assert.ok(r.distance_m > 40 && r.distance_m < 70, `ระยะ ${r.distance_m}`);
  await assert.rejects(punchAt(db, U.emp5, "out", "2026-12-03 17:05+07", FAR), /นอกพื้นที่คลัง \(ห่าง 11\d\d เมตร ต้องอยู่ในรัศมี 100 เมตร\)/);
  await assert.rejects(punchAt(db, U.emp5, "out", "2026-12-03 17:05+07", IN, 500), /GPS ยังไม่แม่นพอ/);
  await assert.rejects(punchAt(db, U.emp5, "out", "2026-12-03 17:05+07", [null, null]), /ไม่ได้รับตำแหน่ง/);
  await assert.rejects(punchAt(db, U.emp32, "in", "2026-12-03 07:55+07"), /ยังไม่ได้ตั้งพิกัด/);
  // คลังเพิ่มเติมที่ดูแลก็ลงเวลาได้
  await db.query(`insert into public.user_warehouses (user_id, warehouse_id) values ($1, $2)`, [U.emp32, WH5]);
  assert.equal((await punchAt(db, U.emp32, "in", "2026-12-03 07:55+07")).wd, "2026-12-03");
  // ผ่านปุ่มในแอป (เวลาเซิร์ฟเวอร์)
  const app = await as(db, U.sup5, () => rows(db, `select public.punch('in', 13.0, 100.0, 5) as r`));
  assert.ok(app[0].r.work_date);
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.punch('in', 13.0, 100.0, 5)`)), /บันทึกเข้างานแล้ว/);
});

test("ลงเวลา: กะดึกข้ามวันนับเป็นวันที่เริ่มกะ และกันกดซ้ำ", async () => {
  const db = await base();
  await shift(db, U.emp5, "2026-12-01", "GN_5");
  assert.equal((await punchAt(db, U.emp5, "in", "2026-12-01 19:50+07")).wd, "2026-12-01");
  await assert.rejects(punchAt(db, U.emp5, "in", "2026-12-01 19:55+07"), /บันทึกเข้างานแล้ว/);
  assert.equal((await punchAt(db, U.emp5, "out", "2026-12-02 05:05+07")).wd, "2026-12-01", "ออกตอนเช้า = วันที่เริ่มกะ");
  await assert.rejects(punchAt(db, U.emp5, "out", "2026-12-02 05:06+07"), /บันทึกออกงานไปแล้ว/);

  // มาสายหลังเที่ยงคืน (ยังอยู่ในกะดึกของเมื่อวาน)
  await shift(db, U.sup5, "2026-12-01", "GN_5");
  assert.equal((await punchAt(db, U.sup5, "in", "2026-12-02 00:30+07")).wd, "2026-12-01");
  // ลืมกดเข้า แต่กดออกตอนเช้า = ของกะเมื่อวาน
  await shift(db, U.admin5, "2026-12-01", "GN_5");
  assert.equal((await punchAt(db, U.admin5, "out", "2026-12-02 05:30+07")).wd, "2026-12-01");
});

test("สถานะรายวัน: สาย/ออกก่อนตามเวลาผ่อนผันที่ตั้งพร้อมวันที่เริ่มใช้, ขาด, ลืมออก, วันหยุด", async () => {
  const db = await base();
  for (const d of ["2026-12-03", "2026-12-04", "2026-12-05", "2026-12-07", "2026-12-08"]) await shift(db, U.emp5, d, "STD1");
  await shift(db, U.emp5, "2026-12-06", "OFF");
  await punchAt(db, U.emp5, "in", "2026-12-03 08:07+07");
  await punchAt(db, U.emp5, "out", "2026-12-03 16:50+07");
  await punchAt(db, U.emp5, "in", "2026-12-04 08:00+07"); // ไม่กดออก
  await punchAt(db, U.emp5, "in", "2026-12-06 09:00+07"); // มาทำงานวันหยุด
  await punchAt(db, U.emp5, "out", "2026-12-06 12:00+07");

  let st = await status(db, U.emp5, "2026-12-03", "2026-12-09", "2026-12-08 12:00+07");
  const by = Object.fromEntries(st.map((r) => [r.d, r]));
  assert.deepEqual([by["2026-12-03"].status, by["2026-12-03"].late_min, by["2026-12-03"].early_min], ["late_early", 7, 10]);
  assert.equal(by["2026-12-04"].status, "no_out");
  assert.equal(by["2026-12-05"].status, "absent");
  assert.equal(by["2026-12-06"].status, "off_worked");
  assert.equal(by["2026-12-07"].status, "absent");
  assert.equal(by["2026-12-08"].status, "waiting", "กะเริ่มแล้วแต่ยังไม่เข้า");
  assert.equal(by["2026-12-09"].status, "no_shift");
  assert.equal((await status(db, U.emp5, "2026-12-08", "2026-12-08", "2026-12-08 07:00+07"))[0].status, "upcoming");
  assert.equal((await status(db, U.emp5, "2026-12-04", "2026-12-04", "2026-12-04 18:00+07"))[0].status, "working", "ยังไม่เลยเวลาลืมออก");

  // ตั้งผ่อนผันสาย 10 นาที / ออกก่อน 10 นาที เริ่มใช้ 1 ธ.ค. → วันที่ 3 ปกติ (ค่าเก่ายังใช้กับวันก่อนหน้า)
  await db.exec(`
    insert into public.app_settings (key, effective_from, value) values
      ('attendance.late_grace_minutes', '2026-12-01', '10'), ('attendance.early_leave_grace_minutes', '2026-12-01', '10');
  `);
  st = await status(db, U.emp5, "2026-12-03", "2026-12-03", "2026-12-08 12:00+07");
  assert.deepEqual([st[0].status, st[0].late_min, st[0].early_min], ["ok", 0, 0]);
  const old = await rows(db, `select public.setting_num('attendance.late_grace_minutes', '2026-11-30', -1) as v`);
  assert.equal(Number(old[0].v), 0);
});

test("ขอแก้เวลา: หัวหน้าอนุมัติแล้วระบบเพิ่มเวลาให้และล็อก / อนุมัติของตัวเองไม่ได้", async () => {
  const db = await base();
  await shift(db, U.emp5, "2026-11-20", "STD1");
  await shift(db, U.emp5, "2026-11-21", "GN_5");
  const today = (await rows(db, `select (now() at time zone 'Asia/Bangkok')::date::text as d`))[0].d;
  const req = (user, date, i, o, reason = "ลืมกด") =>
    as(db, user, () => rows(db, `select public.request_correction($1, $2, $3, $4) as id`, [date, i, o, reason])).then((r) => r[0].id);

  await assert.rejects(req(U.emp5, "2099-01-01", "08:00", "17:00"), /ล่วงหน้า/);
  await assert.rejects(req(U.emp5, "2020-01-01", "08:00", "17:00"), /ย้อนหลังได้ไม่เกิน/);
  await assert.rejects(req(U.emp5, today, null, null), /อย่างน้อย 1/);
  await assert.rejects(req(U.emp5, today, "08:00", null, " "), /เหตุผล/);

  // ใช้วันที่ย้อนหลังที่อยู่ในช่วง (เมื่อวาน) เพื่อไม่ให้ขึ้นกับวันที่รันเทสต์
  const y = (await rows(db, `select ((now() at time zone 'Asia/Bangkok')::date - 1)::text as d`))[0].d;
  await db.query(`update public.shift_schedules set work_date = $1 where user_id = $2 and shift_code = 'GN_5'`, [y, U.emp5]);
  const id = await req(U.emp5, y, "20:00", "05:00");
  await assert.rejects(req(U.emp5, y, "20:00", "05:00"), /รออนุมัติอยู่แล้ว/);
  await assert.rejects(as(db, U.emp5, () => db.query(`select public.decide_correction($1, true)`, [id])), /ของตัวเอง/);
  await assert.rejects(as(db, U.admin32, () => db.query(`select public.decide_correction($1, true)`, [id])), /ไม่มีสิทธิ์/);
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.decide_correction($1, false, '')`, [id])), /เหตุผล/);
  await as(db, U.sup5, () => db.query(`select public.decide_correction($1, true, 'ตรวจกล้องแล้ว')`, [id]));
  const p = await rows(db, `select kind, to_char(punched_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') as t, work_date::text as wd from public.attendance_punches where user_id = $1 order by punched_at`, [U.emp5]);
  const next = (await rows(db, `select ($1::date + 1)::text as d`, [y]))[0].d;
  assert.deepEqual(p, [{ kind: "in", t: `${y} 20:00`, wd: y }, { kind: "out", t: `${next} 05:00`, wd: y }], "เวลาออกกะดึก = เช้าวันถัดไป");
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.decide_correction($1, true)`, [id])), /ดำเนินการไปแล้ว/);

  // หัวหน้ายื่นแทนพนักงานได้ / พนักงานยื่นแทนคนอื่นไม่ได้
  await as(db, U.sup5, () => db.query(`select public.request_correction($1, '08:00', null, 'ยื่นแทน', $2)`, [today, U.emp5]));
  await assert.rejects(as(db, U.emp5, () => db.query(`select public.request_correction($1, '08:00', null, 'x', $2)`, [today, U.sup5])), /ไม่มีสิทธิ์/);
  const logs = await rows(db, `select action from public.audit_logs where table_name = 'attendance_corrections' order by id`);
  assert.deepEqual(logs.map((l) => l.action), ["correction_request", "correction_approve", "correction_request"]);
});

test("สิทธิ์ข้อมูลลงเวลา: เห็นของตัวเอง/หัวหน้าเห็นคลังตัวเอง เขียนตรงไม่ได้", async () => {
  const db = await base();
  await punchAt(db, U.emp5, "in", "2026-12-03 08:00+07");
  const seen = (uid) => as(db, uid, () => rows(db, `select user_id from public.attendance_punches`));
  assert.equal((await seen(U.emp5)).length, 1);
  assert.equal((await seen(U.sup5)).length, 1);
  assert.equal((await seen(U.emp32)).length, 0);
  assert.equal((await seen(U.admin32)).length, 0);
  await assert.rejects(
    as(db, U.emp5, () => db.query(`insert into public.attendance_punches (user_id, kind, work_date) values ($1, 'in', '2026-12-03')`, [U.emp5])),
    /permission denied/,
  );
  await assert.rejects(as(db, U.emp5, () => db.query(`update public.attendance_punches set punched_at = now()`)), /permission denied/);
  await assert.rejects(as(db, U.emp5, () => db.query(`select * from public.punch_core($1, 'in', now(), 13, 100, 1)`, [U.emp5])), /permission denied/);
  await assert.rejects(as(db, U.admin32, () => db.query(`select * from public.warehouse_attendance($1, '2026-12-01', '2026-12-31')`, [WH5])), /ไม่มีสิทธิ์/);
  const w = await as(db, U.sup5, () => rows(db, `select employee_code, status from public.warehouse_attendance($1, '2026-12-03', '2026-12-03')`, [WH5]));
  assert.ok(w.some((r) => r.employee_code === "E5"));
  assert.equal((await as(db, U.emp5, () => rows(db, `select * from public.my_attendance('2026-12-03', '2026-12-03')`))).length, 1);
});

test("ค่าตั้งค่า: ทุกคนอ่านได้ ผู้บริหารขึ้นไปเพิ่มค่าใหม่ได้ และบันทึกประวัติ", async () => {
  const db = await base();
  const add = (uid) => as(db, uid, () => db.query(`insert into public.app_settings (key, effective_from, value) values ('attendance.late_grace_minutes', '2027-01-01', '5')`));
  await assert.rejects(add(U.admin5), /row-level security/);
  await add(U.exec);
  assert.ok((await as(db, U.emp5, () => rows(db, `select * from public.app_settings`))).length >= 8);
  assert.equal((await rows(db, `select count(*)::int as c from public.audit_logs where table_name = 'app_settings' and actor_id = $1`, [U.exec]))[0].c, 1);
});

// ---------------- ใบลา ----------------
const submit = (db, uid, type, s, e, period = "full", extra = {}) =>
  as(db, uid, () =>
    rows(db, `select public.submit_leave($1, $2, $3, $4, $5, $6, $7) as id`, [type, s, e, period, extra.reason ?? "ทดสอบ", extra.file ?? null, extra.user ?? null]),
  ).then((r) => r[0].id);
const leave = (db, id) => rows(db, `select status, days::text as days, steps_required, steps_done, over_quota from public.leave_requests where id = $1`, [id]).then((r) => r[0]);
const decide = (db, uid, id, ok, note = null) => as(db, uid, () => rows(db, `select public.decide_leave($1, $2, $3) as s`, [id, ok, note])).then((r) => r[0].s);

test("ใบลา: นับเฉพาะวันทำงานตามตารางกะ ไม่นับ OFF/HOL และวันนักขัตฤกษ์ที่ยังไม่มีตาราง", async () => {
  const db = await base();
  await shift(db, U.emp5, "2026-12-07", "STD1");
  await shift(db, U.emp5, "2026-12-08", "OFF");
  await shift(db, U.emp5, "2026-12-09", "GN_5");
  await shift(db, U.emp5, "2026-12-10", "HOL");
  await db.exec(`insert into public.holidays (holiday_date, name) values ('2026-12-31', 'วันหยุดสมมติ')`);
  const days = (s, e, p = "full", u = null) => as(db, U.emp5, () => rows(db, `select public.leave_days_preview($1, $2, $3, $4)::text as n`, [s, e, p, u])).then((r) => r[0].n);
  assert.equal(await days("2026-12-07", "2026-12-10"), "2.0", "7 กับ 9 เท่านั้น");
  assert.equal(await days("2026-12-30", "2026-12-31"), "1.0", "ไม่มีตารางกะ: ไม่นับวันนักขัตฤกษ์");
  assert.equal(await days("2026-12-07", "2026-12-07", "morning"), "0.5");
  await assert.rejects(days("2026-12-07", "2026-12-07", "full", U.sup5), /ไม่มีสิทธิ์/);
  await assert.rejects(submit(db, U.emp5, "sick", "2026-12-08", "2026-12-08"), /ไม่มีวันทำงาน/);
  await assert.rejects(submit(db, U.emp5, "sick", "2026-12-07", "2026-12-09", "morning"), /ครึ่งวันเลือกได้วันเดียว/);
  await assert.rejects(submit(db, U.emp5, "xyz", "2026-12-07", "2026-12-07"), /ไม่รู้จักประเภท/);
});

test("ใบลา: ขั้นตอนอนุมัติ 1 ขั้น / ลาตั้งแต่ 4 วันต้องผ่านผู้บริหาร / อนุมัติของตัวเองไม่ได้", async () => {
  const db = await base();
  const a = await submit(db, U.emp5, "personal", "2026-12-01", "2026-12-02");
  assert.deepEqual(await leave(db, a), { status: "pending", days: "2.0", steps_required: 1, steps_done: 0, over_quota: false });
  await assert.rejects(submit(db, U.emp5, "sick", "2026-12-02", "2026-12-03"), /มีใบลาในช่วงวันที่นี้อยู่แล้ว/);
  await assert.rejects(decide(db, U.emp5, a, true), /ของตัวเอง/);
  await assert.rejects(decide(db, U.admin32, a, true), /ไม่มีสิทธิ์/);
  await assert.rejects(decide(db, U.sup5, a, false, ""), /เหตุผล/);
  assert.equal(await decide(db, U.sup5, a, true, "ok"), "approved");
  await assert.rejects(decide(db, U.sup5, a, true), /ดำเนินการไปแล้ว/);

  // 5 วัน → 2 ขั้น: หัวหน้าอนุมัติแล้วยังรอผู้บริหาร
  const b = await submit(db, U.emp5, "vacation", "2026-12-10", "2026-12-14");
  assert.equal((await leave(db, b)).steps_required, 2);
  assert.equal(await decide(db, U.sup5, b, true), "pending");
  await assert.rejects(decide(db, U.admin5, b, true), /ต้องให้ผู้บริหารอนุมัติ/);
  assert.equal(await decide(db, U.exec, b, true), "approved");
  // ผู้บริหารอนุมัติขั้นแรกเอง = ครบ
  const c = await submit(db, U.emp5, "vacation", "2026-12-20", "2026-12-24");
  assert.equal(await decide(db, U.exec, c, true), "approved");
  // หัวหน้ายื่นแทนได้ แต่อนุมัติคนอื่นต้องไม่ใช่ตัวเองที่ลา
  const d = await submit(db, U.sup5, "sick", "2026-12-28", "2026-12-28", "full", { user: U.emp5 });
  assert.equal((await rows(db, `select user_id from public.leave_requests where id = $1`, [d]))[0].user_id, U.emp5);
  await assert.rejects(submit(db, U.emp5, "sick", "2026-12-29", "2026-12-29", "full", { user: U.sup5 }), /ไม่มีสิทธิ์ยื่นใบลาแทน/);

  const sig = await rows(db, `select step, action, actor_role from public.leave_approvals where request_id = $1 order by created_at`, [b]);
  assert.deepEqual(sig.map((s) => [s.step, s.action, s.actor_role]), [[1, "approve", "supervisor"], [2, "approve", "executive"]]);
});

test("ใบลา: ยกเลิก, ขอยกเลิกหลังอนุมัติ, โควตา/คงเหลือ, ไฟล์แนบ, สถานะเข้างานเป็นลา", async () => {
  const db = await base();
  const a = await submit(db, U.emp5, "personal", "2026-12-01", "2026-12-01");
  assert.equal((await as(db, U.emp5, () => rows(db, `select public.cancel_leave($1) as s`, [a])))[0].s, "cancelled");
  const b = await submit(db, U.emp5, "personal", "2026-12-02", "2026-12-03");
  await decide(db, U.sup5, b, true);
  await assert.rejects(as(db, U.emp5, () => db.query(`select public.cancel_leave($1)`, [b])), /เหตุผล/);
  assert.equal((await as(db, U.emp5, () => rows(db, `select public.cancel_leave($1, 'ไม่ได้ไปแล้ว') as s`, [b])))[0].s, "cancel_requested");
  await assert.rejects(as(db, U.emp32, () => db.query(`select public.cancel_leave($1, 'x')`, [b])), /ไม่พบใบลาของคุณ/);

  // ระหว่างรอยกเลิก วันลายังนับและยังเป็น "ลา"
  let st = await status(db, U.emp5, "2026-12-02", "2026-12-02", "2026-12-10 00:00+07");
  assert.equal(st[0].status, "leave");
  assert.equal(await decide(db, U.sup5, b, true), "cancelled");
  st = await status(db, U.emp5, "2026-12-02", "2026-12-02", "2026-12-10 00:00+07");
  assert.equal(st[0].status, "no_shift");

  // โควตา: ตั้งรายคน 1 วัน → เกินโควตา (ยังยื่นได้ ให้ผู้อนุมัติเห็น)
  await as(db, U.admin5, () => db.query(`insert into public.leave_quota_overrides (user_id, year, leave_type, days) values ($1, 2026, 'sick', 1)`, [U.emp5]));
  await assert.rejects(
    as(db, U.sup5, () => db.query(`insert into public.leave_quota_overrides (user_id, year, leave_type, days) values ($1, 2026, 'vacation', 1)`, [U.emp5])),
    /row-level security/,
  );
  const c = await submit(db, U.emp5, "sick", "2026-12-07", "2026-12-08");
  assert.equal((await leave(db, c)).over_quota, true);
  const bal = await as(db, U.emp5, () => rows(db, `select leave_type, quota::text, approved::text, pending::text, remaining::text from public.leave_balance(2026)`));
  assert.deepEqual(bal.find((x) => x.leave_type === "sick"), { leave_type: "sick", quota: "1.0", approved: "0", pending: "2.0", remaining: "-1.0" });
  assert.equal(bal.find((x) => x.leave_type === "vacation").quota, "6");
  await assert.rejects(as(db, U.emp32, () => db.query(`select * from public.leave_balance(2026, $1)`, [U.emp5])), /ไม่มีสิทธิ์/);

  // ไฟล์แนบ: เฉพาะลาป่วย และต้องอยู่ในโฟลเดอร์ของเจ้าของ
  await assert.rejects(submit(db, U.emp5, "personal", "2026-12-15", "2026-12-15", "full", { file: `${U.emp5}/a.pdf` }), /แนบเอกสารไม่ได้/);
  await assert.rejects(submit(db, U.emp5, "sick", "2026-12-15", "2026-12-15", "full", { file: `${U.sup5}/a.pdf` }), /ไฟล์แนบไม่ถูกต้อง/);
  await submit(db, U.emp5, "sick", "2026-12-15", "2026-12-15", "full", { file: `${U.emp5}/a.pdf` });

  // สิทธิ์อ่านใบลา
  assert.equal((await as(db, U.emp32, () => rows(db, `select id from public.leave_requests`))).length, 0);
  assert.equal((await as(db, U.sup5, () => rows(db, `select id from public.leave_requests`))).length, 4);
  await assert.rejects(as(db, U.emp5, () => db.query(`update public.leave_requests set status = 'approved'`)), /permission denied/);
});

test("การเข้างานของฉัน: ไม่เปิดเผยกะของเดือนที่ยังเป็นร่าง", async () => {
  const db = await base();
  await shift(db, U.emp5, "2026-12-03", "STD1");
  const mine = () => as(db, U.emp5, () => rows(db, `select shift_code from public.my_attendance('2026-12-03', '2026-12-03')`));
  assert.equal((await mine())[0].shift_code, null);
  await as(db, U.sup5, () => db.query(`select public.set_schedule_status($1, '2026-12-01', 'published')`, [WH5]));
  assert.equal((await mine())[0].shift_code, "STD1");
});
