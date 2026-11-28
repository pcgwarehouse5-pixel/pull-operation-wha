"use client";

// คลังนี้อยู่หน่วยงานที่เปิดเมนูเสริมนี้ไหม (เช่น shop_forms = แบบฟอร์มหน้าร้าน)
import { useApp } from "@/components/AuthProvider";
import type { UnitModule } from "./types";

export function useWhModule(wh: string | null | undefined, module: UnitModule): boolean {
  const { warehouses, units } = useApp();
  const unitId = warehouses.find((w) => w.id === wh)?.unit_id;
  return !!unitId && !!units.find((u) => u.id === unitId)?.modules.includes(module);
}
