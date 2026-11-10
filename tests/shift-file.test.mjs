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

test("แม่แบบ Excel: ดาวน์โหลด → กรอก → อัปโหลดกลับ ได้ครบ (เปิดด้วยตัวอ่าน .xlsx ของแอป)", async () => {
  const { shiftDef, cellOf } = await import("../src/lib/shifts.ts");
  const { templateSheets, hourShifts } = await import("../src/lib/shift-file.ts");
  const { buildXlsx } = await import("../src/lib/xlsx-write.ts");
  const { readXlsx } = await import("../src/lib/xlsx-read.ts");
  const o = (value, label, s, e) => ({ value, label, extra: s ? { start_time: s, end_time: e } : {} });
  const defs = [o("STD1", "08:00-17:00", "08:00", "17:00"), o("GN_5", "20:00-05:00", "20:00", "05:00"), o("GN_12", "08:30-17:30", "08:30", "17:30"), o("OFF", "หยุด")].map(shiftDef);
  assert.deepEqual(hourShifts(defs).map((h) => [h.hour, h.def.code]), [[8, "STD1"], [20, "GN_5"]]);
  // มีกะเดิมอยู่บางช่อง → แม่แบบใส่ให้เป็นเลขเวลาเข้า / รหัสกะ
  const grid = { u1: { "2026-12-01": cellOf("GN_5"), "2026-12-02": cellOf("GN_12"), "2026-12-03": cellOf("STD1", "HOL") } };
  const sheets = templateSheets(people, dec, defs, grid, "ตารางผลัด คลัง 5 · ธันวาคม 2569");
  const [main, guide] = sheets;
  assert.equal(main.rows[1][3].v, "TUE", "1 ธ.ค. 2569 = วันอังคาร");
  assert.equal(main.rows[2][3].v, 1);
  assert.deepEqual(main.rows[3].slice(0, 6).map((c) => c.v), ["A001", "หนึ่ง (นึ่ง)", "RT", 20, "GN_12", "8+HOL"]);
  assert.ok(main.lists[0].values.includes("8") && main.lists[0].values.includes("พักร้อน"));
  assert.ok(main.lists[0].values.join(",").length < 255, "รายการให้เลือกใน Excel ยาวไม่เกิน 255 ตัวอักษร");
  assert.ok(guide.rows.some((r) => r[0]?.v === "GN_12"), "รหัสกะที่พิมพ์เป็นเลขไม่ได้อยู่ในวิธีกรอก");
  // หัวหน้ากรอกเพิ่มใน Excel
  main.rows[3][6] = { v: "พักร้อน" };
  main.rows[4][3] = { v: 8 };
  main.rows[4][4] = { v: "OFF" };
  const table = await readXlsx(buildXlsx(sheets));
  assert.equal(table[0][0], "ตารางผลัด คลัง 5 · ธันวาคม 2569");
  const r = parseShiftImport(table, dec, people, new Set(["STD1", "GN_5", "GN_12", "OFF"]), new Set(), defs);
  assert.equal(r.matchedBy, "code");
  assert.equal(r.people, 2);
  assert.deepEqual(
    r.changes.map((c) => [c.user_id, Number(c.work_date.slice(8)), cellText(c.cell)]),
    [["u1", 1, "GN_5"], ["u1", 2, "GN_12"], ["u1", 3, "STD1+HOL"], ["u2", 1, "STD1"], ["u2", 2, "OFF"]],
  );
  assert.deepEqual(r.leaves.map((l) => [l.user_id, Number(l.work_date.slice(8))]), [["u1", 4]]);
  assert.deepEqual(r.problems.filter((p) => !p.startsWith("วันลา")), []);
});
