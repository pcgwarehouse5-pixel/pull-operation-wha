import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Thai_Looped, Noto_Sans_Myanmar } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { LocaleProvider } from "@/i18n";
import { NavProgress } from "@/components/NavProgress";

// ไทย: แบบมีหัว อ่านง่ายสำหรับทุกคน / พม่า: Noto Sans Myanmar (ฟอนต์ถูกเก็บไว้กับเว็บเอง ไม่ดึงจาก Google ตอนใช้งาน)
const thai = IBM_Plex_Sans_Thai_Looped({ subsets: ["thai", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-thai", display: "swap" });
const burmese = Noto_Sans_Myanmar({ subsets: ["myanmar"], weight: ["400", "600", "700"], variable: "--font-my", display: "swap" });

export const metadata: Metadata = {
  title: "WHA Workforce",
  description: "แอปกลางบริหารพนักงานคลังสินค้า WHA",
  applicationName: "WHA Workforce",
  // iPhone / iPad: เปิดจากไอคอนบนหน้าจอโฮมแล้วเต็มจอเหมือนแอป (ไอคอนใช้ src/app/apple-icon.png)
  appleWebApp: { capable: true, title: "WHA Workforce", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  // iPhone รุ่นเก่า (iOS 15–16) ยังอ่านแท็กชื่อเดิมนี้ เพื่อเปิดเต็มจอไม่มีแถบ Safari
  other: { "apple-mobile-web-app-capable": "yes" },
};

// ทุกหน้าต้องเช็กการล็อกอินก่อนแสดงผล จึงไม่ใช่หน้าที่ "แสดงได้ทันที" ตามการตรวจของ Next.js
export const instant = false;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1b2a5c",
};

// ติดตั้งแอปบนมือถือ: เก็บคำขอ "ติดตั้งแอป" ของ Chrome ไว้ตั้งแต่โหลดหน้า (ปุ่มติดตั้งในแอปใช้ต่อ)
// และลงทะเบียนตัวช่วย public/sw.js (เฉพาะเว็บจริง) · เขียนแบบ JavaScript รุ่นเก่า ให้มือถือเก่ารันได้
const PWA_BOOT = `(function(){
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); window.__whaInstall = e; window.dispatchEvent(new Event('wha-install-ready')); });
  window.addEventListener('appinstalled', function () { window.__whaInstall = null; window.__whaInstalled = true; window.dispatchEvent(new Event('wha-install-ready')); });
  ${process.env.NODE_ENV === "production" ? "if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {}); }); }" : ""}
})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`h-full antialiased ${thai.variable} ${burmese.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PWA_BOOT }} />
      </head>
      <body className="min-h-full">
        <NavProgress />
        <LocaleProvider>
          <AuthProvider>{children}</AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
