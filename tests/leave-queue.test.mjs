// ทดสอบคิวอนุมัติใบลา: ลำดับวันลา และป้ายความเร่งด่วน (ข้อมูลสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import { leaveDue, sortLeaveQueue } from "../src/lib/leave-queue.ts";

const row = (id, start_date, end_date = start_date, created_at = "2026-11-01T00:00:00Z") => ({ id, start_date, end_date, created_at });

test("เรียงจากวันลาก่อนไปวันลาหลัง ข้ามเดือนและข้ามปีได้", () => {
  const list = [row("jan", "2027-01-02"), row("dec", "2026-12-01"), row("nov", "2026-11-25"), row("past", "2026-11-10")];
  assert.deepEqual(sortLeaveQueue(list).map((r) => r.id), ["past", "nov", "dec", "jan"]);
  assert.equal(list[0].id, "jan", "ไม่แก้ลำดับของรายการเดิม");
});

test("วันเริ่มลาเท่ากัน: จบก่อนขึ้นก่อน แล้วตามเวลาที่ยื่น", () => {
  const list = [
    row("long", "2026-11-25", "2026-11-28"),
    row("late", "2026-11-25", "2026-11-25", "2026-11-03T00:00:00Z"),
    row("early", "2026-11-25", "2026-11-25", "2026-11-02T00:00:00Z"),
  ];
  assert.deepEqual(sortLeaveQueue(list).map((r) => r.id), ["early", "late", "long"]);
});

test("ป้ายความเร่งด่วนเทียบกับวันนี้", () => {
  const t = "2026-11-21";
  const d = (s, e = s) => leaveDue(s, e, t);
  assert.deepEqual(d("2026-11-12"), { kind: "overdue", text: "เลยมาแล้ว 9 วัน", level: "urgent" });
  assert.deepEqual(d("2026-11-18", "2026-11-20"), { kind: "overdue", text: "เลยมาแล้ว 1 วัน", level: "urgent" }, "นับจากวันสุดท้ายของใบลา");
  assert.equal(d("2026-11-20", "2026-11-24").kind, "ongoing");
  assert.equal(d("2026-11-20", "2026-11-21").kind, "ongoing", "วันนี้เป็นวันสุดท้าย");
  assert.deepEqual(d("2026-11-21", "2026-11-23"), { kind: "today", text: "ลาวันนี้", level: "urgent" });
  assert.deepEqual(d("2026-11-22"), { kind: "tomorrow", text: "ลาพรุ่งนี้", level: "soon" });
  assert.deepEqual(d("2026-11-24"), { kind: "soon", text: "อีก 3 วัน", level: "soon" });
  assert.deepEqual(d("2026-11-25"), { kind: "later", text: "อีก 4 วัน", level: "normal" });
  assert.equal(leaveDue("2027-01-01", "2027-01-01", "2026-12-31").kind, "tomorrow", "ข้ามปี");
});
