// ทดสอบการหาพิกัดคลังจากค่า GPS หลายครั้ง (ปุ่ม "ใช้ตำแหน่งปัจจุบัน" ในหน้าคลัง)
import { test } from "node:test";
import assert from "node:assert/strict";
import { bestFix, fixIsGood } from "../src/lib/geo-fix.ts";

test("ไม่มีค่า → null", () => {
  assert.equal(bestFix([]), null);
  assert.equal(bestFix([{ lat: NaN, lng: 100, acc: 5 }]), null);
});

test("ค่าเดียว → ใช้ค่านั้น", () => {
  assert.deepEqual(bestFix([{ lat: 13.1, lng: 100.9, acc: 8 }]), { lat: 13.1, lng: 100.9, acc: 8, used: 1, total: 1 });
});

test("ตัดค่าที่คลาดเคลื่อนมาก (ตอนเพิ่งเปิด GPS) ทิ้ง", () => {
  const f = bestFix([
    { lat: 13.2, lng: 101.0, acc: 900 },
    { lat: 13.15, lng: 100.95, acc: 60 },
    { lat: 13.1, lng: 100.9, acc: 6 },
    { lat: 13.1, lng: 100.9, acc: 7 },
  ]);
  assert.equal(f.used, 2);
  assert.equal(f.total, 4);
  assert.equal(f.acc, 6);
  assert.ok(Math.abs(f.lat - 13.1) < 1e-9 && Math.abs(f.lng - 100.9) < 1e-9);
});

test("เฉลี่ยถ่วงน้ำหนัก: ค่าแม่นกว่ามีน้ำหนักมากกว่า", () => {
  const f = bestFix([
    { lat: 13.0, lng: 100.0, acc: 4 },
    { lat: 13.0001, lng: 100.0001, acc: 6 },
  ]);
  // น้ำหนัก 1/16 กับ 1/36 → ค่าเฉลี่ยใกล้ค่าแรกมากกว่า
  assert.ok(f.lat > 13.0 && f.lat < 13.00005);
  assert.equal(f.used, 2);
});

test("หยุดเองเมื่อได้ค่าแม่น ≤ 10 ม. อย่างน้อย 3 ครั้ง", () => {
  assert.equal(fixIsGood([{ lat: 1, lng: 1, acc: 9 }, { lat: 1, lng: 1, acc: 12 }, { lat: 1, lng: 1, acc: 8 }]), false);
  assert.equal(fixIsGood([{ lat: 1, lng: 1, acc: 9 }, { lat: 1, lng: 1, acc: 10 }, { lat: 1, lng: 1, acc: 8 }]), true);
});
