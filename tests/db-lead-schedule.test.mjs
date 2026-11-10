// ทดสอบตารางกะหัวหน้าคลัง: แยกจากตารางกะปกติ แก้/ประกาศได้เฉพาะผู้จัดการ หัวหน้างาน/แอดมินดูได้ พนักงานไม่เห็น
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, WH5, setup, as, rows } from "./helpers.mjs";

const DM = "00000000-0000-0000-0000-000000000011"; // ผู้จัดการแผนก (WH5)
const LEAD = "00000000-0000-0000-0000-000000000021"; // ตำแหน่ง Supervisor แต่บทบาทพนักงาน (WH5)
const q1 = async (db, sql, params) => (await db.query(sql, params)).rows[0];

async function world() {
  const db = await setup();
  await db.query(`insert into auth.users (id, email) values ($1, 'dm@wha.local'), ($2, 'lead@wha.local')`, [DM, LEAD]);
  await db.query(`insert into public.profiles (id, employee_code, first_name_th, role, warehouse_id) values ($1, 'DM', 'ผู้จัดการ', 'dept_manager', $3), ($2, 'L1', 'หัวหน้าคลัง', 'employee', $3)`, [DM, LEAD, WH5]);
  await db.query(`update public.profiles set position = 'Supervisor' where id = $1`, [LEAD]);
  await db.exec(`insert into public.dropdown_options (category, value, label, extra) values ('shift_type', 'STD1', '08:00-17:00', '{"start_time":"08:00","end_time":"17:00"}')`);
  return db;
}
const apply = (db, uid, list) =>
  as(db, uid, () => db.query(`select public.apply_shifts($1, $2, 'test')`, [WH5, JSON.stringify(list.map((u) => ({ user_id: u, work_date: "2026-12-01", shift_code: "STD1" })))]));
const status = (db, uid, st, scope) => as(db, uid, () => db.query(`select public.set_schedule_status_scope($1, '2026-12-01', $2, $3)`, [WH5, st, scope]));

// อ่านจากตารางกะอย่างเดียว (ตารางรายชื่อมีสิทธิ์ของตัวเอง) แล้วแปลง id เป็นรหัสพนักงาน
const CODE = { [U.emp5]: "E5", [U.sup5]: "S5", [DM]: "DM", [LEAD]: "L1" };
const team = (db, uid) => as(db, uid, () => rows(db, `select user_id from public.team_schedule('2026-12-01')`)).then((r) => r.map((x) => CODE[x.user_id]).sort());
const seen = (db, uid) => as(db, uid, () => rows(db, `select user_id from public.shift_schedules`)).then((r) => r.map((x) => CODE[x.user_id]).sort());

test("ใครอยู่ในตารางกะหัวหน้าคลัง: ตำแหน่งในหน้าตั้งค่า + ผู้จัดการแผนก", async () => {
  const db = await world();
  const lead = async (id) => (await q1(db, `select public.is_lead($1) as v`, [id])).v;
  assert.equal(await lead(LEAD), true);
  assert.equal(await lead(DM), true);
  assert.equal(await lead(U.emp5), false);
  assert.equal(await lead(U.sup5), false, "บทบาทหัวหน้างานแต่ตำแหน่งไม่ใช่ Supervisor");
  await db.query(`update public.app_settings set value = '["Supervisor","Leader"]' where key = 'shifts.lead_positions'`);
  await db.query(`update public.profiles set position = 'Leader' where id = $1`, [U.emp5]);
  assert.equal(await lead(U.emp5), true, "เพิ่มตำแหน่งในหน้าตั้งค่าแล้วเข้าตารางทันที");
});

test("แก้กะหัวหน้าคลังได้เฉพาะผู้จัดการ · หัวหน้างาน/แอดมินแก้ตารางปกติได้ตามเดิม", async () => {
  const db = await world();
  await assert.rejects(apply(db, U.sup5, [LEAD]), /เฉพาะผู้จัดการ/);
  await assert.rejects(apply(db, U.admin5, [U.emp5, LEAD]), /เฉพาะผู้จัดการ/, "ทั้งชุดไม่บันทึก");
  assert.equal((await q1(db, `select count(*)::int as n from public.shift_schedules`)).n, 0);
  await apply(db, U.sup5, [U.emp5]);
  await apply(db, DM, [LEAD, DM]);
  await apply(db, U.exec, [U.sup5]);
  // แก้ตรงผ่านตาราง (RLS) ก็ไม่ได้
  await assert.rejects(as(db, U.admin5, () => db.query(`insert into public.shift_schedules (user_id, work_date, shift_code) values ($1, '2026-12-02', 'STD1')`, [LEAD])), /row-level security/);
  // ประกาศ/ล้างตารางหัวหน้าคลัง: เฉพาะผู้จัดการ
  await assert.rejects(status(db, U.admin5, "published", "lead"), /เฉพาะผู้จัดการ/);
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.clear_schedule_scope($1, '2026-12-01', 'x', 'lead')`, [WH5])), /เฉพาะผู้จัดการ/);
  // ล้างตารางปกติไม่แตะกะหัวหน้าคลัง
  await as(db, U.sup5, () => db.query(`select public.clear_schedule_month($1, '2026-12-01', 'ทดสอบ')`, [WH5]));
  assert.deepEqual(await seen(db, U.super), ["DM", "L1"]);
  const n = await as(db, DM, async () => (await q1(db, `select public.clear_schedule_scope($1, '2026-12-01', 'ทดสอบ', 'lead') as n`, [WH5])).n);
  assert.equal(n, 2);
});

test("ประกาศแยกกัน และใครเห็นกะของใคร", async () => {
  const db = await world();
  await apply(db, U.sup5, [U.emp5, U.sup5]);
  await apply(db, DM, [LEAD, DM]);
  // หัวหน้างาน/แอดมินของคลังเห็นทั้งหมดแม้ยังเป็นร่าง (ดูอย่างเดียว)
  assert.deepEqual(await seen(db, U.admin5), ["DM", "E5", "L1", "S5"]);
  // ประกาศตารางปกติ: พนักงานเห็นเฉพาะตารางปกติ · หัวหน้าคลังยังไม่เห็นกะตัวเอง
  await status(db, U.sup5, "published", "staff");
  assert.deepEqual(await seen(db, U.emp5), ["E5", "S5"]);
  assert.deepEqual(await team(db, U.emp5), ["E5", "S5"]);
  assert.deepEqual(await seen(db, LEAD), ["E5", "S5"]);
  // ประกาศตารางหัวหน้าคลัง: หัวหน้าคลังเห็นของกลุ่มตัวเอง · พนักงานยังไม่เห็น
  await status(db, DM, "published", "lead");
  assert.deepEqual(await seen(db, LEAD), ["DM", "E5", "L1", "S5"]);
  assert.deepEqual(await team(db, LEAD), ["DM", "E5", "L1", "S5"]);
  assert.deepEqual(await seen(db, U.emp5), ["E5", "S5"]);
  assert.deepEqual(await team(db, U.emp5), ["E5", "S5"]);
  // ตารางกะของฉัน (my_attendance) ของหัวหน้าคลัง ตามสถานะตารางหัวหน้าคลัง
  const mine = async () => (await as(db, LEAD, () => q1(db, `select shift_code from public.my_attendance('2026-12-01', '2026-12-01')`))).shift_code;
  assert.equal(await mine(), "STD1");
  await status(db, DM, "draft", "lead");
  assert.equal(await mine(), null);
  assert.equal((await q1(db, `select count(*)::int as n from public.schedule_months where warehouse_id = $1`, [WH5])).n, 2);
});

test("แจ้งเตือนประกาศ: แจ้งเฉพาะคนในกลุ่มนั้น", async () => {
  const db = await world();
  await status(db, DM, "published", "lead");
  const inbox = async (id) => (await rows(db, `select title from public.notifications where user_id = $1`, [id])).map((r) => r.title);
  assert.equal((await inbox(LEAD)).length, 1);
  assert.match((await inbox(LEAD))[0], /หัวหน้าคลัง/);
  assert.equal((await inbox(U.emp5)).length, 0);
  await status(db, U.sup5, "published", "staff");
  assert.equal((await inbox(U.emp5)).length, 1);
  assert.equal((await inbox(LEAD)).length, 1, "ตารางปกติไม่แจ้งหัวหน้าคลัง");
});
