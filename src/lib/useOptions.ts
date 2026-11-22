"use client";

// โหลดรายการตัวเลือกจากหน้า "ตั้งค่าตัวเลือก" ตามหมวดที่ต้องการ (จำไว้ 1 นาที เปลี่ยนหน้าแล้วไม่ต้องดึงซ้ำ)
import { useEffect, useState } from "react";
import { useApp } from "@/components/AuthProvider";
import { createOptionsCache } from "./options-cache";
import { sb } from "./supabase";
import type { DropdownOption } from "./types";

const byOrder = (a: DropdownOption, b: DropdownOption) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, "th");

const cache = createOptionsCache<DropdownOption>({
  sort: byOrder,
  fetcher: async (cats) => {
    const { data, error } = await sb().from("dropdown_options").select("*").in("category", cats);
    if (error) throw error;
    return (data ?? []) as DropdownOption[];
  },
});

/** เรียกหลังบันทึกในหน้าตั้งค่า เพื่อให้ทุกหน้าเห็นค่าใหม่ทันที */
export const invalidateOptions = () => cache.invalidate();

export function useOptions(categories: string[]) {
  const { demo } = useApp();
  const key = categories.join(",");
  const [options, setOptions] = useState<Record<string, DropdownOption[]>>(() => (demo ? null : cache.peek(key.split(","))) ?? {});

  useEffect(() => {
    let live = true;
    const cats = key.split(",");
    if (demo) {
      const rows = [...demo.PREVIEW_OPTIONS, ...demo.PREVIEW_EXTRA_OPTIONS];
      const group = Object.fromEntries(cats.map((c) => [c, rows.filter((o) => o.category === c).sort(byOrder)]));
      Promise.resolve().then(() => live && setOptions((prev) => (cats.every((c) => JSON.stringify(prev[c]) === JSON.stringify(group[c])) ? prev : group)));
    } else {
      cache.load(cats).then((next) => {
        if (!live) return;
        // รายการเดิมไม่เปลี่ยน: ไม่ต้องวาดหน้าใหม่
        setOptions((prev) => (cats.every((c) => prev[c] === next[c]) ? prev : next));
      });
    }
    return () => {
      live = false;
    };
  }, [key, demo]);

  return options;
}

// ชื่อที่แสดงของค่าที่เก็บไว้ (เช่น monthly_employee → พนักงานรายเดือน)
export function labelOf(options: DropdownOption[] | undefined, value: string | null | undefined): string {
  if (!value) return "-";
  return options?.find((o) => o.value === value)?.label ?? value;
}
