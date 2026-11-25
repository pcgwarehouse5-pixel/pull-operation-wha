// ทดสอบตัวกรองรายชื่อหน้าดึงกำลังคนทีละตำแหน่ง (ข้อมูลสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import { JOB, jobPositions, positionOptions, visiblePool } from "../src/lib/pull-filter.ts";

const P = (id, wh, pos, skills, status = "ready") => ({ user_id: id, employee_code: id, name: `คน ${id}`, nickname: null, emp_position: pos, warehouse_id: wh, skills, status });
const pool = [
  P("a", "w5", "RT", ["RT รับ"]),
  P("b", "w5", "RT", ["RT รับ"], "unavailable"),
  P("c", "w32", "RT", ["RT รับ"]),
  P("d", "w5", "OP", ["RT รับ", "OP ลาก"], "busy"),
  P("e", "w5", "OP", ["OP ลาก"]),
  P("f", "w5", null, ["RT รับ"]),
];
const f = (o) => ({ skill: "RT รับ", scope: "skill", wh: "", pos: "", jobPos: ["RT"], status: "", q: "", ...o });
const ids = (r) => r.shown.map((p) => p.user_id);

test("ไม่แสดงคนที่ไม่พร้อม แต่นับไว้ว่าซ่อนกี่คน", () => {
  const r = visiblePool(pool, f());
  assert.deepEqual(ids(r), ["a", "c", "d", "f"]);
  assert.equal(r.hidden, 1);
});

test("กรองคลังของผู้ใช้", () => {
  assert.deepEqual(ids(visiblePool(pool, f({ wh: "w5" }))), ["a", "d", "f"]);
});

test("กรองตำแหน่งของงานนี้ / ตำแหน่งที่เลือก / ไม่ระบุตำแหน่ง", () => {
  assert.deepEqual(ids(visiblePool(pool, f({ pos: JOB }))), ["a", "c"]);
  assert.deepEqual(ids(visiblePool(pool, f({ pos: "OP", scope: "all" }))), ["d", "e"]);
  assert.deepEqual(ids(visiblePool(pool, f({ pos: "ไม่ระบุตำแหน่ง" }))), ["f"]);
});

test("ตัวเลือกตำแหน่งนับเฉพาะคนที่แสดงได้ (เรียงคนมากก่อน · ไม่ระบุตำแหน่งไว้ท้าย)", () => {
  assert.deepEqual(positionOptions(pool, { skill: "RT รับ", scope: "skill", wh: "w5" }), [
    { position: "OP", count: 1 }, { position: "RT", count: 1 }, { position: "ไม่ระบุตำแหน่ง", count: 1 },
  ]);
});

test("ตำแหน่งของงาน: ใช้ข้อมูลหน้าทักษะก่อน ถ้าไม่มีใช้ตำแหน่งของคนที่มีทักษะ", () => {
  assert.deepEqual(jobPositions(["RT", "CT"], pool, "RT รับ"), ["CT", "RT"]);
  assert.deepEqual(jobPositions(null, pool, "RT รับ"), ["OP", "RT"]);
});

test("ค้นหาชื่อ/รหัส และสถานะ", () => {
  assert.deepEqual(ids(visiblePool(pool, f({ q: "c" }))), ["c"]);
  assert.deepEqual(ids(visiblePool(pool, f({ status: "busy" }))), ["d"]);
});
