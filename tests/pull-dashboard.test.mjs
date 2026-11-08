// ทดสอบตัวเลข Dashboard ผู้บริหาร และการจัดกลุ่มทักษะ (ข้อมูลสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import { networkTotals, trend, pct, skillGroup } from "../src/lib/pull.ts";

const R = (day, wh, pool, need, booked, extra = {}) => ({ work_day: day, wh_id: wh, wh_code: wh, wh_name: wh, pool_count: pool, on_leave: 0, need, complete: need !== null, short: need === null ? null : Math.max(0, need - booked), booked, pulled_in: 0, lent_out: 0, ...extra });

test("รวมทุกคลัง: คลังที่ยังคำนวณไม่ได้ทำให้ความต้องการรวมเป็น —", () => {
  const t = networkTotals([R("d", "WH5", 60, 64, 58, { on_leave: 2, pulled_in: 3 }), R("d", "WH32", 50, 48, 44)]);
  assert.deepEqual(t, { pool: 110, booked: 102, need: 112, short: 10, remaining: 8, leave: 2, pulled: 3, incomplete: 0 });
  const u = networkTotals([R("d", "WH5", 60, 64, 58), R("d", "WH32", 50, null, 0)]);
  assert.equal(u.need, null);
  assert.equal(u.short, null);
  assert.equal(u.incomplete, 1);
  assert.equal(networkTotals([R("d", "W", 5, 1, 9)]).remaining, 0, "จองเกินกำลังคน = คงเหลือ 0 ไม่ติดลบ");
});

test("แนวโน้มรายวัน และเปอร์เซ็นต์", () => {
  const t = trend([R("2026-11-02", "A", 100, 80, 75), R("2026-11-01", "A", 100, 90, 80), R("2026-11-01", "B", 60, null, 10)]);
  assert.deepEqual(t.map((x) => [x.day, x.need, x.booked, x.usage]), [["2026-11-01", null, 90, 56], ["2026-11-02", 80, 75, 75]]);
  assert.equal(pct(1, 3), 33);
  assert.equal(pct(5, 0), null);
  assert.equal(pct(null, 10), null);
});

test("ตำแหน่งหลักของทักษะ", () => {
  assert.equal(skillGroup("RT รับ(Domestics)"), "RT");
  assert.equal(skillGroup("เช็คจ่าย(Export)"), "Checker");
  assert.equal(skillGroup("Picker จ่าย"), "Picker");
  assert.equal(skillGroup("OP ลากรับ"), "OP");
  assert.equal(skillGroup("CT โหลด Domestics"), "CT");
  assert.equal(skillGroup("CT4F"), "CT");
  assert.equal(skillGroup("โหลดงาน"), "โหลดสินค้า");
  assert.equal(skillGroup("พ่อบ้าน"), "อื่นๆ");
});
