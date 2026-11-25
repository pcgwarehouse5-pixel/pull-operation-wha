// ทดสอบการเตือน "กำลังคนไม่พอ" หลังกรอกปริมาณงาน (ข้อมูลสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import { staffShortage } from "../src/lib/pull.ts";

const req = (skill_name, required, complete = true) => ({ skill_name, skill_order: 0, fte: required, required, complete, missing: complete ? null : "ยังไม่กรอกยอดงาน" });
const person = (id, skills, status = "ready", booked_skill = null) => ({ user_id: id, skills, status, booked_skill });

test("คนพอ: ไม่ขาด", () => {
  const s = staffShortage([req("RT", 2)], [person("a", ["RT"]), person("b", ["RT"]), person("c", ["RT"])]);
  assert.deepEqual(s, { rows: [{ skill: "RT", need: 2, have: 3, short: 0 }], need: 2, fill: 2, short: 0 });
});

test("คนไม่พอต่อทักษะ และไม่นับคนไม่พร้อม/ติดภารกิจ", () => {
  const s = staffShortage([req("RT", 3)], [person("a", ["RT"]), person("b", ["RT"], "unavailable"), person("c", ["RT"], "busy")]);
  assert.deepEqual(s.rows, [{ skill: "RT", need: 3, have: 1, short: 2 }]);
  assert.equal(s.short, 2);
});

test("คนหลายทักษะนับซ้ำต่อทักษะ แต่รวมแล้ว 1 คนลงได้ 1 ตำแหน่ง", () => {
  // ทักษะละ 1 คน ดูเหมือนพอ แต่มีคนเดียว → ขาดรวม 1
  const s = staffShortage([req("RT", 1), req("OP", 1)], [person("a", ["RT", "OP"])]);
  assert.deepEqual(s.rows.map((r) => r.short), [0, 0]);
  assert.equal(s.fill, 1);
  assert.equal(s.short, 1);
});

test("จับคู่ให้ได้มากที่สุด (ไม่ใช้คนหลายทักษะไปก่อนจนขาด)", () => {
  // a ทำได้ RT/OP, b ทำได้ RT อย่างเดียว → a ต้องไป OP ถึงจะครบ
  const s = staffShortage([req("RT", 1), req("OP", 1)], [person("a", ["RT", "OP"]), person("b", ["RT"])]);
  assert.equal(s.short, 0);
});

test("คนที่จองเข้าคลังนี้แล้ว นับเฉพาะทักษะที่จอง", () => {
  const s = staffShortage([req("RT", 1), req("OP", 1)], [person("a", ["RT", "OP"], "booked_here", "RT")]);
  assert.deepEqual(s.rows, [{ skill: "RT", need: 1, have: 1, short: 0 }, { skill: "OP", need: 1, have: 0, short: 1 }]);
  assert.equal(s.short, 1);
});

test("ทักษะที่ยังคำนวณไม่ได้ หรือต้องการ 0 ไม่นำมาเตือน", () => {
  const s = staffShortage([req("RT", null, false), req("OP", 0)], []);
  assert.deepEqual(s, { rows: [], need: 0, fill: 0, short: 0 });
});
