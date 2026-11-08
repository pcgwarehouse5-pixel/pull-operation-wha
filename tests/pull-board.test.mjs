// ทดสอบตัวเลขหน้าสรุปกำลังพล (ข้อมูลสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, hhmm } from "../src/lib/pull.ts";

const P = (code, status, skills) => ({ user_id: code, employee_code: code, name: code, nickname: null, emp_position: null, warehouse_id: "w", warehouse_code: "W", shift_code: "D8", start_min: 480, status, reason: null, skills, booking_id: null, booked_to: null, booked_to_code: null, booked_skill: null });
const B = (user, skill, status = "booked") => ({ id: user, work_date: "2026-11-08", shift: "morning", user_id: user, from_warehouse_id: "w", to_warehouse_id: "w", skill_name: skill, status, break_time: null, booked_at: "" });
const R = (skill, required, complete = true) => ({ skill_name: skill, skill_order: 1, fte: required, required: complete ? required : null, complete, missing: complete ? null : "ยังไม่กรอกยอดงาน" });

test("สรุปต่อทักษะ: ต้องการ/จองแล้ว/รอจอง/คนเหลือ/อัตราการจอง", () => {
  const pool = [P("a", "ready", ["RT"]), P("b", "ready", ["RT", "Checker"]), P("c", "booked_here", ["RT"]), P("d", "busy", ["RT"]), P("e", "unavailable", ["RT"]), P("f", "ready", ["Checker"])];
  const s = summarize([R("RT", 5), R("Checker", 1)], pool, [B("c", "RT"), B("x", "RT", "cancelled")]);
  assert.deepEqual(s.rows[0], { skill: "RT", total: 4, need: 5, booked: 1, waiting: 4, left: 2, rate: 20 });
  assert.deepEqual(s.rows[1], { skill: "Checker", total: 2, need: 1, booked: 0, waiting: 1, left: 2, rate: 0 });
  assert.equal(s.total, 5, "คนที่มีหลายทักษะนับครั้งเดียว (ไม่นับคนไม่พร้อม)");
  assert.equal(s.need, 6);
  assert.equal(s.booked, 1, "ไม่นับรายการที่ยกเลิกแล้ว");
  assert.equal(s.waiting, 5);
  assert.equal(s.left, 3);
  assert.equal(s.rate, 17);
});

test("สรุป: ยังคำนวณไม่ได้ = ไม่มีตัวเลข / จองเกินไม่ติดลบ / ต้องการ 0 = ครบ 100%", () => {
  const s = summarize([R("RT", null, false), R("OP", 1), R("CT", 0)], [P("a", "ready", ["OP"])], [B("a", "OP"), B("b", "OP")]);
  assert.equal(s.rows[0].need, null);
  assert.equal(s.rows[0].waiting, null);
  assert.equal(s.rows[0].rate, null);
  assert.equal(s.rows[1].waiting, 0, "จองเกินที่ต้องการ = รอจอง 0");
  assert.equal(s.rows[1].rate, 100);
  assert.equal(s.rows[2].rate, 100);
  assert.equal(s.need, null, "มีทักษะที่ยังไม่รู้ = รวมแสดง —");
  assert.equal(s.waiting, null);
});

test("เวลาเข้างาน", () => {
  assert.equal(hhmm(480), "08:00");
  assert.equal(hhmm(1230), "20:30");
  assert.equal(hhmm(1500), "01:00");
  assert.equal(hhmm(null), "—");
});
