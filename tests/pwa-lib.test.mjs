// ทดสอบการแยกประเภทเครื่องสำหรับปุ่ม "ติดตั้งแอป" (UA ตัวอย่างของมือถือจริงหลายรุ่น)
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPlatform, iosVersion, chromeVersion, tooOld, lineExternalUrl } from "../src/lib/pwa.ts";

const UA = {
  iphone15Safari: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
  iphone12Safari: "Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
  iphone17Chrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1",
  iphoneLine: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/13.17.0",
  ipadOS: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  androidNew: "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  android7: "Mozilla/5.0 (Linux; Android 7.0; SM-J701F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.6045.163 Mobile Safari/537.36",
  android5: "Mozilla/5.0 (Linux; Android 5.1.1; SM-J200G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.74 Mobile Safari/537.36",
  androidFacebook: "Mozilla/5.0 (Linux; Android 12; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.33.116;]",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

test("แยกประเภทเครื่อง: iPhone Safari / iPhone Chrome / LINE / Facebook / Android / iPad / คอม / ติดตั้งแล้ว", () => {
  assert.equal(detectPlatform(UA.iphone15Safari, false), "ios-safari");
  assert.equal(detectPlatform(UA.iphone17Chrome, false), "ios-other");
  assert.equal(detectPlatform(UA.iphoneLine, false), "inapp-line");
  assert.equal(detectPlatform(UA.androidFacebook, false), "inapp-other");
  assert.equal(detectPlatform(UA.androidNew, false), "android");
  assert.equal(detectPlatform(UA.ipadOS, false, 5), "ios-safari", "iPad บอกตัวเป็น Mac แต่มีจอสัมผัส");
  assert.equal(detectPlatform(UA.ipadOS, false, 0), "desktop", "Mac จริง");
  assert.equal(detectPlatform(UA.windows, false), "desktop");
  assert.equal(detectPlatform(UA.androidNew, true), "installed");
});

test("รุ่นเก่าเกินไป: iOS ต่ำกว่า 15.4 / Chrome บน Android ต่ำกว่า 99", () => {
  assert.deepEqual(iosVersion(UA.iphone15Safari), [15, 8]);
  assert.equal(chromeVersion(UA.android7), 119);
  assert.equal(tooOld(UA.iphone15Safari), false, "iPhone 6s/7 อัปเดตได้ถึง iOS 15.8");
  assert.equal(tooOld(UA.iphone12Safari), true, "iPhone 6 / 5s ค้างที่ iOS 12");
  assert.equal(tooOld(UA.android7), false, "Android 7 ใช้ Chrome 119 ได้");
  assert.equal(tooOld(UA.android5), true, "Android 5 ค้างที่ Chrome 95");
  assert.equal(tooOld(UA.windows), false);
});

test("ลิงก์ให้ LINE เปิดในเบราว์เซอร์", () => {
  assert.equal(lineExternalUrl("https://pull-operation-wha.vercel.app/login"), "https://pull-operation-wha.vercel.app/login?openExternalBrowser=1");
  assert.equal(lineExternalUrl("https://x.app/?a=1"), "https://x.app/?a=1&openExternalBrowser=1");
});
