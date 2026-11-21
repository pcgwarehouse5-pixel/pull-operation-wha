// ทดสอบวันลาในตารางผลัด (ข้อมูลสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import { leaveCellText, leaveDayMap, leaveOnDay, visibleLength } from "../src/lib/shift-leave.ts";
import { cellOf, keyOf, monthDates, shiftDef, spanDates } from "../src/lib/shifts.ts";

const span = (user_id, leave_type, start_date, end_date, period = "full", status = "approved") => ({ user_id, leave_type, start_date, end_date, period, status });
const work = shiftDef({ value: "STD1", label: "08:00-17:00", extra: { start_time: "08:00", end_time: "17:00" } });
const off = shiftDef({ value: "OFF", label: "OFF", extra: {} });

test("แสดงเฉพาะใบที่อนุมัติแล้ว หรือขอยกเลิกแต่ยังไม่อนุมัติการยกเลิก", () => {
  const dates = monthDates("2026-11");
  const m = leaveDayMap([
    span("a", "sick", "2026-11-03", "2026-11-03"),
    span("b", "sick", "2026-11-03", "2026-11-03", "full", "pending"),
    span("c", "sick", "2026-11-03", "2026-11-03", "full", "rejected"),
    span("d", "sick", "2026-11-03", "2026-11-03", "full", "cancelled"),
    span("e", "personal", "2026-11-03", "2026-11-03", "morning", "cancel_requested"),
  ], dates);
  assert.deepEqual([...m.keys()].sort(), [keyOf("a", "2026-11-03"), keyOf("e", "2026-11-03")].sort());
  assert.deepEqual(m.get(keyOf("e", "2026-11-03")), { type: "personal", period: "morning", cancelling: true });
});

test("ใบลาหลายวัน: ตัดตามช่วงที่แสดง ข้ามเดือนได้", () => {
  const nov = leaveDayMap([span("a", "vacation", "2026-10-30", "2026-11-02"), span("b", "vacation", "2026-11-29", "2026-12-02")], monthDates("2026-11"));
  assert.deepEqual([...nov.keys()].sort(), [
    keyOf("a", "2026-11-01"), keyOf("a", "2026-11-02"), keyOf("b", "2026-11-29"), keyOf("b", "2026-11-30"),
  ]);
  const half = leaveDayMap([span("b", "vacation", "2026-11-29", "2026-12-02")], spanDates("2026-11", "1.5"));
  assert.equal(half.size, 4, "ดูเดือนครึ่ง เห็นครบข้ามรอยต่อเดือน");
  assert.equal(leaveDayMap([span("a", "sick", "2026-10-01", "2026-10-02")], monthDates("2026-11")).size, 0);
  assert.equal(leaveDayMap([span("a", "sick", "2026-11-01", "2026-11-01")], []).size, 0);
});

test("ช่องที่ขึ้นว่าลา ตรงกับกฎนับวันลา: วัน OFF และวันหยุดกลางใบลาไม่นับ", () => {
  const m = leaveDayMap([span("a", "sick", "2026-11-05", "2026-11-05")], monthDates("2026-11"));
  const on = (cell, def, hol = false, u = "a", d = "2026-11-05") => leaveOnDay(m, u, d, cell, def, hol);
  assert.equal(on(cellOf("STD1"), work)?.type, "sick", "มีกะทำงาน = ลา");
  assert.equal(on(cellOf("STD1"), work, true)?.type, "sick", "กะทำงานตรงวันหยุด = ลา");
  assert.equal(on(cellOf("OFF"), off), null, "OFF = คง OFF");
  assert.equal(on(cellOf("XYZ"), undefined), null, "รหัสที่ไม่ใช่กะทำงาน");
  assert.equal(on(undefined, undefined)?.type, "sick", "ยังไม่มีกะ = ลา");
  assert.equal(on(undefined, undefined, true), null, "ไม่มีกะ + นักขัตฤกษ์ = ไม่นับ");
  assert.equal(on(cellOf("STD1"), work, false, "b"), null, "คนอื่น");
  assert.equal(on(cellOf("STD1"), work, false, "a", "2026-11-06"), null, "วันอื่น");
});

test("ข้อความในช่อง: บรรทัดบนบอกเต็มวัน/ครึ่งวัน บรรทัดล่างบอกประเภท", () => {
  const c = (type, label, period = "full") => leaveCellText(type, label, period);
  assert.deepEqual(c("sick", "ป่วย"), { top: "ลา", main: "ป่วย" });
  assert.deepEqual(c("personal", "กิจ", "morning"), { top: "ลาเช้า", main: "กิจ" });
  assert.deepEqual(c("sick", "ป่วย", "afternoon"), { top: "ลาบ่าย", main: "ป่วย" });
  assert.deepEqual(c("maternity", "คลอด"), { top: "ลา", main: "คลอด" });
  assert.deepEqual(c("ordination", "บวช"), { top: "ลา", main: "บวช" });
  assert.deepEqual(c("vacation", "พักผ่อน"), { top: "ลาพัก", main: "ร้อน" });
  assert.deepEqual(c("vacation", "พักผ่อน", "morning"), { top: "ลาเช้า", main: "พักร้อน" });
  assert.deepEqual(c("paternity", "ช่วยภรรยาคลอดบุตร"), { top: "ลาช่วย", main: "คลอด" });
  assert.deepEqual(c("child_care", "ดูแลบุตรต่อจากลาคลอด"), { top: "ลาดูแล", main: "บุตร" });
  assert.deepEqual(c("new1", "ลารับราชการทหาร"), { top: "ลา", main: "รับร…" }, "ประเภทใหม่ที่ชื่อยาว ตัดให้พอดีช่อง");
  assert.deepEqual(c("x", undefined), { top: "ลา", main: "x" });
  assert.equal(visibleLength("พักร้อน"), 5);
});
