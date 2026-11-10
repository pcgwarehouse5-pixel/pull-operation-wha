// ทดสอบสูตรตารางกะแบบ Excel (ข้อมูลสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCellText, cellCopyText, cellLines, toTsv, fromTsv, pastePlan, fillPlan, moveTarget, norm } from "../src/lib/shift-grid.ts";
import { shiftDef, cellOf } from "../src/lib/shifts.ts";

const defs = [
  { value: "STD1", label: "08:00-17:00", extra: { start_time: "08:00", end_time: "17:00" } },
  { value: "GN_12", label: "08:00-17:00 (สำรอง)", extra: { start_time: "08:00", end_time: "17:00" } },
  { value: "GN_5", label: "20:00-05:00", extra: { start_time: "20:00", end_time: "05:00" } },
  { value: "GA-2", label: "07:30-16:30", extra: { start_time: "07:30", end_time: "16:30" } },
  { value: "OFF", label: "หยุด", extra: {} },
  { value: "HOL", label: "นักขัตฤกษ์", extra: {} },
].map(shiftDef);
const p = (t) => {
  const r = parseCellText(t, defs);
  return r.ok ? (r.cell ? `${r.cell.shift_code}${r.cell.holiday_work ? "+" + r.cell.holiday_work : ""}` : null) : `ERR:${r.error}`;
};

test("พิมพ์/วาง: เวลาหลายแบบ รหัส ชื่อ คำว่าหยุด และทำงานวันหยุด", () => {
  assert.equal(p("8-17"), "STD1", "เวลาซ้ำหลายรหัส = รหัสแรกตามลำดับในตั้งค่า");
  assert.equal(p("08:00-17:00"), "STD1");
  assert.equal(p("08.00 – 17.00"), "STD1");
  assert.equal(p("20-5"), "GN_5", "กะข้ามเที่ยงคืน");
  assert.equal(p("7:30-16:30"), "GA-2");
  assert.equal(p("gn_12"), "GN_12", "รหัสตรงตัว (ตัวพิมพ์เล็ก)");
  assert.equal(p("หยุด"), "OFF");
  assert.equal(p("off"), "OFF");
  assert.equal(p("นักขัตฤกษ์"), "HOL");
  assert.equal(p("8-17+HOL"), "STD1+HOL");
  assert.equal(p("20-5 (ห)"), "GN_5+OFF");
  assert.equal(p("หยุด+HOL"), "OFF", "วันหยุดไม่มีธงทำงานวันหยุด");
  assert.equal(p("   "), null, "ว่าง = ลบ");
  assert.match(p("9-18"), /ERR:ไม่มีกะเวลา 09:00-18:00/);
  assert.match(p("abc"), /ERR:ไม่รู้จัก/);
});

test("ข้อความในช่องและตอนคัดลอก (วางกลับเข้าแอปได้ตรงเดิม)", () => {
  const d = new Map(defs.map((x) => [x.code, x]));
  assert.deepEqual(cellLines(cellOf("GN_5"), d.get("GN_5")), ["20:00", "05:00"]);
  assert.deepEqual(cellLines(cellOf("OFF"), d.get("OFF")), ["หยุด", ""]);
  assert.equal(cellLines(undefined, undefined), null);
  for (const c of [cellOf("GN_5"), cellOf("STD1", "HOL"), cellOf("OFF"), cellOf("HOL"), cellOf("GA-2", "OFF")]) {
    const text = cellCopyText(c, d.get(c.shift_code));
    const back = parseCellText(text, defs);
    assert.ok(back.ok && back.cell);
    assert.equal(back.cell.holiday_work, c.holiday_work, text);
    assert.equal(d.get(back.cell.shift_code).start, d.get(c.shift_code).start, text);
  }
  assert.equal(cellCopyText(cellOf("STD1", "HOL"), d.get("STD1")), "08:00-17:00+HOL");
});

test("คลิปบอร์ดแบบ Excel: Tab/บรรทัดใหม่ อ่าน-เขียนกลับได้", () => {
  const m = [["08:00-17:00", "หยุด"], ["", "20:00-05:00"]];
  assert.deepEqual(fromTsv(toTsv(m)), m);
  assert.deepEqual(fromTsv("8-17\t8-17\r\n"), [["8-17", "8-17"]], "Excel ต่อท้ายด้วยบรรทัดใหม่");
});

test("วาง: 1 ช่องเติมทั้งช่วง / ช่วงเป็นจำนวนเท่า = ทำซ้ำ / วางจากมุมและตัดส่วนเกินตาราง", () => {
  assert.equal(pastePlan([["A"]], norm({ r: 0, c: 0 }, { r: 2, c: 3 }), 10, 10).length, 12);
  const tiled = pastePlan([["A", "B"]], norm({ r: 0, c: 0 }, { r: 0, c: 5 }), 10, 10).map((x) => x[2]).join("");
  assert.equal(tiled, "ABABAB");
  const corner = pastePlan([["A", "B", "C"], ["D", "E", "F"]], norm({ r: 8, c: 8 }, { r: 8, c: 8 }), 10, 10);
  assert.deepEqual(corner.map(([r, c, v]) => `${r}${c}${v}`), ["88A", "89B", "98D", "99E"]);
  // ช่วงไม่ใช่จำนวนเท่า → วางตามขนาดข้อมูลจากมุมซ้ายบน
  assert.equal(pastePlan([["A", "B"]], norm({ r: 0, c: 0 }, { r: 0, c: 2 }), 10, 10).length, 2);
});

test("ลากเติม: ซ้ำรูปแบบตามทิศที่ลากไกลกว่า (ขวา ซ้าย ลง)", () => {
  const src = norm({ r: 0, c: 0 }, { r: 0, c: 1 }); // 2 ช่อง เช่น ทำงาน, หยุด
  const right = fillPlan(src, { r: 1, c: 6 });
  assert.deepEqual(right.area, { r0: 0, r1: 0, c0: 2, c1: 6 });
  assert.deepEqual([2, 3, 4, 5, 6].map((c) => right.from(0, c).c), [0, 1, 0, 1, 0]);
  const left = fillPlan(norm({ r: 0, c: 4 }, { r: 0, c: 5 }), { r: 0, c: 1 });
  assert.deepEqual(left.area, { r0: 0, r1: 0, c0: 1, c1: 3 });
  assert.deepEqual([1, 2, 3].map((c) => left.from(0, c).c), [5, 4, 5]);
  const down = fillPlan(norm({ r: 0, c: 0 }, { r: 1, c: 0 }), { r: 4, c: 0 });
  assert.deepEqual(down.area, { r0: 2, r1: 4, c0: 0, c1: 0 });
  assert.equal(fillPlan(src, { r: 0, c: 1 }).area, null, "ไม่ได้ลากออกนอกช่วง");
});

test("ลากย้าย: ไม่ล้นขอบตาราง", () => {
  assert.deepEqual(moveTarget(norm({ r: 0, c: 0 }, { r: 1, c: 2 }), 3, 4, 10, 31), { r0: 3, c0: 4, r1: 4, c1: 6 });
  assert.deepEqual(moveTarget(norm({ r: 0, c: 0 }, { r: 1, c: 2 }), 20, 40, 10, 31), { r0: 8, c0: 28, r1: 9, c1: 30 });
  assert.deepEqual(moveTarget(norm({ r: 2, c: 2 }, { r: 2, c: 2 }), -5, -5, 10, 31), { r0: 0, c0: 0, r1: 0, c1: 0 });
});

test("ลากเรียงรายชื่อในกลุ่ม: ลงไปอยู่หลัง / ขึ้นไปอยู่ก่อน / เรียงตามที่บันทึก", async () => {
  const { moveItem, sortByMembers, mergeMembers } = await import("../src/lib/shift-grid.ts");
  assert.deepEqual(moveItem(["a", "b", "c", "d"], "a", "c"), ["b", "c", "a", "d"]);
  assert.deepEqual(moveItem(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
  assert.deepEqual(moveItem(["a", "b"], "a", "a"), ["a", "b"]);
  assert.deepEqual(moveItem(["a", "b"], "x", "a"), ["a", "b"]);
  const emps = [{ id: "e1" }, { id: "e2" }, { id: "e3" }, { id: "e4" }];
  assert.deepEqual(sortByMembers(emps, ["e3", "e1"]).map((e) => e.id), ["e3", "e1", "e2", "e4"], "คนใหม่ต่อท้ายตามลำดับเดิม");
  assert.deepEqual(mergeMembers(["x", "e1", "y", "e2"], ["e2", "e1"]), ["e2", "e1", "x", "y"]);
});
