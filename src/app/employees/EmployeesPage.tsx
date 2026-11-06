"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Empty, Loading, PageIntro, inputCls } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { errText, fetchAll, sb } from "@/lib/supabase";
import { downloadCsv } from "@/lib/csv";
import { labelOf, useOptions } from "@/lib/useOptions";
import { fullName, isGlobal, isManager, type Employee } from "@/lib/types";

const PAGE = 100;

export default function EmployeesPage() {
  const { profile: me, warehouses, myWarehouseIds, demo } = useApp();
  const [rows, setRows] = useState<Employee[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [wh, setWh] = useState("");
  const [pos, setPos] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState<"active" | "resigned" | "">("active");
  const [limit, setLimit] = useState(PAGE);
  const opts = useOptions(["employment_type"]);
  const canEdit = isManager(me.role);
  const visibleWh = isGlobal(me.role) ? warehouses : warehouses.filter((w) => myWarehouseIds.includes(w.id));

  const load = useCallback(async () => {
    if (demo) {
      setRows(demo.previewEmployees());
      return;
    }
    try {
      setRows(await fetchAll<Employee>((from, to) => sb().from("profiles").select("*").order("employee_code").range(from, to)));
    } catch (e) {
      setErr(errText(e));
    }
  }, [demo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปิดหน้า
    load();
  }, [load]);

  const whCode = (id: string | null) => warehouses.find((w) => w.id === id)?.code ?? "-";
  const positions = useMemo(() => [...new Set((rows ?? []).map((r) => r.position).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "th")), [rows]);

  const shown = (rows ?? []).filter((r) => {
    const s = q.trim().toLowerCase();
    if (s && !`${r.employee_code} ${r.first_name_th} ${r.last_name_th ?? ""} ${r.nickname ?? ""}`.toLowerCase().includes(s)) return false;
    if (wh && r.warehouse_id !== wh) return false;
    if (pos && r.position !== pos) return false;
    if (type && r.employment_type !== type) return false;
    if (status && r.status !== status) return false;
    return true;
  });

  const activeShown = shown.filter((r) => r.status === "active");
  const byType = Object.entries(
    activeShown.reduce<Record<string, number>>((a, r) => ((a[r.employment_type ?? ""] = (a[r.employment_type ?? ""] ?? 0) + 1), a), {}),
  ).sort((a, b) => b[1] - a[1]);

  function exportCsv() {
    const header = ["รหัสพนักงาน", "คำนำหน้า", "ชื่อ", "นามสกุล", "ชื่อเล่น", "ตำแหน่ง", "ประเภทพนักงาน", "แผนก", "บริษัทรับเหมา", "รหัสเงินเดือน", "คลัง", "สถานะ", "วันที่ลาออก"];
    const body = shown.map((r) => [
      r.employee_code,
      r.title,
      r.first_name_th,
      r.last_name_th,
      r.nickname,
      r.position,
      labelOf(opts.employment_type, r.employment_type),
      r.department,
      r.subcontractor_company,
      r.salary_code,
      whCode(r.warehouse_id),
      r.status === "active" ? "ทำงานอยู่" : "ลาออก",
      r.resigned_date,
    ]);
    downloadCsv(`พนักงาน-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body]);
  }

  return (
    <AppShell title="ทะเบียนพนักงาน" wide minRole="supervisor">
      <PageIntro
        title="ทะเบียนพนักงาน"
        action={
          canEdit && (
            <div className="flex flex-wrap gap-2">
              <Link href="/employees/new" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-2">
                <Icon name="plus" size={20} /> เพิ่มพนักงาน
              </Link>
              <Link href="/employees/import" className="inline-flex min-h-12 items-center rounded-xl bg-white px-5 font-semibold text-brand ring-1 ring-inset ring-line hover:bg-[#f6f8fc]">
                นำเข้า Excel
              </Link>
            </div>
          )
        }
      >
        {canEdit ? "เพิ่ม แก้ไข ทักษะ และลาออก/คืนสภาพ" : "ดูรายชื่อพนักงานในคลังที่คุณดูแล"}
      </PageIntro>

      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}

      <Card className="mb-3">
        <label className="relative block">
          <span className="sr-only">ค้นหา</span>
          <Icon name="search" size={20} className="pointer-events-none absolute top-3.5 left-3 text-muted" />
          <input className={`${inputCls} pl-10`} placeholder="ค้นหารหัส ชื่อ หรือชื่อเล่น" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <select className={inputCls} value={wh} onChange={(e) => setWh(e.target.value)} aria-label="คลัง">
            <option value="">ทุกคลัง</option>
            {visibleWh.map((w) => (
              <option key={w.id} value={w.id}>{w.code}</option>
            ))}
          </select>
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="สถานะ">
            <option value="active">ทำงานอยู่</option>
            <option value="resigned">ลาออก</option>
            <option value="">ทุกสถานะ</option>
          </select>
          <select className={inputCls} value={pos} onChange={(e) => setPos(e.target.value)} aria-label="ตำแหน่ง">
            <option value="">ทุกตำแหน่ง</option>
            {positions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)} aria-label="ประเภทพนักงาน">
            <option value="">ทุกประเภท</option>
            {(opts.employment_type ?? []).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </Card>

      {!rows ? (
        <Loading />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-xl bg-brand px-3 py-1.5 text-[15px] font-semibold text-white">ทำงานอยู่ {activeShown.length.toLocaleString("th-TH")} คน</span>
            {byType.map(([t, n]) => (
              <span key={t} className="rounded-xl bg-white px-3 py-1.5 text-[14px] ring-1 ring-line">
                {t ? labelOf(opts.employment_type, t) : "ไม่ระบุประเภท"} {n}
              </span>
            ))}
            {canEdit && shown.length > 0 && (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={exportCsv}>ส่งออก CSV ({shown.length})</Button>
            )}
          </div>

          {shown.length === 0 ? (
            <Empty>ไม่พบพนักงานตามเงื่อนไข</Empty>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2">
              {shown.slice(0, limit).map((r) => (
                <li key={r.id}>
                  <Link href={`/employees/${r.id}`} className="flex items-center gap-3 rounded-2xl bg-white p-3.5 ring-1 ring-line hover:ring-brand/40">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#eaf0fb] text-[15px] font-bold text-brand" aria-hidden="true">
                      {r.first_name_th.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {fullName(r)} {r.nickname && <span className="font-normal text-muted">({r.nickname})</span>}
                      </span>
                      <span className="block truncate text-[14px] text-muted">
                        {r.employee_code} · {r.position ?? "ไม่ระบุตำแหน่ง"} · {labelOf(opts.employment_type, r.employment_type)}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <Badge tone="blue">{whCode(r.warehouse_id)}</Badge>
                      {r.status !== "active" && <Badge tone="red">ลาออก</Badge>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {shown.length > limit && (
            <div className="mt-4 text-center">
              <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>แสดงเพิ่ม ({(shown.length - limit).toLocaleString("th-TH")} คน)</Button>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
