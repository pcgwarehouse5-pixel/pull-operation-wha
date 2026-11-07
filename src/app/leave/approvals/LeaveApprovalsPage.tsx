"use client";

// อนุมัติใบลา (หัวหน้างานขึ้นไป): รออนุมัติ / ประวัติ / ยื่นใบลาแทนพนักงาน
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PageHelper } from "@/components/Puinun";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Empty, Field, Loading, Modal, inputCls } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { LeaveForm } from "@/components/leave/LeaveForm";
import { LeaveItem } from "@/components/leave/LeaveItem";
import { RejectModal } from "@/components/attendance/RejectModal";
import { EMP_COLS, empName, type Emp } from "@/components/shifts/common";
import { errText, fetchAll, sb } from "@/lib/supabase";
import { useOptions, labelOf } from "@/lib/useOptions";
import { isGlobal } from "@/lib/types";
import { addDays, todayIso } from "@/lib/shifts";
import { type LeaveApproval, type LeaveBalance, type LeaveRequest } from "@/lib/attendance";

type Row = LeaveRequest & { profiles: { employee_code: string; first_name_th: string; last_name_th: string | null; nickname: string | null; position: string | null } };
type Msg = { tone: "success" | "error"; text: string };

export default function LeaveApprovalsPage() {
  const { profile: me, warehouses, myWarehouseIds, demo } = useApp();
  const opts = useOptions(["leave_type"]);
  const typeOpts = demo ? demo.PREVIEW_LEAVE_TYPES : opts.leave_type;
  const global = isGlobal(me.role);
  const visible = useMemo(() => warehouses.filter((w) => w.is_active && (global || myWarehouseIds.includes(w.id))), [warehouses, global, myWarehouseIds]);
  const [wh, setWh] = useState(global ? "" : ((visible.find((w) => w.id === me.warehouse_id) ?? visible[0])?.id ?? ""));
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [apps, setApps] = useState<LeaveApproval[]>([]);
  const [bal, setBal] = useState<Record<string, LeaveBalance[]>>({});
  const [reject, setReject] = useState<Row | null>(null);
  const [onBehalf, setOnBehalf] = useState<Emp | "pick" | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    if (demo) {
      const list = demo.previewLeaveQueue(me.id);
      setRows(tab === "pending" ? list.filter((r) => r.status === "pending") : []);
      return;
    }
    try {
      const sel = "*, profiles!inner(employee_code, first_name_th, last_name_th, nickname, position, warehouse_id)";
      const list = await fetchAll<Row>((f, t) => {
        let q = sb().from("leave_requests").select(sel);
        if (wh) q = q.eq("profiles.warehouse_id", wh);
        q = tab === "pending" ? q.in("status", ["pending", "cancel_requested"]).order("start_date") : q.in("status", ["approved", "rejected", "cancelled"]).gte("start_date", addDays(todayIso(), -90)).order("start_date", { ascending: false });
        return q.range(f, t);
      });
      setRows(list);
      if (list.length) {
        const a = await fetchAll<LeaveApproval>((f, t) => sb().from("leave_approvals").select("*").in("request_id", list.map((x) => x.id)).order("created_at").range(f, t));
        setApps(a);
      } else setApps([]);
    } catch (e) {
      setRows([]);
      setMsg({ tone: "error", text: errText(e) });
    }
  }, [demo, me.id, tab, wh]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปลี่ยนแท็บ/คลัง
    load();
  }, [load]);

  async function loadBalance(r: Row) {
    if (demo) return setBal((b) => ({ ...b, [r.id]: demo.PREVIEW_BALANCE }));
    const { data, error } = await sb().rpc("leave_balance", { p_year: Number(r.start_date.slice(0, 4)), p_user: r.user_id });
    if (error) return setMsg({ tone: "error", text: errText(error) });
    setBal((b) => ({ ...b, [r.id]: (data ?? []) as LeaveBalance[] }));
  }

  async function decide(r: Row, ok: boolean, note?: string) {
    const what = r.status === "cancel_requested" ? (ok ? "อนุมัติการยกเลิก" : "ไม่อนุมัติการยกเลิก") : ok ? "อนุมัติ" : "ไม่อนุมัติ";
    if (ok && !confirm(`${what}ใบลา${labelOf(typeOpts, r.leave_type)}ของ ${r.profiles.first_name_th} ${r.days} วัน?`)) return;
    if (demo) return setReject(null);
    setBusy(true);
    const { data, error } = await sb().rpc("decide_leave", { p_id: r.id, p_approve: ok, p_note: note ?? null });
    setBusy(false);
    if (error) return setMsg({ tone: "error", text: errText(error) });
    setReject(null);
    setMsg({ tone: "success", text: data === "pending" ? "อนุมัติขั้นนี้แล้ว รอผู้บริหารอนุมัติต่อ" : `${what}แล้ว` });
    load();
  }

  const canAct = (r: Row) => r.user_id !== me.id && !(r.status === "pending" && r.steps_done >= 1 && !global);

  return (
    <AppShell title="อนุมัติใบลา" minRole="supervisor" wide>
      <PageHelper pose="docs" title="อนุมัติใบลา">
        อนุมัติหรือตีกลับใบลา ใบที่ลายาวตามจำนวนวันที่ตั้งไว้ต้องให้ผู้บริหารอนุมัติต่อ
      </PageHelper>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(visible.length > 1 || global) && (
          <select className={`${inputCls} !w-auto`} value={wh} onChange={(e) => setWh(e.target.value)} aria-label="คลัง">
            {global && <option value="">ทุกคลัง</option>}
            {visible.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        )}
        <div className="flex rounded-xl bg-white p-1 ring-1 ring-line" role="tablist">
          {([["pending", "รออนุมัติ"], ["history", "ประวัติ 90 วัน"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-10 rounded-lg px-4 text-[15px] font-semibold ${tab === k ? "bg-brand text-white" : "text-ink"}`}>
              {l}
            </button>
          ))}
        </div>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setOnBehalf("pick")}>
          <Icon name="plus" size={18} /> ยื่นใบลาแทนพนักงาน
        </Button>
      </div>
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>{tab === "pending" ? "ไม่มีใบลารออนุมัติ" : "ไม่มีประวัติในช่วง 90 วัน"}</Empty>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {rows.map((r) => (
            <li key={r.id}>
              <LeaveItem
                r={r}
                typeLabel={labelOf(typeOpts, r.leave_type)}
                approvals={apps.filter((a) => a.request_id === r.id)}
                onError={(t) => setMsg({ tone: "error", text: t })}
                who={
                  <p className="font-bold text-brand">
                    {empName(r.profiles)} <span className="text-[13px] font-normal text-muted">· {r.profiles.employee_code} · {r.profiles.position ?? "-"}</span>
                  </p>
                }
                actions={
                  <>
                    {bal[r.id] ? (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {bal[r.id].map((b) => (
                          <Badge key={b.leave_type} tone={b.leave_type === r.leave_type ? "blue" : "slate"}>
                            {b.label} {b.quota === null ? `ใช้ ${Number(b.approved) + Number(b.pending)}` : `เหลือ ${Number(b.remaining)}/${Number(b.quota)}`}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <button type="button" className="mb-2 text-[14px] font-semibold text-brand" onClick={() => loadBalance(r)}>ดูวันลาคงเหลือ</button>
                    )}
                    {tab === "pending" &&
                      (canAct(r) ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" className="flex-1" disabled={busy} onClick={() => setReject(r)}>
                            {r.status === "cancel_requested" ? "ไม่ให้ยกเลิก" : "ไม่อนุมัติ"}
                          </Button>
                          <Button size="sm" className="flex-1" disabled={busy} onClick={() => decide(r, true)}>
                            {r.status === "cancel_requested" ? "อนุมัติการยกเลิก" : r.steps_required > 1 && r.steps_done === 0 && !global ? "อนุมัติ (ส่งต่อผู้บริหาร)" : "อนุมัติ"}
                          </Button>
                        </div>
                      ) : (
                        <p className="text-[14px] text-muted">{r.user_id === me.id ? "ใบลาของคุณเอง ต้องให้คนอื่นอนุมัติ" : "รอผู้บริหารอนุมัติ"}</p>
                      ))}
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}

      {reject && (
        <RejectModal
          title={reject.status === "cancel_requested" ? "ไม่อนุมัติการยกเลิก" : "ไม่อนุมัติใบลา"}
          busy={busy}
          onClose={() => setReject(null)}
          onOk={(n) => decide(reject, false, n)}
        />
      )}
      {onBehalf === "pick" && <PickEmployee wh={wh || visible[0]?.id || ""} onClose={() => setOnBehalf(null)} onPick={(e) => setOnBehalf(e)} />}
      {onBehalf && onBehalf !== "pick" && (
        <LeaveForm
          userId={onBehalf.id}
          who={empName(onBehalf)}
          onClose={() => setOnBehalf(null)}
          onDone={(text) => {
            setOnBehalf(null);
            setMsg({ tone: "success", text });
            load();
          }}
        />
      )}
    </AppShell>
  );
}

function PickEmployee({ wh, onClose, onPick }: { wh: string; onClose: () => void; onPick: (e: Emp) => void }) {
  const { profile: me, demo } = useApp();
  const [list, setList] = useState<Emp[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (demo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- โหมดดูดีไซน์
      setList(demo.previewRoster(demo.PREVIEW_WAREHOUSES[0].id));
      return;
    }
    fetchAll<Emp>((f, t) => sb().from("profiles").select(EMP_COLS).eq("warehouse_id", wh).eq("status", "active").order("employee_code").range(f, t)).then(setList, () => setList([]));
  }, [demo, wh]);
  const shown = (list ?? []).filter((e) => e.id !== me.id && (!q || `${e.employee_code} ${e.first_name_th} ${e.last_name_th ?? ""} ${e.nickname ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Modal title="เลือกพนักงาน" onClose={onClose}>
      <Field label="ค้นหา">
        <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ชื่อ / รหัสพนักงาน" autoFocus />
      </Field>
      {!list ? (
        <Loading />
      ) : (
        <ul className="mt-3 max-h-80 divide-y divide-line overflow-y-auto">
          {shown.slice(0, 100).map((e) => (
            <li key={e.id}>
              <button type="button" className="flex min-h-12 w-full items-center gap-2 px-1 text-left hover:bg-paper" onClick={() => onPick(e)}>
                <span className="min-w-0 flex-1 truncate font-semibold">{empName(e)}</span>
                <span className="text-[13px] text-muted">{e.employee_code} · {e.position ?? "-"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
