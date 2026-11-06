// ทดสอบตัวรวมชั่วโมง OT แยกตามอัตรา (หน้ารายงาน)
import { test } from "node:test";
import assert from "node:assert/strict";
import { otBuckets, ratesOf, rateLabel, fmtHours } from "../src/lib/ot.ts";

test("รวมชั่วโมงแยกตามอัตรา และเรียงจากน้อยไปมาก", () => {
  const rows = [
    { normal_hours: 0, normal_rate: null, ot_hours: 1.5, ot_rate: 1.5 },
    { normal_hours: 8, normal_rate: 1, ot_hours: 2.5, ot_rate: 3 },
    { normal_hours: 4, normal_rate: 2, ot_hours: 0, ot_rate: null },
    { normal_hours: 0, normal_rate: null, ot_hours: "2.0", ot_rate: "1.50" }, // ค่าจากฐานข้อมูลเป็นข้อความ
  ];
  assert.deepEqual([...otBuckets(rows).entries()], [[1, 8], [1.5, 3.5], [2, 4], [3, 2.5]]);
  assert.deepEqual(ratesOf(rows), [1, 1.5, 2, 3]);
  assert.equal(rateLabel(1.5), "OT 1.5");
  assert.equal(fmtHours(3), "3");
  assert.equal(fmtHours(2.5), "2.5");
});
