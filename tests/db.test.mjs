// ทดสอบไฟล์ SQL จริงบน Postgres จำลองในเครื่อง (ไม่แตะ Supabase จริง)
// รัน: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// ผู้ใช้ทดสอบ (id สมมติ)
const U = {
  super: "00000000-0000-0000-0000-000000000001",
  exec: "00000000-0000-0000-0000-000000000002",
  admin5: "00000000-0000-0000-0000-000000000003",
  admin32: "00000000-0000-0000-0000-000000000004",
  sup5: "00000000-0000-0000-0000-000000000005",
  emp5: "00000000-0000-0000-0000-000000000006",
  emp32: "00000000-0000-0000-0000-000000000007",
};
const WH5 = "10000000-0000-0000-0000-000000000005";
const WH32 = "10000000-0000-0000-0000-000000000032";

// จำลองส่วนที่ Supabase มีให้อยู่แล้ว (schema auth, บทบาท anon/authenticated, สิทธิ์ตั้งต้น)
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

async function setup() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await db.exec(fs.readFileSync(new URL(f, dir), "utf8"));
  }
  // งานตั้งต้นทำแบบ "เซิร์ฟเวอร์" (ไม่มีผู้ใช้ล็อกอิน) เหมือนสคริปต์ย้ายข้อมูล
  await db.exec(`
    insert into public.warehouses (id, code, name) values ('${WH5}', 'WH5', 'คลัง 5'), ('${WH32}', 'WH32', 'คลัง 32');
  `);
  const people = [
    [U.super, "SA01", "super_admin", null],
    [U.exec, "EX01", "executive", null],
    [U.admin5, "A5", "admin", WH5],
    [U.admin32, "A32", "admin", WH32],
    [U.sup5, "S5", "supervisor", WH5],
    [U.emp5, "E5", "employee", WH5],
    [U.emp32, "E32", "employee", WH32],
  ];
  for (const [id, code, role, wh] of people) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${code.toLowerCase()}@wha.local`]);
    await db.query(
      `insert into public.profiles (id, employee_code, first_name_th, role, warehouse_id) values ($1, $2, $3, $4, $5)`,
      [id, code, `ชื่อ ${code}`, role, wh],
    );
  }
  return db;
}

// ทำคำสั่งในนามผู้ใช้คนหนึ่ง (เหมือนเรียกจากแอปหลังล็อกอิน)
async function as(db, uid, fn) {
  await db.exec(`set role ${uid ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

const rows = async (db, sql, params) => (await db.query(sql, params)).rows;
const codesSeenBy = (db, uid) =>
  as(db, uid, async () => (await rows(db, `select employee_code from public.profiles order by employee_code`)).map((r) => r.employee_code));

test("คนที่ไม่ได้ล็อกอินเข้าถึงข้อมูลไม่ได้", async () => {
  const db = await setup();
  await as(db, null, async () => {
    await assert.rejects(db.query(`select * from public.profiles`), /permission denied/);
    await assert.rejects(db.query(`select * from public.warehouses`), /permission denied/);
    await assert.rejects(db.query(`select public.my_role()`), /permission denied/);
  });
});

test("แต่ละบทบาทเห็นรายชื่อเฉพาะคลังที่ดูแล", async () => {
  const db = await setup();
  assert.deepEqual(await codesSeenBy(db, U.emp5), ["E5"], "พนักงานเห็นแค่ตัวเอง");
  assert.deepEqual(await codesSeenBy(db, U.sup5), ["A5", "E5", "S5"], "หัวหน้างานเห็นคนในคลัง 5");
  assert.deepEqual(await codesSeenBy(db, U.admin32), ["A32", "E32"], "แอดมินคลัง 32 ไม่เห็นคลัง 5");
  assert.equal((await codesSeenBy(db, U.exec)).length, 7, "ผู้บริหารเห็นทุกคน");

  // ให้แอดมินคลัง 32 ดูแลคลัง 5 เพิ่ม → เห็นทั้ง 2 คลัง
  await as(db, U.super, () => db.query(`select public.set_user_access($1, 'admin', $2, $3)`, [U.admin32, WH32, [WH5]]));
  assert.equal((await codesSeenBy(db, U.admin32)).length, 5);
});

test("พนักงานแก้ได้เฉพาะช่องติดต่อของตัวเอง", async () => {
  const db = await setup();
  await as(db, U.emp5, async () => {
    await db.query(`update public.profiles set nickname = 'ต้น', phone = '0810000000' where id = $1`, [U.emp5]);
    await assert.rejects(db.query(`update public.profiles set position = 'Supervisor' where id = $1`, [U.emp5]), /แก้ได้เฉพาะ/);
    // ช่องสำคัญถูกปิดสิทธิ์ตั้งแต่ระดับคอลัมน์
    await assert.rejects(db.query(`update public.profiles set role = 'super_admin' where id = $1`, [U.emp5]), /permission denied/);
    await assert.rejects(db.query(`update public.profiles set warehouse_id = $2 where id = $1`, [U.emp5, WH32]), /permission denied/);
    await assert.rejects(db.query(`update public.profiles set must_change_password = false where id = $1`, [U.emp5]), /permission denied/);
    // แก้ของคนอื่นไม่ได้ (มองไม่เห็นแถว)
    const r = await db.query(`update public.profiles set nickname = 'x' where id = $1`, [U.emp32]);
    assert.equal(r.affectedRows, 0);
    await assert.rejects(db.query(`insert into public.profiles (id, employee_code, first_name_th) values ($1, 'X', 'x')`, [U.emp5]), /permission denied/);
    await assert.rejects(db.query(`delete from public.profiles where id = $1`, [U.emp5]), /permission denied/);
  });
  const me = (await rows(db, `select nickname, phone from public.profiles where id = $1`, [U.emp5]))[0];
  assert.deepEqual(me, { nickname: "ต้น", phone: "0810000000" });
});

test("แอดมินแก้ข้อมูลพนักงานได้เฉพาะคลังตัวเอง", async () => {
  const db = await setup();
  await as(db, U.admin5, async () => {
    await db.query(`update public.profiles set position = 'Picker' where id = $1`, [U.emp5]);
    const r = await db.query(`update public.profiles set position = 'Picker' where id = $1`, [U.emp32]);
    assert.equal(r.affectedRows, 0, "แอดมินคลัง 5 แก้คนคลัง 32 ไม่ได้");
  });
  // หัวหน้างานดูได้แต่แก้ข้อมูลพนักงานไม่ได้ (ไม่มีแถวไหนถูกแก้)
  const sup = await as(db, U.sup5, () => db.query(`update public.profiles set position = 'RT' where id = $1`, [U.emp5]));
  assert.equal(sup.affectedRows, 0);
  assert.equal((await rows(db, `select position from public.profiles where id = $1`, [U.emp5]))[0].position, "Picker");
  // ผู้บริหารแก้ได้ทุกคลังเหมือนแอดมิน
  await as(db, U.exec, () => db.query(`update public.profiles set position = 'RT' where id = $1`, [U.emp32]));
  assert.equal((await rows(db, `select position from public.profiles where id = $1`, [U.emp32]))[0].position, "RT");
});

test("การกำหนดบทบาทเป็นไปตามลำดับขั้น", async () => {
  const db = await setup();
  const access = (uid, target, role, home, extra = []) =>
    as(db, uid, () => db.query(`select public.set_user_access($1, $2, $3, $4)`, [target, role, home, extra]));

  // แอดมิน: ตั้งหัวหน้างานในคลังตัวเองได้ แต่ตั้งแอดมิน/ข้ามคลัง/ตัวเองไม่ได้
  await access(U.admin5, U.emp5, "supervisor", WH5);
  await assert.rejects(access(U.admin5, U.emp5, "admin", WH5), /กำหนดบทบาทนี้ไม่ได้/);
  await assert.rejects(access(U.admin5, U.emp32, "supervisor", WH32), /ไม่มีสิทธิ์จัดการผู้ใช้คลังนี้/);
  await assert.rejects(access(U.admin5, U.admin5, "admin", WH5), /ของตัวเอง/);
  await assert.rejects(access(U.admin5, U.emp5, "employee", WH32), /ย้ายผู้ใช้ไปคลังนี้/);
  // หัวหน้างานกำหนดบทบาทไม่ได้เลย
  await assert.rejects(access(U.sup5, U.emp5, "employee", WH5), /ไม่มีสิทธิ์กำหนดบทบาท/);

  // ผู้บริหาร: ตั้งแอดมินได้ทุกคลัง แต่ตั้งผู้บริหารไม่ได้ และแก้ผู้บริหารคนอื่นไม่ได้
  await access(U.exec, U.emp32, "admin", WH32, [WH5]);
  await assert.rejects(access(U.exec, U.emp5, "executive", WH5), /กำหนดบทบาทนี้ไม่ได้/);
  await assert.rejects(access(U.exec, U.super, "employee", null), /เท่ากับหรือสูงกว่า/);

  // ผู้ดูแลระบบสูงสุด: ตั้งผู้บริหารได้ แต่ลดตัวเองคนสุดท้ายไม่ได้
  await access(U.super, U.admin5, "executive", WH5);
  await assert.rejects(access(U.super, U.super, "employee", null), /ของตัวเอง/);

  const roles = Object.fromEntries((await rows(db, `select employee_code, role from public.profiles`)).map((r) => [r.employee_code, r.role]));
  assert.equal(roles.E5, "supervisor");
  assert.equal(roles.E32, "admin");
  assert.equal(roles.A5, "executive");
  const extra = await rows(db, `select warehouse_id from public.user_warehouses where user_id = $1`, [U.emp32]);
  assert.deepEqual(extra.map((r) => r.warehouse_id), [WH5]);
});

test("ต้องมีผู้ดูแลระบบสูงสุดเหลืออย่างน้อย 1 คน", async () => {
  const db = await setup();
  await db.query(`update public.profiles set role = 'super_admin' where id = $1`, [U.exec]);
  // มี 2 คน: ลดอีกคนได้
  await as(db, U.super, () => db.query(`select public.set_user_access($1, 'executive', null)`, [U.exec]));
  // เหลือคนเดียว: ลดไม่ได้ (ทดสอบผ่านผู้ดูแลอีกคนที่เพิ่มชั่วคราว)
  await db.query(`update public.profiles set role = 'super_admin' where id = $1`, [U.exec]);
  await db.query(`update public.profiles set status = 'resigned' where id = $1`, [U.super]);
  await assert.rejects(
    as(db, U.exec, () => db.query(`select public.set_user_access($1, 'employee', null)`, [U.exec])),
    /ของตัวเอง/,
  );
});

test("คนที่ลาออกแล้วไม่มีสิทธิ์ใดๆ", async () => {
  const db = await setup();
  await db.query(`update public.profiles set status = 'resigned' where id = $1`, [U.admin5]);
  assert.deepEqual(await codesSeenBy(db, U.admin5), ["A5"], "เห็นแค่ข้อมูลตัวเอง");
  const r = await as(db, U.admin5, () => db.query(`update public.profiles set position = 'x' where id = $1`, [U.emp5]));
  assert.equal(r.affectedRows, 0);
});

test("คลัง: ทุกคนดูได้ เฉพาะผู้ดูแลระบบสูงสุดเพิ่ม/แก้ได้", async () => {
  const db = await setup();
  const ins = `insert into public.warehouses (code, name) values ('WH29', 'คลัง 29')`;
  assert.equal((await as(db, U.emp5, () => rows(db, `select code from public.warehouses`))).length, 2);
  await assert.rejects(as(db, U.exec, () => db.query(ins)), /row-level security/);
  await assert.rejects(as(db, U.admin5, () => db.query(ins)), /row-level security/);
  await as(db, U.super, () => db.query(ins));
  await assert.rejects(as(db, U.super, () => db.query(`insert into public.warehouses (code, name) values ('wh 1', 'x')`)), /warehouses_code_format/);
  assert.equal((await rows(db, `select count(*)::int as n from public.warehouses`))[0].n, 3);
});

test("ตัวเลือกตั้งค่า: ทุกคนอ่านได้ แอดมินขึ้นไปแก้ได้", async () => {
  const db = await setup();
  const ins = `insert into public.dropdown_options (category, value, label) values ('position', 'RT', 'RT')`;
  await assert.rejects(as(db, U.sup5, () => db.query(ins)), /row-level security/);
  await as(db, U.admin5, () => db.query(ins));
  assert.equal((await as(db, U.emp5, () => rows(db, `select value from public.dropdown_options`))).length, 1);
});

test("ประวัติการใช้งาน: บันทึกอัตโนมัติ และแก้/ลบไม่ได้", async () => {
  const db = await setup();
  await as(db, U.admin5, () => db.query(`update public.profiles set position = 'Picker' where id = $1`, [U.emp5]));
  await as(db, U.emp5, () => db.query(`select public.log_login()`));

  const log = (await rows(db, `select actor_id, action, table_name, warehouse_id, old_data->>'position' as before, new_data->>'position' as after
                               from public.audit_logs where table_name = 'profiles' and action = 'update'`))[0];
  assert.deepEqual(log, { actor_id: U.admin5, action: "update", table_name: "profiles", warehouse_id: WH5, before: null, after: "Picker" });

  // บันทึกซ้ำที่ไม่มีอะไรเปลี่ยน ไม่ต้องเก็บ
  const before = (await rows(db, `select count(*)::int as n from public.audit_logs`))[0].n;
  await as(db, U.admin5, () => db.query(`update public.profiles set position = 'Picker' where id = $1`, [U.emp5]));
  assert.equal((await rows(db, `select count(*)::int as n from public.audit_logs`))[0].n, before);

  await as(db, U.emp5, async () => {
    const mine = await rows(db, `select action from public.audit_logs`);
    assert.deepEqual(mine.map((r) => r.action), ["login"], "พนักงานเห็นเฉพาะของตัวเอง");
    await assert.rejects(db.query(`delete from public.audit_logs`), /permission denied/);
    await assert.rejects(db.query(`update public.audit_logs set action = 'x'`), /permission denied/);
    await assert.rejects(db.query(`insert into public.audit_logs (action) values ('fake')`), /permission denied/);
  });
  assert.ok((await as(db, U.admin32, () => rows(db, `select * from public.audit_logs where warehouse_id = $1`, [WH5]))).length === 0, "แอดมินคลังอื่นไม่เห็น");
});

test("ตรวจสิทธิ์รีเซ็ตรหัสผ่าน (can_manage_user)", async () => {
  const db = await setup();
  const can = (uid, target) => as(db, uid, async () => (await rows(db, `select public.can_manage_user($1) as ok`, [target]))[0].ok);
  assert.equal(await can(U.admin5, U.emp5), true);
  assert.equal(await can(U.admin5, U.emp32), false, "คนละคลัง");
  assert.equal(await can(U.admin5, U.admin5), false, "ตัวเอง");
  assert.equal(await can(U.admin5, U.exec), false, "บทบาทสูงกว่า");
  assert.equal(await can(U.sup5, U.emp5), false, "หัวหน้างานรีเซ็ตไม่ได้");
  assert.equal(await can(U.exec, U.admin32), true);
  assert.equal(await can(U.super, U.exec), true);
});
