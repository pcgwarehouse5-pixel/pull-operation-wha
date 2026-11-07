// ตรวจคำแปล: ภาษาพม่าต้องมีครบทุกคีย์ และมีตัวแปร {..} ตรงกับภาษาไทย (กันแก้คำแปลแล้วหน้าจอเพี้ยน)
import { test } from "node:test";
import assert from "node:assert/strict";
import { th } from "../src/i18n/th.ts";
import { my } from "../src/i18n/my.ts";

const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("คำแปลพม่าครบทุกคีย์ ไม่ว่าง และตัวแปรตรงกับภาษาไทย", () => {
  assert.deepEqual(Object.keys(my).sort(), Object.keys(th).sort());
  for (const [k, v] of Object.entries(th)) {
    assert.ok(my[k].trim().length > 0, `คำแปลว่าง: ${k}`);
    assert.deepEqual(vars(my[k]), vars(v), `ตัวแปรไม่ตรงกัน: ${k}`);
  }
});

test("ข้อความพม่าใช้อักษรพม่าจริง (ยกเว้นคำเฉพาะ)", () => {
  const allowLatin = new Set(["app.name", "lang.th", "nav.ot", "pf.line", "common.dash", "common.timeAt"]);
  for (const [k, v] of Object.entries(my)) {
    if (allowLatin.has(k)) continue;
    assert.match(v, /[က-႟]/, `ไม่มีอักษรพม่า: ${k}`);
  }
});
