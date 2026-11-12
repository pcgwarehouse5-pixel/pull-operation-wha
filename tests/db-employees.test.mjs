// ทดสอบสิทธิ์ของโมดูล 1 (ทะเบียนพนักงาน) บน Postgres จำลอง
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, WH5, WH32, setup, as, rows } from "./helpers.mjs";

async function withSkills() {
  const db = await setup();
  await db.exec(`
    insert into public.skills (id, position, name) values
      ('20000000-0000-0000-0000-000000000001', 'RT', 'RT ยกรับ'),
      ('20000000-0000-0000-0000-000000000002', 'RT', 'RT ยกจ่าย'),
      ('20000000-0000-0000-0000-000000000003', 'Checker', 'เช็ครับ');
  `);
  return db;
}
const S1 = "20000000-0000-0000-0000-000000000001";
const S2 = "20000000-0000-0000-0000-000000000002";
const skillsOf = async (db, uid) => (await rows(db, `select skill_id from public.employee_skills where user_id = $1 order by skill_id`, [uid])).map((r) => r.skill_id);

test("ทักษะ: แอดมินกำหนดได้เฉพาะคนในคลังตัวเอง และบันทึกประวัติ", async () => {
  const db = await withSkills();
  await as(db, U.admin5, () => db.query(`select public.set_employee_skills($1, $2)`, [U.emp5, [S1, S2]]));
  assert.deepEqual(await skillsOf(db, U.emp5), [S1, S2]);
  // เอาออก 1 ทักษะ
  await as(db, U.admin5, () => db.query(`select public.set_employee_skills($1, $2)`, [U.emp5, [S2]]));
  assert.deepEqual(await skillsOf(db, U.emp5), [S2]);
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.set_employee_skills($1, $2)`, [U.emp32, [S1]])), /ไม่มีสิทธิ์/);
  // หัวหน้างานกำหนดทักษะได้เหมือนแอดมิน (คลังตัวเอง)
  await as(db, U.sup5, () => db.query(`select public.set_employee_skills($1, $2)`, [U.emp5, [S2]]));
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.set_employee_skills($1, $2)`, [U.emp32, [S1]])), /ไม่มีสิทธิ์/);
  await assert.rejects(as(db, U.emp5, () => db.query(`select public.set_employee_skills($1, $2)`, [U.emp5, [S1]])), /ไม่มีสิทธิ์/);
  // ผู้บริหารแก้ได้ทุกคลัง
  await as(db, U.exec, () => db.query(`select public.set_employee_skills($1, $2)`, [U.emp32, [S1]]));
  assert.deepEqual(await skillsOf(db, U.emp32), [S1]);
  const logs = await rows(db, `select new_data->'skills' as s from public.audit_logs where action = 'skills_update' and record_id = $1 order by id`, [U.emp5]);
  assert.deepEqual(logs.map((l) => l.s), [["RT ยกจ่าย", "RT ยกรับ"], ["RT ยกจ่าย"]], "หัวหน้างานบันทึกค่าเดิมซ้ำ ไม่เพิ่มประวัติ");
});

test("ทักษะ: แก้ตรงๆ ไม่ได้ และเห็นเฉพาะคนที่มีสิทธิ์เห็น", async () => {
  const db = await withSkills();
  await as(db, U.admin5, () => db.query(`select public.set_employee_skills($1, $2)`, [U.emp5, [S1]]));
  await as(db, U.admin32, () => db.query(`select public.set_employee_skills($1, $2)`, [U.emp32, [S2]]));
  await assert.rejects(as(db, U.admin5, () => db.query(`insert into public.employee_skills (user_id, skill_id) values ($1, $2)`, [U.emp5, S2])), /permission denied/);
  await assert.rejects(as(db, U.emp5, () => db.query(`delete from public.employee_skills`)), /permission denied/);
  const seen = async (uid) => (await as(db, uid, () => rows(db, `select user_id from public.employee_skills order by user_id`))).map((r) => r.user_id);
  assert.deepEqual(await seen(U.emp5), [U.emp5], "พนักงานเห็นแค่ของตัวเอง");
  assert.deepEqual(await seen(U.sup5), [U.emp5], "หัวหน้างานคลัง 5 เห็นคนในคลัง 5");
  assert.equal((await seen(U.exec)).length, 2, "ผู้บริหารเห็นทุกคลัง");
  // รายการทักษะ: แอดมินและหัวหน้างานเพิ่มได้ พนักงานเพิ่มไม่ได้
  await as(db, U.admin5, () => db.query(`insert into public.skills (position, name) values ('OP', 'OP ลากรับ')`));
  await as(db, U.sup5, () => db.query(`insert into public.skills (position, name) values ('OP', 'OP ลากจ่าย')`));
  await assert.rejects(as(db, U.emp5, () => db.query(`insert into public.skills (position, name) values ('OP', 'OP ลากอื่น')`)), /row-level security/);
});

test("อัตรากำลัง: แยกตามคลัง แอดมินแก้ได้เฉพาะคลังตัวเอง", async () => {
  const db = await setup();
  await as(db, U.admin5, () => db.query(`insert into public.headcount_budgets (warehouse_id, position, budget_count) values ($1, 'RT', 6)`, [WH5]));
  await assert.rejects(
    as(db, U.admin5, () => db.query(`insert into public.headcount_budgets (warehouse_id, position, budget_count) values ($1, 'RT', 6)`, [WH32])),
    /row-level security/,
  );
  // หัวหน้างานแก้อัตรากำลังคลังตัวเองได้ คลังอื่นไม่ได้
  await as(db, U.sup5, () => db.query(`insert into public.headcount_budgets (warehouse_id, position, budget_count) values ($1, 'OP', 2)`, [WH5]));
  await assert.rejects(
    as(db, U.sup5, () => db.query(`insert into public.headcount_budgets (warehouse_id, position, budget_count) values ($1, 'OP', 2)`, [WH32])),
    /row-level security/,
  );
  await as(db, U.exec, () => db.query(`insert into public.headcount_budgets (warehouse_id, position, budget_count) values ($1, 'RT', 4)`, [WH32]));
  await assert.rejects(
    as(db, U.admin5, () => db.query(`update public.headcount_budgets set budget_count = -1 where warehouse_id = $1`, [WH5])),
    /check/,
  );
  const seen = async (uid) => (await as(db, uid, () => rows(db, `select warehouse_id from public.headcount_budgets`))).length;
  assert.equal(await seen(U.sup5), 2, "หัวหน้างานคลัง 5 เห็นเฉพาะคลัง 5 (RT + OP ที่เพิ่มเอง)");
  assert.equal(await seen(U.emp5), 0, "พนักงานไม่เห็นอัตรากำลัง");
  assert.equal(await seen(U.exec), 3, "ผู้บริหารเห็นทุกคลัง");
});

test("ลาออก/คืนสภาพ: ต้องมีวันที่และเหตุผล ทำได้ตามสิทธิ์ และหมดสิทธิ์ทันที", async () => {
  const db = await setup();
  const status = (uid, s, d, r) => db.query(`select public.set_employee_status($1, $2, $3, $4)`, [uid, s, d, r]);
  await assert.rejects(as(db, U.admin5, () => status(U.sup5, "resigned", null, "ย้ายงาน")), /วันที่/);
  await assert.rejects(as(db, U.admin5, () => status(U.sup5, "resigned", "2026-11-30", " ")), /เหตุผล/);
  await assert.rejects(as(db, U.admin5, () => status(U.emp32, "resigned", "2026-11-30", "ย้ายงาน")), /ไม่มีสิทธิ์/);
  await assert.rejects(as(db, U.sup5, () => status(U.emp32, "resigned", "2026-11-30", "ย้ายงาน")), /ไม่มีสิทธิ์/, "หัวหน้างานทำได้เฉพาะคลังตัวเอง");
  await assert.rejects(as(db, U.emp5, () => status(U.emp5, "resigned", "2026-11-30", "ย้ายงาน")), /ไม่มีสิทธิ์/);
  await assert.rejects(as(db, U.admin5, () => status(U.admin5, "resigned", "2026-11-30", "ลาออกเอง")), /ไม่มีสิทธิ์/, "ทำกับตัวเองไม่ได้");

  // หัวหน้างานคลัง 5 ลาออก → หมดสิทธิ์ดูคนอื่นทันที
  await as(db, U.admin5, () => status(U.sup5, "resigned", "2026-11-30", "ย้ายงาน"));
  const t = (await rows(db, `select status, resigned_date::text as d from public.profiles where id = $1`, [U.sup5]))[0];
  assert.deepEqual(t, { status: "resigned", d: "2026-11-30" });
  assert.equal((await as(db, U.sup5, () => rows(db, `select id from public.profiles`))).length, 1);
  await assert.rejects(as(db, U.admin5, () => status(U.sup5, "resigned", "2026-11-30", "ซ้ำ")), /อยู่แล้ว/);

  // คืนสภาพ → วันที่ลาออกถูกล้าง
  await as(db, U.admin5, () => status(U.sup5, "active", null, null));
  assert.deepEqual((await rows(db, `select status, resigned_date from public.profiles where id = $1`, [U.sup5]))[0], { status: "active", resigned_date: null });

  const logs = await rows(db, `select action, actor_id, new_data->>'reason' as reason from public.audit_logs where action in ('resign', 'reinstate') order by id`);
  assert.deepEqual(logs, [
    { action: "resign", actor_id: U.admin5, reason: "ย้ายงาน" },
    { action: "reinstate", actor_id: U.admin5, reason: null },
  ]);
  // แก้สถานะตรงๆ ไม่ได้
  await assert.rejects(as(db, U.admin5, () => db.query(`update public.profiles set status = 'resigned' where id = $1`, [U.emp5])), /permission denied/);
});

test("บริษัทต้นสังกัด: แอดมินแก้ได้ พนักงานแก้ของตัวเองไม่ได้", async () => {
  const db = await setup();
  await as(db, U.admin5, () => db.query(`update public.profiles set subcontractor_company = 'บริษัท ก' where id = $1`, [U.emp5]));
  await assert.rejects(as(db, U.emp5, () => db.query(`update public.profiles set subcontractor_company = 'บริษัท ข' where id = $1`, [U.emp5])), /แก้ได้เฉพาะ/);
  assert.equal((await rows(db, `select subcontractor_company from public.profiles where id = $1`, [U.emp5]))[0].subcontractor_company, "บริษัท ก");
});
