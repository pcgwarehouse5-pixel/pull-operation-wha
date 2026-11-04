"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Empty, Loading, PageIntro, inputCls } from "@/components/ui";
import { errText, sb } from "@/lib/supabase";
import { thaiDateTime } from "@/lib/format";
import type { AuditLog } from "@/lib/types";

const PAGE = 50;

const ACTION: Record<string, { label: string; tone: "slate" | "blue" | "green" | "amber" | "red" }> = {
  login: { label: "เข้าสู่ระบบ", tone: "slate" },
  insert: { label: "เพิ่ม", tone: "green" },
  update: { label: "แก้ไข", tone: "blue" },
  delete: { label: "ลบ", tone: "red" },
  password_change: { label: "เปลี่ยนรหัสผ่าน", tone: "slate" },
  password_reset: { label: "รีเซ็ตรหัสผ่าน", tone: "amber" },
  user_create: { label: "สร้างผู้ใช้", tone: "green" },
};

const TABLE: Record<string, string> = {
  profiles: "ผู้ใช้",
  warehouses: "คลัง",
  user_warehouses: "คลังที่ดูแล",
  dropdown_options: "ตัวเลือกตั้งค่า",
};

const FIELD: Record<string, string> = {
  role: "บทบาท",
  warehouse_id: "คลัง",
  position: "ตำแหน่ง",
  nickname: "ชื่อเล่น",
  phone: "เบอร์โทร",
  line_id: "LINE ID",
  first_name_th: "ชื่อ",
  last_name_th: "นามสกุล",
  must_change_password: "ต้องตั้งรหัสใหม่",
  status: "สถานะ",
  label: "ชื่อที่แสดง",
  is_active: "เปิดใช้งาน",
  name: "ชื่อ",
  code: "รหัส",
  checkin_radius_m: "รัศมี Check In",
  latitude: "ละติจูด",
  longitude: "ลองจิจูด",
};

const SKIP = new Set(["updated_at", "created_at", "id"]);

function changes(l: AuditLog): string {
  if (l.action !== "update" || !l.old_data || !l.new_data) return "";
  const keys = Object.keys(l.new_data).filter((k) => !SKIP.has(k) && JSON.stringify(l.old_data![k]) !== JSON.stringify(l.new_data![k]));
  return keys
    .slice(0, 4)
    .map((k) => `${FIELD[k] ?? k}: ${String(l.old_data![k] ?? "-")} → ${String(l.new_data![k] ?? "-")}`)
    .join(" · ");
}

function subject(l: AuditLog): string {
  const d = l.new_data ?? l.old_data;
  if (!d) return "";
  if (l.table_name === "profiles") return String(d.employee_code ?? "");
  if (l.table_name === "warehouses") return String(d.code ?? "");
  if (l.table_name === "dropdown_options") return `${d.category}: ${d.label}`;
  return "";
}

export default function AuditPage() {
  const { demo } = useApp();
  const [rows, setRows] = useState<AuditLog[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [action, setAction] = useState("");
  const [more, setMore] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(
    async (offset: number) => {
      if (demo) {
        setRows(demo.PREVIEW_AUDIT.filter((r) => !action || r.action === action));
        setNames(Object.fromEntries(demo.PREVIEW_USERS.map((u) => [u.id, `${u.employee_code} ${u.first_name_th}`])));
        return;
      }
      try {
        let q = sb().from("audit_logs").select("*").order("created_at", { ascending: false }).range(offset, offset + PAGE - 1);
        if (action) q = q.eq("action", action);
        const { data, error } = await q;
        if (error) throw error;
        const got = (data ?? []) as AuditLog[];
        setRows((r) => (offset === 0 ? got : [...(r ?? []), ...got]));
        setMore(got.length === PAGE);
        const ids = [...new Set(got.map((g) => g.actor_id).filter(Boolean))] as string[];
        if (ids.length) {
          const { data: ps } = await sb().from("profiles").select("id, employee_code, first_name_th").in("id", ids);
          setNames((n) => ({ ...n, ...Object.fromEntries((ps ?? []).map((p) => [p.id, `${p.employee_code} ${p.first_name_th}`])) }));
        }
      } catch (e) {
        setErr(errText(e));
      }
    },
    [action, demo],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- เริ่มโหลดใหม่จาก Supabase เมื่อเปลี่ยนตัวกรอง
    setRows(null);
    load(0);
  }, [load]);

  return (
    <AppShell title="ประวัติการใช้งาน" minRole="admin">
      <PageIntro title="ประวัติการใช้งาน">ระบบบันทึกเองทุกครั้ง แก้ไขหรือลบไม่ได้</PageIntro>
      <div className="mb-3 max-w-xs">
        <select className={inputCls} value={action} onChange={(e) => setAction(e.target.value)} aria-label="ประเภท">
          <option value="">ทุกประเภท</option>
          {Object.entries(ACTION).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>ยังไม่มีประวัติ</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((l) => {
            const a = ACTION[l.action] ?? { label: l.action, tone: "slate" as const };
            const c = changes(l);
            return (
              <li key={l.id}>
                <Card className="!p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={a.tone}>{a.label}</Badge>
                    {l.table_name && l.action !== "login" && <span className="text-[14px] text-muted">{TABLE[l.table_name] ?? l.table_name}</span>}
                    <span className="font-semibold">{subject(l)}</span>
                    <span className="ml-auto text-[13px] text-muted">{thaiDateTime(l.created_at)}</span>
                  </div>
                  <p className="mt-1 text-[14px] text-muted">โดย {l.actor_id ? (names[l.actor_id] ?? "ผู้ใช้") : "ระบบ"}</p>
                  {c && <p className="mt-1 break-words text-[14px]">{c}</p>}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {more && (
        <div className="mt-4 text-center">
          <Button variant="secondary" onClick={() => load(rows?.length ?? 0)}>โหลดเพิ่ม</Button>
        </div>
      )}
    </AppShell>
  );
}
