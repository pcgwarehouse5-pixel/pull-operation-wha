// ทดสอบสรุปคนขาดงานในตารางผลัด (ข้อมูลสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import { absentSummary } from "../src/lib/shift-absent.ts";
import { pendingLeaveDays } from "../src/lib/shift-leave.ts";
import { cellOf, keyOf, monthDates, shiftDef, spanDates } from "../src/lib/shifts.ts";

const defs = new Map([
  shiftDef({ value: "STD1", label: "08:00-17:00", extra: { start_time: "08:00", end_time: "17:00" } }),
  shiftDef({ value: "GN_5", label: "20:00-05:00", extra: { start_time: "20:00", end_time: "05:00" } }),
].map((d) => [d.code, d]));
const dates = monthDates("2026-11");
const emps = [{ id: "a", employee_code: "A002" }, { id: "b", employee_code: "A001" }, { id: "c", employee_code: "A003" }];
const base = (over = {}) => ({
  emps, dates, defs, pending: {}, isOnLeave: () => false, pendingLeaves: new Map(), pendingFixes: new Set(),
  grid: {
    a: { "2026-11-19": cellOf("STD1"), "2026-11-20": cellOf("GN_5") },
    b: { "2026-11-21": cellOf("STD1") },
    c: { "2026-11-21": cellOf("STD1") },
  },
  absent: new Set([keyOf("a", "2026-11-20"), keyOf("a", "2026-11-19"), keyOf("b", "2026-11-21")]),
  ...over,
});

test("สรุปใครขาดวันไหน: คนขาดมากขึ้นก่อน วันที่เรียงเก่าไปใหม่ พร้อมเวลาเข้างาน", () => {
  const r = absentSummary(base());
  assert.deepEqual(r.map((x) => x.emp.id), ["a", "b"], "คนไม่ขาดไม่อยู่ในรายการ");
  assert.deepEqual(r[0].days.map((d) => [d.date, d.start]), [["2026-11-19", "08:00"], ["2026-11-20", "20:00"]]);
});

test("ขาดเท่ากัน: เรียงตามรหัสพนักงาน", () => {
  const r = absentSummary(base({ absent: new Set([keyOf("a", "2026-11-19"), keyOf("b", "2026-11-21")]) }));
  assert.deepEqual(r.map((x) => x.emp.employee_code), ["A001", "A002"]);
});

test("นับตรงกับช่องดำ: ไม่นับวันลาที่อนุมัติแล้ว ช่องที่แก้ค้าง ช่องไม่มีกะ และวันนอกช่วง", () => {
  const onLeave = absentSummary(base({ isOnLeave: (id, d) => id === "a" && d === "2026-11-19" }));
  assert.deepEqual(onLeave.find((x) => x.emp.id === "a").days.map((d) => d.date), ["2026-11-20"]);
  const edited = absentSummary(base({ pending: { [keyOf("b", "2026-11-21")]: cellOf("GN_5") } }));
  assert.deepEqual(edited.map((x) => x.emp.id), ["a"]);
  const noCell = absentSummary(base({ absent: new Set([keyOf("c", "2026-11-05")]) }));
  assert.equal(noCell.length, 0);
  const outside = absentSummary(base({ dates: monthDates("2026-12") }));
  assert.equal(outside.length, 0);
});

test("บอกวันที่ยังมีใบลารออนุมัติ หรือคำขอแก้เวลาค้างอยู่", () => {
  const r = absentSummary(base({
    pendingLeaves: new Map([[keyOf("a", "2026-11-19"), "sick"]]),
    pendingFixes: new Set([keyOf("a", "2026-11-20")]),
  }));
  assert.deepEqual(r[0].days.map((d) => [d.pendingLeave, d.pendingFix]), [["sick", false], [null, true]]);
});

test("ใบลารออนุมัติ: กระจายรายวัน เฉพาะสถานะ pending ตัดตามช่วงที่แสดง ข้ามเดือนได้", () => {
  const span = (user_id, start_date, end_date, status = "pending") => ({ user_id, leave_type: "sick", start_date, end_date, period: "full", status });
  const m = pendingLeaveDays([span("a", "2026-11-29", "2026-12-02"), span("b", "2026-11-29", "2026-11-29", "approved")], monthDates("2026-11"));
  assert.deepEqual([...m.keys()], [keyOf("a", "2026-11-29"), keyOf("a", "2026-11-30")]);
  assert.equal(m.get(keyOf("a", "2026-11-30")), "sick");
  assert.equal(pendingLeaveDays([span("a", "2026-11-29", "2026-12-02")], spanDates("2026-11", "1.5")).size, 4);
  assert.equal(pendingLeaveDays([span("a", "2026-11-29", "2026-11-29")], []).size, 0);
});
