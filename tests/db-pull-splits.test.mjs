// ทดสอบการแตกยอดงานอัตโนมัติ (migration 0037) ด้วยตัวอย่างชุดเดียวกับฝั่งหน้าเว็บ (tests/pull-calc.test.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, WH5, setup, as, rows } from "./helpers.mjs";
import { SPLIT_CASE } from "./fixtures/pull-cases.mjs";

const q1 = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const FUTURE = `public.pull_today() + 1`;

// ตั้งค่าคลัง WH5 ตามตัวอย่าง (ผู้ดูแลระบบสูงสุด) · กฎแตกยอดเริ่มใช้พรุ่งนี้ · คืนรหัสประเภทงาน
async function configure(db, c = SPLIT_CASE) {
  const skills = [...new Set(c.tasks.map((t) => t[0]))];
  for (const s of skills) await db.query(`insert into public.skills (position, name) values ('ทดสอบ', $1) on conflict do nothing`, [s]);
  return as(db, U.super, async () => {
    await db.query(`select public.set_pull_skills($1, $2)`, [WH5, skills]);
    const id = {};
    for (const [i, [name, unit]] of c.types.entries()) {
      id[name] = (await q1(db, `select public.save_pull_workload_type(null, $1, $2, $3, $4, true) as id`, [WH5, name, unit, i + 1])).id;
    }
    for (const [name] of c.types) {
      await db.query(`select public.set_pull_type_skills($1, $2)`, [id[name], c.tasks.filter((t) => t[1] === name).map((t) => t[0])]);
    }
    const rates = [];
    for (const [s, t, r] of c.tasks) {
      const k = await q1(db, `select id from public.pull_tasks where workload_type_id = $1 and skill_name = $2`, [id[t], s]);
      rates.push({ task_id: k.id, per_hour: r });
    }
    await db.query(`select public.set_pull_rates($1, '2000-01-01', $2)`, [WH5, JSON.stringify(rates)]);
    await db.query(`select public.set_pull_shift_hours($1, '2000-01-01', $2, $2)`, [WH5, c.hours]);
    for (const [name, source, share, divisor] of c.splits) {
      await db.query(`select public.set_pull_type_split($1, ${FUTURE}, $2, $3, $4)`, [id[name], id[source], share, divisor]);
    }
    return id;
  });
}

const items = (id, volumes) => JSON.stringify(Object.entries(volumes).map(([n, v]) => ({ type_id: id[n], volume: v })));

test("แตกยอด: จ่าย 10,000 ชิ้น → แต่ละงานได้ยอดตามสัดส่วนและตัวหาร แล้วคิดคนได้ตรงกับหน้าเว็บ", async () => {
  const db = await setup();
  const id = await configure(db);
  await as(db, U.sup5, () => db.query(`select public.save_pull_workloads($1, ${FUTURE}, 'morning', $2)`, [WH5, items(id, SPLIT_CASE.volumes)]));
  const detail = await as(db, U.sup5, () => rows(db, `select type_name, skill_name, volume::float as volume from public.pull_requirement_rows($1, ${FUTURE}, 'morning')`, [WH5]));
  const vol = Object.fromEntries(detail.map((r) => [r.type_name, r.volume]));
  assert.deepEqual(vol, SPLIT_CASE.expectVolumes);
  const reqs = await as(db, U.sup5, () => rows(db, `select skill_name, required from public.pull_requirements($1, ${FUTURE}, 'morning')`, [WH5]));
  assert.deepEqual(Object.fromEntries(reqs.map((r) => [r.skill_name, r.required])), SPLIT_CASE.expect);
});

test("แตกยอด: ก่อนวันเริ่มใช้ยังใช้ยอดที่กรอกเองแบบเดิม · หลังวันเริ่มใช้ห้ามกรอกยอดของงานที่แตกแล้ว", async () => {
  const db = await setup();
  const id = await configure(db);
  // วันนี้ (ก่อนกฎเริ่มใช้) กรอกยอดงานจ่ายพาเลทเต็มเองได้ และใช้ค่านั้น
  await as(db, U.sup5, () => db.query(`select public.save_pull_workloads($1, public.pull_today(), 'morning', $2)`, [WH5, items(id, { "งานจ่าย พาเลทเต็ม": 70, ยอดจ่ายรวม: 10000 })]));
  const today = await as(db, U.sup5, () => rows(db, `select type_name, volume::float as volume from public.pull_requirement_rows($1, public.pull_today(), 'morning')`, [WH5]));
  assert.equal(today.find((r) => r.type_name === "งานจ่าย พาเลทเต็ม").volume, 70);
  assert.equal(today.find((r) => r.type_name === "งานเติม Pickface").volume, null);
  // พรุ่งนี้: ยอดของงานที่แตกแล้วกรอกเองไม่ได้
  await assert.rejects(
    as(db, U.sup5, () => db.query(`select public.save_pull_workloads($1, ${FUTURE}, 'morning', $2)`, [WH5, items(id, { "งานจ่าย พาเลทเต็ม": 70 })])),
    /แตกจากยอดหลักให้อัตโนมัติ/,
  );
  // ยังไม่กรอกยอดหลัก = งานที่แตกยังคำนวณไม่ได้ (ไม่ตีเป็น 0)
  const why = await as(db, U.sup5, () => rows(db, `select skill_name, missing from public.pull_requirements($1, ${FUTURE}, 'morning')`, [WH5]));
  assert.equal(why.find((r) => r.skill_name === "RT จ่าย").missing, "ยังไม่กรอกยอดงาน");
});

test("แตกยอด: กันตั้งกฎผิด (สิทธิ์ ย้อนหลัง แตกเป็นทอด ตัวเอง ค่าผิด) และกลับไปกรอกเองได้", async () => {
  const db = await setup();
  const id = await configure(db);
  const set = (uid, type, from, source, share, div) =>
    as(db, uid, () => db.query(`select public.set_pull_type_split($1, ${from}, $2, $3, $4)`, [id[type], source ? id[source] : null, share, div]));
  await assert.rejects(set(U.sup5, "งานโหลดสินค้า", FUTURE, "ยอดจ่ายรวม", 100, 1), /ไม่มีสิทธิ์/);
  await assert.rejects(set(U.admin5, "งานโหลดสินค้า", "public.pull_today() - 1", "ยอดจ่ายรวม", 100, 1), /ไม่ย้อนหลัง/);
  await assert.rejects(set(U.admin5, "งานรับ", FUTURE, "งานจ่าย พาเลทเต็ม", 50, 1), /ใช้เป็นยอดหลักไม่ได้/);
  await assert.rejects(set(U.admin5, "ยอดจ่ายรวม", FUTURE, "งานรับ", 50, 1), /เป็นยอดหลักของงานอื่น/);
  await assert.rejects(set(U.admin5, "งานรับ", FUTURE, "งานรับ", 50, 1), /ประเภทงานอื่น/);
  await assert.rejects(set(U.admin5, "งานโหลดสินค้า", FUTURE, "ยอดจ่ายรวม", 0, 1), /สัดส่วน/);
  await assert.rejects(set(U.admin5, "งานโหลดสินค้า", FUTURE, "ยอดจ่ายรวม", 100, 0), /ตัวหาร/);
  // ลบยอดหลักที่งานอื่นใช้อยู่ไม่ได้
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.delete_pull_workload_type($1)`, [id.ยอดจ่ายรวม])), /เป็นยอดหลัก/);
  // วันที่ 2 เป็นต้นไป งานโหลดกลับไปกรอกเอง
  await set(U.admin5, "งานโหลดสินค้า", "public.pull_today() + 2", null, null, null);
  await as(db, U.sup5, () => db.query(`select public.save_pull_workloads($1, public.pull_today() + 2, 'morning', $2)`, [WH5, items(id, { งานโหลดสินค้า: 123, ยอดจ่ายรวม: 10000 })]));
  const d2 = await as(db, U.sup5, () => rows(db, `select type_name, volume::float as volume from public.pull_requirement_rows($1, public.pull_today() + 2, 'morning')`, [WH5]));
  assert.equal(d2.find((r) => r.type_name === "งานโหลดสินค้า").volume, 123);
  assert.equal(d2.find((r) => r.type_name === "งานเช็คจ่าย").volume, 10000);
  // ลบกฎล่วงหน้าได้ / หน้าเว็บเรียกฟังก์ชันแกนตรงไม่ได้ / พนักงานอ่านกฎไม่ได้
  await as(db, U.admin5, () => db.query(`select public.delete_pull_type_split($1, public.pull_today() + 2)`, [id.งานโหลดสินค้า]));
  assert.equal((await q1(db, `select count(*)::int as n from public.pull_type_splits where type_id = $1`, [id.งานโหลดสินค้า])).n, 1);
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.pull_volume_at($1, public.pull_today(), 'morning')`, [id.งานรับ])), /permission denied/);
  assert.equal((await as(db, U.emp5, () => rows(db, `select * from public.pull_type_splits`))).length, 0);
  assert.equal((await as(db, U.sup5, () => rows(db, `select * from public.pull_type_splits`))).length, 5);
});
