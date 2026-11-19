// ทดสอบการเลือกวิธีแก้ "หาตำแหน่งไม่ได้" ให้ตรงกับเครื่อง (หน้าลงเวลา)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { guideKind, problemFromCode, geoSteps, afterStep } from "../src/lib/geo-help.ts";

test("แยกชนิดเครื่องจาก platform", () => {
  assert.equal(guideKind("android", false), "android");
  assert.equal(guideKind("android-samsung", false), "android-samsung");
  assert.equal(guideKind("ios-safari", true), "ios-safari");
  assert.equal(guideKind("ios-other", true), "ios-chrome");
  assert.equal(guideKind("installed", true), "ios-app");
  assert.equal(guideKind("installed", false), "android-app");
  assert.equal(guideKind("inapp-line", true), "line");
  assert.equal(guideKind("inapp-other", false), "inapp");
  assert.equal(guideKind("desktop", false), "desktop");
});

test("รหัสข้อผิดพลาดของเบราว์เซอร์ → สาเหตุ", () => {
  assert.equal(problemFromCode(1), "denied");
  assert.equal(problemFromCode(2), "off");
  assert.equal(problemFromCode(3), "timeout");
  assert.equal(problemFromCode(0), "none");
  assert.equal(problemFromCode(undefined), "none");
});

test("ไม่อนุญาต: Android ไปที่สิทธิ์ของเว็บ, iPhone ไปที่บริการหาตำแหน่ง", () => {
  assert.deepEqual(geoSteps("android", "denied"), ["geo.and.d1", "geo.and.d2", "geo.and.d3"]);
  assert.deepEqual(geoSteps("ios-safari", "denied"), ["geo.ios.d1", "geo.ios.ls", "geo.ios.sw"]);
  assert.deepEqual(geoSteps("ios-chrome", "denied"), ["geo.ios.ls", "geo.ios.chrome"]);
  assert.deepEqual(geoSteps("ios-app", "denied"), ["geo.ios.ls", "geo.ios.sw"]);
});

test("GPS ปิด / หาไม่ทัน", () => {
  assert.deepEqual(geoSteps("android", "off"), ["geo.and.off"]);
  assert.deepEqual(geoSteps("ios-safari", "off"), ["geo.ios.ls"]);
  assert.deepEqual(geoSteps("android", "timeout"), ["geo.to1", "geo.to2"]);
});

test("LINE / Facebook: ไม่มีขั้นตอน ให้เปิดในเบราว์เซอร์", () => {
  assert.deepEqual(geoSteps("line", "denied"), []);
  assert.equal(afterStep("line", "denied"), "browser");
  assert.equal(afterStep("inapp", "off"), "browser");
});

test("ขั้นสุดท้าย: iPhone ต้องโหลดหน้าใหม่, แอปที่ติดตั้งต้องเปิดใหม่, Android ลองใหม่ได้เลย", () => {
  assert.equal(afterStep("ios-safari", "denied"), "reload");
  assert.equal(afterStep("ios-chrome", "denied"), "reload");
  assert.equal(afterStep("ios-app", "denied"), "reopen");
  assert.equal(afterStep("android-app", "denied"), "reopen");
  assert.equal(afterStep("android", "denied"), "retry");
  assert.equal(afterStep("ios-safari", "off"), "retry");
});

test("ทุกคีย์ข้อความที่ใช้มีทั้งภาษาไทยและพม่า", () => {
  const th = fs.readFileSync(new URL("../src/i18n/th.ts", import.meta.url), "utf8");
  const my = fs.readFileSync(new URL("../src/i18n/my.ts", import.meta.url), "utf8");
  const kinds = ["android", "android-samsung", "android-app", "ios-safari", "ios-chrome", "ios-app", "line", "inapp", "desktop"];
  const keys = new Set();
  for (const k of kinds) {
    keys.add(`geo.dev.${k}`);
    for (const p of ["denied", "off", "timeout", "none"]) geoSteps(k, p).forEach((s) => keys.add(s));
  }
  for (const k of keys) {
    assert.ok(th.includes(`"${k}":`), `th ขาด ${k}`);
    assert.ok(my.includes(`"${k}":`), `my ขาด ${k}`);
  }
});
