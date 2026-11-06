// ทดสอบสูตรตารางกะ: วันที่ รหัสกะ เครื่องมือวางกะ และวางกะอัตโนมัติ (ข้อมูลสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthDates, addMonths, addDays, weekday, thaiMonthLabel, currentMonth, shiftDef, shiftTimeText,
  stage, mergeGrid, toRows, cellOf, copyFromPrevious, repeatPattern, holidayFill, countByDay, generatePlan,
} from "../src/lib/shifts.ts";

test("วันที่: จำนวนวัน เดือนถัดไป วันในสัปดาห์ และเดือนตามเวลาไทย", () => {
  assert.equal(monthDates("2028-02").length, 29, "ปีอธิกสุรทิน");
  assert.equal(monthDates("2026-12").at(-1), "2026-12-31");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(weekday("2026-12-05"), 6, "5 ธ.ค. 2569 เป็นวันเสาร์");
  assert.equal(thaiMonthLabel("2026-12"), "ธันวาคม 2569");
  assert.equal(currentMonth(new Date("2026-11-30T18:30:00Z")), "2026-12", "01:30 น. ของ 1 ธ.ค. เวลาไทย");
});

test("รหัสกะ: อ่านเวลา กะข้ามเที่ยงคืน และรหัสที่ไม่ใช่กะทำงาน", () => {
  const night = shiftDef({ value: "GN_5", label: "20:00-05:00", extra: { start_time: "20:00", end_time: "05:00", bg: "#3b82f6" } });
  assert.deepEqual([night.start, night.end, night.working, night.night], [1200, 1740, true, true]);
  assert.equal(shiftTimeText(night), "20:00-05:00");
  const off = shiftDef({ value: "OFF", label: "หยุด", extra: { bg: "#ff0000" } });
  assert.deepEqual([off.working, off.start, off.bg], [false, null, "#ff0000"]);
  assert.equal(shiftDef({ value: "X", label: "x", extra: { start_time: "25:00", end_time: "05:00" } }).working, false);
});

test("รายการแก้ไข: แก้กลับเป็นค่าเดิมไม่นับ, เติมเฉพาะช่องว่าง, ลบช่อง", () => {
  const base = { u1: { "2026-12-01": cellOf("STD1") } };
  let p = stage({}, base, [{ user_id: "u1", work_date: "2026-12-01", cell: cellOf("GN_5") }]);
  assert.equal(Object.keys(p).length, 1);
  p = stage(p, base, [{ user_id: "u1", work_date: "2026-12-01", cell: cellOf("STD1") }]);
  assert.equal(Object.keys(p).length, 0, "กลับเป็นค่าเดิม");
  p = stage({}, base, [
    { user_id: "u1", work_date: "2026-12-01", cell: cellOf("OFF") },
    { user_id: "u1", work_date: "2026-12-02", cell: cellOf("OFF") },
  ], true);
  assert.deepEqual(Object.keys(p), ["u1|2026-12-02"], "ไม่ทับช่องที่มีกะแล้ว");
  p = stage(p, base, [{ user_id: "u1", work_date: "2026-12-01", cell: null }]);
  const g = mergeGrid(base, p);
  assert.deepEqual(Object.keys(g.u1), ["2026-12-02"]);
  assert.deepEqual(toRows(p).find((r) => r.work_date === "2026-12-01"), { user_id: "u1", work_date: "2026-12-01", shift_code: null, holiday_work: null, is_volunteer: false });
});

test("เครื่องมือ: คัดลอกเดือนก่อน (วันในสัปดาห์ตรงกัน), ทำซ้ำรูปแบบ, วันนักขัตฤกษ์", () => {
  const nov = monthDates("2026-11");
  const src = { u1: Object.fromEntries(nov.map((d) => [d, cellOf(weekday(d) === 0 ? "OFF" : "STD1")])) };
  const dec = monthDates("2026-12");
  const copied = copyFromPrevious(src, ["u1"], dec);
  assert.equal(copied.length, 31, "ครบทุกวัน แม้เดือนเป้าหมายยาวกว่า 4 สัปดาห์");
  for (const c of copied) assert.equal(c.cell.shift_code, weekday(c.work_date) === 0 ? "OFF" : "STD1", c.work_date);

  const rep = repeatPattern([{ code: "STD1", days: 5 }, { code: "OFF", days: 2 }], ["u1", "u2"], dec, 2);
  assert.equal(rep.length, 2 * 29);
  assert.deepEqual(rep.slice(0, 8).map((c) => c.cell.shift_code), ["STD1", "STD1", "STD1", "STD1", "STD1", "OFF", "OFF", "STD1"]);
  assert.equal(rep[0].work_date, "2026-12-03");
  assert.deepEqual(repeatPattern([{ code: "", days: 3 }], ["u1"], dec), []);

  const hol = holidayFill(["2026-12-05", "2026-12-10", "2027-01-01"], ["u1"], dec, "HOL");
  assert.deepEqual(hol.map((c) => c.work_date), ["2026-12-05", "2026-12-10"]);
  const counts = countByDay({ u1: { "2026-12-01": cellOf("STD1") }, u2: { "2026-12-01": cellOf("STD1") } }, ["u1", "u2"], ["2026-12-01"]);
  assert.deepEqual(counts["2026-12-01"], { STD1: 2 });
});

test("วางกะอัตโนมัติ: คนพอดีความต้องการ หยุดตามจำนวนวัน และเว้นเวลาพักระหว่างกะ", () => {
  const employees = Array.from({ length: 6 }, (_, i) => ({ id: `rt${i}`, code: `R${i}`, position: "RT" }))
    .concat(Array.from({ length: 3 }, (_, i) => ({ id: `ck${i}`, code: `C${i}`, position: "Checker" })));
  const dates = monthDates("2026-12");
  const needs = [
    { shift: "STD1", start: 480, end: 1020, counts: { RT: 2, Checker: 1 } },
    { shift: "GN_5", start: 1200, end: 1740, counts: { RT: 2, Forklift: 1 } },
  ];
  const plan = generatePlan({ employees, dates, needs, offCode: "OFF", daysOffPerWeek: 1, rotateWeekly: true, rotationWeeks: 2, minRestHours: 12 });
  assert.deepEqual(plan.missingPositions, ["Forklift"]);
  for (const d of dates) {
    const on = (code, pos) => employees.filter((e) => e.position === pos && plan.assignments[e.id][d] === code).length;
    assert.equal(on("STD1", "RT"), 2, d);
    assert.equal(on("GN_5", "RT"), 2, d);
    assert.equal(on("STD1", "Checker"), 1, d);
  }
  // ทุกคนได้หยุด และทุกช่องมีค่า
  for (const e of employees) {
    assert.equal(Object.keys(plan.assignments[e.id]).length, 31);
    assert.ok(Object.values(plan.assignments[e.id]).filter((c) => c === "OFF").length >= 4, e.id);
  }
  // เวลาพัก: ไม่มีใครเลิกกะดึก 05:00 แล้วเข้ากะเช้า 08:00 วันเดียวกัน
  for (const e of employees) {
    for (let i = 1; i < dates.length; i++) {
      assert.ok(!(plan.assignments[e.id][dates[i - 1]] === "GN_5" && plan.assignments[e.id][dates[i]] === "STD1"), `${e.id} ${dates[i]}`);
    }
  }
  assert.equal(plan.shortages.filter((s) => s.position !== "Forklift").length, 0);

  // คนไม่พอ: รายงานวันที่ขาด
  const few = generatePlan({ employees: employees.slice(0, 2), dates: dates.slice(0, 7), needs, offCode: "OFF", daysOffPerWeek: 1, rotateWeekly: false, rotationWeeks: 1, minRestHours: 12 });
  assert.ok(few.shortages.some((s) => s.position === "RT" && s.missing > 0));
  assert.ok(few.restBlocked >= 0);

  // กะของวันสุดท้ายเดือนก่อนถูกนับเวลาพัก
  const carry = generatePlan({
    employees: [{ id: "a", code: "A", position: "RT" }], dates: ["2026-12-01"], offCode: "OFF", daysOffPerWeek: 0, rotateWeekly: false, rotationWeeks: 1, minRestHours: 12,
    needs: [{ shift: "STD1", start: 480, end: 1020, counts: { RT: 1 } }], previousLast: { a: needs[1] },
  });
  assert.equal(carry.assignments.a["2026-12-01"], "OFF");
});
