// ทดสอบหมายเหตุรายช่องในตารางกะ (คลิกขวา → หมายเหตุ) บน Postgres จำลอง
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, setup, as, rows } from "./helpers.mjs";

const WH5 = "10000000-0000-0000-0000-000000000005";
const DM = "00000000-0000-0000-0000-000000000011"; // ผู้จัดการแผนก (WH5)
const LEAD = "00000000-0000-0000-0000-000000000021"; // ตำแหน่ง Supervisor = อยู่ตารางกะหัวหน้าคลัง (WH5)
const D = "2026-12-01";

async function world() {
  const db = await setup();
  await db.query(`insert into auth.users (id, email) values ($1, 'dm@wha.local'), ($2, 'lead@wha.local')`, [DM, LEAD]);
  await db.query(`insert into public.profiles (id, employee_code, first_name_th, role, warehouse_id) values ($1, 'DM', 'ผู้จัดการ', 'dept_manager', $3), ($2, 'L1', 'หัวหน้าคลัง', 'employee', $3)`, [DM, LEAD, WH5]);
  await db.query(`update public.profiles set position = 'Supervisor' where id = $1`, [LEAD]);
  return db;
}
const setNote = (db, uid, user, note, date = D) => as(db, uid, () => db.query(`select public.set_shift_cell_note($1, $2, $3)`, [user, date, note]));
const notes = (db, uid) => as(db, uid, () => rows(db, `select user_id, work_date::text as d, note from public.shift_cell_notes order by user_id, work_date`));

test("หัวหน้างานใส่/แก้/ลบหมายเหตุช่องของพนักงานคลังตัวเอง · ใส่ได้แม้ช่องยังว่าง · บันทึกประวัติ", async () => {
  const db = await world();
  await setNote(db, U.sup5, U.emp5, "  ขอสลับกะกับ E6  ");
  assert.deepEqual(await notes(db, U.admin5), [{ user_id: U.emp5, d: D, note: "ขอสลับกะกับ E6" }]);
  await setNote(db, U.sup5, U.emp5, "ไปอบรมช่วงเช้า");
  assert.equal((await notes(db, U.sup5))[0].note, "ไปอบรมช่วงเช้า");
  await setNote(db, U.sup5, U.emp5, "   ");
  assert.equal((await notes(db, U.sup5)).length, 0, "ข้อความว่าง = ลบ");
  const audit = await rows(db, `select count(*)::int n from public.audit_logs where table_name = 'shift_cell_notes'`);
  assert.equal(audit[0].n, 3);
});

test("สิทธิ์เห็น: คลังอื่นและพนักงานไม่เห็น · ผู้จัดการเห็น", async () => {
  const db = await world();
  await setNote(db, U.sup5, U.emp5, "ลาบวช 3 วัน รอเอกสาร");
  assert.equal((await notes(db, U.admin32)).length, 0, "แอดมินคลังอื่นไม่เห็น");
  assert.equal((await notes(db, U.emp5)).length, 0, "พนักงานไม่เห็น (แม้เป็นช่องของตัวเอง)");
  assert.equal((await notes(db, U.exec)).length, 1);
  assert.equal((await notes(db, DM)).length, 1);
});

test("สิทธิ์ใส่: คลังอื่น/พนักงาน/ไม่ล็อกอินไม่ได้ · ตารางหัวหน้าคลังเฉพาะผู้จัดการ · แก้ตารางตรงไม่ได้", async () => {
  const db = await world();
  await assert.rejects(setNote(db, U.admin32, U.emp5, "x"), /ไม่มีสิทธิ์/);
  await assert.rejects(setNote(db, U.emp5, U.emp5, "x"), /ไม่มีสิทธิ์/);
  await assert.rejects(setNote(db, null, U.emp5, "x"), /permission denied/);
  await assert.rejects(setNote(db, U.sup5, LEAD, "x"), /ไม่มีสิทธิ์/, "ตารางกะหัวหน้าคลังแก้ได้เฉพาะผู้จัดการ");
  await setNote(db, DM, LEAD, "ประชุมผู้บริหาร");
  assert.equal((await notes(db, U.sup5)).length, 1, "หัวหน้างานยังเห็นหมายเหตุของตารางหัวหน้าคลัง (ดูได้อย่างเดียว)");
  await assert.rejects(as(db, U.sup5, () => db.query(`insert into public.shift_cell_notes (user_id, work_date, note) values ($1, $2, 'x')`, [U.emp5, D])), /permission denied/);
  await assert.rejects(as(db, U.sup5, () => db.query(`update public.shift_cell_notes set note = 'แก้ตรง'`)), /permission denied/);
});

test("ตรวจข้อมูล: ความยาว · พนักงานไม่มีจริง · ช่องไม่ครบ", async () => {
  const db = await world();
  await assert.rejects(setNote(db, U.sup5, U.emp5, "ก".repeat(301)), /ไม่เกิน 300/);
  await assert.rejects(setNote(db, U.sup5, "00000000-0000-0000-0000-0000000000ff", "x"), /ไม่พบพนักงาน/);
  await assert.rejects(setNote(db, U.sup5, U.emp5, "x", null), /กรุณาเลือกช่อง/);
  await setNote(db, U.sup5, U.emp5, "ก".repeat(300));
});
