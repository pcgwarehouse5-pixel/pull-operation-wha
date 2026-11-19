// วิธีอนุญาต/เปิดตำแหน่งของแต่ละเครื่อง สำหรับหน้า "ลงเวลา"
// เว็บขอสิทธิ์ซ้ำเองไม่ได้ถ้าพนักงานเคยกด "ไม่อนุญาต" ต้องไปเปิดในการตั้งค่าของเบราว์เซอร์/มือถือ
// ฟังก์ชันนี้เลือกชุดขั้นตอนให้ตรงกับเครื่อง (ข้อความอยู่ใน i18n คีย์ geo.*) ทดสอบได้ด้วย tests/geo-help.test.mjs
import type { Platform } from "./pwa";

/** ปัญหาที่เจอตอนขอตำแหน่ง: ไม่อนุญาต / GPS ปิด / หาไม่ทัน / เครื่องไม่รองรับ */
export type GeoProblem = "denied" | "off" | "timeout" | "none";

export type GuideKind =
  | "android" // Chrome บน Android
  | "android-samsung" // Samsung Internet
  | "android-app" // ติดตั้งเป็นแอปบน Android แล้ว
  | "ios-safari"
  | "ios-chrome" // iPhone ใน Chrome / เบราว์เซอร์อื่น
  | "ios-app" // ติดตั้งบนหน้าจอโฮม iPhone แล้ว
  | "line" // เปิดลิงก์ในแอป LINE
  | "inapp" // Facebook / Messenger / TikTok ฯลฯ
  | "desktop";

/** ขั้นสุดท้ายหลังแก้การตั้งค่า: ลองใหม่ในหน้านี้ / โหลดหน้าใหม่ / ปิดแอปแล้วเปิดใหม่ */
export type GeoAfter = "retry" | "reload" | "reopen" | "browser";

export function guideKind(p: Platform, ios: boolean): GuideKind {
  switch (p) {
    case "installed":
      return ios ? "ios-app" : "android-app";
    case "inapp-line":
      return "line";
    case "inapp-other":
      return "inapp";
    case "ios-other":
      return "ios-chrome";
    default:
      return p;
  }
}

/** สาเหตุจากรหัสข้อผิดพลาดของเบราว์เซอร์ (1 = ไม่อนุญาต, 2 = หาตำแหน่งไม่ได้/GPS ปิด, 3 = หมดเวลา) */
export function problemFromCode(code: number | undefined): GeoProblem {
  return code === 1 ? "denied" : code === 3 ? "timeout" : code === 2 ? "off" : "none";
}

const ANDROID: GuideKind[] = ["android", "android-samsung", "android-app"];
const IOS: GuideKind[] = ["ios-safari", "ios-chrome", "ios-app"];

/** คีย์ข้อความทีละขั้น (ไม่รวมขั้นสุดท้าย ดู afterStep) */
export function geoSteps(kind: GuideKind, problem: GeoProblem): string[] {
  if (kind === "line" || kind === "inapp" || problem === "none") return [];
  if (problem === "timeout") return ["geo.to1", "geo.to2"];
  if (problem === "off") {
    if (ANDROID.includes(kind)) return ["geo.and.off"];
    if (IOS.includes(kind)) return ["geo.ios.ls"];
    return ["geo.desk.off"];
  }
  // denied
  switch (kind) {
    case "android":
      return ["geo.and.d1", "geo.and.d2", "geo.and.d3"];
    case "android-samsung":
      return ["geo.sam.d1", "geo.and.d2", "geo.sam.d3"];
    case "android-app":
      return ["geo.andApp.d1", "geo.andApp.d2", "geo.and.d3"];
    case "ios-safari":
      return ["geo.ios.d1", "geo.ios.ls", "geo.ios.sw"];
    case "ios-chrome":
      return ["geo.ios.ls", "geo.ios.chrome"];
    case "ios-app":
      return ["geo.ios.ls", "geo.ios.sw"];
    default:
      return ["geo.desk.d1"];
  }
}

export function afterStep(kind: GuideKind, problem: GeoProblem): GeoAfter {
  if (kind === "line" || kind === "inapp") return "browser";
  if (problem !== "denied") return "retry";
  if (kind === "ios-safari" || kind === "ios-chrome") return "reload"; // iPhone ต้องโหลดหน้าใหม่จึงถามสิทธิ์อีกครั้ง
  if (kind === "ios-app" || kind === "android-app") return "reopen";
  return "retry";
}
