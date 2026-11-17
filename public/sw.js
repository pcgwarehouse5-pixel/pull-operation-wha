// ตัวช่วยของแอปที่ติดตั้งบนมือถือ (Service Worker)
// - ทำให้ Chrome บน Android (รวมรุ่นเก่า) ยอมให้ "ติดตั้งแอป"
// - ไม่มีเน็ต: แสดงหน้า "ไม่มีการเชื่อมต่อ" แทนหน้าจอว่าง
// - ไม่เก็บข้อมูลของพนักงานไว้ในเครื่อง (หน้าและข้อมูลโหลดใหม่จากเซิร์ฟเวอร์ทุกครั้ง)
const CACHE = "wha-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // เฉพาะการเปิดหน้า: ลองโหลดจากเน็ตก่อน ไม่ได้ค่อยแสดงหน้าออฟไลน์ · คำขออื่น (ข้อมูล รูป ไฟล์) ปล่อยตามปกติ
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
