// ทดสอบแจ้งเตือนในแอป และงานอัตโนมัติ บน Postgres จำลอง — ข้อมูลสมมติทั้งหมด
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, WH5, setup, as, rows } from "./helpers.mjs";

async function base() {
  const db = await setup();
  await db.exec(`
    update public.warehouses set latitude = 13.0, longitude = 100.0, checkin_radius_m = 100;
    insert into public.dropdown_options (category, value, label, extra) values
      ('shift_type', 'STD1', '08:00-17:00', '{"start_time":"08:00","end_time":"17:00"}'),
      ('shift_type', 'OFF', 'หยุด', '{}'),
      ('leave_type', 'sick', 'ป่วย', '{}'),
      ('leave_type', 'vacation', 'พักผ่อน', '{}');
  `);
  return db;
}
const inbox = (db, uid) => rows(db, `select kind, title, link from public.notifications where user_id = $1 order by id`, [uid]);
const kinds = async (db, uid) => (await inbox(db, uid)).map((n) => n.kind);
const shift = (db, user, date, code = "STD1") => db.query(`insert into public.shift_schedules (user_id, work_date, shift_code) values ($1, $2, $3)`, [user, date, code]);
const jobs = (db, at) => rows(db, `select public.run_jobs_at($1::timestamptz) as r`, [at]).then((r) => r[0].r);

test("แจ้งเตือนใบลา: ผู้อนุมัติได้รับเมื่อยื่น / เจ้าของได้รับผล / ขั้นที่ 2 ไปที่ผู้จัดการระดับต่ำสุด", async () => {
  const db = await base();
  const id = (await as(db, U.emp5, () => rows(db, `select public.submit_leave('sick', '2026-12-01', '2026-12-01', 'full', 'ไข้') as id`)))[0].id;
  assert.deepEqual(await kinds(db, U.sup5), ["leave_pending"]);
  assert.deepEqual(await kinds(db, U.admin5), ["leave_pending"]);
  assert.deepEqual(await kinds(db, U.emp5), []);
  assert.deepEqual(await kinds(db, U.admin32), [], "คลังอื่นไม่ได้รับ");
  assert.match((await inbox(db, U.sup5))[0].title, /ใบลารออนุมัติ: ชื่อ E5/);
  await as(db, U.sup5, () => db.query(`select public.decide_leave($1, true)`, [id]));
  assert.deepEqual(await inbox(db, U.emp5), [{ kind: "leave_result", title: "ใบลาได้รับการอนุมัติแล้ว", link: "/leave" }]);

  const b = (await as(db, U.emp5, () => rows(db, `select public.submit_leave('vacation', '2026-12-10', '2026-12-14', 'full', 'x') as id`)))[0].id;
  await as(db, U.sup5, () => db.query(`select public.decide_leave($1, true)`, [b]));
  assert.ok((await inbox(db, U.exec)).some((n) => /รอผู้จัดการอนุมัติ/.test(n.title)), "ระดับผู้จัดการต่ำสุดที่มี (ผู้บริหารเดิม = ระดับ 4)");
  assert.ok(!(await inbox(db, U.super)).some((n) => /รอผู้จัดการ/.test(n.title)), "ผู้ดูแลระบบสูงสุดไม่ได้รับ เมื่อมีผู้จัดการอยู่แล้ว");
});

test("แจ้งเตือนคำขอแก้เวลาและประกาศตารางกะ / เห็นเฉพาะของตัวเอง / อ่านแล้ว", async () => {
  const db = await base();
  const today = (await rows(db, `select (now() at time zone 'Asia/Bangkok')::date::text as d`))[0].d;
  const cid = (await as(db, U.emp5, () => rows(db, `select public.request_correction($1, '08:00', '17:00', 'ลืม') as id`, [today])))[0].id;
  assert.deepEqual(await kinds(db, U.sup5), ["correction_pending"]);
  await as(db, U.sup5, () => db.query(`select public.decide_correction($1, false, 'ไม่ตรงกับกล้อง')`, [cid]));
  const n = (await inbox(db, U.emp5)).at(-1);
  assert.equal(n.title, "ไม่อนุมัติคำขอแก้เวลา");

  await as(db, U.sup5, () => db.query(`select public.set_schedule_status($1, '2026-12-01', 'published')`, [WH5]));
  assert.ok((await kinds(db, U.emp5)).includes("schedule"));
  assert.ok(!(await kinds(db, U.emp32)).includes("schedule"), "คลังอื่นไม่ได้รับ");
  // กลับเป็นร่างแล้วประกาศใหม่ = แจ้งอีกรอบ
  await as(db, U.sup5, () => db.query(`select public.set_schedule_status($1, '2026-12-01', 'draft')`, [WH5]));
  await db.exec(`update public.schedule_months set published_at = now() + interval '1 minute'`);
  await as(db, U.sup5, () => db.query(`select public.set_schedule_status($1, '2026-12-01', 'published')`, [WH5]));

  const mine = await as(db, U.emp5, () => rows(db, `select user_id from public.notifications`));
  assert.ok(mine.length >= 2 && mine.every((x) => x.user_id === U.emp5));
  await assert.rejects(as(db, U.emp5, () => db.query(`insert into public.notifications (user_id, kind, title) values ($1, 'x', 'y')`, [U.sup5])), /permission denied/);
  await assert.rejects(as(db, U.emp5, () => db.query(`update public.notifications set title = 'z'`)), /permission denied/);
  await assert.rejects(as(db, U.emp5, () => db.query(`select public.notify($1, 'x', 'y', null, null)`, [U.sup5])), /permission denied/);
  const read = (await as(db, U.emp5, () => rows(db, `select public.mark_notifications_read() as n`)))[0].n;
  assert.equal(read, mine.length);
  assert.equal((await rows(db, `select count(*)::int as c from public.notifications where user_id = $1 and read_at is null`, [U.emp5]))[0].c, 0);
  assert.equal((await rows(db, `select count(*)::int as c from public.notifications where user_id = $1 and read_at is not null`, [U.sup5]))[0].c, 0, "ไม่แตะของคนอื่น");
});

test("งานอัตโนมัติ: ยังไม่ลงเวลาเข้า (ไม่แจ้งซ้ำ), ลืมออก, Check In อัตโนมัติ, ไม่แจ้งคนที่ลา", async () => {
  const db = await base();
  await shift(db, U.emp5, "2026-12-03");
  await shift(db, U.sup5, "2026-12-03");
  await shift(db, U.admin5, "2026-12-03");
  await db.exec(`update public.profiles set auto_check_in = true where id = '${U.sup5}'`);
  await db.query(`insert into public.leave_requests (user_id, leave_type, start_date, end_date, days, status) values ($1, 'sick', '2026-12-03', '2026-12-03', 1, 'approved')`, [U.admin5]);

  const r0 = await jobs(db, "2026-12-03 08:20+07");
  assert.deepEqual([r0.missing_in, r0.auto_check_in], [0, 1], "ยังไม่ถึง 30 นาที / เข้าอัตโนมัติเมื่อกะเริ่ม");
  const r = await jobs(db, "2026-12-03 08:40+07");
  assert.deepEqual([r.missing_in, r.auto_check_in], [1, 0]);
  await jobs(db, "2026-12-03 08:55+07");
  assert.deepEqual(await kinds(db, U.emp5), ["missing_in"], "ไม่แจ้งซ้ำ");
  assert.deepEqual(await kinds(db, U.admin5), [], "ลาอยู่ ไม่แจ้ง");
  const auto = await rows(db, `select kind, is_auto, to_char(punched_at at time zone 'Asia/Bangkok', 'HH24:MI') as t from public.attendance_punches where user_id = $1`, [U.sup5]);
  assert.deepEqual(auto, [{ kind: "in", is_auto: true, t: "08:00" }]);

  await db.query(`select public.punch_core($1, 'in', '2026-12-03 09:00+07', 13.0, 100.0, 5)`, [U.emp5]);
  assert.equal((await jobs(db, "2026-12-03 20:00+07")).missing_out, 0, "ยังไม่เลย 4 ชม. หลังเลิกกะ");
  assert.equal((await jobs(db, "2026-12-03 21:30+07")).missing_out, 2, "พนักงาน + คนที่เข้าอัตโนมัติแต่ไม่กดออก");
  assert.ok((await kinds(db, U.emp5)).includes("missing_out"));
});

test("งานอัตโนมัติ: ขาดงานติดต่อกัน 3 วันทำงาน แจ้งหัวหน้า/แอดมิน และ OT รออนุมัติ", async () => {
  const db = await base();
  for (const d of ["2026-12-05", "2026-12-07", "2026-12-08", "2026-12-09"]) await shift(db, U.emp32, d);
  await shift(db, U.emp32, "2026-12-06", "OFF"); // วันหยุดไม่ตัดความต่อเนื่อง
  await db.query(`select public.punch_core($1, 'in', '2026-12-05 07:55+07', 13.0, 100.0, 5)`, [U.emp32]);
  await db.query(`select public.punch_core($1, 'out', '2026-12-05 19:30+07', 13.0, 100.0, 5)`, [U.emp32]);

  assert.equal((await jobs(db, "2026-12-10 08:00+07")).absent_streak, 0, "ก่อนเวลาสรุปประจำวัน");
  const r = await jobs(db, "2026-12-10 09:15+07");
  assert.equal(r.absent_streak, 1);
  const n = (await inbox(db, U.admin32)).find((x) => x.kind === "absent_streak");
  assert.match(n.title, /ขาดงานติดต่อกัน 3 วันทำงาน/);
  assert.equal(n.link, "/attendance/team");
  assert.ok(!(await kinds(db, U.admin5)).includes("absent_streak"));
  assert.ok((await kinds(db, U.admin32)).includes("ot_pending"), "OT วันที่ 5 ยังไม่อนุมัติ");
  await jobs(db, "2026-12-10 11:00+07");
  assert.equal((await kinds(db, U.admin32)).filter((k) => k === "absent_streak").length, 1, "วันละครั้ง");
});
