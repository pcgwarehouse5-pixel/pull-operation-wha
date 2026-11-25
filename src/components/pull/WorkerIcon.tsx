"use client";

// ไอคอนพนักงานคลัง (รูปการ์ตูน) · รูปชุดเดียวกับป้ายชื่อบนแผนที่ 3D (src/lib/worker-icon.ts)
import { useId } from "react";
import { workerIconSvg } from "@/lib/worker-icon";

export function WorkerIcon({ color, seed = "", size = 64, title }: { color: string; seed?: string; size?: number; title?: string }) {
  const id = useId().replace(/[^a-z0-9]/gi, "");
  return (
    <span
      className="block"
      style={{ width: size, height: size }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      // SVG สร้างจากแม่แบบในโค้ดเท่านั้น (สีผ่านการตรวจรูปแบบ #hex) ไม่มีข้อความจากผู้ใช้
      dangerouslySetInnerHTML={{ __html: workerIconSvg(color, seed, `w${id}`, size) }}
    />
  );
}
