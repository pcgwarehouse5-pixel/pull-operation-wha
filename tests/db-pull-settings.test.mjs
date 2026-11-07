// ทดสอบการตั้งค่า Pull Operation (ทักษะที่ดึงได้ / ประเภทงาน / Productivity / ชั่วโมงต่อกะ) บน Postgres จำลอง
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { U, WH5, WH32, SUPABASE_STUB, setup, as, rows } from "./helpers.mjs";

const q1 = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const today = async (db) => (await q1(db, `select public.pull_today()::text as d`)).d;
const addDays = (ymd, n) => {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function withSkills() {
  const db = await setup();
  await db.exec(`
    insert into public.skills (position, name) values
      ('RT', 'RT รับ(Domestics)'), ('RT', 'RT เติม(Domestics)'), ('CT', 'OP ลากรับ'), ('OP', 'OP ลากรับ'),
      ('Checker Receive', 'เช็ครับ(Domestics)');
    insert into public.skills (position, name, is_active) values ('RT', 'ทักษะที่ปิดแล้ว', false);
  `);
  return db;
}

// ตั้งค่าครบ 1 ชุดของ WH5: ทักษะ + ประเภทงานรับ (พาเลท) ผูก RT รับ และ OP ลากรับ
async function configured() {
  const db = await withSkills();
  await as(db, U.admin5, () => db.query(`select public.set_pull_skills($1, $2)`, [WH5, ["RT รับ(Domestics)", "OP ลากรับ", "RT เติม(Domestics)"]]));
  const type = await as(db, U.admin5, async () => (await q1(db, `select public.save_pull_workload_type(null, $1, 'งานรับ', 'pallet', 1, true) as id`, [WH5])).id);
  await as(db, U.admin5, () => db.query(`select public.set_pull_type_skills($1, $2)`, [type, ["RT รับ(Domestics)", "OP ลากรับ"]]));
  const tasks = Object.fromEntries((await rows(db, `select skill_name, id from public.pull_tasks where workload_type_id = $1`, [type])).map((r) => [r.skill_name, r.id]));
  return { db, type, tasks };
}

test("ทักษะที่ดึงได้: แอดมินตั้งได้เฉพาะคลังตัวเอง ทักษะต้องมีจริงและเปิดใช้", async () => {
  const db = await withSkills();
  await as(db, U.admin5, () => db.query(`select public.set_pull_skills($1, $2)`, [WH5, ["OP ลากรับ", "RT รับ(Domestics)"]]));
  const got = await rows(db, `select skill_name, sort_order from public.pull_skills where warehouse_id = $1 order by sort_order`, [WH5]);
  assert.deepEqual(got.map((r) => r.skill_name), ["OP ลากรับ", "RT รับ(Domestics)"], "เรียงตามลำดับที่ส่ง");
  // ส่งใหม่ = แทนของเดิม
  await as(db, U.admin5, () => db.query(`select public.set_pull_skills($1, $2)`, [WH5, ["RT รับ(Domestics)"]]));
  assert.equal((await rows(db, `select 1 from public.pull_skills where warehouse_id = $1`, [WH5])).length, 1);

  await assert.rejects(as(db, U.admin32, () => db.query(`select public.set_pull_skills($1, $2)`, [WH5, ["OP ลากรับ"]])), /ไม่มีสิทธิ์/);
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.set_pull_skills($1, $2)`, [WH5, ["OP ลากรับ"]])), /ไม่มีสิทธิ์/, "หัวหน้างานตั้งค่าไม่ได้");
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.set_pull_skills($1, $2)`, [WH5, ["ไม่มีทักษะนี้"]])), /ไม่พบทักษะ/);
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.set_pull_skills($1, $2)`, [WH5, ["ทักษะที่ปิดแล้ว"]])), /ไม่พบทักษะ/);
  // ผู้บริหารตั้งได้ทุกคลัง
  await as(db, U.exec, () => db.query(`select public.set_pull_skills($1, $2)`, [WH32, ["OP ลากรับ"]]));
  assert.equal((await rows(db, `select 1 from public.pull_skills where warehouse_id = $1`, [WH32])).length, 1);
  // บันทึกประวัติ
  assert.ok((await rows(db, `select 1 from public.audit_logs where table_name = 'pull_skills'`)).length >= 3);
});

test("ประเภทงาน: หน่วยต้องมีในรายการ ชื่อห้ามซ้ำ ผูกได้เฉพาะทักษะที่เปิดให้ดึง", async () => {
  const { db, type } = await configured();
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.save_pull_workload_type(null, $1, 'งานใหม่', 'ไม่มีหน่วยนี้', 1, true)`, [WH5])), /ไม่พบหน่วยนับ/);
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.save_pull_workload_type(null, $1, ' งานรับ ', 'piece', 1, true)`, [WH5])), /มีประเภทงานชื่อนี้/);
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.save_pull_workload_type(null, $1, '   ', 'piece', 1, true)`, [WH5])), /ใส่ชื่อ/);
  // ชื่อเดียวกันใช้ได้ในอีกคลัง
  await as(db, U.admin32, () => db.query(`select public.save_pull_workload_type(null, $1, 'งานรับ', 'pallet', 1, true)`, [WH32]));
  // แก้ประเภทงานของคลังอื่นผ่านรหัสคลังตัวเองไม่ได้
  await assert.rejects(as(db, U.admin32, () => db.query(`select public.save_pull_workload_type($1, $2, 'แก้', 'pallet', 1, true)`, [type, WH32])), /ไม่พบประเภทงาน/);
  // ผูกทักษะที่คลังยังไม่เปิดให้ดึงไม่ได้
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.set_pull_type_skills($1, $2)`, [type, ["เช็ครับ(Domestics)"]])), /ยังไม่ได้เปิดให้คลังนี้ดึง/);
  await assert.rejects(as(db, U.admin32, () => db.query(`select public.set_pull_type_skills($1, $2)`, [type, ["OP ลากรับ"]])), /ไม่มีสิทธิ์/);
  // เอาทักษะออก = ปิด (ไม่ลบประวัติ) / ใส่กลับ = เปิดใหม่ งานเดิม
  const before = await rows(db, `select id from public.pull_tasks where workload_type_id = $1 and skill_name = 'OP ลากรับ'`, [type]);
  await as(db, U.admin5, () => db.query(`select public.set_pull_type_skills($1, $2)`, [type, ["RT รับ(Domestics)"]]));
  assert.deepEqual((await rows(db, `select skill_name, is_active from public.pull_tasks where workload_type_id = $1 order by skill_name`, [type])).map((r) => `${r.skill_name}:${r.is_active}`), ["OP ลากรับ:false", "RT รับ(Domestics):true"]);
  await as(db, U.admin5, () => db.query(`select public.set_pull_type_skills($1, $2)`, [type, ["RT รับ(Domestics)", "OP ลากรับ"]]));
  const after = await rows(db, `select id, is_active from public.pull_tasks where workload_type_id = $1 and skill_name = 'OP ลากรับ'`, [type]);
  assert.equal(after[0].id, before[0].id);
  assert.equal(after[0].is_active, true);
});

test("Productivity: บันทึกพร้อมวันที่เริ่มใช้ ค่าใช้ตามวันที่ และห้ามย้อนหลัง", async () => {
  const { db, tasks } = await configured();
  const t = await today(db);
  const rt = tasks["RT รับ(Domestics)"];
  const op = tasks["OP ลากรับ"];
  const n = await as(db, U.admin5, async () =>
    (await q1(db, `select public.set_pull_rates($1, $2, $3, 'ตาม Excel') as n`, [WH5, t, JSON.stringify([{ task_id: rt, per_hour: 30 }, { task_id: op, per_hour: 32.456 }])])).n,
  );
  assert.equal(n, 2);
  // ค่าใหม่ล่วงหน้า 10 วัน
  await as(db, U.admin5, () => db.query(`select public.set_pull_rates($1, $2, $3)`, [WH5, addDays(t, 10), JSON.stringify([{ task_id: rt, per_hour: 25 }])]));
  const at = async (d) => Number((await q1(db, `select public.pull_rate_at($1, $2::date) as v`, [rt, d])).v);
  assert.equal(await at(t), 30);
  assert.equal(await at(addDays(t, 9)), 30);
  assert.equal(await at(addDays(t, 10)), 25);
  assert.equal((await q1(db, `select public.pull_rate_at($1, $2::date) as v`, [rt, addDays(t, -1)])).v, null, "ก่อนมีค่า = ไม่มีค่า (ไม่ตีเป็น 0)");
  assert.equal(Number((await q1(db, `select public.pull_rate_at($1, $2::date) as v`, [op, t])).v), 32.46, "เก็บทศนิยม 2 ตำแหน่ง");
  // บันทึกซ้ำวันเดิม = แก้ค่าวันนั้น
  await as(db, U.admin5, () => db.query(`select public.set_pull_rates($1, $2, $3)`, [WH5, t, JSON.stringify([{ task_id: rt, per_hour: 31 }])]));
  assert.equal(await at(t), 31);

  await assert.rejects(as(db, U.admin5, () => db.query(`select public.set_pull_rates($1, $2, $3)`, [WH5, addDays(t, -1), JSON.stringify([{ task_id: rt, per_hour: 1 }])])), /ไม่ย้อนหลัง/);
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.set_pull_rates($1, $2, $3)`, [WH5, t, JSON.stringify([{ task_id: rt, per_hour: 0 }])])), /มากกว่า 0/);
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.set_pull_rates($1, $2, $3)`, [WH5, t, JSON.stringify([])])), /ไม่มีค่า/);
  await assert.rejects(as(db, U.admin32, () => db.query(`select public.set_pull_rates($1, $2, $3)`, [WH32, t, JSON.stringify([{ task_id: rt, per_hour: 5 }])])), /ไม่พบงาน/, "ใช้งานของคลังอื่นไม่ได้");
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.set_pull_rates($1, $2, $3)`, [WH5, t, JSON.stringify([{ task_id: rt, per_hour: 5 }])])), /ไม่มีสิทธิ์/);
  // ผู้ดูแลระบบสูงสุดแก้ย้อนหลังได้ (กรณีตั้งค่าครั้งแรก)
  await as(db, U.super, () => db.query(`select public.set_pull_rates($1, '2000-01-01', $2)`, [WH5, JSON.stringify([{ task_id: rt, per_hour: 28 }])]));
  assert.equal(Number((await q1(db, `select public.pull_rate_at($1, $2::date) as v`, [rt, addDays(t, -1)])).v), 28);

  // ลบได้เฉพาะค่าล่วงหน้า
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.delete_pull_future('rate', $1, $2, $3)`, [WH5, t, rt])), /ยังไม่ถึงวันเริ่มใช้/);
  await as(db, U.admin5, () => db.query(`select public.delete_pull_future('rate', $1, $2, $3)`, [WH5, addDays(t, 10), rt]));
  assert.equal(await at(addDays(t, 10)), 31);
});

test("หน่วยของประเภทงานล็อกหลังตั้ง Productivity แล้ว", async () => {
  const { db, type, tasks } = await configured();
  // ยังไม่มี Productivity = เปลี่ยนหน่วยได้
  await as(db, U.admin5, () => db.query(`select public.save_pull_workload_type($1, $2, 'งานรับ', 'piece', 1, true)`, [type, WH5]));
  await as(db, U.admin5, () => db.query(`select public.save_pull_workload_type($1, $2, 'งานรับ', 'pallet', 1, true)`, [type, WH5]));
  await as(db, U.admin5, () => db.query(`select public.set_pull_rates($1, public.pull_today(), $2)`, [WH5, JSON.stringify([{ task_id: tasks["OP ลากรับ"], per_hour: 32 }])]));
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.save_pull_workload_type($1, $2, 'งานรับ', 'piece', 1, true)`, [type, WH5])), /เปลี่ยนหน่วยไม่ได้/);
  // เปลี่ยนชื่อ/ปิดใช้ได้
  await as(db, U.admin5, () => db.query(`select public.save_pull_workload_type($1, $2, 'งานรับสินค้าเข้า', 'pallet', 2, false)`, [type, WH5]));
  assert.deepEqual(await q1(db, `select name, is_active from public.pull_workload_types where id = $1`, [type]), { name: "งานรับสินค้าเข้า", is_active: false });
});

test("ชั่วโมงต่อกะ: ตั้งแยกเช้า/ดึก ค่าใช้ตามวันที่", async () => {
  const db = await withSkills();
  const t = await today(db);
  await as(db, U.admin5, () => db.query(`select public.set_pull_shift_hours($1, $2, 10, 9.5)`, [WH5, t]));
  await as(db, U.admin5, () => db.query(`select public.set_pull_shift_hours($1, $2, 8, 8)`, [WH5, addDays(t, 3)]));
  const h = async (shift, d) => Number((await q1(db, `select public.pull_hours_at($1, $2, $3::date) as v`, [WH5, shift, d])).v);
  assert.equal(await h("morning", t), 10);
  assert.equal(await h("night", t), 9.5);
  assert.equal(await h("night", addDays(t, 3)), 8);
  assert.equal((await q1(db, `select public.pull_hours_at($1, 'morning', $2::date) as v`, [WH32, t])).v, null);
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.set_pull_shift_hours($1, $2, 0, 8)`, [WH5, t])), /มากกว่า 0/);
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.set_pull_shift_hours($1, $2, 8, 25)`, [WH5, t])), /ไม่เกิน 24/);
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.set_pull_shift_hours($1, $2, 8, 8)`, [WH5, addDays(t, -2)])), /ไม่ย้อนหลัง/);
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.set_pull_shift_hours($1, $2, 8, 8)`, [WH32, t])), /ไม่มีสิทธิ์/);
  await as(db, U.admin5, () => db.query(`select public.delete_pull_future('hours', $1, $2)`, [WH5, addDays(t, 3)]));
  assert.equal(await h("morning", addDays(t, 3)), 10);
});

test("สิทธิ์อ่าน/เขียนตรง: หัวหน้างานอ่านคลังตัวเอง พนักงานไม่เห็น แก้ตรงๆ ไม่ได้", async () => {
  const { db, tasks } = await configured();
  await as(db, U.admin5, () => db.query(`select public.set_pull_rates($1, public.pull_today(), $2)`, [WH5, JSON.stringify([{ task_id: tasks["OP ลากรับ"], per_hour: 32 }])]));
  await as(db, U.admin32, () => db.query(`select public.save_pull_workload_type(null, $1, 'งานรับ Export', 'pallet', 1, true)`, [WH32]));
  const typesSeen = (uid) => as(db, uid, async () => (await rows(db, `select name from public.pull_workload_types order by name`)).map((r) => r.name));
  assert.deepEqual(await typesSeen(U.sup5), ["งานรับ"]);
  assert.deepEqual(await typesSeen(U.admin32), ["งานรับ Export"]);
  assert.deepEqual(await typesSeen(U.exec), ["งานรับ", "งานรับ Export"]);
  assert.deepEqual(await typesSeen(U.emp5), []);
  assert.equal((await as(db, U.sup5, () => rows(db, `select 1 from public.pull_task_rates`))).length, 1);
  assert.equal((await as(db, U.emp5, () => rows(db, `select 1 from public.pull_task_rates`))).length, 0);
  // ทักษะที่ดึงได้: หัวหน้างานทุกคลังเห็นกัน (ตารางคลัง × ทักษะ) พนักงานไม่เห็น
  assert.equal((await as(db, U.admin32, () => rows(db, `select 1 from public.pull_skills where warehouse_id = $1`, [WH5]))).length, 3);
  assert.equal((await as(db, U.emp5, () => rows(db, `select 1 from public.pull_skills`))).length, 0);
  await assert.rejects(as(db, U.admin5, () => db.query(`insert into public.pull_skills (warehouse_id, skill_name) values ($1, 'x')`, [WH5])), /permission denied/);
  await assert.rejects(as(db, U.admin5, () => db.query(`update public.pull_task_rates set per_hour = 1`)), /permission denied/);
  await assert.rejects(as(db, null, () => db.query(`select public.pull_skill_counts()`)), /permission denied/);
});

test("จำนวนคนต่อทักษะ: ตัวเลขรวมแยกคลัง นับทักษะชื่อเดียวกันหลายตำแหน่งเป็นคนเดียว", async () => {
  const db = await withSkills();
  await db.exec(`
    insert into public.employee_skills (user_id, skill_id)
      select '${U.emp5}', id from public.skills where name = 'OP ลากรับ';
    insert into public.employee_skills (user_id, skill_id)
      select '${U.emp32}', id from public.skills where name = 'OP ลากรับ' and position = 'CT';
  `);
  const got = await as(db, U.sup5, () => rows(db, `select warehouse_id, skill_name, people from public.pull_skill_counts() order by warehouse_id`));
  assert.deepEqual(got.map((r) => `${r.warehouse_id === WH5 ? "WH5" : "WH32"}:${r.skill_name}:${r.people}`), ["WH5:OP ลากรับ:1", "WH32:OP ลากรับ:1"]);
  await assert.rejects(as(db, U.emp5, () => db.query(`select * from public.pull_skill_counts()`)), /ไม่มีสิทธิ์/);
});

test("ค่าเริ่มต้นจาก Excel/แอปเดิม ใส่ให้เมื่อมีคลังและทักษะตรงชื่อ", async () => {
  // จำลองฐานข้อมูลจริง: มีคลังและทักษะอยู่ก่อนรัน 0010
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const files = fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort();
  for (const f of files.filter((x) => x < "0010")) await db.exec(fs.readFileSync(new URL(f, dir), "utf8"));
  await db.exec(`
    insert into public.warehouses (id, code, name) values ('${WH5}', 'WH5', 'คลัง 5'), ('${WH32}', 'WH32', 'คลัง 32');
    insert into public.skills (position, name) values
      ('CT', 'OP ลากรับ'), ('OP', 'OP ลากรับ'), ('RT', 'RT รับ(Domestics)'), ('CT4F', 'CT4F'), ('Checker Receive', 'เช็ครับ(Domestics)'),
      ('RT', 'RT จ่าย(Domestics)'), ('OP', 'OP ลากจ่าย'), ('RT', 'RT เติม(Domestics)'), ('OP', 'Picker จ่าย'), ('Team Load', 'โหลดงาน'),
      ('CT', 'CT โหลด Domestics'), ('Checker Dispatch', 'เช็คจ่าย(Domestics)'), ('OP', 'Picker Ecommerce'), ('Checker Dispatch', 'เช็คจ่าย Ecommerce'),
      ('RT', 'RT รับ(Export)'), ('Checker Receive', 'เช็ครับ(Export)'), ('RT', 'RT จ่าย(Export)'), ('CT', 'CT โหลด Export'), ('Checker Dispatch', 'เช็คจ่าย(Export)');
  `);
  for (const f of files.filter((x) => x >= "0010")) await db.exec(fs.readFileSync(new URL(f, dir), "utf8"));

  const rate = async (wh, type, skill) =>
    Number((await q1(db, `select r.per_hour from public.pull_task_rates r join public.pull_tasks k on k.id = r.task_id
      join public.pull_workload_types t on t.id = k.workload_type_id where t.warehouse_id = $1 and t.name = $2 and k.skill_name = $3`, [wh, type, skill])).per_hour);
  assert.equal(await rate(WH5, "งานรับ", "OP ลากรับ"), 32);
  assert.equal(await rate(WH5, "งานรับ", "RT รับ(Domestics)"), 30);
  assert.equal(await rate(WH5, "งานรับ", "CT4F"), 88);
  assert.equal(await rate(WH5, "งานรับ", "เช็ครับ(Domestics)"), 60);
  assert.equal(await rate(WH5, "งานจ่าย พาเลทเต็ม", "RT จ่าย(Domestics)"), 35);
  assert.equal(await rate(WH5, "งานจ่าย พาเลทเต็ม", "OP ลากจ่าย"), 38);
  assert.equal(await rate(WH5, "งานเติม Pickface", "RT เติม(Domestics)"), 18);
  assert.equal(await rate(WH5, "งานจ่าย Picker", "Picker จ่าย"), 180);
  assert.equal(await rate(WH5, "งานโหลดสินค้า", "โหลดงาน"), 200);
  assert.equal(await rate(WH5, "งานโหลดสินค้า", "CT โหลด Domestics"), 800);
  assert.equal(await rate(WH5, "งานเช็คจ่าย", "เช็คจ่าย(Domestics)"), 700);
  assert.equal(await rate(WH5, "งานจ่าย Ecommerce", "Picker Ecommerce"), 60);
  assert.equal(await rate(WH32, "งานรับ Export", "RT รับ(Export)"), 30);
  assert.equal(await rate(WH32, "งานเช็คจ่าย Export", "เช็คจ่าย(Export)"), 700);
  const units = await rows(db, `select name, unit from public.pull_workload_types where warehouse_id = $1 order by sort_order`, [WH5]);
  assert.deepEqual(units.map((u) => `${u.name}:${u.unit}`), [
    "งานรับ:pallet", "งานจ่าย พาเลทเต็ม:pallet", "งานเติม Pickface:pallet", "งานจ่าย Picker:piece",
    "งานโหลดสินค้า:piece", "งานเช็คจ่าย:piece", "งานจ่าย Ecommerce:piece",
  ]);
  assert.equal((await rows(db, `select 1 from public.pull_skills where warehouse_id = $1`, [WH5])).length, 13);
  assert.equal((await rows(db, `select 1 from public.pull_skills where warehouse_id = $1`, [WH32])).length, 9);
  const hours = await rows(db, `select w.code, h.shift, h.hours from public.pull_shift_hours h join public.warehouses w on w.id = h.warehouse_id order by 1, 2`);
  assert.deepEqual(hours.map((h) => `${h.code}:${h.shift}:${Number(h.hours)}`), ["WH32:morning:9", "WH32:night:9", "WH5:morning:10", "WH5:night:10"]);
});
