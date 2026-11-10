// ทดสอบบทบาทผู้จัดการ 4 ระดับ: สิทธิ์ทุกคลัง การให้บทบาท ลำดับอนุมัติระดับถัดไป และผู้จัดการฝ่ายขึ้นไปไม่ลงเวลา
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, WH5, WH32, setup, as, rows } from "./helpers.mjs";

const M = {
  dept: "00000000-0000-0000-0000-000000000011", // ผู้จัดการแผนก (สังกัด WH5)
  div: "00000000-0000-0000-0000-000000000012", // ผู้จัดการฝ่าย
  deputy: "00000000-0000-0000-0000-000000000013", // รองผู้จัดการทั่วไป
  gm: "00000000-0000-0000-0000-000000000014", // ผู้จัดการทั่วไป
};
const q1 = async (db, sql, params) => (await db.query(sql, params)).rows[0];

async function world() {
  const db = await setup();
  for (const [id, code, role, wh] of [[M.dept, "DM", "dept_manager", WH5], [M.div, "DV", "division_manager", null], [M.deputy, "DG", "deputy_gm", null], [M.gm, "GM", "gm", null]]) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${code.toLowerCase()}@wha.local`]);
    await db.query(`insert into public.profiles (id, employee_code, first_name_th, role, warehouse_id) values ($1, $2, $3, $4, $5)`, [id, code, `ชื่อ ${code}`, role, wh]);
  }
  await db.exec(`
    insert into public.dropdown_options (category, value, label, extra) values
      ('shift_type', 'STD1', '08:00-17:00', '{"start_time":"08:00","end_time":"17:00"}'),
      ('leave_type', 'sick', 'ป่วย', '{}'), ('leave_type', 'vacation', 'พักผ่อน', '{}');
  `);
  return db;
}
const submit = (db, uid, type, s, e) =>
  as(db, uid, () => rows(db, `select public.submit_leave($1, $2, $3, 'full', 'ทดสอบ') as id`, [type, s, e])).then((r) => r[0].id);
const decide = (db, uid, id, ok = true, note = null) => as(db, uid, () => rows(db, `select public.decide_leave($1, $2, $3) as s`, [id, ok, note])).then((r) => r[0].s);
const canApprove = (db, uid, target) => as(db, uid, async () => (await q1(db, `select public.can_approve_user($1) as ok`, [target])).ok);
const inboxKinds = (db, uid) => rows(db, `select kind from public.notifications where user_id = $1 order by id`, [uid]).then((r) => r.map((x) => x.kind));
const access = (db, uid, target, role, home = WH5) => as(db, uid, () => db.query(`select public.set_user_access($1, $2, $3)`, [target, role, home]));

test("ผู้จัดการทุกระดับ: เห็นและจัดการได้ทุกคลัง เพิ่มคลังและแก้ตัวเลือกได้", async () => {
  const db = await world();
  for (const m of Object.values(M)) {
    assert.equal((await as(db, m, () => rows(db, `select 1 from public.profiles`))).length, 11, "เห็นทุกคน");
    assert.equal((await as(db, m, () => q1(db, `select public.can_manage_warehouse($1) as ok`, [WH32]))).ok, true);
  }
  await as(db, M.dept, () => db.query(`insert into public.warehouses (code, name) values ('WH29', 'คลัง 29')`));
  await as(db, M.dept, () => db.query(`insert into public.dropdown_options (category, value, label) values ('position', 'ใหม่', 'ใหม่')`));
  await assert.rejects(as(db, U.admin5, () => db.query(`insert into public.warehouses (code, name) values ('WHX', 'x')`)), /row-level security/, "แอดมินยังเพิ่มคลังไม่ได้");
  await assert.rejects(as(db, U.exec, () => db.query(`insert into public.warehouses (code, name) values ('WHY', 'y')`)), /row-level security/, "ผู้บริหารเดิมไม่ได้เพิ่มสิทธิ์นี้");
});

test("ให้บทบาท: ได้ต่ำกว่าตัวเองลงไป และแก้คนระดับเท่ากัน/สูงกว่าไม่ได้", async () => {
  const db = await world();
  await assert.rejects(access(db, U.admin5, U.emp5, "dept_manager"), /กำหนดบทบาทนี้ไม่ได้/);
  await access(db, M.dept, U.emp5, "admin");
  await assert.rejects(access(db, M.dept, U.emp32, "dept_manager", WH32), /กำหนดบทบาทนี้ไม่ได้/);
  await access(db, M.div, U.emp32, "dept_manager", WH32);
  await assert.rejects(access(db, M.div, U.sup5, "division_manager", null), /กำหนดบทบาทนี้ไม่ได้/);
  await access(db, M.deputy, U.sup5, "division_manager", null);
  await access(db, M.gm, U.admin32, "deputy_gm", null);
  await assert.rejects(access(db, M.gm, U.admin5, "gm", null), /กำหนดบทบาทนี้ไม่ได้/);
  await assert.rejects(access(db, M.dept, M.div, "employee"), /เท่ากับหรือสูงกว่า/);
  await assert.rejects(access(db, M.gm, U.emp5, "executive"), /เลิกใช้แล้ว/);
});

test("อนุมัติระดับถัดไป: ใครอนุมัติคำขอของใครได้", async () => {
  const db = await world();
  const ok = (by, of) => canApprove(db, by, of);
  // พนักงาน ← หัวหน้างาน/แอดมินของคลัง หรือผู้จัดการ
  assert.equal(await ok(U.sup5, U.emp5), true);
  assert.equal(await ok(U.admin5, U.emp5), true);
  assert.equal(await ok(U.admin32, U.emp5), false, "คลังอื่น");
  assert.equal(await ok(M.dept, U.emp32), true, "ผู้จัดการอนุมัติได้ทุกคลัง");
  // หัวหน้างาน/แอดมิน ← ผู้จัดการแผนกขึ้นไป
  assert.equal(await ok(U.admin5, U.sup5), false);
  assert.equal(await ok(M.dept, U.sup5), true);
  assert.equal(await ok(M.dept, U.admin5), true);
  // ผู้จัดการแผนก ← ผู้จัดการฝ่ายขึ้นไป
  assert.equal(await ok(U.admin5, M.dept), false);
  assert.equal(await ok(M.div, M.dept), true);
  assert.equal(await ok(M.dept, M.dept), false, "ของตัวเอง");
  // ผู้จัดการฝ่ายขึ้นไปไม่มีคำขอให้อนุมัติ
  assert.equal(await ok(M.gm, M.div), false);
});

test("ใบลา: หัวหน้างานลา → ผู้จัดการแผนกอนุมัติ / ลายาวต้องผ่านผู้จัดการ / ผู้จัดการแผนกลา → ผู้จัดการฝ่าย", async () => {
  const db = await world();
  const a = await submit(db, U.sup5, "sick", "2026-12-01", "2026-12-01");
  await assert.rejects(decide(db, U.admin5, a), /ระดับที่สูงกว่า/);
  assert.equal(await decide(db, M.dept, a), "approved");

  const b = await submit(db, U.emp5, "vacation", "2026-12-10", "2026-12-14");
  assert.equal(await decide(db, U.sup5, b), "pending");
  await assert.rejects(decide(db, U.admin5, b), /ผู้จัดการแผนกขึ้นไป/);
  assert.equal(await decide(db, M.dept, b), "approved");

  const c = await submit(db, M.dept, "sick", "2026-12-20", "2026-12-20");
  await assert.rejects(decide(db, U.admin5, c), /ระดับที่สูงกว่า/);
  assert.equal(await decide(db, M.div, c), "approved");
});

test("แจ้งเตือนไปที่ระดับที่อนุมัติได้ต่ำสุด", async () => {
  const db = await world();
  await submit(db, U.emp5, "sick", "2026-12-01", "2026-12-01");
  assert.deepEqual(await inboxKinds(db, U.sup5), ["leave_pending"]);
  assert.deepEqual(await inboxKinds(db, U.admin5), ["leave_pending"]);
  assert.deepEqual(await inboxKinds(db, M.dept), [], "ใบลาพนักงานไม่รบกวนผู้จัดการ");
  await submit(db, U.sup5, "sick", "2026-12-02", "2026-12-02");
  assert.deepEqual(await inboxKinds(db, M.dept), ["leave_pending"]);
  assert.deepEqual(await inboxKinds(db, U.admin5), ["leave_pending"], "แอดมินไม่ได้รับใบลาของหัวหน้างาน");
  await submit(db, M.dept, "sick", "2026-12-03", "2026-12-03");
  assert.deepEqual(await inboxKinds(db, M.div), ["leave_pending"]);
  assert.deepEqual(await inboxKinds(db, M.gm), [], "ไม่ข้ามไปถึงผู้จัดการทั่วไป");
});

test("ผู้จัดการฝ่ายขึ้นไป: ไม่อยู่ในตารางกะ ไม่ลงเวลา ไม่มี OT ไม่ใช้ระบบลา", async () => {
  const db = await world();
  const flags = await q1(db, `select exclude_from_shift, ot_eligible, travel_eligible, auto_check_in from public.profiles where id = $1`, [M.div]);
  assert.deepEqual(flags, { exclude_from_shift: true, ot_eligible: false, travel_eligible: false, auto_check_in: false });
  await assert.rejects(submit(db, M.div, "sick", "2026-12-01", "2026-12-01"), /ไม่ใช้ระบบลา/);
  await assert.rejects(as(db, M.gm, () => db.query(`select public.punch('in', 13, 100, 10)`)), /ไม่ต้องลงเวลา/);
  // ผู้จัดการแผนกยังลงเวลาและลาได้ตามปกติ
  const f2 = await q1(db, `select exclude_from_shift, ot_eligible from public.profiles where id = $1`, [M.dept]);
  assert.deepEqual(f2, { exclude_from_shift: false, ot_eligible: true });
  // เลื่อนขึ้นเป็นผู้จัดการฝ่าย: กะตั้งแต่วันนี้ถูกลบ กะที่ผ่านมาเก็บไว้ และแก้ช่องให้ลงเวลากลับไม่ได้
  const d = (await q1(db, `select (now() at time zone 'Asia/Bangkok')::date::text as d`)).d;
  await db.query(`insert into public.shift_schedules (user_id, work_date, shift_code) values ($1, $2::date - 3, 'STD1'), ($1, $2::date, 'STD1'), ($1, $2::date + 5, 'STD1')`, [U.emp32, d]);
  await access(db, M.div, U.emp32, "dept_manager", WH32);
  await access(db, M.deputy, U.emp32, "division_manager", null);
  assert.equal((await q1(db, `select count(*)::int as n from public.shift_schedules where user_id = $1`, [U.emp32])).n, 1);
  await as(db, M.gm, () => db.query(`update public.profiles set ot_eligible = true, exclude_from_shift = false where id = $1`, [U.emp32]));
  assert.deepEqual(await q1(db, `select ot_eligible, exclude_from_shift from public.profiles where id = $1`, [U.emp32]), { ot_eligible: false, exclude_from_shift: true });
  // บันทึกกะให้ไม่ได้ (ข้ามโดยไม่ทำให้ทั้งชุดล้ม)
  await as(db, M.gm, () => db.query(`select public.apply_shifts($1, $2, 'test')`, [WH5, JSON.stringify([{ user_id: U.emp5, work_date: "2026-12-01", shift_code: "STD1" }])]));
  await db.query(`insert into public.shift_schedules (user_id, work_date, shift_code) values ($1, '2026-12-02', 'STD1')`, [M.div]);
  assert.equal((await q1(db, `select count(*)::int as n from public.shift_schedules where user_id = $1`, [M.div])).n, 0);
});
