// ทดสอบประชาสัมพันธ์ (ป๊อปอัปเมื่อเปิดแอป) บน Postgres จำลอง — ข้อมูลสมมติ
import { test } from "node:test";
import assert from "node:assert/strict";
import { U, setup, as, rows } from "./helpers.mjs";

const IMG = "11111111-2222-3333-4444-555555555555.webp";
const save = (db, uid, o) =>
  as(db, uid, async () => (await rows(db, `select public.save_announcement($1, $2, $3, $4, $5, $6, $7::date, $8::date) as id`,
    [o.id ?? null, o.title ?? "ประกาศ", o.image ?? IMG, o.type ?? "none", o.url ?? null, o.menu ?? null, o.from, o.to]))[0].id);
const today = async (db) => (await rows(db, `select (now() at time zone 'Asia/Bangkok')::date::text as d`))[0].d;
const shift = async (db, n) => (await rows(db, `select ((now() at time zone 'Asia/Bangkok')::date + $1::int)::text as d`, [n]))[0].d;
const seen = (db, uid) => as(db, uid, async () => (await rows(db, `select title from public.announcements order by title`)).map((r) => r.title));

test("ประชาสัมพันธ์: หัวหน้างานขึ้นไปเพิ่มได้ พนักงานเพิ่มไม่ได้ · ตรวจหัวข้อ ภาพ วันที่ ลิงก์", async () => {
  const db = await setup();
  const d = await today(db);
  await assert.rejects(save(db, U.emp5, { from: d, to: d }), /ไม่มีสิทธิ์/);
  const id = await save(db, U.sup5, { title: "  งานกีฬาสี  ", type: "url", url: "https://example.com/sport", from: d, to: d });
  const r = (await rows(db, `select title, link_type, link_url, link_menu, created_by from public.announcements where id = $1`, [id]))[0];
  assert.deepEqual(r, { title: "งานกีฬาสี", link_type: "url", link_url: "https://example.com/sport", link_menu: null, created_by: U.sup5 });
  await assert.rejects(save(db, U.admin5, { title: " ", from: d, to: d }), /หัวข้อ/);
  await assert.rejects(save(db, U.admin5, { image: "", from: d, to: d }), /แนบภาพ/);
  await assert.rejects(save(db, U.admin5, { from: d, to: await shift(db, -1) }), /ช่วงวันที่/);
  await assert.rejects(save(db, U.admin5, { from: d, to: await shift(db, 400) }), /ไม่เกิน 1 ปี/);
  await assert.rejects(save(db, U.admin5, { type: "url", url: "http://example.com", from: d, to: d }), /https/);
  await assert.rejects(save(db, U.admin5, { type: "url", url: "javascript:alert(1)", from: d, to: d }), /https/);
  await assert.rejects(save(db, U.admin5, { type: "menu", menu: "https://evil.com", from: d, to: d }), /เมนู/);
  // เมนูในแอป: เก็บเฉพาะเมนู ล้างลิงก์เว็บ
  const m = await save(db, U.admin5, { title: "ไปดูตำแหน่ง", type: "menu", menu: "/my-position", url: "https://x.com", from: d, to: d });
  assert.deepEqual((await rows(db, `select link_url, link_menu from public.announcements where id = $1`, [m]))[0], { link_url: null, link_menu: "/my-position" });
  // แก้ไข
  await save(db, U.sup5, { id: m, title: "ไปดูตำแหน่งงานวันนี้", type: "none", from: d, to: d });
  assert.deepEqual((await rows(db, `select title, link_type, link_menu from public.announcements where id = $1`, [m]))[0], { title: "ไปดูตำแหน่งงานวันนี้", link_type: "none", link_menu: null });
});

test("ประชาสัมพันธ์: ทุกคนทุกคลังเห็นเฉพาะที่อยู่ในช่วงวันที่ · หัวหน้าเห็นทั้งหมด · ลบแล้วไม่เห็น · แก้ตารางตรงๆ ไม่ได้", async () => {
  const db = await setup();
  const d = await today(db);
  await save(db, U.sup5, { title: "ก ตอนนี้", from: d, to: d });
  await save(db, U.sup5, { title: "ข ล่วงหน้า", from: await shift(db, 3), to: await shift(db, 5) });
  const old = await save(db, U.sup5, { title: "ค หมดแล้ว", from: await shift(db, -5), to: await shift(db, -1) });
  assert.deepEqual(await seen(db, U.emp5), ["ก ตอนนี้"], "พนักงานคลัง 5 เห็นเฉพาะที่ถึงวัน");
  assert.deepEqual(await seen(db, U.emp32), ["ก ตอนนี้"], "พนักงานคลังอื่นก็เห็น (ทุกคนทุกคลัง)");
  assert.deepEqual(await seen(db, U.sup5), ["ก ตอนนี้", "ข ล่วงหน้า", "ค หมดแล้ว"], "หัวหน้าเห็นทั้งหมดเพื่อจัดการ");
  await assert.rejects(as(db, U.emp5, () => db.query(`select public.delete_announcement($1)`, [old])), /ไม่มีสิทธิ์/);
  await as(db, U.admin32, () => db.query(`select public.delete_announcement($1)`, [old]));
  assert.ok(!(await seen(db, U.sup5)).includes("ค หมดแล้ว"), "ลบแล้วไม่เห็น");
  assert.equal((await rows(db, `select count(*)::int as n from public.announcements where deleted_at is not null and deleted_by = $1`, [U.admin32]))[0].n, 1, "เก็บประวัติการลบ");
  await assert.rejects(as(db, U.admin5, () => db.query(`select public.delete_announcement($1)`, [old])), /ไม่พบ/);
  await assert.rejects(as(db, U.sup5, () => db.query(`insert into public.announcements (title, image_path, starts_on, ends_on) values ('x', $1, now(), now())`, [IMG])), /permission denied/);
  await assert.rejects(as(db, U.sup5, () => db.query(`update public.announcements set title = 'x'`)), /permission denied/);
  const logs = await rows(db, `select action from public.audit_logs where table_name = 'announcements'`);
  assert.ok(logs.length >= 4, "บันทึกประวัติการเพิ่ม/ลบ");
});
