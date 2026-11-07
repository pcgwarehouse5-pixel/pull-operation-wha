import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Thai_Looped, Noto_Sans_Myanmar } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { LocaleProvider } from "@/i18n";

// ไทย: แบบมีหัว อ่านง่ายสำหรับทุกคน / พม่า: Noto Sans Myanmar (ฟอนต์ถูกเก็บไว้กับเว็บเอง ไม่ดึงจาก Google ตอนใช้งาน)
const thai = IBM_Plex_Sans_Thai_Looped({ subsets: ["thai", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-thai", display: "swap" });
const burmese = Noto_Sans_Myanmar({ subsets: ["myanmar"], weight: ["400", "600", "700"], variable: "--font-my", display: "swap" });

export const metadata: Metadata = {
  title: "WHA Workforce",
  description: "แอปกลางบริหารพนักงานคลังสินค้า WHA",
};

// ทุกหน้าต้องเช็กการล็อกอินก่อนแสดงผล จึงไม่ใช่หน้าที่ "แสดงได้ทันที" ตามการตรวจของ Next.js
export const instant = false;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1b2a5c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`h-full antialiased ${thai.variable} ${burmese.variable}`}>
      <body className="min-h-full">
        <LocaleProvider>
          <AuthProvider>{children}</AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
