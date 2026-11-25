// ทดสอบหมายเหตุ "คนที่เหลือ" หลังทั้ง 2 คลังจองแล้ว บน Postgres จำลอง
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, WH5, setup, as, rows } from "./helpers.mjs";

const today = async (db) => (await rows(db, `select public.pull_today()::text as d`))[0].d;
const setNote = (db, uid, d, users, note, shift = "morning") =>
  as(db, uid, async () => (await rows(db, `select public.set_pull_leftover_notes($1, $2, $3, $4) as n`, [d, shift, users, note]))[0].n);
const notes = (db, uid, d) => as(db, uid, () => rows(db, `select user_id, note, warehouse_id from public.pull_leftover_notes where work_date = $1 order by user_id`, [d]));

test("หัวหน้าคลังใส่หมายเหตุให้คนคลังตัวเอง หลายคนพร้อมกัน · ทุกคลังเห็น", async () => {
  const db = await setup();
  const d = await today(db);
  assert.equal(await setNote(db, U.sup5, d, [U.emp5, U.sup5], "  ช่วยเคลียร์พื้นที่ Zone B  "), 2);
  const seen = await notes(db, U.admin32, d);
  assert.deepEqual(seen.map((r) => [r.user_id, r.note, r.warehouse_id]), [
    [U.sup5, "ช่วยเคลียร์พื้นที่ Zone B", WH5],
    [U.emp5, "ช่วยเคลียร์พื้นที่ Zone B", WH5],
  ].sort((a, b) => a[0].localeCompare(b[0])), "คลัง 32 เห็นหมายเหตุของคลัง 5");
  // แก้ข้อความ / ลบด้วยข้อความว่าง
  await setNote(db, U.sup5, d, [U.emp5], "ไปช่วยนับสต็อก");
  assert.equal((await notes(db, U.exec, d)).find((r) => r.user_id === U.emp5).note, "ไปช่วยนับสต็อก");
  await setNote(db, U.sup5, d, [U.emp5], "   ");
  assert.deepEqual((await notes(db, U.exec, d)).map((r) => r.user_id), [U.sup5]);
  // บันทึกประวัติ
  const audit = await rows(db, `select count(*)::int n from public.audit_logs where table_name = 'pull_leftover_notes'`);
  assert.ok(audit[0].n >= 4);
});

test("สิทธิ์: คลังอื่นใส่ไม่ได้ · พนักงานไม่เห็น · ไม่ล็อกอินเรียกไม่ได้ · แก้ตารางตรงไม่ได้", async () => {
  const db = await setup();
  const d = await today(db);
  await assert.rejects(setNote(db, U.admin32, d, [U.emp5], "x"), /เฉพาะพนักงานคลังที่คุณดูแล/);
  await assert.rejects(setNote(db, U.emp5, d, [U.emp5], "x"), /เฉพาะพนักงานคลังที่คุณดูแล/);
  await assert.rejects(setNote(db, null, d, [U.emp5], "x"), /permission denied/);
  await setNote(db, U.sup5, d, [U.emp5], "ช่วยแพ็ค");
  assert.equal((await notes(db, U.emp5, d)).length, 0, "พนักงานไม่เห็นหมายเหตุ");
  await assert.rejects(as(db, U.sup5, () => db.query(`update public.pull_leftover_notes set note = 'แก้ตรง'`)), /permission denied/);
  await assert.rejects(as(db, U.sup5, () => db.query(`insert into public.pull_leftover_notes (work_date, shift, user_id, warehouse_id, note) values ($1, 'night', $2, $3, 'x')`, [d, U.emp5, WH5])), /permission denied/);
});

test("ตรวจข้อมูล: วันที่ กะ จำนวนคน ความยาว", async () => {
  const db = await setup();
  const d = await today(db);
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.set_pull_leftover_notes($1::date - 1, 'morning', $2, 'x')`, [d, [U.emp5]])), /ตั้งแต่วันนี้/);
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.set_pull_leftover_notes($1::date + 61, 'morning', $2, 'x')`, [d, [U.emp5]])), /ไม่เกิน 60 วัน/);
  await assert.rejects(setNote(db, U.sup5, d, [U.emp5], "x", "evening"), /กรุณาเลือกกะ/);
  await assert.rejects(setNote(db, U.sup5, d, [], "x"), /กรุณาเลือกพนักงาน/);
  await assert.rejects(setNote(db, U.sup5, d, [U.emp5], "ก".repeat(201)), /ไม่เกิน 200/);
  // กะเช้า/กะดึก แยกกัน
  await setNote(db, U.sup5, d, [U.emp5], "เช้า");
  await setNote(db, U.sup5, d, [U.emp5], "ดึก", "night");
  assert.equal((await notes(db, U.exec, d)).length, 2);
});
