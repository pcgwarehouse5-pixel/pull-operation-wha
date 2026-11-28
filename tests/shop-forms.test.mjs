// ทดสอบตัวช่วยแบบฟอร์มหน้าร้าน: ลาเป็นชั่วโมง · แบบฟอร์มลางาน · ใบแจ้งตารางการปฏิบัติงาน (ข้อมูลสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import { daysText, hourChoices, hoursToDays, isSunday, leaveEnd, leaveFormSheet, parseShiftForm, shiftCell, thaiDmy, thaiRange } from "../src/lib/shop-forms.ts";

test("ลาเป็นชั่วโมง: เวลาสิ้นสุด · ตัวเลือกชั่วโมง · แปลงเป็นวัน (ตรงกับฐานข้อมูลปัด 3 ตำแหน่ง)", () => {
  assert.equal(leaveEnd("10:00", 2), "12:00");
  assert.equal(leaveEnd("08:30", 1.5), "10:00");
  assert.equal(leaveEnd("23:00", 2), null);
  assert.deepEqual(hourChoices(8, 60), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(hourChoices(4, 30), [0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  assert.equal(hoursToDays(2, 8), 0.25);
  assert.equal(hoursToDays(1.5, 8), 0.188);
});

test("daysText: วัน + ชั่วโมง", () => {
  assert.equal(daysText(11.75, 8), "11 วัน 6 ชม.");
  assert.equal(daysText(0.25, 8), "2 ชม.");
  assert.equal(daysText(1, 8), "1 วัน");
  assert.equal(daysText(0, 8), "0 วัน");
  assert.equal(daysText(-0.5, 8), "-4 ชม.");
  assert.equal(daysText(11.812, 8), "11 วัน 6.5 ชม.");
});

test("วันที่ พ.ศ.", () => {
  assert.equal(thaiDmy("2001-03-05"), "05/03/2544");
  assert.equal(thaiRange("2027-04-05", "2027-04-05"), "05/04/2570");
  assert.equal(thaiRange("2027-04-05", "2027-04-07"), "05–07/04/2570");
  assert.equal(thaiRange("2027-03-30", "2027-04-02"), "30/03–02/04/2570");
  assert.equal(thaiRange("2026-12-31", "2027-01-02"), "31/12/2569–02/01/2570");
});

const row = (o) => ({ user_id: "u", request_id: "r", leave_type: "sick", start_date: "2027-03-02", end_date: "2027-03-02", period: "full", start_time: null, hours: null, days: 1, reason: null, approved_by: "หัวหน้า", vacation_quota: 12, ...o });

test("แบบฟอร์มลางาน: แยกคอลัมน์ ป่วย/กิจ/พักผ่อน (วัน/ชม.) · สิทธิพักผ่อนคงเหลือ · ประเภทอื่นเขียนในเหตุผล · ยอดรวม", () => {
  const s = leaveFormSheet(
    [
      row({ request_id: "a", leave_type: "vacation", period: "hours", start_time: "13:00:00", hours: 4, days: 0.5, reason: "ธุระ" }),
      row({ request_id: "b", leave_type: "sick", start_date: "2027-04-05", end_date: "2027-04-06", days: 2 }),
      row({ request_id: "c", leave_type: "personal", period: "morning", days: 0.5, start_date: "2027-05-03", end_date: "2027-05-03" }),
      row({ request_id: "d", leave_type: "vacation", days: 3, start_date: "2027-06-01", end_date: "2027-06-03" }),
      row({ request_id: "e", leave_type: "ordination", days: 15, start_date: "2027-07-01", end_date: "2027-07-15", reason: "บวชทดแทนคุณ" }),
    ],
    8,
    (c) => ({ ordination: "บวช" })[c] ?? c,
  );
  assert.equal(s.quota, 12);
  assert.deepEqual(s.lines.map((l) => [l.date, JSON.stringify(l.cells), l.vacationLeft, l.reason]), [
    ["02/03/2570", '{"vacation":{"days":0,"hours":4}}', "11 วัน 4 ชม.", "13:00–17:00 น. · ธุระ"],
    ["05–06/04/2570", '{"sick":{"days":2,"hours":0}}', "", ""],
    ["03/05/2570", '{"personal":{"days":0.5,"hours":0}}', "", "ครึ่งวันเช้า"],
    ["01–03/06/2570", '{"vacation":{"days":3,"hours":0}}', "8 วัน 4 ชม.", ""],
    ["01–15/07/2570", "{}", "", "ลาบวช 15 วัน · บวชทดแทนคุณ"],
  ]);
  assert.deepEqual(s.totals, { sick: { days: 2, hours: 0 }, personal: { days: 0.5, hours: 0 }, vacation: { days: 3, hours: 4 } });
});

test("แบบฟอร์มลางาน: คนที่ไม่มีใบลา → ไม่มีแถว แต่ยังรู้สิทธิลาพักผ่อน", () => {
  const s = leaveFormSheet([row({ request_id: null, leave_type: null, start_date: null, vacation_quota: 6 })], 8, (c) => c);
  assert.deepEqual([s.lines.length, s.quota], [0, 6]);
});

test("ใบแจ้งตารางการปฏิบัติงาน: รหัสที่ตั้ง → ตัวเลขกะ · กะอื่น → ชั่วโมงเข้างาน · วันหยุด → - · อาทิตย์", () => {
  const codes = { STD1: "1" };
  assert.equal(shiftCell("STD1", "08:00", codes), "1");
  assert.equal(shiftCell("WH_3", "10:00", codes), "10");
  assert.equal(shiftCell("GA-2", "07:30", codes), "7.30");
  assert.equal(shiftCell("GN_1", "06:00", codes), "6");
  assert.equal(shiftCell("OFF", null, codes), "-");
  assert.equal(shiftCell(null, null, codes), "");
  assert.equal(isSunday("2026-11-01"), true);
  assert.equal(isSunday("2026-11-02"), false);
  const f = parseShiftForm({ company: "บริษัท ก", codes: { STD1: "1", BAD: 5 }, signer_name: "ผู้จัดการ" });
  assert.deepEqual([f.company, f.codes, f.signer_name, f.legend], ["บริษัท ก", { STD1: "1" }, "ผู้จัดการ", ""]);
});
