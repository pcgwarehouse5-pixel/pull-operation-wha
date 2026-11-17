import type { MetadataRoute } from "next";

// ติดตั้งแอปบนมือถือ (Android: "ติดตั้งแอป" / iPhone: "เพิ่มไปยังหน้าจอโฮม") ใช้โลโก้และสีของแอป
// แสดงเต็มจอเหมือนแอปทั่วไป ไม่มีแถบที่อยู่เว็บ · เปิดแนวตั้ง
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "WHA Workforce",
    short_name: "WHA Workforce",
    description: "แอปกลางบริหารพนักงานคลังสินค้า WHA",
    lang: "th",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f7fb",
    theme_color: "#1b2a5c",
    categories: ["business", "productivity"],
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
