// ทดสอบการเลือก "ตำแหน่งงานตอนนี้" ของพนักงาน (รวมกะดึกข้ามเที่ยงคืน)
import { test } from "node:test";
import assert from "node:assert/strict";
import { currentPosition, upcomingPositions, breakHm } from "../src/lib/my-position.ts";

const pos = (work_date, shift = "morning", extra = {}) => ({
  id: work_date, work_date, shift, skill_name: "RT รับ", to_code: "WH5", to_name: "คลัง 5", break_time: null, away: false, ...extra,
});

test("ตำแหน่งวันนี้ / ยังไม่จัด", () => {
  const rows = [pos("2026-11-12"), pos("2026-11-14")];
  assert.equal(currentPosition(rows, {}, "2026-11-12", new Date("2026-11-12T09:00:00+07:00")).pos.id, "2026-11-12");
  const none = currentPosition(rows, {}, "2026-11-13", new Date("2026-11-13T09:00:00+07:00"));
  assert.deepEqual(none, { date: "2026-11-13", pos: null });
});

test("กะดึกเมื่อวานยังไม่จบ → แสดงกะเมื่อวานก่อน เลิกกะแล้วค่อยแสดงของวันนี้", () => {
  const rows = [pos("2026-11-11", "night"), pos("2026-11-12")];
  const shifts = { "2026-11-11": { code: "N20", start: "2026-11-11T20:00:00+07:00", end: "2026-11-12T05:00:00+07:00" } };
  assert.equal(currentPosition(rows, shifts, "2026-11-12", new Date("2026-11-12T02:00:00+07:00")).pos.id, "2026-11-11");
  assert.equal(currentPosition(rows, shifts, "2026-11-12", new Date("2026-11-12T05:30:00+07:00")).pos.id, "2026-11-12");
  // กะเมื่อวานยังไม่จบ แต่หัวหน้าไม่ได้จัดตำแหน่งไว้ → ใช้วันนี้
  assert.equal(currentPosition([pos("2026-11-12")], shifts, "2026-11-12", new Date("2026-11-12T02:00:00+07:00")).date, "2026-11-12");
});

test("วันถัดไปเรียงตามวันที่ ไม่รวมกะตอนนี้ / เวลาพักแสดง HH:MM", () => {
  const rows = [pos("2026-11-15"), pos("2026-11-12"), pos("2026-11-13"), pos("2026-11-11", "night")];
  assert.deepEqual(upcomingPositions(rows, "2026-11-12").map((r) => r.id), ["2026-11-13", "2026-11-15"]);
  assert.equal(breakHm("12:00:00"), "12:00");
  assert.equal(breakHm(null), null);
});
