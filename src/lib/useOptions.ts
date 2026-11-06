"use client";

// โหลดรายการตัวเลือกจากหน้า "ตั้งค่าตัวเลือก" ตามหมวดที่ต้องการ
import { useEffect, useState } from "react";
import { useApp } from "@/components/AuthProvider";
import { sb } from "./supabase";
import type { DropdownOption } from "./types";

export function useOptions(categories: string[]) {
  const { demo } = useApp();
  const key = categories.join(",");
  const [options, setOptions] = useState<Record<string, DropdownOption[]>>({});

  useEffect(() => {
    let live = true;
    const cats = key.split(",");
    const group = (rows: DropdownOption[]) =>
      Object.fromEntries(cats.map((c) => [c, rows.filter((o) => o.category === c).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, "th"))]));
    if (demo) {
      Promise.resolve().then(() => live && setOptions(group([...demo.PREVIEW_OPTIONS, ...demo.PREVIEW_EXTRA_OPTIONS])));
    } else {
      sb()
        .from("dropdown_options")
        .select("*")
        .in("category", cats)
        .then(({ data }) => live && setOptions(group((data ?? []) as DropdownOption[])));
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
