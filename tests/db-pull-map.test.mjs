// ทดสอบการบันทึกตำแหน่งบนแผนที่คลัง 3D (หน้าผังตำแหน่ง) บน Postgres จำลอง
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, WH5, WH32, setup, as, rows } from "./helpers.mjs";

const q1 = async (db, sql, params) => (await db.query(sql, params)).rows[0];

// emp5 (WH5) และ emp32 (WH32) เข้ากะเช้าวันนี้ · หัวหน้า WH5 จองทั้งสองคนเข้า WH5
async function world() {
  const db = await setup();
  await db.exec(`
    insert into public.dropdown_options (category, value, label, extra) values ('shift_type', 'D8', '08:00-17:00', '{"start_time":"08:00","end_time":"17:00"}');
    insert into public.skills (position, name) values ('RT', 'RT รับ');
    insert into public.employee_skills (user_id, skill_id) select u, (select id from public.skills where name = 'RT รับ')
      from unnest(array['${U.emp5}', '${U.emp32}']::uuid[]) u;
  `);
  const d = (await q1(db, `select public.pull_today()::text as d`)).d;
  await db.query(`insert into public.shift_schedules (user_id, work_date, shift_code) select u, $1, 'D8' from unnest($2::uuid[]) u`, [d, [U.emp5, U.emp32]]);
  await as(db, U.super, async () => {
    await db.query(`select public.set_pull_skills($1, '{RT รับ}')`, [WH5]);
    await db.query(`select public.set_pull_skills($1, '{RT รับ}')`, [WH32]);
  });
  await as(db, U.sup5, () =>
    db.query(`select public.book_pull($1, $2, 'morning', $3)`, [WH5, d, JSON.stringify([{ user_id: U.emp5, skill: "RT รับ" }, { user_id: U.emp32, skill: "RT รับ" }])]),
  );
  const ids = Object.fromEntries((await rows(db, `select user_id, id from public.pull_bookings`)).map((r) => [r.user_id, r.id]));
  return { db, d, a: ids[U.emp5], b: ids[U.emp32] };
}
const setPos = (db, uid, items) => as(db, uid, async () => (await q1(db, `select public.set_pull_positions($1) as n`, [JSON.stringify(items)])).n);
const pos = (db, id) => q1(db, `select map_x, map_y, map_at is not null as at from public.pull_bookings where id = $1`, [id]);

test("ตำแหน่งบนแผนที่: คลังปลายทางลากวางได้ทีละคนและทั้งกลุ่ม · ที่เดิมไม่บันทึกซ้ำ · ล้างได้", async () => {
  const { db, a, b } = await world();
  assert.equal(await setPos(db, U.sup5, [{ id: a, x: 1200.5, y: 900 }]), 1);
  assert.deepEqual(await pos(db, a), { map_x: 1200.5, map_y: 900, at: true });
  // ลากทั้งกลุ่ม (2 คน) ในครั้งเดียว · คนแรกอยู่ที่เดิม = นับเฉพาะที่เปลี่ยน
  assert.equal(await setPos(db, U.sup5, [{ id: a, x: 1200.5, y: 900 }, { id: b, x: 1220, y: 900 }]), 1);
  assert.deepEqual(await pos(db, b), { map_x: 1220, map_y: 900, at: true });
  // ทุกการเปลี่ยนมีบันทึกประวัติ
  const audit = await rows(db, `select count(*)::int as n from public.audit_logs where table_name = 'pull_bookings' and action ilike '%update%'`);
  assert.ok(audit[0].n >= 2);
  // ล้างตำแหน่ง = กลับไปวางอัตโนมัติ
  assert.equal(await setPos(db, U.sup5, [{ id: a, x: null, y: null }]), 1);
  assert.deepEqual(await pos(db, a), { map_x: null, map_y: null, at: false });
  // หัวหน้าเห็นตำแหน่งที่บันทึกไว้ (RLS เดิมของการจอง) · พนักงานเห็นของตัวเอง
  assert.equal((await as(db, U.sup5, () => rows(db, `select map_x from public.pull_bookings where map_x is not null`))).length, 1);
  assert.equal((await as(db, U.emp32, () => rows(db, `select map_x from public.pull_bookings`)))[0].map_x, 1220);
});

test("ตำแหน่งบนแผนที่: สิทธิ์ ข้อมูลผิด วันที่ผ่านไปแล้ว และรายการที่ยกเลิก", async () => {
  const { db, d, a, b } = await world();
  await assert.rejects(setPos(db, U.admin32, [{ id: b, x: 10, y: 10 }]), /เฉพาะคลังที่จอง/, "คลังต้นทางย้ายไม่ได้");
  await assert.rejects(setPos(db, U.emp5, [{ id: a, x: 10, y: 10 }]), /เฉพาะคลังที่จอง/);
  await assert.rejects(setPos(db, U.sup5, [{ id: a, x: 10 }]), /ไม่ถูกต้อง/);
  await assert.rejects(setPos(db, U.sup5, [{ id: a, x: -5, y: 10 }]), /ไม่ถูกต้อง/);
  await assert.rejects(setPos(db, U.sup5, [{ id: a, x: "10", y: 10 }]), /ไม่ถูกต้อง/);
  await assert.rejects(setPos(db, U.sup5, [{ id: "x", x: 1, y: 1 }]), /ไม่ถูกต้อง/);
  await assert.rejects(as(db, U.sup5, () => db.query(`select public.set_pull_positions('{}')`)), /ไม่ถูกต้อง/);
  // ผิดสักรายการ = ไม่บันทึกทั้งชุด
  await assert.rejects(setPos(db, U.sup5, [{ id: a, x: 100, y: 100 }, { id: b, x: 99999, y: 1 }]), /ไม่ถูกต้อง/);
  assert.equal((await pos(db, a)).map_x, null);
  // แก้ตรงที่ตารางไม่ได้ (ต้องผ่านฟังก์ชัน)
  await assert.rejects(as(db, U.sup5, () => db.query(`update public.pull_bookings set map_x = 1, map_y = 1 where id = $1`, [a])), /permission denied/);
  // คนที่ไม่ได้ล็อกอินเรียกไม่ได้
  const anon = await q1(db, `select has_function_privilege('anon', 'public.set_pull_positions(jsonb)', 'execute') as ok`);
  assert.equal(anon.ok, false);
  // วันที่ผ่านไปแล้ว
  await db.query(`update public.pull_bookings set work_date = $1::date - 1 where id = $2`, [d, a]);
  await assert.rejects(setPos(db, U.sup5, [{ id: a, x: 1, y: 1 }]), /ผ่านไปแล้ว/);
  // ยกเลิกแล้ว
  await as(db, U.sup5, () => db.query(`select public.cancel_pull_booking($1, 'จองผิด')`, [b]));
  await assert.rejects(setPos(db, U.sup5, [{ id: b, x: 1, y: 1 }]), /ไม่พบรายการ/);
});
