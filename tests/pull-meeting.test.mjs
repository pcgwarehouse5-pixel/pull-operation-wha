// รอบถัดไปที่หน้า Pull เลือกให้อัตโนมัติ ตามเวลาประชุมเริ่มงาน (หัวหน้าคลังจองคนก่อนประชุมประมาณ 1 ชั่วโมง)
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextRound, bangkokNowMin, shiftWithMeeting, isHm, DEFAULT_MEETINGS } from "../src/lib/pull.ts";

const M = { morning: "08:00", night: "20:00" };
const at = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

test("ก่อน 08:00 = กะเช้าวันนี้ · 08:00–19:59 = กะดึกวันนี้ · ตั้งแต่ 20:00 = กะเช้าพรุ่งนี้", () => {
  assert.deepEqual(nextRound("2026-11-18", at("00:30"), M), { date: "2026-11-18", shift: "morning" });
  assert.deepEqual(nextRound("2026-11-18", at("07:00"), M), { date: "2026-11-18", shift: "morning" }, "จองก่อนประชุมเช้า 1 ชม.");
  assert.deepEqual(nextRound("2026-11-18", at("07:59"), M), { date: "2026-11-18", shift: "morning" });
  assert.deepEqual(nextRound("2026-11-18", at("08:00"), M), { date: "2026-11-18", shift: "night" });
  assert.deepEqual(nextRound("2026-11-18", at("19:00"), M), { date: "2026-11-18", shift: "night" }, "จองก่อนประชุมดึก 1 ชม.");
  assert.deepEqual(nextRound("2026-11-18", at("20:00"), M), { date: "2026-11-19", shift: "morning" });
  assert.deepEqual(nextRound("2026-11-30", at("23:00"), M), { date: "2026-12-01", shift: "morning" }, "ข้ามเดือน");
  assert.deepEqual(nextRound("2026-12-31", at("21:00"), M), { date: "2027-01-01", shift: "morning" }, "ข้ามปี");
});

test("เปลี่ยนเวลาประชุมในหน้าตั้งค่า แล้วรอบที่เลือกให้เปลี่ยนตาม", () => {
  const m = { morning: "07:30", night: "19:30" };
  assert.deepEqual(nextRound("2026-11-18", at("07:40"), m), { date: "2026-11-18", shift: "night" });
  assert.deepEqual(nextRound("2026-11-18", at("19:40"), m), { date: "2026-11-19", shift: "morning" });
});

test("เวลาไทย ข้อความกะ และรูปแบบเวลา", () => {
  assert.equal(bangkokNowMin(new Date("2026-11-18T00:05:00Z")), at("07:05"), "UTC 00:05 = 07:05 เวลาไทย");
  assert.equal(bangkokNowMin(new Date("2026-11-18T17:30:00Z")), at("00:30"), "ข้ามวันตามเวลาไทย");
  assert.equal(shiftWithMeeting("morning", M), "กะเช้า · ประชุม 08:00 น.");
  assert.equal(shiftWithMeeting("night", M), "กะดึก · ประชุม 20:00 น.");
  assert.ok(isHm("08:00") && isHm("23:59"));
  assert.ok(!isHm("8:00") && !isHm("24:00") && !isHm("12:60") && !isHm(800));
  assert.deepEqual(DEFAULT_MEETINGS, M, "ค่าเริ่มต้นตรงกับ migration 0025");
});
