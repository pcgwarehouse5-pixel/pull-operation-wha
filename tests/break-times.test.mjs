// ทดสอบเวลาพัก 2 รอบ แยกผลัดเช้า/ดึก (ข้อมูลตามที่ผู้ใช้กำหนด)
import { test } from "node:test";
import assert from "node:assert/strict";
import { breakPair, breakShort, breakSlots } from "../src/lib/break-times.ts";

const opt = (value, sort_order, extra = {}, is_active = true) => ({ value, sort_order, is_active, extra });
const OPTIONS = [
  opt("12:00", 2, { shift: "morning", second: "17:00", second_note: "ก่อนเริ่ม OT" }),
  opt("11:00", 1, { shift: "morning", second: "16:30", second_note: "ก่อนเริ่ม OT" }),
  opt("13:00", 3, { shift: "morning", second: "17:30", second_note: "ก่อนเริ่ม OT" }),
  opt("23:30", 11, { shift: "night", second: "02:00" }),
  opt("00:00", 12, { shift: "night", second: "03:00" }),
  opt("00:30", 13, { shift: "night", second: "04:00" }),
  opt("14:00", 20, { shift: "morning", second: "18:00" }, false),
];

test("เลือกได้เฉพาะเวลาพักของผลัดนั้น เรียงตามลำดับ (ผลัดดึกข้ามเที่ยงคืนเรียงถูก)", () => {
  assert.deepEqual(breakSlots(OPTIONS, "morning").map((s) => `${s.first}>${s.second}`), ["11:00>16:30", "12:00>17:00", "13:00>17:30"]);
  assert.deepEqual(breakSlots(OPTIONS, "night").map((s) => `${s.first}>${s.second}`), ["23:30>02:00", "00:00>03:00", "00:30>04:00"]);
  assert.equal(breakSlots(undefined, "morning").length, 0);
});

test("เลือกรอบแรกครั้งเดียว ได้รอบ 2 คู่กัน ตามที่กำหนด", () => {
  const pair = (shift, t) => breakPair(OPTIONS, shift, t);
  assert.deepEqual(pair("morning", "11:00:00"), { first: "11:00", second: "16:30", note: "ก่อนเริ่ม OT" });
  assert.equal(pair("morning", "12:00").second, "17:00");
  assert.equal(pair("morning", "13:00").second, "17:30");
  assert.deepEqual(pair("night", "23:30:00"), { first: "23:30", second: "02:00", note: "" });
  assert.equal(pair("night", "00:00:00").second, "03:00");
  assert.equal(pair("night", "00:30:00").second, "04:00");
});

test("เวลาที่ไม่มีในตัวเลือกของผลัดนั้น แสดงรอบแรกอย่างเดียว · ไม่มีเวลา = ยังไม่ตั้ง", () => {
  assert.deepEqual(breakPair(OPTIONS, "night", "11:00:00"), { first: "11:00", second: null, note: "" }, "ผลัดดึกที่ตั้ง 11:00 ไว้ก่อนแยกผลัด");
  assert.deepEqual(breakPair(OPTIONS, "morning", "09:15"), { first: "09:15", second: null, note: "" });
  assert.equal(breakPair(OPTIONS, "morning", null), null);
  assert.equal(breakPair(OPTIONS, "morning", "14:00").second, "18:00", "ตัวเลือกที่ปิดแล้วยังบอกรอบ 2 ของคนที่ตั้งไว้แล้วได้");
});

test("ตัวเลือกที่ไม่ระบุผลัดใช้ได้ทุกผลัด · รอบ 2 รูปแบบผิดไม่แสดง", () => {
  const list = [opt("10:00", 1), opt("15:00", 2, { second: "25:00" })];
  assert.equal(breakSlots(list, "night").length, 2);
  assert.equal(breakPair(list, "morning", "15:00").second, null);
});

test("ข้อความสั้นบนป้าย", () => {
  assert.equal(breakShort({ first: "11:00", second: "16:30", note: "" }), "พัก 11:00 · 16:30");
  assert.equal(breakShort({ first: "11:00", second: null, note: "" }), "พัก 11:00");
});
