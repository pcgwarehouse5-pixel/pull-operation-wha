// ทดสอบยอดงานประจำวัน + คำนวณคนที่ต้องการในฐานข้อมูล ด้วยตัวอย่างชุดเดียวกับฝั่งหน้าเว็บ (tests/pull-calc.test.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, WH5, WH32, setup, as, rows } from "./helpers.mjs";
import { PULL_CASES } from "./fixtures/pull-cases.mjs";

const q1 = async (db, sql, params) => (await db.query(sql, params)).rows[0];

// ตั้งค่าคลัง WH5 ตามตัวอย่าง (ทำโดยผู้ดูแลระบบสูงสุด วันที่เริ่มใช้ 2000-01-01) คืนรหัสประเภทงาน
async function configure(db, c) {
  const skills = [...new Set(c.tasks.map((t) => t[0]))];
  for (const s of skills) await db.query(`insert into public.skills (position, name) values ('ทดสอบ', $1) on conflict do nothing`, [s]);
  return as(db, U.super, async () => {
    await db.query(`select public.set_pull_skills($1, $2)`, [WH5, skills]);
    const typeId = {};
    for (const [i, name] of c.types.entries()) {
      typeId[name] = (await q1(db, `select public.save_pull_workload_type(null, $1, $2, 'pallet', $3, true) as id`, [WH5, name, i + 1])).id;
    }
    for (const name of c.types) {
      await db.query(`select public.set_pull_type_skills($1, $2)`, [typeId[name], c.tasks.filter((t) => t[1] === name).map((t) => t[0])]);
    }
    const rates = [];
    for (const [s, t, r] of c.tasks) {
      const k = await q1(db, `select id from public.pull_tasks where workload_type_id = $1 and skill_name = $2`, [typeId[t], s]);
      rates.push({ task_id: k.id, per_hour: r });
    }
    await db.query(`select public.set_pull_rates($1, '2000-01-01', $2)`, [WH5, JSON.stringify(rates)]);
    await db.query(`select public.set_pull_shift_hours($1, '2000-01-01', $2, $2)`, [WH5, c.hours]);
    return typeId;
  });
}

const items = (typeId, volumes) => JSON.stringify(Object.entries(volumes).map(([n, v]) => ({ type_id: typeId[n], volume: v })));

for (const c of PULL_CASES) {
  test(`ฐานข้อมูล: ${c.name}`, async () => {
    const db = await setup();
    const typeId = await configure(db, c);
    await as(db, U.sup5, () => db.query(`select public.save_pull_workloads($1, public.pull_today(), 'morning', $2)`, [WH5, items(typeId, c.volumes)]));
    const reqs = await as(db, U.sup5, () => rows(db, `select skill_name, required, complete from public.pull_requirements($1, public.pull_today(), 'morning')`, [WH5]));
    assert.deepEqual(Object.fromEntries(reqs.map((r) => [r.skill_name, r.required])), c.expect);
    const total = reqs.every((r) => r.complete) ? reqs.reduce((n, r) => n + r.required, 0) : null;
    assert.equal(total, c.total);
  });
}

test("ฐานข้อมูล: รายละเอียดทีละงาน และเหตุผลที่ยังคำนวณไม่ได้", async () => {
  const db = await setup();
  const c = PULL_CASES[0];
  const typeId = await configure(db, c);
  await db.query(`insert into public.skills (position, name) values ('ทดสอบ', 'ทักษะใหม่')`);
  await as(db, U.super, () => db.query(`select public.set_pull_skills($1, $2)`, [WH5, ["RT รับ", "Picker จ่าย", "Checker", "ทักษะใหม่"]]));
  await as(db, U.sup5, () => db.query(`select public.save_pull_workloads($1, public.pull_today(), 'morning', $2)`, [WH5, items(typeId, { งานรับ: 400 })]));
  const detail = await as(db, U.sup5, () => rows(db, `select skill_name, type_name, volume::float, hours::float, per_hour::float, round(fte, 2)::float as fte from public.pull_requirement_rows($1, public.pull_today(), 'morning')`, [WH5]));
  assert.deepEqual(detail[0], { skill_name: "RT รับ", type_name: "งานรับ", volume: 400, hours: 8, per_hour: 25, fte: 2 });
  assert.equal(detail[1].volume, null);
  assert.equal(detail[1].fte, null);
  const why = Object.fromEntries((await as(db, U.sup5, () => rows(db, `select skill_name, missing from public.pull_requirements($1, public.pull_today(), 'morning')`, [WH5]))).map((r) => [r.skill_name, r.missing]));
  assert.deepEqual(why, { "RT รับ": null, "Picker จ่าย": "ยังไม่กรอกยอดงาน", Checker: "ยังไม่กรอกยอดงาน", ทักษะใหม่: "ยังไม่ผูกประเภทงาน" });
  // กะดึกยังไม่มียอด
  const night = await as(db, U.sup5, () => rows(db, `select required from public.pull_requirements($1, public.pull_today(), 'night') where skill_name = 'RT รับ'`, [WH5]));
  assert.equal(night[0].required, null);
});

test("บันทึกยอดงาน: สิทธิ์ วันที่ และค่าที่รับได้", async () => {
  const db = await setup();
  const typeId = await configure(db, PULL_CASES[0]);
  const t = typeId["งานรับ"];
  const save = (uid, date, vol, wh = WH5, shift = "morning") =>
    as(db, uid, () => db.query(`select public.save_pull_workloads($1, ${date}, $2, $3)`, [wh, shift, JSON.stringify([{ type_id: t, volume: vol }])]));
  await save(U.sup5, "public.pull_today()", 400);
  await save(U.sup5, "public.pull_today() + 3", 410);
  await assert.rejects(save(U.emp5, "public.pull_today()", 1), /ไม่มีสิทธิ์/);
  await assert.rejects(save(U.admin32, "public.pull_today()", 1), /ไม่มีสิทธิ์/);
  await assert.rejects(save(U.admin32, "public.pull_today()", 1, WH32), /ไม่พบประเภทงาน/, "ใช้ประเภทงานของคลังอื่นไม่ได้");
  await assert.rejects(save(U.sup5, "public.pull_today() - 1", 1), /เฉพาะแอดมิน/, "หัวหน้างานแก้ย้อนหลังไม่ได้");
  await save(U.admin5, "public.pull_today() - 1", 390);
  await assert.rejects(save(U.sup5, "public.pull_today() + 91", 1), /ไม่เกิน 90 วัน/);
  await assert.rejects(save(U.sup5, "public.pull_today()", -1), /ไม่ติดลบ/);
  await assert.rejects(save(U.sup5, "public.pull_today()", 1, WH5, "evening"), /เลือกกะ/);
  const vol = async (date) => (await q1(db, `select volume::float as v from public.pull_workloads where workload_type_id = $1 and work_date = ${date} and shift = 'morning'`, [t]))?.v ?? null;
  assert.equal(await vol("public.pull_today()"), 400);
  assert.equal(await vol("public.pull_today() - 1"), 390);
  // null = ลบยอดที่เคยกรอก
  await save(U.sup5, "public.pull_today()", null);
  assert.equal(await vol("public.pull_today()"), null);
  // ประเภทงานที่ปิดแล้วบันทึกไม่ได้
  await as(db, U.admin5, () => db.query(`select public.save_pull_workload_type($1, $2, 'งานรับ', 'pallet', 1, false)`, [t, WH5]));
  await assert.rejects(save(U.sup5, "public.pull_today()", 1), /ไม่พบประเภทงาน/);
  // บันทึกประวัติ
  assert.ok((await rows(db, `select 1 from public.audit_logs where table_name = 'pull_workloads'`)).length >= 4);
});

test("ยอดงาน: อ่านได้เฉพาะหัวหน้างานของคลังนั้น แก้ตรงๆ ไม่ได้ ดูผลคำนวณคลังอื่นไม่ได้", async () => {
  const db = await setup();
  const typeId = await configure(db, PULL_CASES[0]);
  await as(db, U.sup5, () => db.query(`select public.save_pull_workloads($1, public.pull_today(), 'morning', $2)`, [WH5, items(typeId, { งานรับ: 400 })]));
  const seen = (uid) => as(db, uid, async () => (await rows(db, `select 1 from public.pull_workloads`)).length);
  assert.equal(await seen(U.sup5), 1);
  assert.equal(await seen(U.exec), 1);
  assert.equal(await seen(U.admin32), 0);
  assert.equal(await seen(U.emp5), 0);
  await assert.rejects(as(db, U.sup5, () => db.query(`update public.pull_workloads set volume = 1`)), /permission denied/);
  await assert.rejects(as(db, U.admin32, () => db.query(`select * from public.pull_requirements($1, public.pull_today(), 'morning')`, [WH5])), /ไม่มีสิทธิ์/);
  await assert.rejects(as(db, U.emp5, () => db.query(`select * from public.pull_requirement_rows($1, public.pull_today(), 'morning')`, [WH5])), /ไม่มีสิทธิ์/);
  assert.equal((await as(db, U.exec, () => rows(db, `select * from public.pull_requirements($1, public.pull_today(), 'morning')`, [WH5]))).length, 3);
});
