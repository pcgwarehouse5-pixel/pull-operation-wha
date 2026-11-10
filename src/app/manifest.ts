import type { MetadataRoute } from "next";

// ติดตั้งแอปบนหน้าจอมือถือ ("เพิ่มไปยังหน้าจอหลัก") ใช้โลโก้และสีของแอป
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WHA Workforce",
    short_name: "WHA Workforce",
    description: "แอปกลางบริหารพนักงานคลังสินค้า WHA",
    lang: "th",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f7fb",
    theme_color: "#1b2a5c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
