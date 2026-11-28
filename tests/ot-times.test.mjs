// ทดสอบเวลาในรายงาน OT "ตามตารางกะ" (ผู้ใช้กำหนด 28 พ.ย. 2569) — ชั่วโมงมาจากฐานข้อมูล เวลาในรายงานต้องตรงกับชั่วโมง
import { test } from "node:test";
import assert from "node:assert/strict";
import { paidTimes, shiftWindow } from "../src/lib/ot-times.ts";
import { hhmm } from "../src/lib/timesheet.ts";

const D = "2026-12-02";
const t = (hm, d = D) => `${d}T${hm}:00+07:00`;
const BRK = { minutes: 60, after: 480 };
const day = (o) => ({ off: false, firstIn: t("07:50"), lastOut: t("20:05"), shiftStart: t("08:00"), shiftEnd: t("17:00"), normalHours: 0, otHours: 3, counted: true, ...o });
const show = (p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, hhmm(v)]));

test("วันทำงาน: สแกน 07:50 กะ 08:00 → 08:00 · ออก 20:05 OT 3 ชม. → 20:00", () => {
  assert.deepEqual(show(paidTimes(day({}), BRK)), { from: "08:00", to: "20:00", normalFrom: "08:00", normalTo: "17:00", otFrom: "17:00", otTo: "20:00" });
});

test("วันทำงาน: ออก 20:35 OT 3.5 ชม. → 20:30 · มาสาย 08:12 แสดงเวลาจริง", () => {
  const p = paidTimes(day({ firstIn: t("08:12"), lastOut: t("20:35"), otHours: 3.5 }), BRK);
  assert.equal(hhmm(p.from), "08:12");
  assert.equal(hhmm(p.otTo), "20:30");
});

test("MOU ชั่วโมงแรกไม่ครบ: ออก 17:35 ไม่มี OT → แสดง 17:00 · ออก 18:35 OT 1.5 → 18:30", () => {
  assert.deepEqual(show(paidTimes(day({ lastOut: t("17:35"), otHours: 0 }), BRK)), { from: "08:00", to: "17:00", normalFrom: "08:00", normalTo: "17:00", otFrom: "", otTo: "" });
  assert.equal(hhmm(paidTimes(day({ lastOut: t("18:35"), otHours: 1.5 }), BRK).to), "18:30");
});

test("OT ยังไม่อนุมัติ: เวลาออกไม่เกินเลิกกะ · ออกก่อนเลิกกะแสดงเวลาจริง · ไม่มีเวลาออก", () => {
  assert.equal(hhmm(paidTimes(day({ counted: false }), BRK).to), "17:00");
  assert.equal(hhmm(paidTimes(day({ lastOut: t("16:40"), otHours: 0 }), BRK).to), "16:40");
  const p = paidTimes(day({ lastOut: null }), BRK);
  assert.equal(hhmm(p.from), "08:00");
  assert.equal(p.to, null);
});

test("กะดึกข้ามวัน: เลิก 05:00 OT 2 ชม. → 07:00 ของวันถัดไป", () => {
  const w = shiftWindow("2026-12-04", "20:00", "05:00");
  assert.equal(w.end, new Date("2026-12-05T05:00:00+07:00").toISOString());
  const p = paidTimes(day({ firstIn: t("19:55", "2026-12-04"), lastOut: t("07:10", "2026-12-05"), shiftStart: w.start, shiftEnd: w.end, otHours: 2 }), BRK);
  assert.equal(hhmm(p.from), "20:00");
  assert.equal(p.to, new Date("2026-12-05T07:00:00+07:00").toISOString());
});

test("วันหยุด: เข้า 07:55 (กะ 08:00) ออก 17:20 ทำ 8 ชม. หักพัก 1 ชม. → 08:00–17:00 · ไม่ถึง 8 ชม. ไม่หักพัก", () => {
  const p = paidTimes({ off: true, firstIn: t("07:55"), lastOut: t("17:20"), shiftStart: t("08:00"), shiftEnd: t("17:00"), normalHours: 8, otHours: 0, counted: true }, BRK);
  assert.deepEqual([hhmm(p.from), hhmm(p.to), hhmm(p.otFrom), hhmm(p.otTo)], ["08:00", "17:00", "08:00", "17:00"]);
  const q = paidTimes({ off: true, firstIn: t("09:03"), lastOut: t("13:20"), shiftStart: null, shiftEnd: null, normalHours: 4, otHours: 0, counted: true }, BRK);
  assert.deepEqual([hhmm(q.from), hhmm(q.to)], ["09:03", "13:03"]);
});

test("shiftWindow: เวลาไม่ครบ → null", () => {
  assert.deepEqual(shiftWindow(D, null, "17:00"), { start: null, end: null });
  assert.deepEqual(shiftWindow(D, "8:00", "17:00"), { start: new Date(t("08:00")).toISOString(), end: new Date(t("17:00")).toISOString() });
});
