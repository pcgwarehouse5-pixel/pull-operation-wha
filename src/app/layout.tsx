import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "WHA Workforce",
  description: "แอปกลางบริหารพนักงานคลังสินค้า WHA",
};

// ทุกหน้าต้องเช็กการล็อกอินก่อนแสดงผล จึงไม่ใช่หน้าที่ "แสดงได้ทันที" ตามการตรวจของ Next.js
export const instant = false;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e3a8a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className="h-full antialiased">
      <body className="min-h-full">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
