// ทดสอบตัวช่วยประชาสัมพันธ์ฝั่งหน้าเว็บ (ข้อมูลสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupAnnouncements, isShowing, urlHost, validMenuPath, validUrl } from "../src/lib/announcements.ts";

test("แบ่งกลุ่มตามวันที่: กำลังแสดง (รวมวันแรก/วันสุดท้าย) / รอแสดง / หมดเวลา", () => {
  const a = (id, starts_on, ends_on) => ({ id, starts_on, ends_on });
  const list = [a("now2", "2026-11-10", "2026-11-20"), a("first", "2026-11-15", "2026-11-15"), a("next", "2026-11-16", "2026-11-30"), a("old", "2026-11-01", "2026-11-14"), a("older", "2026-10-01", "2026-10-05")];
  const g = groupAnnouncements(list, "2026-11-15");
  assert.deepEqual(g.now.map((x) => x.id), ["first", "now2"], "ใกล้หมดเวลาก่อน");
  assert.deepEqual(g.upcoming.map((x) => x.id), ["next"]);
  assert.deepEqual(g.ended.map((x) => x.id), ["old", "older"], "หมดเวลาล่าสุดก่อน");
  assert.equal(isShowing(a("x", "2026-11-15", "2026-11-15"), "2026-11-15"), true);
  assert.equal(isShowing(a("x", "2026-11-16", "2026-11-20"), "2026-11-15"), false);
});

test("ลิงก์: เว็บต้องเป็น https · เมนูต้องเป็นหน้าในแอป", () => {
  assert.equal(validUrl("  https://example.com/a?b=1  "), "https://example.com/a?b=1");
  assert.equal(validUrl("http://example.com"), null);
  assert.equal(validUrl("javascript:alert(1)"), null);
  assert.equal(validUrl("https://exa mple.com"), null);
  assert.equal(validUrl("https://" + "a".repeat(500)), null);
  assert.equal(urlHost("https://www.example.com/path"), "www.example.com");
  assert.equal(validMenuPath("/my-position"), true);
  assert.equal(validMenuPath("https://evil.com"), false);
  assert.equal(validMenuPath("//evil"), false, "// = ลิงก์ออกนอกแอป ไม่ยอม");
  assert.equal(validMenuPath("/"), true);
});
