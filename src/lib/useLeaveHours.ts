"use client";

// ลาเป็นชั่วโมง (เฉพาะหน่วยงานที่เปิดเมนู leave_hours เช่น หน้าร้าน) · ค่าตั้งค่าอ่านจากฐานข้อมูล ณ วันนี้
import { useEffect, useState } from "react";
import { useApp } from "@/components/AuthProvider";
import { sb } from "./supabase";

export type LeaveHours = { enabled: boolean; hoursPerDay: number; stepMinutes: number; types: string[] };

const DEFAULT: LeaveHours = { enabled: false, hoursPerDay: 8, stepMinutes: 60, types: ["sick", "personal", "vacation"] };
type Cfg = Omit<LeaveHours, "enabled">;
// อ่านครั้งเดียวต่อการเปิดหน้า (หลายแถวในรายการใช้ร่วมกัน)
let cache: Promise<Cfg> | null = null;
function loadCfg(): Promise<Cfg> {
  const get = (k: string) => sb().rpc("setting", { p_key: k }).then(({ data }) => data as unknown);
  cache ??= Promise.all([get("leave.hours_per_day"), get("leave.hour_step_minutes"), get("leave.hourly_types")]).then(([h, s, t]) => ({
    hoursPerDay: Number(h) > 0 ? Number(h) : DEFAULT.hoursPerDay,
    stepMinutes: Number(s) > 0 ? Number(s) : DEFAULT.stepMinutes,
    types: Array.isArray(t) ? (t as string[]) : DEFAULT.types,
  }));
  return cache;
}

export function useLeaveHours(): LeaveHours {
  const { modules, demo } = useApp();
  const enabled = modules.includes("leave_hours");
  const [cfg, setCfg] = useState<Cfg>(DEFAULT);
  useEffect(() => {
    if (!enabled || demo) return;
    let live = true;
    loadCfg().then((c) => live && setCfg(c));
    return () => {
      live = false;
    };
  }, [enabled, demo]);
  return { ...cfg, enabled };
}
