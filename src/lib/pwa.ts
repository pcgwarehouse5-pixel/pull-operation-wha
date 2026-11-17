// ติดตั้งแอปบนมือถือ: ดูว่าเครื่อง/เบราว์เซอร์นี้ติดตั้งด้วยวิธีไหน และเก่าเกินไปไหม
// ทดสอบได้ด้วย tests/pwa-lib.test.mjs

export type Platform =
  | "installed" // เปิดจากไอคอนบนหน้าจอแล้ว
  | "inapp-line" // เปิดลิงก์ในแอป LINE (ติดตั้งไม่ได้ ต้องเปิดใน Chrome/Safari ก่อน)
  | "inapp-other" // Facebook / Messenger / Instagram / TikTok ฯลฯ
  | "ios-safari" // iPhone / iPad ใน Safari: ปุ่มแชร์ → เพิ่มไปยังหน้าจอโฮม
  | "ios-other" // iPhone ใน Chrome ฯลฯ
  | "android-samsung" // Samsung Internet: ติดตั้งมักขึ้น "ดาวน์โหลดล้มเหลว" → ให้ติดตั้งผ่าน Chrome
  | "android"
  | "desktop";

/** ขั้นต่ำที่แอปรองรับ (ตรงกับ browserslist ใน package.json) */
export const MIN_IOS: [number, number] = [15, 4];
export const MIN_CHROME = 99;

export function iosVersion(ua: string): [number, number] | null {
  const m = ua.match(/(?:iPhone|iPad|iPod)[^)]*? OS (\d+)_(\d+)/) ?? ua.match(/Version\/(\d+)\.(\d+).*Mobile.*Safari/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function chromeVersion(ua: string): number | null {
  const m = ua.match(/(?:Chrome|CriOS)\/(\d+)/);
  return m ? Number(m[1]) : null;
}

export function isIOS(ua: string, maxTouchPoints = 0): boolean {
  // iPadOS 13+ บอกตัวว่าเป็น Mac แต่มีจอสัมผัส
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

export function detectPlatform(ua: string, standalone: boolean, maxTouchPoints = 0): Platform {
  if (standalone) return "installed";
  if (/\bLine\//i.test(ua)) return "inapp-line";
  if (/FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|musical_ly|TikTok|Messenger/i.test(ua)) return "inapp-other";
  if (isIOS(ua, maxTouchPoints)) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) ? "ios-other" : "ios-safari";
  if (/Android/i.test(ua)) return /SamsungBrowser/i.test(ua) ? "android-samsung" : "android";
  return "desktop";
}

/** เครื่องเก่ากว่าที่แอปรองรับ (iOS ต่ำกว่า 15.4 / Chrome บน Android ต่ำกว่า 99) */
export function tooOld(ua: string, maxTouchPoints = 0): boolean {
  if (isIOS(ua, maxTouchPoints)) {
    const v = iosVersion(ua);
    return !!v && (v[0] < MIN_IOS[0] || (v[0] === MIN_IOS[0] && v[1] < MIN_IOS[1]));
  }
  if (/Android/i.test(ua)) {
    const c = chromeVersion(ua);
    return c !== null && c < MIN_CHROME;
  }
  return false;
}

/** ลิงก์เปิดหน้านี้ใน Chrome บน Android (ถ้าเครื่องไม่มี Chrome จะไปหน้า Chrome ใน Play Store) */
export function chromeIntentUrl(href: string): string {
  const u = new URL(href);
  const fallback = "https://play.google.com/store/apps/details?id=com.android.chrome";
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(":", "")};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}

/** ลิงก์ให้ LINE เปิดหน้านี้ในเบราว์เซอร์ของเครื่อง (LINE รองรับพารามิเตอร์ openExternalBrowser=1) */
export function lineExternalUrl(href: string): string {
  const u = new URL(href);
  u.searchParams.set("openExternalBrowser", "1");
  return u.toString();
}
