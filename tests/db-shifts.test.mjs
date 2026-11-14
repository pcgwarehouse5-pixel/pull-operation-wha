// ทดสอบสิทธิ์ของโมดูล 2 (ตารางกะ) บน Postgres จำลอง
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, WH5, WH32, setup, as, rows } from "./helpers.mjs";

async function withCodes() {
  const db = await setup();
  await db.exec(`
    insert into public.dropdown_options (category, value, label, extra) values
      ('shift_type', 'STD1', '08:00-17:00', '{"start_time":"08:00","end_time":"17:00"}'),
      ('shift_type', 'GN_5', '20:00-05:00', '{"start_time":"20:00","end_time":"05:00"}'),
      ('shift_type', 'OFF', 'หยุด', '{}'),
      ('shift_type', 'HOL', 'นักขัตฤกษ์', '{}');
  `);
  return db;
}
const put = (db, uid, user, date, code, extra = {}) =>
  as(db, uid, () =>
    db.query(
      `insert into public.shift_schedules (user_id, work_date, shift_code, holiday_work) values ($1, $2, $3, $4)
       on conflict (user_id, work_date) do update set shift_code = excluded.shift_code, holiday_work = excluded.holiday_work`,
      [user, date, code, extra.holiday_work ?? null],
    ),
  );
const seen = (db, uid) => as(db, uid, () => rows(db, `select user_id, work_date::text as d, shift_code from public.shift_schedules order by user_id, work_date`));

test("ตารางกะ: หัวหน้างาน/แอดมินแก้ได้เฉพาะคลังที่ดูแล พนักงานแก้ไม่ได้", async () => {
  const db = await withCodes();
  await put(db, U.sup5, U.emp5, "2026-12-01", "STD1");
  await put(db, U.admin5, U.emp5, "2026-12-02", "GN_5");
  await assert.rejects(put(db, U.sup5, U.emp32, "2026-12-01", "STD1"), /row-level security/);
  await assert.rejects(put(db, U.emp5, U.emp5, "2026-12-03", "STD1"), /row-level security/);
  await put(db, U.exec, U.emp32, "2026-12-01", "OFF");
  await assert.rejects(put(db, U.sup5, U.emp5, "2026-12-04", "XYZ"), /ไม่รู้จักรหัสกะ/);
  const by = (await rows(db, `select updated_by from public.shift_schedules where user_id = $1 and work_date = '2026-12-02'`, [U.emp5]))[0];
  assert.equal(by.updated_by, U.admin5, "บันทึกว่าใครแก้ล่าสุด");
  // ลบได้เฉพาะคลังที่ดูแล
  const del = await as(db, U.admin32, () => db.query(`delete from public.shift_schedules where user_id = $1`, [U.emp5]));
  assert.equal(del.affectedRows, 0);
});

test("ตารางกะ: พนักงานเห็นเฉพาะกะของตัวเองในเดือนที่ประกาศแล้ว (ไม่เห็นเพื่อนร่วมคลัง)", async () => {
  const db = await withCodes();
  await put(db, U.sup5, U.emp5, "2026-12-01", "STD1");
  await put(db, U.sup5, U.sup5, "2026-12-01", "GN_5");
  await put(db, U.admin32, U.emp32, "2026-12-01", "STD1");

  assert.equal((await seen(db, U.emp5)).length, 0, "เดือนยังเป็นร่าง พนักงานยังไม่เห็น");
  assert.equal((await seen(db, U.sup5)).length, 2, "หัวหน้างานเห็นร่างของคลังตัวเอง");
  await assert.rejects(as(db, U.emp5, () => db.query(`select public.set_schedule_status($1, '2026-12-01', 'published')`, [WH5])), /ไม่มีสิทธิ์/);

  await as(db, U.sup5, () => db.query(`select public.set_schedule_status($1, '2026-12-15', 'published')`, [WH5]));
  const mine = await seen(db, U.emp5);
  assert.deepEqual(mine.map((r) => r.user_id), [U.emp5], "เห็นเฉพาะของตัวเอง ไม่เห็นเพื่อนร่วมคลัง");
  assert.ok(!mine.some((r) => r.user_id === U.emp32), "ไม่เห็นคลังอื่น");
  assert.equal((await seen(db, U.emp32)).length, 0, "คลัง 32 ยังไม่ประกาศ พนักงานคลัง 32 ไม่เห็นแม้แต่ของตัวเอง");

  // team_schedule (หน้าตารางกะของฉัน) คืนเฉพาะกะของตัวเอง
  const team = await as(db, U.emp5, () => rows(db, `select first_name_th, shift_code from public.team_schedule('2026-12-01') order by first_name_th`));
  assert.deepEqual(team, [{ first_name_th: "ชื่อ E5", shift_code: "STD1" }]);
  const cols = Object.keys((await as(db, U.emp5, () => rows(db, `select * from public.team_schedule('2026-12-01')`)))[0]);
  assert.ok(!cols.includes("phone") && !cols.includes("salary_code") && !cols.includes("employee_code"), "ไม่มีข้อมูลส่วนตัวอื่น");
  assert.equal((await as(db, U.emp32, () => rows(db, `select * from public.team_schedule('2026-12-01')`))).length, 0);

  // กลับเป็นร่าง → พนักงานไม่เห็นอีก
  await as(db, U.sup5, () => db.query(`select public.set_schedule_status($1, '2026-12-01', 'draft')`, [WH5]));
  assert.equal((await seen(db, U.emp5)).length, 0);
  const logs = await rows(db, `select action from public.audit_logs where table_name = 'schedule_months' order by id`);
  assert.deepEqual(logs.map((l) => l.action), ["schedule_publish", "schedule_unpublish"]);
});

test("ตารางกะ: บันทึกประวัติเฉพาะการเปลี่ยน/ลบ พร้อมกะเดิมและกะใหม่", async () => {
  const db = await withCodes();
  await put(db, U.sup5, U.emp5, "2026-12-01", "STD1");
  await put(db, U.sup5, U.emp5, "2026-12-01", "STD1"); // ไม่มีอะไรเปลี่ยน
  await put(db, U.sup5, U.emp5, "2026-12-01", "GN_5", { holiday_work: "HOL" });
  await as(db, U.sup5, () => db.query(`delete from public.shift_schedules where user_id = $1`, [U.emp5]));
  const logs = await rows(db, `select action, actor_id, old_data->>'shift' as f, new_data->>'shift' as t, new_data->>'holiday_work' as hw, warehouse_id from public.audit_logs where table_name = 'shift_schedules' order by id`);
  assert.deepEqual(logs, [
    { action: "shift_change", actor_id: U.sup5, f: "STD1", t: "GN_5", hw: "HOL", warehouse_id: WH5 },
    { action: "shift_delete", actor_id: U.sup5, f: "GN_5", t: null, hw: null, warehouse_id: WH5 },
  ]);
});

test("ตารางกะ: ล้างทั้งเดือนต้องมีเหตุผล เก็บสำเนา และย้อนคืนได้", async () => {
  const db = await withCodes();
  for (const d of ["2026-12-01", "2026-12-02", "2026-12-31"]) await put(db, U.sup5, U.emp5, d, "STD1");
  await put(db, U.sup5, U.emp5, "2027-01-01", "OFF");
  await put(db, U.admin32, U.emp32, "2026-12-01", "STD1");

  await assert.rejects(as(db, U.sup5, () => db.query(`select public.clear_schedule_month($1, '2026-12-01', '')`, [WH5])), /เหตุผล/);
  await assert.rejects(as(db, U.admin32, () => db.query(`select public.clear_schedule_month($1, '2026-12-01', 'ผิด')`, [WH5])), /ไม่มีสิทธิ์/);
  const n = (await as(db, U.sup5, () => rows(db, `select public.clear_schedule_month($1, '2026-12-10', 'วางกะใหม่') as n`, [WH5])))[0].n;
  assert.equal(n, 3, "ล้างเฉพาะเดือน ธ.ค. ของคลัง 5");
  assert.equal((await rows(db, `select count(*)::int as c from public.shift_schedules`))[0].c, 2, "เหลือ ม.ค. ของคลัง 5 และคลัง 32");
  assert.equal((await rows(db, `select count(*)::int as c from public.audit_logs where action = 'shift_delete'`))[0].c, 0, "ไม่บันทึกทีละช่อง");

  const log = (await rows(db, `select id, jsonb_array_length(old_data->'rows') as n from public.audit_logs where action = 'schedule_clear'`))[0];
  assert.equal(log.n, 3);
  // ใส่กะใหม่ไปแล้ว 1 วัน → ย้อนคืนไม่ทับ
  await put(db, U.sup5, U.emp5, "2026-12-01", "GN_5");
  const restored = (await as(db, U.sup5, () => rows(db, `select public.restore_schedule_month($1) as n`, [log.id])))[0].n;
  assert.equal(restored, 2);
  const dec = await rows(db, `select work_date::text as d, shift_code from public.shift_schedules where user_id = $1 and work_date < '2027-01-01' order by 1`, [U.emp5]);
  assert.deepEqual(dec, [{ d: "2026-12-01", shift_code: "GN_5" }, { d: "2026-12-02", shift_code: "STD1" }, { d: "2026-12-31", shift_code: "STD1" }]);
  await assert.rejects(as(db, U.emp5, () => db.query(`select public.restore_schedule_month($1)`, [log.id])), /ไม่มีสิทธิ์/);
});

test("ปฏิทินวันหยุด: ทุกคนดูได้ แอดมินคลังขึ้นไปแก้ได้ (มีผลกับ OT ทุกคลัง)", async () => {
  const db = await setup();
  await as(db, U.admin5, () => db.query(`insert into public.holidays (holiday_date, name) values ('2026-12-05', 'วันพ่อแห่งชาติ (ตัวอย่าง)')`));
  await assert.rejects(as(db, U.sup5, () => db.query(`insert into public.holidays (holiday_date, name) values ('2026-12-10', 'x')`)), /row-level security/, "หัวหน้างานแก้วันหยุดไม่ได้");
  await assert.rejects(as(db, U.emp5, () => db.query(`insert into public.holidays (holiday_date, name) values ('2026-12-10', 'x')`)), /row-level security/);
  await assert.rejects(as(db, U.admin5, () => db.query(`insert into public.holidays (holiday_date, name) values ('2026-12-05', 'ซ้ำ')`)), /duplicate/);
  assert.equal((await as(db, U.emp5, () => rows(db, `select * from public.holidays`))).length, 1);
});

test("สถานะเดือน: พนักงานเห็นสถานะของคลังตัวเองเท่านั้น และแก้ตรงๆ ไม่ได้", async () => {
  const db = await withCodes();
  await as(db, U.admin32, () => db.query(`select public.set_schedule_status($1, '2026-12-01', 'published')`, [WH32]));
  await as(db, U.admin5, () => db.query(`select public.set_schedule_status($1, '2026-12-01', 'published')`, [WH5]));
  assert.equal((await as(db, U.emp5, () => rows(db, `select warehouse_id from public.schedule_months`))).length, 1);
  await assert.rejects(as(db, U.admin5, () => db.query(`update public.schedule_months set status = 'draft'`)), /permission denied/);
});

test("บันทึกหลายช่อง: เก็บค่าเดิม เปลี่ยนเฉพาะที่ต่าง และย้อนกลับได้โดยไม่ทับงานที่แก้ต่อ", async () => {
  const db = await withCodes();
  await put(db, U.sup5, U.emp5, "2026-12-01", "STD1");
  await put(db, U.sup5, U.emp5, "2026-12-02", "STD1");
  const apply = (uid, wh, list) => as(db, uid, () => rows(db, `select public.apply_shifts($1, $2::jsonb, 'test') as n`, [wh, JSON.stringify(list)]));
  const cells = [
    { user_id: U.emp5, work_date: "2026-12-01", shift_code: "STD1" }, // เหมือนเดิม
    { user_id: U.emp5, work_date: "2026-12-02", shift_code: "GN_5", holiday_work: "OFF" },
    { user_id: U.emp5, work_date: "2026-12-03", shift_code: "OFF" },
    { user_id: U.sup5, work_date: "2026-12-01", shift_code: "STD1" },
    { user_id: U.sup5, work_date: "2026-12-09", shift_code: null }, // ลบช่องที่ว่างอยู่แล้ว = ไม่นับ
  ];
  await assert.rejects(apply(U.emp5, WH5, cells), /ไม่มีสิทธิ์/);
  await assert.rejects(apply(U.sup5, WH5, [...cells, { user_id: U.emp32, work_date: "2026-12-01", shift_code: "STD1" }]), /ไม่ได้อยู่ในคลังนี้/);
  await assert.rejects(apply(U.sup5, WH5, [{ user_id: U.emp5, work_date: "2026-12-05", shift_code: "XYZ" }]), /ไม่รู้จักรหัสกะ/);
  assert.equal((await apply(U.sup5, WH5, cells))[0].n, 3);
  assert.equal((await rows(db, `select count(*)::int as c from public.audit_logs where action = 'shift_change'`))[0].c, 0, "ไม่บันทึกทีละช่อง");
  const log = (await rows(db, `select id, new_data->>'count' as n from public.audit_logs where action = 'schedule_bulk'`))[0];
  assert.equal(log.n, "3");

  // มีคนแก้วันที่ 3 ต่อ → ย้อนกลับไม่แตะวันที่ 3
  await put(db, U.sup5, U.emp5, "2026-12-03", "STD1");
  const n = (await as(db, U.sup5, () => rows(db, `select public.undo_shift_bulk($1) as n`, [log.id])))[0].n;
  assert.equal(n, 2);
  const now = await rows(db, `select user_id, work_date::text as d, shift_code, holiday_work from public.shift_schedules order by user_id, work_date`);
  assert.deepEqual(now.filter((r) => r.user_id === U.emp5).map((r) => [r.d, r.shift_code, r.holiday_work]), [
    ["2026-12-01", "STD1", null],
    ["2026-12-02", "STD1", null],
    ["2026-12-03", "STD1", null],
  ]);
  assert.ok(!now.some((r) => r.user_id === U.sup5), "ช่องที่เพิ่มใหม่ถูกลบออก");
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.undo_shift_bulk($1)`, [log.id])), /ย้อนกลับไปแล้ว/);
  await assert.rejects(as(db, U.admin32, () => db.query(`select public.undo_shift_bulk($1)`, [log.id])), /ไม่มีสิทธิ์/);
});

test("ประวัติตารางกะ: หัวหน้างานเห็นของคลังตัวเอง พร้อมสถานะย้อนกลับ", async () => {
  const db = await withCodes();
  await as(db, U.sup5, () => db.query(`select public.apply_shifts($1, $2::jsonb, 'auto_plan')`, [WH5, JSON.stringify([{ user_id: U.emp5, work_date: "2026-12-01", shift_code: "STD1" }])]));
  await as(db, U.admin5, () => db.query(`select public.clear_schedule_month($1, '2026-12-01', 'ทดลอง')`, [WH5]));
  const h = await as(db, U.sup5, () => rows(db, `select action, actor_name, count, source, reason, undone from public.schedule_history($1, '2026-12-01')`, [WH5]));
  assert.deepEqual(h.map((r) => [r.action, r.count, r.source, r.reason, r.undone]), [["schedule_clear", 1, null, "ทดลอง", false], ["schedule_bulk", 1, "auto_plan", null, false]]);
  assert.equal(h[1].actor_name, "ชื่อ S5");
  assert.equal((await as(db, U.admin32, () => rows(db, `select * from public.schedule_history($1, '2026-12-01')`, [WH5]))).length, 0);
});

test("ลำดับกลุ่มตำแหน่ง: หัวหน้าของคลังจัดได้ ใช้ร่วมกันในคลัง คลังอื่น/พนักงานแก้ไม่ได้", async () => {
  const db = await setup();
  await as(db, U.sup5, () => db.query(`select public.set_group_order($1, $2)`, [WH5, ["Checker", "RT"]]));
  const read = (uid) => as(db, uid, () => rows(db, `select positions from public.schedule_group_order where warehouse_id = $1`, [WH5]));
  assert.deepEqual((await read(U.admin5))[0].positions, ["Checker", "RT"], "คนอื่นในคลังเห็นลำดับเดียวกัน");
  await as(db, U.admin5, () => db.query(`select public.set_group_order($1, $2)`, [WH5, ["RT", "Checker"]]));
  assert.deepEqual((await read(U.sup5))[0].positions, ["RT", "Checker"]);
  await assert.rejects(as(db, U.emp5, () => db.query(`select public.set_group_order($1, '{}')`, [WH5])), /ไม่มีสิทธิ์/);
  await assert.rejects(as(db, U.admin32, () => db.query(`select public.set_group_order($1, '{}')`, [WH5])), /ไม่มีสิทธิ์/);
  assert.equal((await read(U.admin32)).length, 0);
  await assert.rejects(as(db, U.sup5, () => db.query(`update public.schedule_group_order set positions = '{}'`)), /permission denied/);
});

test("ลำดับรายชื่อในกลุ่ม: หัวหน้าของคลังจัดได้ เก็บเฉพาะคนในคลัง ไม่ทับลำดับกลุ่ม", async () => {
  const db = await setup();
  await as(db, U.sup5, () => db.query(`select public.set_group_order($1, $2)`, [WH5, ["Checker", "RT"]]));
  // ส่งคนคลังอื่นและคนซ้ำมาด้วย → ตัดทิ้ง เหลือเฉพาะคนคลัง 5 ตามลำดับ
  await as(db, U.sup5, () => db.query(`select public.set_member_order($1, $2)`, [WH5, [U.emp5, U.emp32, U.sup5, U.emp5]]));
  const read = (uid) => as(db, uid, () => rows(db, `select positions, members from public.schedule_group_order where warehouse_id = $1`, [WH5]));
  assert.deepEqual((await read(U.admin5))[0], { positions: ["Checker", "RT"], members: [U.emp5, U.sup5] });
  await as(db, U.admin5, () => db.query(`select public.set_member_order($1, $2)`, [WH5, [U.sup5, U.emp5]]));
  assert.deepEqual((await read(U.sup5))[0].members, [U.sup5, U.emp5]);
  assert.deepEqual((await read(U.sup5))[0].positions, ["Checker", "RT"], "ลำดับกลุ่มยังอยู่");
  await assert.rejects(as(db, U.emp5, () => db.query(`select public.set_member_order($1, '{}')`, [WH5])), /ไม่มีสิทธิ์/);
  await assert.rejects(as(db, U.admin32, () => db.query(`select public.set_member_order($1, '{}')`, [WH5])), /ไม่มีสิทธิ์/);
  // คลังที่ยังไม่มีแถว: สร้างใหม่ได้
  await as(db, U.admin32, () => db.query(`select public.set_member_order($1, $2)`, [WH32, [U.emp32]]));
  assert.deepEqual((await as(db, U.admin32, () => rows(db, `select positions, members from public.schedule_group_order where warehouse_id = $1`, [WH32])))[0], { positions: [], members: [U.emp32] });
});
