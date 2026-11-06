// ทดสอบตัวอ่าน/เขียนไฟล์ CSV และ Excel (.xlsx) และการตรวจข้อมูลนำเข้า (ข้อมูลสมมติทั้งหมด)
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { toCsv, parseCsv, safeCell } from "../src/lib/csv.ts";
import { readXlsx } from "../src/lib/xlsx-read.ts";
import { parseImport, summarize, headerToField } from "../src/lib/employee-import.ts";

test("CSV: กันสูตร Excel อันตราย และอ่านกลับได้ตรงเดิม", () => {
  assert.equal(safeCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(safeCell("+66812345678"), "'+66812345678");
  assert.equal(safeCell("@SUM"), "'@SUM");
  assert.equal(safeCell("-5"), "'-5");
  assert.equal(safeCell("สมชาย"), "สมชาย");
  const csv = toCsv([["รหัส", "ชื่อ"], ["001", 'ใจ "ดี", มาก'], ["002", "บรรทัด\nสอง"]]);
  assert.ok(csv.startsWith("﻿"), "มี BOM ให้ Excel อ่านภาษาไทยถูก");
  assert.deepEqual(parseCsv(csv), [["รหัส", "ชื่อ"], ["001", 'ใจ "ดี", มาก'], ["002", "บรรทัด\nสอง"]]);
  assert.deepEqual(parseCsv("a\tb\n1\t2\n\n"), [["a", "b"], ["1", "2"]], "คั่นด้วย tab (วางจาก Excel) ก็อ่านได้");
});

// สร้างไฟล์ .xlsx ขนาดเล็กในหน่วยความจำ (zip + XML) เพื่อทดสอบตัวอ่าน
function makeXlsx(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name);
    const raw = enc.encode(text);
    const data = zlib.deflateRawSync(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

test("Excel: อ่านข้อความ ตัวเลข ข้อความในเซลล์ และช่องว่างข้ามคอลัมน์", async () => {
  const file = makeXlsx({
    "xl/sharedStrings.xml": `<sst><si><t>รหัสพนักงาน</t></si><si><t>ชื่อ</t></si><si><r><t>สม</t></r><r><t>ชาย</t></r></si><si><t>A &amp; B</t></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>3</v></c></row>
      <row r="2"><c r="A2"><v>12345</v></c><c r="B2" t="s"><v>2</v></c></row>
      <row r="3"><c r="A3" t="inlineStr"><is><t>E-01</t></is></c><c r="C3"><v>7</v></c></row>
      <row r="4"></row>
    </sheetData></worksheet>`,
  });
  assert.deepEqual(await readXlsx(file), [
    ["รหัสพนักงาน", "ชื่อ", "A & B"],
    ["12345", "สมชาย"],
    ["E-01", "", "7"],
  ]);
  await assert.rejects(readXlsx(new Uint8Array([1, 2, 3])), /ไม่ใช่ไฟล์ Excel/);
});

const ctx = (over = {}) => ({
  warehouseId: "WH5",
  positions: ["RT", "Checker"],
  employmentTypes: [{ value: "monthly_employee", label: "พนักงานรายเดือน" }, { value: "mou", label: "MOU" }],
  existing: new Map([["0003", { warehouse_id: "WH5", manageable: true }], ["0009", { warehouse_id: "WH32", manageable: false }]]),
  updateExisting: false,
  ...over,
});

test("นำเข้า: จับคู่หัวคอลัมน์ทั้งแม่แบบใหม่และไฟล์แอปเดิม และไม่รับรหัสผ่าน", () => {
  assert.equal(headerToField("รหัสพนักงาน"), "employee_code");
  assert.equal(headerToField("รหัสเงินเดือน"), "salary_code");
  assert.equal(headerToField("ชื่อเล่น"), "nickname");
  assert.equal(headerToField("ชื่อ"), "first_name_th");
  assert.equal(headerToField("นามสกุล"), "last_name_th");
  assert.equal(headerToField("ประเภทพนักงาน"), "employment_type");
  assert.equal(headerToField("บริษัทรับเหมา"), "subcontractor_company");
  assert.equal(headerToField("รหัสผ่าน"), null);
  const r = parseImport([["รหัส", "นามสกุล"], ["1", "x"]], ctx());
  assert.deepEqual(r.missingColumns, ["ชื่อ"], "ไม่มีคอลัมน์ชื่อ → หยุดก่อน");
});

test("นำเข้า: ตรวจรหัสซ้ำ ชื่อว่าง รหัสผิดรูปแบบ คนของคลังอื่น และแปลงประเภทพนักงาน", () => {
  const table = [
    ["รหัสพนักงาน", "คำนำหน้า", "ชื่อ", "นามสกุล", "ตำแหน่ง", "ประเภทพนักงาน", "เบอร์โทร", "รหัสผ่าน"],
    ["0001", "นาย", "สมมติ", "ทดสอบ", "RT", "พนักงานรายเดือน", "081-234-5678", "1234"],
    ["0002", "", "ทดลอง", "", "ตำแหน่งใหม่", "รายวันพิเศษ", "abc", ""],
    ["0001", "", "ซ้ำ", "", "", "", "", ""],
    ["รหัส ไทย", "", "x", "", "", "", "", ""],
    ["0005", "", "", "", "", "", "", ""],
    ["0003", "", "มีแล้ว", "", "RT", "MOU", "", ""],
    ["0009", "", "คนคลังอื่น", "", "", "", "", ""],
  ];
  const { rows } = parseImport(table, ctx());
  const byLine = Object.fromEntries(rows.map((r) => [r.line, r]));
  assert.equal(byLine[2].action, "create");
  assert.equal(byLine[2].data.employment_type, "monthly_employee", "ชื่อที่แสดงแปลงเป็นรหัส");
  assert.ok(!("password" in byLine[2].data));
  assert.deepEqual(byLine[3].warnings.length, 3, "ตำแหน่งใหม่ + ประเภทไม่รู้จัก + เบอร์ผิด");
  assert.equal(byLine[3].data.phone, undefined);
  assert.deepEqual(byLine[4].errors, ["รหัสพนักงานซ้ำในไฟล์"]);
  assert.match(byLine[5].errors[0], /A-Z/);
  assert.deepEqual(byLine[6].errors, ["ไม่มีชื่อ"]);
  assert.equal(byLine[7].action, "skip", "มีอยู่แล้ว และไม่ได้เลือกอัปเดต → ข้าม");
  assert.match(byLine[8].errors[0], /ไม่มีสิทธิ์/);
  assert.deepEqual(summarize(rows), { create: 2, update: 0, skip: 1, error: 4, warning: 1 });

  const upd = parseImport(table, ctx({ updateExisting: true })).rows.find((r) => r.line === 7);
  assert.equal(upd.action, "update");
});
