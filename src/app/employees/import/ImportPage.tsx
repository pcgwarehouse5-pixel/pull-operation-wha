"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Field, inputCls } from "@/components/ui";
import { api, fetchAll, sb } from "@/lib/supabase";
import { downloadCsv, parseCsv } from "@/lib/csv";
import { readXlsx } from "@/lib/xlsx-read";
import { TEMPLATE_COLUMNS, parseImport, summarize, type ImportRow } from "@/lib/employee-import";
import { useOptions } from "@/lib/useOptions";
import { isGlobal } from "@/lib/types";

type Result = { line: number; code: string; status: "created" | "updated" | "skipped" | "error"; message?: string };

const STATUS: Record<Result["status"], { label: string; tone: "green" | "blue" | "slate" | "red" }> = {
  created: { label: "เพิ่มแล้ว", tone: "green" },
  updated: { label: "อัปเดตแล้ว", tone: "blue" },
  skipped: { label: "ข้าม", tone: "slate" },
  error: { label: "ไม่สำเร็จ", tone: "red" },
};

export default function ImportPage() {
  const { profile: me, warehouses, myWarehouseIds, demo } = useApp();
  const opts = useOptions(["position", "employment_type"]);
  const manageable = (isGlobal(me.role) ? warehouses : warehouses.filter((w) => myWarehouseIds.includes(w.id))).filter((w) => w.is_active);
  const [wh, setWh] = useState(manageable.length === 1 ? manageable[0].id : "");
  const [update, setUpdate] = useState(false);
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<string[][] | null>(null);
  const [parsed, setParsed] = useState<ReturnType<typeof parseImport> | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function template() {
    downloadCsv("แม่แบบนำเข้าพนักงาน.csv", [TEMPLATE_COLUMNS.map((c) => c.header), TEMPLATE_COLUMNS.map((c) => c.example)]);
  }

  async function check(t: string[][], warehouseId: string, upd: boolean) {
    setErr("");
    setResults(null);
    if (!warehouseId) return setErr("กรุณาเลือกคลังก่อน");
    // รหัสที่มีอยู่แล้ว (เท่าที่ฉันเห็น) + คลังที่ฉันจัดการได้
    const existing = new Map<string, { warehouse_id: string | null; manageable: boolean }>();
    if (!demo) {
      const ps = await fetchAll<{ employee_code: string; warehouse_id: string | null }>((f, to) => sb().from("profiles").select("employee_code, warehouse_id").range(f, to));
      for (const p of ps) existing.set(p.employee_code.toLowerCase(), { warehouse_id: p.warehouse_id, manageable: isGlobal(me.role) || (!!p.warehouse_id && myWarehouseIds.includes(p.warehouse_id)) });
    }
    setParsed(
      parseImport(t, {
        warehouseId,
        positions: (opts.position ?? []).map((o) => o.value),
        employmentTypes: (opts.employment_type ?? []).map((o) => ({ value: o.value, label: o.label })),
        existing,
        updateExisting: upd,
      }),
    );
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setErr("");
    setParsed(null);
    setResults(null);
    setFileName(f.name);
    try {
      if (f.size > 5 * 1024 * 1024) throw new Error("ไฟล์ใหญ่เกิน 5 MB");
      const t = /\.xlsx$/i.test(f.name) ? await readXlsx(await f.arrayBuffer()) : /\.(csv|txt)$/i.test(f.name) ? parseCsv(await f.text()) : null;
      if (!t) throw new Error("รองรับเฉพาะไฟล์ .xlsx หรือ .csv (ไฟล์ .xls แบบเก่า ให้เปิดใน Excel แล้วบันทึกเป็น .xlsx ก่อน)");
      setTable(t);
      await check(t, wh, update);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function submit() {
    if (!parsed) return;
    const ready = parsed.rows.filter((r) => !r.errors.length && r.action !== "skip");
    setBusy(true);
    setErr("");
    try {
      if (demo) {
        setResults(ready.map((r) => ({ line: r.line, code: r.data.employee_code!, status: r.action === "update" ? "updated" : "created" })));
      } else {
        const res = await api<{ results: Result[] }>("/api/employees", "POST", {
          action: "import",
          warehouse_id: wh,
          update_existing: update,
          rows: ready.map((r) => ({ line: r.line, ...r.data })),
        });
        setResults(res.results);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sum = parsed ? summarize(parsed.rows) : null;
  const toImport = sum ? sum.create + sum.update : 0;

  return (
    <AppShell title="นำเข้าพนักงานจาก Excel" back="/employees" minRole="admin">
      <Card className="mb-4">
        <h2 className="mb-2 text-lg font-bold text-brand">1. ดาวน์โหลดแม่แบบ</h2>
        <p className="mb-3 text-[15px] text-muted">
          กรอกในแม่แบบ (เปิดด้วย Excel ได้) หรือใช้ไฟล์ที่มีหัวคอลัมน์ รหัสพนักงาน และ ชื่อ ก็ได้ ไฟล์ส่งออกจากแอปเดิมก็ใช้ได้ <b>ไม่ต้องใส่รหัสผ่าน</b> ทุกคนใช้รหัสเริ่มต้นและต้องตั้งใหม่ตอนเข้าครั้งแรก
        </p>
        <Button variant="secondary" onClick={template}>ดาวน์โหลดแม่แบบ (.csv)</Button>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-3 text-lg font-bold text-brand">2. เลือกคลังและไฟล์</h2>
        <div className="space-y-4">
          <Field label="นำเข้าเป็นพนักงานของคลัง">
            <select className={inputCls} value={wh} onChange={(e) => { setWh(e.target.value); if (table) check(table, e.target.value, update); }}>
              <option value="">เลือกคลัง</option>
              {manageable.map((w) => (
                <option key={w.id} value={w.id}>{w.code} {w.name}</option>
              ))}
            </select>
          </Field>
          <label className="flex min-h-11 items-start gap-2.5">
            <input type="checkbox" className="mt-0.5 h-5 w-5" checked={update} onChange={(e) => { setUpdate(e.target.checked); if (table) check(table, wh, e.target.checked); }} />
            <span>
              อัปเดตข้อมูลพนักงานที่มีรหัสอยู่แล้ว
              <span className="block text-[13px] text-muted">ไม่ติ๊ก = ข้ามคนที่มีอยู่แล้ว (ไม่แตะรหัสผ่าน บทบาท และคลังเสมอ)</span>
            </span>
          </label>
          <Field label="ไฟล์ (.xlsx หรือ .csv)">
            <input type="file" accept=".xlsx,.csv,.txt" className={`${inputCls} py-2.5`} onChange={(e) => onFile(e.target.files?.[0])} />
          </Field>
        </div>
      </Card>

      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      {parsed && !results && (
        <Card className="mb-4">
          <h2 className="mb-2 text-lg font-bold text-brand">3. ตรวจก่อนนำเข้า</h2>
          {fileName && <p className="mb-2 text-[14px] text-muted">ไฟล์: {fileName}</p>}
          {parsed.missingColumns.length > 0 ? (
            <Alert tone="error">ไม่พบคอลัมน์ที่จำเป็น: {parsed.missingColumns.join(", ")}</Alert>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge tone="green">เพิ่มใหม่ {sum!.create}</Badge>
                <Badge tone="blue">อัปเดต {sum!.update}</Badge>
                <Badge tone="slate">ข้าม (มีอยู่แล้ว) {sum!.skip}</Badge>
                <Badge tone="red">มีปัญหา {sum!.error}</Badge>
                <Badge tone="amber">มีข้อสังเกต {sum!.warning}</Badge>
              </div>
              {parsed.unknownHeaders.length > 0 && <p className="mb-3 text-[14px] text-muted">คอลัมน์ที่ไม่ได้ใช้: {parsed.unknownHeaders.join(", ")}</p>}
              <IssueList rows={parsed.rows} />
              <Button size="lg" className="mt-4 w-full" disabled={busy || toImport === 0} onClick={submit}>
                {busy ? "กำลังนำเข้า..." : toImport ? `นำเข้า ${toImport} คน (ข้ามแถวที่มีปัญหา)` : "ไม่มีรายการที่นำเข้าได้"}
              </Button>
            </>
          )}
        </Card>
      )}

      {results && (
        <Card className="mb-4">
          <h2 className="mb-2 text-lg font-bold text-brand">ผลการนำเข้า</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            {(Object.keys(STATUS) as Result["status"][]).map((s) => (
              <Badge key={s} tone={STATUS[s].tone}>{STATUS[s].label} {results.filter((r) => r.status === s).length}</Badge>
            ))}
          </div>
          <ul className="max-h-80 space-y-1 overflow-y-auto text-[14px]">
            {results.filter((r) => r.status === "error").map((r) => (
              <li key={r.line} className="text-bad">แถว {r.line} ({r.code}): {r.message}</li>
            ))}
          </ul>
          <Link href="/employees" className="mt-3 inline-flex min-h-12 items-center rounded-xl bg-brand px-5 font-semibold text-white">กลับไปทะเบียนพนักงาน</Link>
        </Card>
      )}
    </AppShell>
  );
}

function IssueList({ rows }: { rows: ImportRow[] }) {
  const bad = rows.filter((r) => r.errors.length || r.warnings.length);
  if (!bad.length) return <Alert tone="success">ข้อมูลครบถ้วน ไม่มีปัญหา</Alert>;
  return (
    <ul className="max-h-80 space-y-1.5 overflow-y-auto rounded-xl bg-paper p-3 text-[14px]">
      {bad.map((r) => (
        <li key={r.line}>
          <b>แถว {r.line}</b> {r.data.employee_code ?? ""} {r.data.first_name_th ?? ""}
          {r.errors.map((e) => <span key={e} className="block text-bad">✕ {e} (ไม่นำเข้า)</span>)}
          {r.warnings.map((w) => <span key={w} className="block text-[#7a5410]">! {w}</span>)}
        </li>
      ))}
    </ul>
  );
}
