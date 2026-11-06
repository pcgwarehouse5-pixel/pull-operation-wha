"use client";

// OT (หัวหน้างานขึ้นไป): OT ที่คำนวณจากเวลาจริง เลือกหลายรายการแล้วอนุมัติ/ไม่อนุมัติ
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Empty, Loading, inputCls } from "@/components/ui";
import { RejectModal } from "@/components/attendance/RejectModal";
import { empName } from "@/components/shifts/common";
import { errText, sb } from "@/lib/supabase";
import { shortDay, thaiTime } from "@/lib/format";
import { isGlobal } from "@/lib/types";
import { addDays, todayIso } from "@/lib/shifts";
import { APPROVAL, DAY_TYPE, fmtHours, otBuckets, rateLabel, type TeamOtRow } from "@/lib/ot";

type Filter = "waiting" | "approved" | "rejected" | "all";
const key = (r: { user_id: string; work_date: string }) => `${r.user_id}|${r.work_date}`;

export default function OtPage() {
  const { profile: me, warehouses, myWarehouseIds, demo } = useApp();
  const visible = useMemo(() => warehouses.filter((w) => w.is_active && (isGlobal(me.role) || myWarehouseIds.includes(w.id))), [warehouses, me.role, myWarehouseIds]);
  const [wh, setWh] = useState((visible.find((w) => w.id === me.warehouse_id) ?? visible[0])?.id ?? "");
  const [from, setFrom] = useState(() => addDays(todayIso(), -13));
  const [to, setTo] = useState(todayIso);
  const [filter, setFilter] = useState<Filter>("waiting");
  const [rows, setRows] = useState<TeamOtRow[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [reject, setReject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setSel(new Set());
    if (demo) return setRows(demo.previewOt(from) as TeamOtRow[]);
    const { data, error } = await sb().rpc("warehouse_ot", { p_wh: wh, p_from: from, p_to: to });
    if (error) setMsg({ tone: "error", text: errText(error) });
    setRows((data ?? []) as TeamOtRow[]);
  }, [demo, wh, from, to]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปลี่ยนคลัง/ช่วงวันที่
    if (wh) load();
  }, [load, wh]);

  const waitingRows = (rows ?? []).filter((r) => r.approval === "pending" || r.approval === "changed");
  const shown = filter === "all" ? (rows ?? []) : filter === "waiting" ? waitingRows : (rows ?? []).filter((r) => r.approval === filter);
  const selectable = shown.filter((r) => r.user_id !== me.id);
  const approvedSum = otBuckets((rows ?? []).filter((r) => r.approval === "approved"));

  function toggle(r: TeamOtRow) {
    const k = key(r);
    const n = new Set(sel);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setSel(n);
  }

  async function decide(ok: boolean, note?: string) {
    const items = [...sel].map((k) => {
      const [user_id, work_date] = k.split("|");
      return { user_id, work_date };
    });
    if (!items.length) return;
    if (ok && !confirm(`อนุมัติ OT ${items.length} รายการ?`)) return;
    if (demo) {
      setReject(false);
      setSel(new Set());
      return;
    }
    setBusy(true);
    const { data, error } = await sb().rpc("decide_ot", { p_items: items, p_approve: ok, p_note: note ?? null });
    setBusy(false);
    setReject(false);
    if (error) return setMsg({ tone: "error", text: errText(error) });
    setMsg({ tone: "success", text: `${ok ? "อนุมัติ" : "ไม่อนุมัติ"} ${data} รายการแล้ว` });
    load();
  }

  return (
    <AppShell title="OT" minRole="supervisor" wide>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        {visible.length > 1 && (
          <select className={`${inputCls} !w-auto`} value={wh} onChange={(e) => setWh(e.target.value)} aria-label="คลัง">
            {visible.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        )}
        <label className="text-[14px]">
          ตั้งแต่
          <input type="date" className={`${inputCls} !w-auto`} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="text-[14px]">
          ถึง
          <input type="date" className={`${inputCls} !w-auto`} value={to} min={from} max={todayIso()} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(
          [
            ["waiting", `รออนุมัติ ${waitingRows.length}`],
            ["approved", "อนุมัติแล้ว"],
            ["rejected", "ไม่อนุมัติ"],
            ["all", "ทั้งหมด"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => {
              setFilter(k);
              setSel(new Set());
            }}
            className={`min-h-10 rounded-full px-3.5 text-[14px] font-semibold ${filter === k ? "bg-brand text-white" : "bg-white ring-1 ring-line"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {approvedSum.size > 0 && (
        <p className="mb-3 px-1 text-[14px] text-muted">
          อนุมัติแล้วในช่วงนี้: {[...approvedSum].map(([r, h]) => `${rateLabel(r)} = ${fmtHours(h)} ชม.`).join(" · ")}
        </p>
      )}
      {!rows ? (
        <Loading />
      ) : !shown.length ? (
        <Empty>{filter === "waiting" ? "ไม่มี OT รออนุมัติในช่วงนี้" : "ไม่มีรายการ"}</Empty>
      ) : (
        <>
          {selectable.length > 0 && filter !== "approved" && (
            <label className="mb-2 flex min-h-11 items-center gap-3 px-1 font-semibold">
              <input
                type="checkbox"
                className="h-5 w-5 accent-brand"
                checked={selectable.every((r) => sel.has(key(r)))}
                onChange={(e) => setSel(e.target.checked ? new Set(selectable.map(key)) : new Set())}
              />
              เลือกทั้งหมด ({selectable.length})
            </label>
          )}
          <ul className="grid gap-2 lg:grid-cols-2">
            {shown.map((r) => {
              const mine = r.user_id === me.id;
              const on = sel.has(key(r));
              return (
                <li key={key(r)}>
                  <Card className={`!p-3 ${on ? "ring-2 ring-brand" : ""}`}>
                    <label className="flex gap-3">
                      <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-brand" disabled={mine} checked={on} onChange={() => toggle(r)} aria-label={`เลือก ${empName(r)} ${r.work_date}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{empName(r)}</span>
                            <span className="block text-[13px] text-muted">{r.employee_code} · {r.position ?? "-"}</span>
                          </span>
                          <Badge tone={APPROVAL[r.approval].tone}>{APPROVAL[r.approval].label}</Badge>
                        </span>
                        <span className="mt-1 block text-[14px]">
                          {shortDay(r.work_date)} · {DAY_TYPE[r.day_type]} · กะ {r.shift_code ?? "-"} · เข้า {thaiTime(r.first_in)} ออก {thaiTime(r.last_out)}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          {Number(r.normal_hours) > 0 && <Badge tone="blue">{rateLabel(Number(r.normal_rate))}: {fmtHours(Number(r.normal_hours))} ชม.</Badge>}
                          {Number(r.ot_hours) > 0 && <Badge tone="blue">{rateLabel(Number(r.ot_rate))}: {fmtHours(Number(r.ot_hours))} ชม.</Badge>}
                        </span>
                        {(r.decided_by_name || r.note) && (
                          <span className="mt-1 block text-[13px] text-muted">
                            {r.decided_by_name && `โดย ${r.decided_by_name}`}
                            {r.note && ` · ${r.note}`}
                          </span>
                        )}
                        {mine && <span className="mt-1 block text-[13px] text-muted">OT ของคุณเอง ต้องให้คนอื่นอนุมัติ</span>}
                      </span>
                    </label>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="mt-4 px-1 text-[13px] text-muted">
        OT คำนวณจากเวลาเข้า-ออกจริงตามกฎในหน้าตั้งค่า (ไม่นับถ้าเกินเวลาเลิกกะไม่ถึงเกณฑ์ ปัดลงตามรอบที่ตั้งไว้) ถ้าเวลาถูกแก้ภายหลัง ระบบจะให้อนุมัติใหม่
      </p>

      {sel.size > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 px-3 lg:bottom-4 lg:left-64">
          <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-white shadow-2xl">
            <span className="flex-1 text-[15px]">เลือก {sel.size} รายการ</span>
            <Button size="sm" variant="ghost" className="!text-white" disabled={busy} onClick={() => setReject(true)}>ไม่อนุมัติ</Button>
            <Button size="sm" disabled={busy} onClick={() => decide(true)}>{busy ? "กำลังบันทึก..." : "อนุมัติ"}</Button>
          </div>
        </div>
      )}
      {sel.size > 0 && <div className="h-20" aria-hidden="true" />}
      {reject && <RejectModal title={`ไม่อนุมัติ OT ${sel.size} รายการ`} busy={busy} onClose={() => setReject(false)} onOk={(n) => decide(false, n)} />}
    </AppShell>
  );
}
