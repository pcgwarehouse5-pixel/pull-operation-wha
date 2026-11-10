// ทดสอบส่งออก/นำเข้าไฟล์ตารางกะ (ข้อมูลสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import { exportRows, parseShiftImport, cellText } from "../src/lib/shift-file.ts";
import { monthDates, cellOf } from "../src/lib/shifts.ts";
import { toCsv, parseCsv } from "../src/lib/csv.ts";

const people = [
  { id: "u1", employee_code: "A001", first_name_th: "หนึ่ง", last_name_th: "ทดสอบ", nickname: "นึ่ง", position: "RT" },
  { id: "u2", employee_code: "A002", first_name_th: "สอง", last_name_th: null, nickname: null, position: "Checker" },
];
const codes = new Set(["STD1", "GN_5", "OFF", "HOL"]);
const dec = monthDates("2026-12");

test("ส่งออกแล้วนำเข้ากลับได้ตรงเดิม (รวมการทำงานวันหยุด)", () => {
  const grid = { u1: { "2026-12-01": cellOf("STD1"), "2026-12-05": cellOf("GN_5", "HOL") }, u2: { "2026-12-31": cellOf("OFF") } };
  const rows = exportRows(people, dec, grid, (c) => c === "STD1" || c === "GN_5");
  assert.equal(rows[0].length, 4 + 31 + 1);
  assert.equal(rows[2][4], "STD1");
  assert.equal(rows[2][8], "GN_5+HOL");
  assert.equal(rows[2].at(-1), "2", "นับวันทำงาน");
  const back = parseShiftImport(parseCsv(toCsv(rows)), dec, people, codes, new Set());
  assert.deepEqual(back.problems, []);
  assert.equal(back.people, 2);
  assert.deepEqual(
    back.changes.map((c) => [c.user_id, c.work_date, cellText(c.cell)]),
    [["u1", "2026-12-01", "STD1"], ["u1", "2026-12-05", "GN_5+HOL"], ["u2", "2026-12-31", "OFF"]],
  );
});

test("นำเข้า: รูปแบบแอปเดิม (ไม่มีหัวตาราง), ตัวพิมพ์เล็ก, รหัสไม่รู้จัก, รหัสพนักงานซ้ำ/ไม่พบ", () => {
  const table = [
    ["a001", "หนึ่ง", "RT", "std1", "GN_5+OT1", "XYZ"],
    ["A001", "หนึ่ง", "RT", "OFF"],
    ["B999", "ไม่มี", "RT", "STD1"],
  ];
  const r = parseShiftImport(table, dec, people, codes, new Set(["2026-12-02"]));
  assert.deepEqual(r.changes.map((c) => [c.work_date, cellText(c.cell)]), [["2026-12-01", "STD1"], ["2026-12-02", "GN_5+HOL"]]);
  assert.deepEqual(r.unknownCodes, ["XYZ"]);
  assert.ok(r.problems.some((p) => p.includes("ซ้ำ")));
  assert.ok(r.problems.some((p) => p.includes("B999")));
});

test("นำเข้ารูปแบบตารางผลัดเดิม: ไม่มีรหัส จับคู่ด้วยชื่อ/ชื่อเล่น · เลขเวลาเข้า · วันลา · อบรม", async () => {
  const { shiftDef } = await import("../src/lib/shifts.ts");
  const opt = (value, s, e) => ({ value, label: value, extra: s ? { start_time: s, end_time: e } : {} });
  const defs = [opt("STD1", "08:00", "17:00"), opt("GN_5", "20:00", "05:00"), opt("GN_1", "06:00", "15:00"), opt("GN_12", "08:30", "17:30"), opt("OFF")].map(shiftDef);
  const ppl = [
    ...people,
    { id: "u3", employee_code: "A003", first_name_th: "สาม", last_name_th: "ใจดี", nickname: "มังกร", position: "Supervisor" },
    { id: "u4", employee_code: "A004", first_name_th: "สี่", last_name_th: null, nickname: null, position: "Supervisor" },
    { id: "u5", employee_code: "A005", first_name_th: "สี่", last_name_th: null, nickname: null, position: "Supervisor" },
  ];
  const nov = monthDates("2026-11");
  const table = [
    ["ชื่อ", "SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT", ...Array(23).fill("")],
    ["", ...nov.map((d) => String(Number(d.slice(8))))],
    ["นาย หนึ่ง", "OFF", "8", "20", "6", "8:30", "8-17", "ลา"],
    ["มังกร", "พักร้อน", "ป่วย", "อบรม", "13", "ลากิจ"],
    ["ไม่มีชื่อนี้", "8"],
    ["สี่", "8"],
  ];
  const r = parseShiftImport(table, nov, ppl, new Set(["STD1", "GN_5", "GN_1", "GN_12", "OFF"]), new Set(), defs);
  assert.equal(r.matchedBy, "name");
  assert.equal(r.people, 2);
  assert.deepEqual(
    r.changes.map((c) => [c.user_id, Number(c.work_date.slice(8)), c.cell.shift_code]),
    [["u1", 1, "OFF"], ["u1", 2, "STD1"], ["u1", 3, "GN_5"], ["u1", 4, "GN_1"], ["u1", 5, "GN_12"], ["u1", 6, "STD1"], ["u3", 3, "STD1"]],
  );
  assert.deepEqual(r.leaves.map((l) => [l.name, Number(l.work_date.slice(8)), l.text]), [["หนึ่ง (นึ่ง)", 7, "ลา"], ["สาม (มังกร)", 1, "พักร้อน"], ["สาม (มังกร)", 2, "ป่วย"], ["สาม (มังกร)", 5, "ลากิจ"]]);
  assert.ok(r.unknownCodes.some((x) => x.startsWith("13 (ไม่มีกะที่เริ่ม 13:00")), "เวลาที่ไม่มีกะ แจ้งให้เพิ่มรหัสกะ");
  assert.ok(r.problems.some((x) => x.includes('ไม่พบชื่อ "ไม่มีชื่อนี้"')));
  assert.ok(r.problems.some((x) => x.includes('"สี่" ตรงกับหลายคน')), "ชื่อซ้ำให้ใช้รหัสแทน");
  assert.ok(r.problems.some((x) => x.includes("วันลา 4 วัน")));
});

test("แม่แบบ: นำเข้ากลับได้ (จับคู่ด้วยรหัส) และมีวิธีกรอกตามรหัสกะที่ใช้อยู่", async () => {
  const { shiftDef } = await import("../src/lib/shifts.ts");
  const { templateRows } = await import("../src/lib/shift-file.ts");
  const defs = [{ value: "STD1", label: "08:00-17:00", extra: { start_time: "08:00", end_time: "17:00" } }, { value: "GN_5", label: "20:00-05:00", extra: { start_time: "20:00", end_time: "05:00" } }, { value: "OFF", label: "หยุด", extra: {} }].map(shiftDef);
  const rows = templateRows(people, dec, defs);
  assert.deepEqual(rows[0].slice(0, 4), ["รหัสพนักงาน", "ชื่อ", "ตำแหน่ง", "1"]);
  assert.ok(rows.some((r) => r.join(" ").includes("8 = STD1") && r.join(" ").includes("20 = GN_5")));
  rows[2][3] = "8";
  rows[3][4] = "พักร้อน";
  const r = parseShiftImport(parseCsv(toCsv(rows)), dec, people, new Set(["STD1", "GN_5", "OFF"]), new Set(), defs);
  assert.equal(r.matchedBy, "code");
  assert.deepEqual(r.changes.map((c) => [c.user_id, c.work_date, c.cell.shift_code]), [["u1", "2026-12-01", "STD1"]]);
  assert.equal(r.leaves.length, 1);
  assert.equal(r.problems.filter((p) => !p.startsWith("วันลา")).length, 0, "แถววิธีกรอกไม่ถูกนับเป็นปัญหา");
});
