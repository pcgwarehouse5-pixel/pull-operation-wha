// ทดสอบการแปลงข้อมูลลงเวลา + OT เป็นแถวใบลงเวลา (ฟอร์ม MOU / คนไทย) ด้วยข้อมูลสมมติ
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDays, dmy, formOf, halfDays, hhmm, hrs, monthDays, parseForm, periodLabel, personName, ratesFor, settingAt, totals, unmappedMouRates } from "../src/lib/timesheet.ts";

const U = "u1";
const t = (d, hm) => `${d}T${hm}:00+07:00`;
const att = (d, o = {}) => ({ user_id: U, work_date: d, shift_code: "STD1", shift_start: t(d, "08:00"), shift_end: t(d, "17:00"), first_in: t(d, "07:52"), last_out: t(d, "17:04"), leave_type: null, leave_period: null, status: "ok", ...o });
const ot = (d, o = {}) => ({ user_id: U, work_date: d, day_type: "normal", normal_hours: 0, normal_rate: null, ot_hours: 2, ot_rate: 1.5, approval: "approved", ...o });
const label = (c) => ({ sick: "ลาป่วย", personal: "ลากิจ" })[c] ?? c;

test("รอบครึ่งเดือนตามปฏิทิน และป้ายงวด", () => {
  assert.equal(monthDays("2026-02").length, 28);
  assert.equal(monthDays("2026-12").length, 31);
  const h1 = halfDays("2026-11", 1);
  const h2 = halfDays("2026-11", 2);
  assert.deepEqual([h1.length, h1[0], h1.at(-1)], [15, "2026-11-01", "2026-11-15"]);
  assert.deepEqual([h2.length, h2[0], h2.at(-1)], [15, "2026-11-16", "2026-11-30"]);
  assert.equal(halfDays("2026-12", 2).length, 16);
  assert.equal(periodLabel(h2), "16-30/11/2026");
  assert.equal(periodLabel(h1), "1-15/11/2026");
  assert.equal(dmy("2026-11-16"), "16-11-2026");
});

test("เวลาแสดงตามเวลาไทย และชั่วโมง", () => {
  assert.equal(hhmm("2026-11-16T00:52:00Z"), "07:52");
  assert.equal(hhmm("2026-11-16T17:00:00Z"), "00:00");
  assert.equal(hhmm(null), "");
  assert.deepEqual([hrs(0), hrs(2), hrs(2.5), hrs(null)], ["", "2", "2.5", ""]);
});

test("วันทำงานปกติ: เวลาตามตารางกะ (เข้า 07:52 → 08:00 · ออก 19:10 OT 2 ชม. → 19:00) แรงงาน 1 วัน", () => {
  const d = "2026-11-16";
  const [r] = buildDays([d], [att(d, { last_out: t(d, "19:10") })], [ot(d)], "2026-11-26", label);
  assert.equal(r.off, false);
  assert.equal(r.workUnits, 1);
  assert.deepEqual([hhmm(r.inAt), hhmm(r.outAt)], ["08:00", "19:00"]);
  assert.deepEqual([hhmm(r.normalFrom), hhmm(r.normalTo)], ["08:00", "17:00"]);
  assert.deepEqual([hhmm(r.otFrom), hhmm(r.otTo)], ["17:00", "19:00"]);
  assert.equal(r.byRate.get(1.5), 2);
  assert.equal(r.workdayOt, 2);
});

test("OT ที่ยังไม่อนุมัติ/ต้องอนุมัติใหม่ ไม่ใส่ในใบ แต่ติดธงเตือน", () => {
  const d = "2026-11-17";
  for (const approval of ["pending", "changed", "rejected"]) {
    const [r] = buildDays([d], [att(d, { last_out: t(d, "19:10") })], [ot(d, { approval })], "2026-11-26", label);
    assert.equal(r.byRate.size, 0);
    assert.equal(r.otFrom, null);
    assert.equal(r.otWaiting, true, approval);
    assert.deepEqual([hhmm(r.normalFrom), hhmm(r.normalTo)], ["08:00", "17:00"]);
    assert.equal(hhmm(r.outAt), "17:00", "OT ยังไม่อนุมัติ เวลาออกไม่เกินเลิกกะ");
  }
});

test("วันหยุดของคนนั้น: ระบายเทา ไม่นับแรงงาน · มาทำงานวันหยุด = ช่วง OT ทั้งช่วง แยกชั่วโมง 1 เท่า / 3 เท่า", () => {
  const d = "2026-11-22";
  const off = att(d, { shift_code: "OFF", shift_start: null, shift_end: null, first_in: null, last_out: null, status: "off" });
  const [r0] = buildDays([d], [off], [], "2026-11-26", label);
  assert.equal(r0.off, true);
  assert.equal(r0.workUnits, null);
  const worked = { ...off, first_in: t(d, "07:55"), last_out: t(d, "19:30"), status: "off_worked" };
  const [r] = buildDays([d], [worked], [ot(d, { day_type: "OFF", normal_hours: 8, normal_rate: 1, ot_hours: 2.5, ot_rate: 3 })], "2026-11-26", label);
  assert.equal(r.off, true);
  assert.equal(r.workUnits, null);
  assert.equal(r.normalFrom, null);
  // ทำ 11:35 ชม. หักพัก 1 ชม. = 10:35 → ปกติ 8 + OT 2.5 → แสดง 07:55–19:25 (ตรงกับชั่วโมงที่จ่าย)
  assert.deepEqual([hhmm(r.otFrom), hhmm(r.otTo)], ["07:55", "19:25"]);
  assert.deepEqual([r.byRate.get(1), r.byRate.get(3), r.holidayNormal, r.holidayOt, r.workdayOt], [8, 2.5, 8, 2.5, 0]);
});

test("ลา ขาด ลืมลงเวลา → หมายเหตุ · ลาครึ่งวันได้แรงงาน 0.5", () => {
  const d1 = "2026-11-18", d2 = "2026-11-19", d3 = "2026-11-20", d4 = "2026-11-21";
  const rows = buildDays(
    [d1, d2, d3, d4],
    [
      att(d1, { first_in: null, last_out: null, leave_type: "sick", leave_period: "full", status: "leave" }),
      att(d2, { first_in: t(d2, "12:58"), leave_type: "personal", leave_period: "morning", status: "leave_half" }),
      att(d3, { first_in: null, last_out: null, status: "absent" }),
      att(d4, { last_out: null, status: "no_out" }),
    ],
    [],
    "2026-11-26",
    label,
  );
  assert.deepEqual(rows.map((r) => r.remark), ["ลาป่วย", "ลากิจ (ครึ่งเช้า)", "ขาดงาน", "ไม่มีเวลาออก"]);
  assert.deepEqual(rows.map((r) => r.workUnits), [null, 0.5, null, 1]);
  assert.equal(rows[3].normalTo, null, "ไม่มีเวลาออก = ไม่เดาเวลาสิ้นสุด");
});

test("วันที่ยังไม่ถึง: ว่างทั้งแถว แต่ยังระบายเทาวันหยุดตามตารางกะ", () => {
  const d = "2026-11-29";
  const [r] = buildDays([d], [att(d, { shift_code: "OFF", shift_start: null, shift_end: null, first_in: null, last_out: null, status: "off" })], [], "2026-11-26", label);
  assert.equal(r.future, true);
  assert.equal(r.off, true);
  const [r2] = buildDays(["2026-11-27"], [att("2026-11-27", { status: "upcoming" })], [], "2026-11-26", label);
  assert.deepEqual([r2.inAt, r2.workUnits, r2.remark], [null, null, ""]);
});

test("รวมทั้งใบ และเตือนอัตราที่ไม่มีช่องในฟอร์ม MOU", () => {
  const ds = ["2026-11-02", "2026-11-03", "2026-11-08"];
  const rows = buildDays(
    ds,
    [att(ds[0], { last_out: t(ds[0], "19:00") }), att(ds[1], { last_out: t(ds[1], "18:30") }), att(ds[2], { shift_code: "OFF", shift_start: null, shift_end: null, status: "off_worked" })],
    [ot(ds[0]), ot(ds[1], { ot_hours: 1.5 }), ot(ds[2], { day_type: "OFF", normal_hours: 8, normal_rate: 2.5, ot_hours: 0, ot_rate: null })],
    "2026-11-26",
    label,
  );
  const s = totals(rows);
  assert.deepEqual([s.units, s.byRate.get(1.5), s.workdayOt, s.holidayNormal], [2, 3.5, 3.5, 8]);
  assert.deepEqual(unmappedMouRates(rows), [2.5]);
});

test("ตัวช่วยอื่น: ฟอร์มตามประเภท อัตราตามตั้งค่า ชื่อ ค่าตั้งค่าตามวันที่ อ่านค่าฟอร์มแบบปลอดภัย", () => {
  assert.deepEqual([formOf("mou"), formOf("MOU"), formOf("monthly_employee"), formOf(null)], ["mou", "mou", "thai", "thai"]);
  const rates = { default: { workday: 1.5, holiday_normal: 1, holiday_ot: 3 }, daily_worker: { holiday_normal: 2 } };
  assert.deepEqual(ratesFor(rates, "daily_worker"), { workday: 1.5, holiday_normal: 2, holiday_ot: 3 });
  assert.deepEqual(ratesFor(rates, "mou"), { workday: 1.5, holiday_normal: 1, holiday_ot: 3 });
  assert.equal(personName({ title: "นาย", first_name_th: "ทดสอบ", last_name_th: "สมมติ" }), "นาย ทดสอบ สมมติ");
  assert.equal(personName({ title: null, first_name_th: "ทดสอบ", last_name_th: null }), "ทดสอบ");
  const hist = [{ effective_from: "2000-01-01", value: "a" }, { effective_from: "2026-12-01", value: "b" }];
  assert.deepEqual([settingAt(hist, "2026-11-30"), settingAt(hist, "2026-12-01"), settingAt([], "2026-12-01")], ["a", "b", undefined]);
  const f = parseForm({ mou: { company: "บริษัท ก", notes: ["x", 5, "y"] }, wh: { WH5: { mou_ul: "128" } }, junk: 1 });
  assert.equal(f.mou.company, "บริษัท ก");
  assert.deepEqual(f.mou.notes, ["x", "y"]);
  assert.equal(f.thai.company, "");
  assert.deepEqual(f.wh.WH5, { mou_dept: "", mou_ul: "128", thai_dept: "", thai_ul: "" });
  assert.deepEqual(parseForm(null).wh, {});
});

test("หมายเหตุสาย N นาที (เฉพาะเมื่อเปิด) · มาสายแสดงเวลาเข้าจริง", () => {
  const d = "2026-11-18";
  const late = att(d, { first_in: t(d, "08:12"), status: "late", late_min: 12 });
  const [a] = buildDays([d], [late], [], "2026-11-26", label);
  assert.equal(a.remark, "");
  const [b] = buildDays([d], [late], [], "2026-11-26", label, { lateNote: true });
  assert.equal(b.remark, "สาย 12 นาที");
  assert.equal(hhmm(b.inAt), "08:12");
});
