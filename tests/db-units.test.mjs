// ทดสอบ "หน่วยงาน": หน้าร้านคลัง 5 ใช้แอปเดียวกับ WHA แต่ข้อมูลไม่ข้ามกัน (เฉพาะผู้ดูแลระบบสูงสุด/คนที่สังกัดทั้งสองฝั่งเห็นได้)
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, WH5, WH32, setup, as, rows } from "./helpers.mjs";

const SHOP_WH = "10000000-0000-0000-0000-000000000055";
const P = {
  shopEmp: "00000000-0000-0000-0000-000000000021",
  shopSup: "00000000-0000-0000-0000-000000000022",
  shopMgr: "00000000-0000-0000-0000-000000000023", // ผู้จัดการแผนกของหน้าร้าน
  whaMgr: "00000000-0000-0000-0000-000000000024", // ผู้จัดการแผนก WHA (สังกัด WH5)
  whaDiv: "00000000-0000-0000-0000-000000000025", // ผู้จัดการฝ่าย ไม่มีคลังหลัก
};
const q1 = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const codes = (db, uid, sql) => as(db, uid, async () => (await rows(db, sql)).map((r) => Object.values(r)[0]).sort());

async function world() {
  const db = await setup();
  await db.exec(`
    insert into public.units (id, code, name, modules) values ('20000000-0000-0000-0000-000000000002', 'SHOP5', 'หน้าร้านคลัง 5', '{}');
    insert into public.warehouses (id, code, name, unit_id) values ('${SHOP_WH}', 'WH5S', 'หน้าร้านคลัง 5', '20000000-0000-0000-0000-000000000002');
    insert into public.dropdown_options (category, value, label, extra) values
      ('shift_type', 'D8', '08:00-17:00', '{"start_time":"08:00","end_time":"17:00"}'),
      ('leave_type', 'sick', 'ป่วย', '{}');
  `);
  for (const [id, code, role, wh] of [
    [P.shopEmp, "SE", "employee", SHOP_WH], [P.shopSup, "SS", "supervisor", SHOP_WH], [P.shopMgr, "SM", "dept_manager", SHOP_WH],
    [P.whaMgr, "WM", "dept_manager", WH5], [P.whaDiv, "WD", "division_manager", null],
  ]) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${code.toLowerCase()}@wha.local`]);
    await db.query(`insert into public.profiles (id, employee_code, first_name_th, role, warehouse_id) values ($1, $2, $3, $4, $5)`, [id, code, `ชื่อ ${code}`, role, wh]);
  }
  const d = (await q1(db, `select public.pull_today()::text as d`)).d;
  await db.query(`insert into public.shift_schedules (user_id, work_date, shift_code) values ($1, $3, 'D8'), ($2, $3, 'D8')`, [P.shopEmp, U.emp5, d]);
  return { db, d };
}
const WHA_CODES = ["A32", "A5", "E32", "E5", "EX01", "S5", "SA01", "WD", "WM"];
const SHOP_CODES = ["SE", "SM", "SS"];

test("คลังเดิมทั้งหมดอยู่หน่วยงาน WHA และคลังใหม่ได้หน่วยงานของผู้สร้าง", async () => {
  const { db } = await world();
  assert.equal((await q1(db, `select count(*)::int n from public.warehouses w join public.units u on u.id = w.unit_id where u.code = 'WHA'`)).n, 2);
  await as(db, P.shopMgr, () => db.query(`insert into public.warehouses (code, name) values ('WH5S2', 'หน้าร้าน 2')`));
  assert.equal((await q1(db, `select u.code from public.warehouses w join public.units u on u.id = w.unit_id where w.code = 'WH5S2'`)).code, "SHOP5");
  await as(db, P.whaMgr, () => db.query(`insert into public.warehouses (code, name) values ('WH29', 'คลัง 29')`));
  assert.equal((await q1(db, `select u.code from public.warehouses w join public.units u on u.id = w.unit_id where w.code = 'WH29'`)).code, "WHA");
  await assert.rejects(
    as(db, P.whaMgr, () => db.query(`update public.warehouses set unit_id = (select id from public.units where code = 'SHOP5') where code = 'WH29'`)),
    /ผู้ดูแลระบบสูงสุด/,
  );
  await as(db, U.super, () => db.query(`update public.warehouses set unit_id = (select id from public.units where code = 'SHOP5') where code = 'WH29'`));
});

test("เห็นพนักงานเฉพาะหน่วยงานตัวเอง (ผู้จัดการ หัวหน้า พนักงาน) / ผู้ดูแลระบบสูงสุดเห็นทั้งหมด", async () => {
  const { db } = await world();
  const all = `select employee_code from public.profiles`;
  assert.deepEqual(await codes(db, P.whaMgr, all), WHA_CODES, "ผู้จัดการ WHA ไม่เห็นหน้าร้าน");
  assert.deepEqual(await codes(db, P.whaDiv, all), WHA_CODES, "ผู้จัดการฝ่าย (ไม่มีคลังหลัก) อยู่ WHA");
  assert.deepEqual(await codes(db, P.shopMgr, all), SHOP_CODES, "ผู้จัดการหน้าร้านไม่เห็น WHA");
  assert.deepEqual(await codes(db, P.shopSup, all), SHOP_CODES);
  assert.deepEqual(await codes(db, P.shopEmp, all), ["SE"]);
  assert.equal((await codes(db, U.super, all)).length, WHA_CODES.length + SHOP_CODES.length);
  assert.deepEqual(await codes(db, P.whaMgr, `select code from public.warehouses`), ["WH32", "WH5"]);
  assert.deepEqual(await codes(db, P.shopMgr, `select code from public.warehouses`), ["WH5S"]);
  assert.deepEqual(await codes(db, P.shopMgr, `select code from public.units`), ["SHOP5"]);
});

test("แอดมินที่สังกัดทั้งคลัง 5 และหน้าร้าน เห็นและดูแลได้ทั้งสองฝั่ง", async () => {
  const { db } = await world();
  await db.query(`insert into public.user_warehouses (user_id, warehouse_id) values ($1, $2)`, [U.admin5, SHOP_WH]);
  const seen = await codes(db, U.admin5, `select employee_code from public.profiles`);
  assert.ok(seen.includes("SE") && seen.includes("E5"));
  assert.equal((await as(db, U.admin5, () => q1(db, `select public.can_approve_user($1) ok`, [P.shopEmp]))).ok, true);
  assert.equal((await as(db, U.admin5, () => q1(db, `select public.can_supervise_warehouse($1) ok`, [SHOP_WH]))).ok, true);
});

test("ตารางกะ/ลงเวลา/สิทธิ์ระดับคลัง: ข้ามหน่วยงานไม่ได้ทั้งดูและแก้", async () => {
  const { db, d } = await world();
  const shifts = `select p.employee_code from public.shift_schedules s join public.profiles p on p.id = s.user_id`;
  assert.deepEqual(await codes(db, P.whaMgr, shifts), ["E5"]);
  assert.deepEqual(await codes(db, P.shopMgr, shifts), ["SE"]);
  for (const [uid, wh, ok] of [[P.whaMgr, SHOP_WH, false], [P.whaMgr, WH32, true], [P.shopMgr, WH5, false], [P.shopMgr, SHOP_WH, true], [U.super, SHOP_WH, true]]) {
    assert.equal((await as(db, uid, () => q1(db, `select public.can_manage_warehouse($1) ok`, [wh]))).ok, ok, `${uid} ${wh}`);
    assert.equal((await as(db, uid, () => q1(db, `select public.can_supervise_warehouse($1) ok`, [wh]))).ok, ok);
  }
  await assert.rejects(
    as(db, P.whaMgr, () => db.query(`select public.apply_shifts($1, $2, 'e2e')`, [SHOP_WH, JSON.stringify([{ user_id: P.shopEmp, work_date: d, shift_code: "D8" }])])),
  );
  assert.equal((await as(db, P.whaMgr, () => rows(db, `update public.shift_schedules set note = 'x' where user_id = $1 returning 1`, [P.shopEmp]))).length, 0);
  await assert.rejects(as(db, P.whaMgr, () => db.query(`select * from public.warehouse_attendance($1, $2, $2)`, [SHOP_WH, d])), /สิทธิ์/);
  const dash = await as(db, P.shopMgr, () => rows(db, `select code from public.dashboard_summary($1)`, [d]));
  assert.deepEqual(dash.map((r) => r.code), ["WH5S"]);
});

test("อนุมัติและแจ้งเตือน: อยู่ในหน่วยงานเดียวกันเท่านั้น", async () => {
  const { db } = await world();
  const can = (uid, target) => as(db, uid, async () => (await q1(db, `select public.can_approve_user($1) ok`, [target])).ok);
  assert.equal(await can(P.whaMgr, P.shopSup), false, "ผู้จัดการ WHA อนุมัติหัวหน้าหน้าร้านไม่ได้");
  assert.equal(await can(P.whaDiv, P.shopMgr), false);
  assert.equal(await can(P.shopMgr, P.shopSup), true);
  assert.equal(await can(P.shopMgr, U.sup5), false);
  assert.equal(await can(U.super, P.shopMgr), true);
  const inbox = (uid) => rows(db, `select kind from public.notifications where user_id = $1`, [uid]).then((r) => r.map((x) => x.kind));
  await as(db, P.shopSup, () => db.query(`select public.submit_leave('sick', '2026-12-02', '2026-12-02', 'full', 'ทดสอบ')`));
  assert.deepEqual(await inbox(P.shopMgr), ["leave_pending"], "ใบลาหัวหน้าหน้าร้านไปหาผู้จัดการหน้าร้าน");
  assert.deepEqual(await inbox(P.whaMgr), [], "ไม่ไปหาผู้จัดการ WHA");
  // หน้าร้านไม่มีผู้จัดการ → ผู้ดูแลระบบสูงสุด (ไม่ข้ามไปหาผู้จัดการ WHA)
  await db.query(`update public.profiles set status = 'resigned' where id = $1`, [P.shopMgr]);
  await as(db, P.shopSup, () => db.query(`select public.submit_leave('sick', '2026-12-03', '2026-12-03', 'full', 'ทดสอบ')`));
  assert.deepEqual(await inbox(P.whaMgr), []);
  assert.deepEqual(await inbox(P.whaDiv), []);
  assert.deepEqual(await inbox(U.super), ["leave_pending"]);
});

test("ระบบดึงคน: หน้าร้านไม่อยู่ในคลังกลาง ภาพรวม และตั้งค่า Pull ไม่ได้", async () => {
  const { db, d } = await world();
  const pool = await as(db, U.sup5, () => rows(db, `select employee_code from public.pull_pool($1, $2, 'morning')`, [WH5, d]));
  assert.ok(pool.some((r) => r.employee_code === "E5"));
  assert.ok(!pool.some((r) => r.employee_code === "SE"), "คนหน้าร้านไม่ถูกดึงไป WHA");
  await assert.rejects(as(db, U.super, () => db.query(`select * from public.pull_pool($1, $2, 'morning')`, [SHOP_WH, d])), /ไม่ได้ใช้ระบบดึงคน/);
  await db.exec(`insert into public.skills (position, name) values ('RT', 'x');
    insert into public.employee_skills (user_id, skill_id) select '${P.shopEmp}', id from public.skills where name = 'x';`);
  await as(db, U.admin5, () => db.query(`select public.set_pull_skills($1, $2)`, [WH5, ["x"]]));
  const r = await as(db, U.sup5, () => q1(db, `select public.book_pull($1, $2, 'morning', $3) r`, [WH5, d, JSON.stringify([{ user_id: P.shopEmp, skill: "x" }])]));
  assert.equal(r.r.booked, 0, "จองคนหน้าร้านเข้า WHA ไม่ได้");
  await assert.rejects(db.query(`insert into public.pull_bookings (user_id, to_warehouse_id, work_date, shift, skill_name) values ($1, $2, $3, 'morning', 'x')`, [P.shopEmp, WH5, d]), /ข้ามหน่วยงาน/);
  const net = await as(db, U.super, () => rows(db, `select distinct wh_code from public.pull_network($1, $1, 'morning')`, [d]));
  assert.deepEqual(net.map((r) => r.wh_code).sort(), ["WH32", "WH5"]);
  assert.equal((await as(db, U.super, () => q1(db, `select public.can_config_pull($1) ok`, [SHOP_WH]))).ok, false);
  assert.deepEqual((await as(db, P.shopEmp, () => q1(db, `select public.my_modules() m`))).m, []);
  assert.deepEqual((await as(db, U.emp5, () => q1(db, `select public.my_modules() m`))).m, ["pull"]);
});

test("ข้อมูลกลาง (อัตรา กฎ รหัสกะ วันหยุด) แก้ได้เฉพาะคนหน่วยงานหลัก", async () => {
  const { db } = await world();
  await assert.rejects(
    as(db, P.shopMgr, () => db.query(`insert into public.dropdown_options (category, value, label) values ('position', 'ใหม่', 'ใหม่')`)),
    /หน่วยงานหลัก/,
  );
  await assert.rejects(as(db, P.shopMgr, () => db.query(`insert into public.holidays (holiday_date, name) values ('2026-12-31', 'x')`)), /หน่วยงานหลัก/);
  await as(db, P.whaMgr, () => db.query(`insert into public.dropdown_options (category, value, label) values ('position', 'ใหม่', 'ใหม่')`));
  assert.ok((await as(db, P.shopMgr, () => rows(db, `select 1 from public.dropdown_options where category = 'shift_type'`))).length > 0, "หน้าร้านยังอ่านรหัสกะร่วมได้");
});

test("เบี้ยขยัน: คลังในค่าตั้งค่า diligence.excluded_warehouses ไม่มีเบี้ยขยัน", async () => {
  const { db } = await world();
  const who = async () => (await rows(db, `select user_id from public.diligence_core($1, '2026-12-01', now())`, [[P.shopEmp, U.emp5]])).map((r) => r.user_id);
  assert.deepEqual((await who()).sort(), [U.emp5, P.shopEmp].sort());
  await db.query(`insert into public.app_settings (key, effective_from, value) values ('diligence.excluded_warehouses', '2026-01-01', '["WH5S"]')`);
  assert.deepEqual(await who(), [U.emp5]);
});

test("เพิ่ม/แก้หน่วยงาน: เฉพาะผู้ดูแลระบบสูงสุด รหัสห้ามซ้ำ แก้ได้แค่ชื่อและเมนูเสริม", async () => {
  const { db } = await world();
  const save = (uid, id, code, name, mods) => as(db, uid, () => q1(db, `select public.save_unit($1, $2, $3, $4) id`, [id, code, name, mods]));
  await assert.rejects(save(P.whaMgr, null, "X1", "x", []), /ผู้ดูแลระบบสูงสุด/);
  await assert.rejects(save(U.super, null, "SHOP5", "ซ้ำ", []), /มีอยู่แล้ว/);
  await assert.rejects(save(U.super, null, "x y", "x", []), /A-Z/);
  await assert.rejects(save(U.super, null, "X1", "x", ["hr"]), /เมนูเสริม/);
  const { id } = await save(U.super, null, "ecom", "อีคอมเมิร์ซ", ["pull", "pull"]);
  assert.deepEqual(await q1(db, `select code, modules from public.units where id = $1`, [id]), { code: "ECOM", modules: ["pull"] });
  await save(U.super, id, "IGNORED", "อีคอมเมิร์ซ 2", []);
  assert.deepEqual(await q1(db, `select code, name, modules from public.units where id = $1`, [id]), { code: "ECOM", name: "อีคอมเมิร์ซ 2", modules: [] });
});
