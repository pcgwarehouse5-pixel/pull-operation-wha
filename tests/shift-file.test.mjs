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
