// ทดสอบคลังกลางและการจองคน (Pull Board) บน Postgres จำลอง
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, WH5, WH32, setup, as, rows } from "./helpers.mjs";

const q1 = async (db, sql, params) => (await db.query(sql, params)).rows[0];

// คลัง 5 เปิดทักษะ "RT รับ" และ "Checker" / emp32 เข้ากะเช้า มีทักษะ RT รับ / emp5 วันหยุด / sup5 ไม่มีกะ
async function world() {
  const db = await setup();
  await db.exec(`
    insert into public.dropdown_options (category, value, label, extra) values
      ('shift_type', 'D8', '08:00-17:00', '{"start_time":"08:00","end_time":"17:00"}'),
      ('shift_type', 'N20', '20:00-05:00', '{"start_time":"20:00","end_time":"05:00"}'),
      ('shift_type', 'OFF', 'หยุด', '{}');
    insert into public.skills (position, name) values ('RT', 'RT รับ'), ('Checker', 'Checker'), ('OP', 'OP ลาก');
    insert into public.employee_skills (user_id, skill_id) select '${U.emp32}', id from public.skills where name in ('RT รับ', 'OP ลาก');
    insert into public.employee_skills (user_id, skill_id) select '${U.emp5}', id from public.skills where name = 'RT รับ';
    insert into public.employee_skills (user_id, skill_id) select '${U.sup5}', id from public.skills where name = 'Checker';
  `);
  const d = (await q1(db, `select public.pull_today()::text as d`)).d;
  await db.query(`insert into public.shift_schedules (user_id, work_date, shift_code) values ($1, $3, 'D8'), ($2, $3, 'OFF')`, [U.emp32, U.emp5, d]);
  await as(db, U.admin5, () => db.query(`select public.set_pull_skills($1, $2)`, [WH5, ["RT รับ", "Checker"]]));
  await as(db, U.admin32, () => db.query(`select public.set_pull_skills($1, $2)`, [WH32, ["RT รับ"]]));
  return { db, d };
}
const pool = (db, uid, wh, d, shift = "morning") =>
  as(db, uid, async () => Object.fromEntries((await rows(db, `select employee_code, status, reason, skills from public.pull_pool($1, $2, $3)`, [wh, d, shift])).map((r) => [r.employee_code, r])));
const book = (db, uid, wh, d, items, shift = "morning") =>
  as(db, uid, async () => (await q1(db, `select public.book_pull($1, $2, $3, $4) as r`, [wh, d, shift, JSON.stringify(items)])).r);

test("คลังกลาง: สถานะพร้อม / ไม่พร้อม พร้อมเหตุผล ตามตารางกะ กะเช้า-ดึก และใบลา", async () => {
  const { db, d } = await world();
  let p = await pool(db, U.sup5, WH5, d);
  assert.equal(p.E32.status, "ready", "คนคลังอื่นที่เข้ากะเช้า = พร้อม");
  assert.deepEqual(p.E32.skills, ["OP ลาก", "RT รับ"]);
  assert.equal(p.E5.reason, "วันหยุด (OFF)");
  assert.equal(p.S5.reason, "ไม่มีกะในวันนี้");
  assert.equal(p.A5, undefined, "แอดมิน/ผู้บริหารไม่อยู่ในคลังกลาง");
  p = await pool(db, U.sup5, WH5, d, "night");
  assert.equal(p.E32.reason, "เข้ากะเช้า");
  // กะดึก
  await db.query(`update public.shift_schedules set shift_code = 'N20' where user_id = $1`, [U.emp32]);
  assert.equal((await pool(db, U.sup5, WH5, d, "night")).E32.status, "ready");
  // ช่วงเวลากะเช้าตั้งได้: เข้างาน 08:00 แต่กะเช้าถึง 07:59 → นับเป็นกะดึก
  await db.query(`update public.shift_schedules set shift_code = 'D8' where user_id = $1`, [U.emp32]);
  await db.query(`insert into public.app_settings (key, effective_from, value) values ('pull.morning_to_hour', $1, '7')`, [d]);
  assert.equal((await pool(db, U.sup5, WH5, d, "night")).E32.status, "ready");
  await db.query(`delete from public.app_settings where key = 'pull.morning_to_hour' and effective_from = $1`, [d]);
  // ลา (รออนุมัติก็นับว่าไม่พร้อม) / ใบลาที่ถูกปฏิเสธไม่นับ
  await db.query(`insert into public.leave_requests (user_id, leave_type, start_date, end_date, days, status) values ($1, 'sick', $2, $2, 1, 'pending')`, [U.emp32, d]);
  assert.equal((await pool(db, U.sup5, WH5, d)).E32.reason, "ลา");
  await db.query(`update public.leave_requests set status = 'rejected' where user_id = $1`, [U.emp32]);
  assert.equal((await pool(db, U.sup5, WH5, d)).E32.status, "ready");
});

test("จองข้ามคลัง: จองได้ทันที แจ้งพนักงานและหัวหน้าคลังต้นทาง คนอื่นเห็นว่าติดภารกิจ", async () => {
  const { db, d } = await world();
  const r = await book(db, U.sup5, WH5, d, [{ user_id: U.emp32, skill: "RT รับ" }]);
  assert.deepEqual(r, { booked: 1, conflicts: [] });
  const b = await q1(db, `select from_warehouse_id, to_warehouse_id, skill_name, shift, status, booked_by from public.pull_bookings where user_id = $1`, [U.emp32]);
  assert.deepEqual(b, { from_warehouse_id: WH32, to_warehouse_id: WH5, skill_name: "RT รับ", shift: "morning", status: "booked", booked_by: U.sup5 });
  const notes = await rows(db, `select user_id, kind, body, link from public.notifications order by kind`);
  assert.deepEqual(notes.map((n) => `${n.kind}:${n.user_id === U.emp32 ? "emp32" : n.user_id === U.admin32 ? "admin32" : n.user_id}`), ["pull_booked:emp32", "pull_source:admin32"]);
  assert.match(notes[0].body, /คลัง WH5 · RT รับ/);
  assert.equal(notes[0].link, "/my-position");
  assert.equal((await pool(db, U.sup5, WH5, d)).E32.status, "booked_here");
  const fromWh32 = await pool(db, U.admin32, WH32, d);
  assert.equal(fromWh32.E32.status, "busy");
  assert.equal(fromWh32.E32.reason, "ถูกจองโดย WH5");
  // 1 คน 1 คลังต่อวัน: คลังอื่นจองซ้ำไม่ได้ (ได้เหตุผลกลับ ไม่ error ทั้งชุด)
  const again = await book(db, U.admin32, WH32, d, [{ user_id: U.emp32, skill: "RT รับ" }]);
  assert.equal(again.booked, 0);
  assert.equal(again.conflicts[0].reason, "ถูกจองโดย WH5");
  // กะอื่นของวันเดียวกันก็จองซ้ำไม่ได้
  await db.query(`update public.shift_schedules set shift_code = 'N20' where user_id = $1`, [U.emp32]);
  const night = await book(db, U.sup5, WH5, d, [{ user_id: U.emp32, skill: "RT รับ" }], "night");
  assert.equal(night.booked, 0);
});

test("จอง: ตรวจทักษะ สถานะ และบันทึกบางคนได้แม้บางคนจองไม่ได้", async () => {
  const { db, d } = await world();
  await db.query(`update public.shift_schedules set shift_code = 'D8' where user_id = $1`, [U.emp5]);
  const r = await book(db, U.sup5, WH5, d, [
    { user_id: U.emp32, skill: "Checker" }, // ไม่มีทักษะนี้
    { user_id: U.emp32, skill: "OP ลาก" }, // คลังไม่ได้เปิดทักษะนี้
    { user_id: U.sup5, skill: "Checker" }, // ไม่มีกะ
    { user_id: U.emp5, skill: "RT รับ" }, // คนคลังตัวเอง พร้อม → จองได้
  ]);
  assert.equal(r.booked, 1);
  assert.deepEqual(r.conflicts.map((c) => c.reason), ["ไม่มีทักษะ Checker", "คลังนี้ไม่ได้เปิดทักษะ OP ลาก", "ไม่มีกะในวันนี้"]);
  // จองคนคลังตัวเอง: ไม่แจ้งคลังต้นทาง (คลังเดียวกัน) · แจ้งพนักงานว่า "จัดตำแหน่งงาน" ไม่ใช่ "ไปช่วยงาน"
  const own = await rows(db, `select user_id, kind, title, link from public.notifications`);
  assert.deepEqual(own.map((n) => [n.user_id, n.kind, n.title, n.link]), [[U.emp5, "pull_placed", "หัวหน้าจัดตำแหน่งงานให้คุณ", "/my-position"]]);
});

test("จอง: สิทธิ์และวันที่", async () => {
  const { db, d } = await world();
  const item = [{ user_id: U.emp32, skill: "RT รับ" }];
  await assert.rejects(book(db, U.emp5, WH5, d, item), /ไม่มีสิทธิ์/);
  await assert.rejects(book(db, U.admin32, WH5, d, item), /ไม่มีสิทธิ์/);
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.book_pull($1, public.pull_today() - 1, 'morning', $2)`, [WH5, JSON.stringify(item)])), /ย้อนหลัง/);
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.book_pull($1, public.pull_today() + 61, 'morning', $2)`, [WH5, JSON.stringify(item)])), /ไม่เกิน 60 วัน/);
  await assert.rejects(book(db, U.sup5, WH5, d, []), /ยังไม่ได้เลือก/);
  await assert.rejects(as(db, U.emp5, () => db.query(`select * from public.pull_pool($1, $2, 'morning')`, [WH5, d])), /ไม่มีสิทธิ์/);
  await assert.rejects(as(db, U.admin32, () => db.query(`select * from public.pull_pool($1, $2, 'morning')`, [WH5, d])), /ไม่มีสิทธิ์/);
  await assert.rejects(as(db, U.sup5, () => db.query(`insert into public.pull_bookings (work_date, shift, user_id, to_warehouse_id, skill_name) values ($1, 'morning', $2, $3, 'RT รับ')`, [d, U.emp32, WH5])), /permission denied/);
  // ผู้บริหารจองให้คลังไหนก็ได้
  assert.equal((await book(db, U.exec, WH5, d, item)).booked, 1);
});

test("ยกเลิกจอง: ต้องมีเหตุผล เฉพาะคลังปลายทาง แจ้งพนักงาน แล้วจองใหม่ได้", async () => {
  const { db, d } = await world();
  await book(db, U.sup5, WH5, d, [{ user_id: U.emp32, skill: "RT รับ" }]);
  const id = (await q1(db, `select id from public.pull_bookings where user_id = $1`, [U.emp32])).id;
  await assert.rejects(as(db, U.admin32, () => db.query(`select public.cancel_pull_booking($1, 'x')`, [id])), /เฉพาะคลังที่จอง/);
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.cancel_pull_booking($1, '  ')`, [id])), /เหตุผล/);
  await as(db, U.sup5, () => db.query(`select public.cancel_pull_booking($1, 'งานลดลง')`, [id]));
  const b = await q1(db, `select status, cancel_reason, cancelled_by from public.pull_bookings where id = $1`, [id]);
  assert.deepEqual(b, { status: "cancelled", cancel_reason: "งานลดลง", cancelled_by: U.sup5 });
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.cancel_pull_booking($1, 'ซ้ำ')`, [id])), /ยกเลิกไปแล้ว/);
  const cn = await rows(db, `select title, link from public.notifications where kind = 'pull_cancelled' and user_id = $1`, [U.emp32]);
  assert.deepEqual(cn, [{ title: "ยกเลิกการไปช่วยงาน", link: "/my-position" }]);
  // ยกเลิกแล้ว คลังอื่นจองได้
  assert.equal((await book(db, U.admin32, WH32, d, [{ user_id: U.emp32, skill: "RT รับ" }])).booked, 1);
  // วันที่ผ่านไปแล้วยกเลิกไม่ได้
  await db.query(`update public.pull_bookings set work_date = work_date - 1 where status = 'booked'`);
  const old = (await q1(db, `select id from public.pull_bookings where status = 'booked'`)).id;
  await assert.rejects(as(db, U.admin32, () => db.query(`select public.cancel_pull_booking($1, 'x')`, [old])), /ผ่านไปแล้ว/);
});

test("เห็นรายการจอง: ตัวพนักงาน คลังปลายทาง คลังต้นทาง ผู้บริหาร (คนอื่นไม่เห็น)", async () => {
  const { db, d } = await world();
  await book(db, U.sup5, WH5, d, [{ user_id: U.emp32, skill: "RT รับ" }]);
  const n = (uid) => as(db, uid, async () => (await rows(db, `select 1 from public.pull_bookings`)).length);
  assert.equal(await n(U.emp32), 1, "พนักงานเห็นของตัวเอง");
  assert.equal(await n(U.sup5), 1, "คลังปลายทาง");
  assert.equal(await n(U.admin32), 1, "คลังต้นทาง");
  assert.equal(await n(U.exec), 1);
  assert.equal(await n(U.emp5), 0);
});
