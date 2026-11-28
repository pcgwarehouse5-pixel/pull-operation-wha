// ทดสอบ migration 0039: ลาเป็นชั่วโมง (หน้าร้าน) · แบบฟอร์มลางาน · เกณฑ์ขั้นต่ำ OT แยกประเภทพนักงาน — ข้อมูลสมมติทั้งหมด
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, WH5, setup, as, rows } from "./helpers.mjs";

const SHOP_UNIT = "20000000-0000-0000-0000-000000000002";
const SHOP_WH = "10000000-0000-0000-0000-0000000000a5";
const P = {
  shopSup: "00000000-0000-0000-0000-0000000000a1",
  shopEmp: "00000000-0000-0000-0000-0000000000a2",
};
const q1 = async (db, sql, params) => (await db.query(sql, params)).rows[0];

async function base() {
  const db = await setup();
  await db.exec(`
    insert into public.units (id, code, name, modules) values ('${SHOP_UNIT}', 'SHOP5', 'หน้าร้านคลัง 5', '{leave_hours,shop_forms}');
    insert into public.warehouses (id, code, name, unit_id) values ('${SHOP_WH}', 'WH5S', 'หน้าร้านคลัง 5', '${SHOP_UNIT}');
    insert into public.dropdown_options (category, value, label, extra) values
      ('shift_type', 'STD1', '08:00-17:00', '{"start_time":"08:00","end_time":"17:00"}'),
      ('leave_type', 'sick', 'ป่วย', '{}'), ('leave_type', 'personal', 'กิจ', '{}'),
      ('leave_type', 'vacation', 'พักผ่อน', '{}'), ('leave_type', 'ordination', 'บวช', '{}');
    insert into public.app_settings (key, effective_from, value) values ('leave.quota', '2027-01-01', '{"sick": 30, "personal": 6, "vacation": 12}');
  `);
  for (const [id, code, role] of [[P.shopSup, "SS1", "supervisor"], [P.shopEmp, "SE1", "employee"]]) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${code.toLowerCase()}@wha.local`]);
    await db.query(`insert into public.profiles (id, employee_code, first_name_th, role, warehouse_id) values ($1, $2, $3, $4, $5)`, [id, code, `ชื่อ ${code}`, role, SHOP_WH]);
  }
  return db;
}

const submit = (db, uid, args) =>
  as(db, uid, async () =>
    (await q1(db, `select public.submit_leave($1, $2, $3, $4, $5, null, $6, $7, $8) as id`, [
      args.type ?? "personal", args.date, args.end ?? args.date, args.period ?? "hours", args.reason ?? null, args.user ?? null, args.time ?? null, args.hours ?? null,
    ])).id,
  );

test("ลาเป็นชั่วโมง: หน้าร้านลาได้ · 2 ชม. = 0.25 วัน · ตรวจประเภท/จำนวน/ทีละชั่วโมง/วันเดียว", async () => {
  const db = await base();
  const id = await submit(db, P.shopEmp, { date: "2027-03-02", time: "10:00", hours: 2, reason: "ธุระธนาคาร" });
  const r = await q1(db, `select period, days::float d, hours::float h, start_time::text t, steps_required from public.leave_requests where id = $1`, [id]);
  assert.deepEqual(r, { period: "hours", d: 0.25, h: 2, t: "10:00:00", steps_required: 1 });

  await assert.rejects(submit(db, P.shopEmp, { type: "ordination", date: "2027-03-03", time: "10:00", hours: 2 }), /ลาเป็นชั่วโมงไม่ได้/);
  await assert.rejects(submit(db, P.shopEmp, { date: "2027-03-03", time: "10:00", hours: 8 }), /ไม่ถึง 8 ชั่วโมง/);
  await assert.rejects(submit(db, P.shopEmp, { date: "2027-03-03", time: "10:00", hours: 1.5 }), /ทีละ 60 นาที/);
  await assert.rejects(submit(db, P.shopEmp, { date: "2027-03-03", time: null, hours: 2 }), /เวลาเริ่มลา/);
  await assert.rejects(submit(db, P.shopEmp, { date: "2027-03-03", end: "2027-03-04", time: "10:00", hours: 2 }), /วันเดียว/);
  await assert.rejects(submit(db, P.shopEmp, { date: "2027-03-03", time: "23:00", hours: 2 }), /ข้ามเที่ยงคืน/);

  // ทีละ 30 นาทีได้ถ้าตั้งค่า
  await db.exec(`insert into public.app_settings (key, effective_from, value) values ('leave.hour_step_minutes', '2027-01-01', '30')`);
  const id2 = await submit(db, P.shopEmp, { date: "2027-03-05", time: "08:00", hours: 1.5 });
  assert.equal((await q1(db, `select days::float d from public.leave_requests where id = $1`, [id2])).d, 0.188);
});

test("ลาเป็นชั่วโมง: เวลาไม่ทับกันยื่นวันเดียวกันได้ · ทับกัน/วันที่มีลาเต็มวันไม่ได้ · คลัง WHA ลาเป็นชั่วโมงไม่ได้", async () => {
  const db = await base();
  await submit(db, P.shopEmp, { date: "2027-03-02", time: "08:00", hours: 2 });
  await submit(db, P.shopEmp, { date: "2027-03-02", time: "15:00", hours: 2 }); // ไม่ทับ
  await assert.rejects(submit(db, P.shopEmp, { date: "2027-03-02", time: "09:00", hours: 1 }), /มีใบลาในช่วงวันที่นี้อยู่แล้ว/);
  await assert.rejects(submit(db, P.shopEmp, { date: "2027-03-02", period: "full" }), /มีใบลาในช่วงวันที่นี้อยู่แล้ว/);
  await submit(db, P.shopEmp, { date: "2027-03-08", period: "full" });
  await assert.rejects(submit(db, P.shopEmp, { date: "2027-03-08", time: "08:00", hours: 1 }), /มีใบลาในช่วงวันที่นี้อยู่แล้ว/);

  await assert.rejects(submit(db, U.emp5, { date: "2027-03-02", time: "10:00", hours: 2 }), /ยังไม่เปิดให้ลาเป็นชั่วโมง/);
  // ลาแบบเดิมของคลัง WHA ยังใช้ได้ (ลายมือชื่อฟังก์ชันเดิม 7 ช่อง)
  const old = await as(db, U.emp5, async () => (await q1(db, `select public.submit_leave('sick', '2027-03-02', '2027-03-02', 'morning', 'ไข้', null, null) as id`)).id);
  assert.equal((await q1(db, `select days::float d from public.leave_requests where id = $1`, [old])).d, 0.5);
});

test("ลาเป็นชั่วโมง: หัวหน้าอนุมัติ → แจ้งเตือนบอกชั่วโมง · สิทธิ์คงเหลือหักเป็นเศษวัน · สถานะลงเวลาเป็นลาบางส่วน", async () => {
  const db = await base();
  const id = await submit(db, P.shopEmp, { type: "vacation", date: "2027-03-02", time: "13:00", hours: 4 });
  const note = await q1(db, `select title, body from public.notifications where kind = 'leave_pending' order by id desc limit 1`);
  assert.match(note.body, /ลาพักผ่อน 4 ชม\. \(.*13:00–17:00\)/);
  await as(db, P.shopSup, () => db.query(`select public.decide_leave($1, true, null)`, [id]));
  assert.equal((await q1(db, `select status from public.leave_requests where id = $1`, [id])).status, "approved");
  const bal = await as(db, P.shopEmp, () => q1(db, `select remaining::float r from public.leave_balance(2027) where leave_type = 'vacation'`));
  assert.equal(bal.r, 11.5);
  const att = await q1(db, `select status, leave_period from public.attendance_rows_core(array[$1]::uuid[], '2027-03-02', '2027-03-02', '2027-03-03 12:00+07')`, [P.shopEmp]);
  assert.deepEqual(att, { status: "leave_half", leave_period: "hours" });
});

test("แบบฟอร์มลางาน: หัวหน้าหน้าร้านดูได้ (ใบที่อนุมัติแล้วของปีนั้น + สิทธิ์ลาพักผ่อน) · คลัง WHA / พนักงาน ดูไม่ได้", async () => {
  const db = await base();
  const a = await submit(db, P.shopEmp, { type: "vacation", date: "2027-03-02", time: "13:00", hours: 4 });
  const b = await submit(db, P.shopEmp, { type: "sick", date: "2027-04-05", end: "2027-04-06", period: "full" });
  await submit(db, P.shopEmp, { type: "personal", date: "2027-05-05", time: "08:00", hours: 1 }); // ยังไม่อนุมัติ → ไม่ขึ้น
  for (const id of [a, b]) await as(db, P.shopSup, () => db.query(`select public.decide_leave($1, true, null)`, [id]));

  const r = await as(db, P.shopSup, () =>
    rows(db, `select user_id, leave_type, period, hours::float h, days::float d, approved_by, vacation_quota::float q from public.leave_form_rows($1, 2027)`, [SHOP_WH]),
  );
  const mine = r.filter((x) => x.user_id === P.shopEmp);
  assert.deepEqual(mine.map((x) => [x.leave_type, x.period, x.h, x.d, x.q]), [["vacation", "hours", 4, 0.5, 12], ["sick", "full", null, 2, 12]]);
  assert.ok(mine[0].approved_by, "มีชื่อผู้อนุมัติ");
  assert.ok(r.some((x) => x.user_id === P.shopSup && x.leave_type === null), "คนที่ไม่มีใบลาก็ได้แถวว่าง (พิมพ์ฟอร์มเปล่าได้)");

  await assert.rejects(as(db, P.shopEmp, () => db.query(`select * from public.leave_form_rows($1, 2027)`, [SHOP_WH])), /ไม่มีสิทธิ์/);
  await assert.rejects(as(db, U.admin5, () => db.query(`select * from public.leave_form_rows($1, 2027)`, [SHOP_WH])), /ไม่มีสิทธิ์/);
  await assert.rejects(as(db, U.admin5, () => db.query(`select * from public.leave_form_rows($1, 2027)`, [WH5])), /ไม่ได้เปิดแบบฟอร์มลางาน/);
  await assert.rejects(as(db, null, () => db.query(`select * from public.leave_form_rows($1, 2027)`, [SHOP_WH])), /permission denied/);
});

test("OT ตั้งแต่ 1 ธ.ค. 2569: MOU ต้องเกินเลิกกะครบ 60 นาที · ประเภทอื่นครบ 30 นาที · ก่อนวันนั้นทุกคน 60 นาทีแบบเดิม", async () => {
  const db = await base();
  await db.exec(`
    update public.warehouses set latitude = 13.0, longitude = 100.0, checkin_radius_m = 100 where id = '${WH5}';
    update public.profiles set employment_type = 'mou' where id = '${U.emp5}';
    update public.profiles set employment_type = 'monthly_employee' where id = '${U.sup5}';
  `);
  const punch = (u, k, at) => db.query(`select public.punch_core($1, $2, $3::timestamptz, 13.0, 100.0, 5)`, [u, k, at]);
  const work = async (u, d, out) => {
    await db.query(`insert into public.shift_schedules (user_id, work_date, shift_code) values ($1, $2, 'STD1')`, [u, d]);
    await punch(u, "in", `${d} 07:50+07`);
    await punch(u, "out", `${d} ${out}+07`);
  };
  for (const u of [U.emp5, U.sup5]) {
    await work(u, "2026-11-30", "17:35"); // ก่อนเริ่มกฎใหม่
    await work(u, "2026-12-02", "17:35");
    await work(u, "2026-12-03", "18:35");
    await work(u, "2026-12-04", "17:25");
  }
  const r = await rows(db, `select user_id, work_date::text d, ot_hours::float oh from public.ot_rows_core($1::uuid[], '2026-11-30', '2026-12-04', '2027-01-15 12:00+07') order by user_id, work_date`, [[U.emp5, U.sup5]]);
  const of = (u) => r.filter((x) => x.user_id === u).map((x) => [x.d, x.oh]);
  assert.deepEqual(of(U.emp5), [["2026-12-03", 1.5]], "MOU: 35 นาทีไม่ได้ · 95 นาที → 1.5");
  assert.deepEqual(of(U.sup5), [["2026-12-02", 0.5], ["2026-12-03", 1.5]], "คนไทย: 35 นาที → 0.5 · 25 นาทีไม่ได้ · 30 พ.ย. ยังใช้ 60 นาที");

  // ตั้งค่าเป็นตัวเลขเดียว (แบบเดิม) ยังใช้ได้
  await db.exec(`insert into public.app_settings (key, effective_from, value) values ('ot.min_minutes', '2026-12-03', '0')`);
  const r2 = await rows(db, `select ot_hours::float oh from public.ot_rows_core($1::uuid[], '2026-12-04', '2026-12-04', '2027-01-15 12:00+07')`, [[U.emp5]]);
  assert.deepEqual(r2, [], "25 นาที ปัดลงทีละ 30 → 0");
});

test("วันที่เริ่มงาน: แอดมินคลังแก้ได้ · พนักงานแก้ของตัวเองไม่ได้ · เมนูเสริมหน่วยงานใหม่บันทึกได้", async () => {
  const db = await base();
  await as(db, U.admin5, () => db.query(`update public.profiles set hire_date = '2020-05-01' where id = $1`, [U.emp5]));
  assert.equal((await q1(db, `select hire_date::text h from public.profiles where id = $1`, [U.emp5])).h, "2020-05-01");
  await assert.rejects(as(db, U.emp5, () => db.query(`update public.profiles set hire_date = '2010-01-01' where id = $1`, [U.emp5])), /แก้ได้เฉพาะ/);
  await as(db, U.super, () => db.query(`select public.save_unit($1, 'SHOP5', 'หน้าร้านคลัง 5', '{shop_forms}')`, [SHOP_UNIT]));
  assert.deepEqual((await q1(db, `select modules from public.units where id = $1`, [SHOP_UNIT])).modules, ["shop_forms"]);
  await assert.rejects(submit(db, P.shopEmp, { date: "2027-03-02", time: "10:00", hours: 2 }), /ยังไม่เปิดให้ลาเป็นชั่วโมง/);
  await assert.rejects(as(db, U.super, () => db.query(`select public.save_unit($1, 'SHOP5', 'x', '{bogus}')`, [SHOP_UNIT])), /เมนูเสริมไม่ถูกต้อง/);
});
