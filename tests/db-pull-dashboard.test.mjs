// ทดสอบภาพรวมทุกคลัง (Dashboard ผู้บริหาร) และเวลาพัก บน Postgres จำลอง
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, WH5, WH32, setup, as, rows } from "./helpers.mjs";

const q1 = async (db, sql, params) => (await db.query(sql, params)).rows[0];

// WH5: RT รับ 25 พาเลท/ชม. 8 ชม. ยอดงานรับวันนี้กะเช้า 400 → ต้องการ 2 คน
// WH32: เปิดทักษะแต่ยังไม่ผูกงาน → คำนวณไม่ได้
// emp5 / sup5 (WH5) และ emp32 (WH32) เข้ากะเช้า 08:00 วันนี้ · จอง emp32 และ emp5 เข้า WH5
async function world() {
  const db = await setup();
  await db.exec(`
    insert into public.dropdown_options (category, value, label, extra) values ('shift_type', 'D8', '08:00-17:00', '{"start_time":"08:00","end_time":"17:00"}');
    insert into public.skills (position, name) values ('RT', 'RT รับ');
    insert into public.employee_skills (user_id, skill_id) select u, (select id from public.skills where name = 'RT รับ')
      from unnest(array['${U.emp5}', '${U.emp32}', '${U.sup5}']::uuid[]) u;
  `);
  const d = (await q1(db, `select public.pull_today()::text as d`)).d;
  await db.query(`insert into public.shift_schedules (user_id, work_date, shift_code) select u, $1, 'D8' from unnest($2::uuid[]) u`, [d, [U.emp5, U.emp32, U.sup5]]);
  await as(db, U.super, async () => {
    await db.query(`select public.set_pull_skills($1, '{RT รับ}')`, [WH5]);
    await db.query(`select public.set_pull_skills($1, '{RT รับ}')`, [WH32]);
    const t = (await q1(db, `select public.save_pull_workload_type(null, $1, 'งานรับ', 'pallet', 1, true) as id`, [WH5])).id;
    await db.query(`select public.set_pull_type_skills($1, '{RT รับ}')`, [t]);
    const k = (await q1(db, `select id from public.pull_tasks where workload_type_id = $1`, [t])).id;
    await db.query(`select public.set_pull_rates($1, '2000-01-01', $2)`, [WH5, JSON.stringify([{ task_id: k, per_hour: 25 }])]);
    await db.query(`select public.set_pull_shift_hours($1, '2000-01-01', 8, 8)`, [WH5]);
    await db.query(`select public.save_pull_workloads($1, $2, 'morning', $3)`, [WH5, d, JSON.stringify([{ type_id: t, volume: 400 }])]);
  });
  await as(db, U.sup5, () => db.query(`select public.book_pull($1, $2, 'morning', $3)`, [WH5, d, JSON.stringify([{ user_id: U.emp32, skill: "RT รับ" }])]));
  return { db, d };
}
const net = (db, uid, d, shift = "morning", to = d) =>
  as(db, uid, async () => Object.fromEntries((await rows(db, `select * from public.pull_network($1, $2, $3)`, [d, to, shift])).map((r) => [r.wh_code, r])));

test("ภาพรวม: กำลังคน ความต้องการ จองแล้ว ดึงข้ามคลัง และยังขาด ต่อคลัง", async () => {
  const { db, d } = await world();
  let n = await net(db, U.exec, d);
  assert.deepEqual(
    { pool: n.WH5.pool_count, need: n.WH5.need, complete: n.WH5.complete, booked: n.WH5.booked, in: n.WH5.pulled_in, out: n.WH5.lent_out, short: n.WH5.short },
    { pool: 2, need: 2, complete: true, booked: 1, in: 1, out: 0, short: 1 },
  );
  assert.deepEqual(
    { pool: n.WH32.pool_count, need: n.WH32.need, complete: n.WH32.complete, booked: n.WH32.booked, out: n.WH32.lent_out, short: n.WH32.short },
    { pool: 1, need: null, complete: false, booked: 0, out: 1, short: null },
    "คลังที่ยังคำนวณไม่ได้ = ไม่มีตัวเลข (ไม่ตีเป็น 0)",
  );
  // จองครบ → ยังขาด 0
  await as(db, U.sup5, () => db.query(`select public.book_pull($1, $2, 'morning', $3)`, [WH5, d, JSON.stringify([{ user_id: U.emp5, skill: "RT รับ" }])]));
  n = await net(db, U.exec, d);
  assert.equal(n.WH5.booked, 2);
  assert.equal(n.WH5.short, 0);
  // ลา: ไม่นับในกำลังคน และนับในจำนวนคนลา
  await db.query(`insert into public.leave_requests (user_id, leave_type, start_date, end_date, days, status) values ($1, 'sick', $2, $2, 1, 'approved')`, [U.sup5, d]);
  n = await net(db, U.exec, d);
  assert.equal(n.WH5.pool_count, 1);
  assert.equal(n.WH5.on_leave, 1);
});

test("ภาพรวม: ทั้งวัน (รวม 2 กะ) และย้อนหลังหลายวัน", async () => {
  const { db, d } = await world();
  const all = await net(db, U.exec, d, "all");
  assert.equal(all.WH5.need, null, "กะดึกยังไม่กรอกยอดงาน → รวมทั้งวันคำนวณไม่ได้");
  assert.equal(all.WH5.booked, 1);
  const days = await as(db, U.exec, () => rows(db, `select work_day::text, wh_code from public.pull_network($1::date - 6, $1::date, 'morning') order by 1, 2`, [d]));
  assert.equal(days.length, 14, "7 วัน × 2 คลัง");
  assert.equal(days.at(-1).work_day, d);
});

test("ภาพรวม: สิทธิ์ (หัวหน้างานขึ้นไป) และช่วงวันที่", async () => {
  const { db, d } = await world();
  assert.equal(Object.keys(await net(db, U.sup5, d)).length, 2, "หัวหน้างานเห็นตัวเลขรวมทุกคลังเหมือนแอดมิน");
  await assert.rejects(net(db, U.emp5, d), /ไม่มีสิทธิ์/);
  assert.equal(Object.keys(await net(db, U.admin5, d)).length, 2, "แอดมินเห็นตัวเลขรวมทุกคลัง");
  await assert.rejects(as(db, U.exec, () => db.query(`select * from public.pull_network($1::date - 40, $1::date, 'morning')`, [d])), /ไม่เกิน 31 วัน/);
  await assert.rejects(net(db, U.exec, d, "evening"), /กะไม่ถูกต้อง/);
  // ฟังก์ชันแกนเรียกตรงไม่ได้ (ข้ามการตรวจสิทธิ์)
  await assert.rejects(as(db, U.emp5, () => db.query(`select * from public.pull_requirements_core($1, $2, 'morning')`, [WH5, d])), /permission denied/);
});

test("เวลาพัก: คลังปลายทางตั้ง/ล้างได้ ตรวจรูปแบบเวลา", async () => {
  const { db } = await world();
  const id = (await q1(db, `select id from public.pull_bookings where user_id = $1`, [U.emp32])).id;
  await as(db, U.sup5, () => db.query(`select public.set_pull_break($1, '12:00')`, [id]));
  assert.equal((await q1(db, `select break_time::text as t from public.pull_bookings where id = $1`, [id])).t, "12:00:00");
  // แจ้งพนักงาน · ตั้งค่าเดิมซ้ำไม่แจ้งซ้ำ · เปลี่ยนเวลาแจ้งใหม่ · ล้างเวลาพักไม่แจ้ง
  const brk = () => rows(db, `select user_id, title, link from public.notifications where kind = 'pull_break' order by id`);
  assert.deepEqual(await brk(), [{ user_id: U.emp32, title: "เวลาพักของคุณ: พัก 12:00", link: "/my-position" }]);
  await as(db, U.sup5, () => db.query(`select public.set_pull_break($1, '12:00')`, [id]));
  assert.equal((await brk()).length, 1);
  await as(db, U.sup5, () => db.query(`select public.set_pull_break($1, '13:00')`, [id]));
  assert.deepEqual((await brk()).map((n) => n.title), ["เวลาพักของคุณ: พัก 12:00", "เวลาพักของคุณ: พัก 13:00"]);
  // พนักงานเห็นเวลาพักของตัวเอง (RLS) แต่ไม่เห็นของคนอื่น
  assert.equal((await as(db, U.emp32, () => rows(db, `select break_time::text as t from public.pull_bookings`)))[0].t, "13:00:00");
  assert.equal((await as(db, U.emp5, () => rows(db, `select 1 from public.pull_bookings`))).length, 0);
  await assert.rejects(as(db, U.admin32, () => db.query(`select public.set_pull_break($1, '11:00')`, [id])), /เฉพาะคลังที่จอง/);
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.set_pull_break($1, '25:00')`, [id])), /ไม่ถูกต้อง/);
  await as(db, U.sup5, () => db.query(`select public.set_pull_break($1, null)`, [id]));
  assert.equal((await q1(db, `select break_time from public.pull_bookings where id = $1`, [id])).break_time, null);
  assert.equal((await brk()).length, 2);
  await as(db, U.sup5, () => db.query(`select public.cancel_pull_booking($1, 'จองผิด')`, [id]));
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.set_pull_break($1, '11:00')`, [id])), /ไม่พบรายการ/);
});
