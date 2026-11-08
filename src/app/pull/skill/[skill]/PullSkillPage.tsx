"use client";

// หน้าดึงกำลังคนทีละตำแหน่ง (ไฟล์ "Pull-Operation Operation & Dashboard" หน้า 2)
// เลือกพนักงานที่ "พร้อม" เข้าตำแหน่ง ดูต้องการ / จองแล้ว / ขาด แล้วกดบันทึกการจอง
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Button, Card, Loading, Modal, inputCls } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { BoardBar, ProgressBar, SkillIcon } from "@/components/pull/PullUI";
import { SaveBar } from "@/components/pull/SaveBar";
import { usePullSelection } from "@/components/pull/usePullSelection";
import { usePullBoard } from "@/components/pull/usePullBoard";
import { errText, sb } from "@/lib/supabase";
import { useOptions } from "@/lib/useOptions";
import { todayIso } from "@/lib/shifts";
import { shortDay } from "@/lib/format";
import { isGlobal } from "@/lib/types";
import { addDays } from "@/lib/pull-data";
import { SHIFT_LABEL, STATUS_LABEL, hhmm, type Booking, type PoolPerson, type PoolStatus } from "@/lib/pull";

type Conflict = { user_id: string; name?: string; reason: string };
const ORDER: Record<PoolStatus, number> = { ready: 0, booked_here: 1, busy: 2, unavailable: 3 };
const TONE: Record<PoolStatus, string> = {
  ready: "bg-[#e6f4ec] text-ok",
  booked_here: "bg-sky text-brand",
  busy: "bg-[#fdf3e1] text-[#b45309]",
  unavailable: "bg-[#fdecec] text-bad",
};
const AV = ["#7c3aed", "#2563eb", "#0f8b8d", "#e5484d", "#e8930c", "#1e8e5a", "#db2777"];
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join("");
const avColor = (id: string) => AV[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % AV.length];

export default function PullSkillPage({ skill }: { skill: string }) {
  const { profile, warehouses, myWarehouseIds, demo } = useApp();
  const today = todayIso();
  const whs = useMemo(() => {
    const act = warehouses.filter((w) => w.is_active).sort((a, b) => a.code.localeCompare(b.code, "th", { numeric: true }));
    return isGlobal(profile.role) ? act : act.filter((w) => myWarehouseIds.includes(w.id));
  }, [warehouses, myWarehouseIds, profile.role]);
  const sel = usePullSelection(whs, profile.warehouse_id);
  const { data, setData, err, reload, at } = usePullBoard(sel.wh, sel.date, sel.shift);
  const opts = useOptions(["pull_cancel_reason"]);
  const searchRef = useRef<HTMLInputElement>(null);

  const [pending, setPending] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [src, setSrc] = useState("");
  const [status, setStatus] = useState<PoolStatus | "">("");
  const [scope, setScope] = useState<"skill" | "all">("skill");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [cancelling, setCancelling] = useState<Booking | null>(null);

  const canEdit = sel.date >= today;
  const changeSel = (fn: () => void) => {
    fn();
    setPending([]);
    setMsg(null);
  };
  const bar = (
    <BoardBar
      title="ดึงกำลังคนทีละตำแหน่ง"
      sub={`${whs.find((w) => w.id === sel.wh)?.code ?? ""} · ${shortDay(sel.date)} · ${SHIFT_LABEL[sel.shift]}`}
      whs={whs} wh={sel.wh} setWh={(v) => changeSel(() => sel.setWh(v))} date={sel.date} setDate={(v) => changeSel(() => sel.setDate(v))}
      shift={sel.shift} setShift={(v) => changeSel(() => sel.setShift(v))} max={addDays(today, 60)} onRefresh={reload} at={at}
    />
  );
  if (!sel.wh) return <AppShell title={skill} back="/pull" minRole="supervisor" wide>{bar}<Alert tone="warning">คุณยังไม่มีคลังที่ดูแล</Alert></AppShell>;
  if (!data) return <AppShell title={skill} back="/pull" minRole="supervisor" wide>{bar}{err ? <Alert tone="error">{err}</Alert> : <Loading />}</AppShell>;

  const req = data.reqs.find((r) => r.skill_name === skill);
  const need = req?.complete ? req.required : null;
  const mine = data.bookings.filter((b) => b.skill_name === skill);
  const booked = mine.length;
  const short = need === null ? null : Math.max(0, need - booked);
  const byId = new Map(data.pool.map((p) => [p.user_id, p]));
  const selectable = (p: PoolPerson) => canEdit && p.status === "ready" && p.skills.includes(skill) && !!req;
  const sources = [...new Map(data.pool.map((p) => [p.warehouse_id, p.warehouse_code])).entries()];

  const list = data.pool
    .filter((p) => (scope === "all" || p.skills.includes(skill)) && (!src || p.warehouse_id === src) && (!status || p.status === status))
    .filter((p) => `${p.name} ${p.nickname ?? ""} ${p.employee_code}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.start_min ?? 9999) - (b.start_min ?? 9999) || a.employee_code.localeCompare(b.employee_code));
  const totalWithSkill = data.pool.filter((p) => p.skills.includes(skill)).length;

  const toggle = (p: PoolPerson) => {
    if (!selectable(p)) return;
    setPending((s) => (s.includes(p.user_id) ? s.filter((x) => x !== p.user_id) : [...s, p.user_id]));
  };

  async function save() {
    if (!pending.length) return;
    setBusy(true);
    setMsg(null);
    try {
      let res: { booked: number; conflicts: Conflict[] };
      if (demo) {
        const ids = new Set(pending);
        setData((d) =>
          d && {
            ...d,
            pool: d.pool.map((p) => (ids.has(p.user_id) ? { ...p, status: "booked_here" as const, reason: "จองเข้าคลังนี้แล้ว", booked_skill: skill, booked_to: sel.wh } : p)),
            bookings: [...d.bookings, ...pending.map((u) => ({ id: `demo-${u}`, work_date: sel.date, shift: sel.shift, user_id: u, from_warehouse_id: byId.get(u)?.warehouse_id ?? null, to_warehouse_id: sel.wh, skill_name: skill, status: "booked" as const, break_time: null, booked_at: new Date().toISOString() }))],
          },
        );
        res = { booked: pending.length, conflicts: [] };
      } else {
        const { data: r, error } = await sb().rpc("book_pull", { p_to_wh: sel.wh, p_date: sel.date, p_shift: sel.shift, p_items: pending.map((u) => ({ user_id: u, skill })) });
        if (error) throw error;
        res = r as { booked: number; conflicts: Conflict[] };
        reload();
      }
      setPending([]);
      if (res.conflicts.length) setConflicts(res.conflicts.map((c) => ({ ...c, name: c.name ?? byId.get(c.user_id)?.name })));
      if (res.booked) setMsg({ tone: "success", text: `จองแล้ว ${res.booked} คน · แจ้งพนักงานและหัวหน้าคลังต้นทางแล้ว${demo ? " (โหมดตัวอย่าง ไม่ได้บันทึกจริง)" : ""}` });
    } catch (e) {
      setMsg({ tone: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function cancelBooking(b: Booking, reason: string) {
    try {
      if (demo) {
        setData((d) => d && { ...d, bookings: d.bookings.filter((x) => x.id !== b.id), pool: d.pool.map((p) => (p.user_id === b.user_id ? { ...p, status: "ready" as const, reason: null, booked_skill: null, booked_to: null } : p)) });
      } else {
        const { error } = await sb().rpc("cancel_pull_booking", { p_id: b.id, p_reason: reason });
        if (error) throw error;
        reload();
      }
      setCancelling(null);
      setMsg({ tone: "success", text: `ยกเลิกการจอง ${byId.get(b.user_id)?.name ?? ""} แล้ว (แจ้งพนักงานแล้ว)${demo ? " · โหมดตัวอย่าง" : ""}` });
    } catch (e) {
      setMsg({ tone: "error", text: errText(e) });
      setCancelling(null);
    }
  }

  const chosen: { id: string; person?: PoolPerson; booking?: Booking }[] = [
    ...mine.map((b) => ({ id: b.user_id, person: byId.get(b.user_id), booking: b })),
    ...pending.map((u) => ({ id: u, person: byId.get(u) })),
  ];
  const slots = Math.max(need ?? 0, chosen.length);

  return (
    <AppShell title={skill} back="/pull" minRole="supervisor" wide>
      {bar}
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className="flex items-center gap-3">
            <SkillIcon name={skill} size={64} />
            <span className="text-2xl font-bold text-ink">{skill}</span>
          </span>
          <div className="flex gap-6 sm:border-l sm:border-line sm:pl-6">
            <Big label="ต้องการ" value={need} color="text-brand" />
            <Big label="จองแล้ว" value={booked} color="text-ok" />
            <Big label="ขาด" value={short} color="text-[#e5484d]" />
          </div>
          <div className="min-w-56 flex-1"><ProgressBar booked={booked} need={need} /></div>
        </div>
        {!req && <div className="mt-3"><Alert tone="warning">คลังนี้ไม่ได้เปิดทักษะ “{skill}” ให้ดึง <Link href="/pull" className="font-semibold underline">กลับหน้าสรุป</Link></Alert></div>}
        {req && need === null && (
          <p className="mt-3 text-[14px] font-semibold text-[#8a6500]">
            ยังไม่มีจำนวนที่ต้องการ ({req.missing}) · ยังดึงคนได้ <Link href="/pull/workload" className="underline">กรอกปริมาณงาน</Link>
          </p>
        )}
        {!canEdit && <p className="mt-3 text-[14px] font-semibold text-muted">วันที่ผ่านไปแล้ว ดูได้อย่างเดียว</p>}
      </Card>

      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-bold text-brand">
              <Icon name="users" size={24} /> รายชื่อพนักงาน <span className="font-semibold text-muted">(มีทักษะนี้ {totalWithSkill} คน)</span>
            </h2>
            <label className="relative w-full sm:w-64">
              <span className="sr-only">ค้นหาชื่อพนักงาน</span>
              <Icon name="search" size={20} className="pointer-events-none absolute top-3.5 left-3 text-muted" />
              <input ref={searchRef} className={`${inputCls} pl-10`} placeholder="ค้นหาชื่อ รหัส" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <select className={inputCls} value={src} onChange={(e) => setSrc(e.target.value)} aria-label="คลังต้นทาง">
              <option value="">ทุกคลัง</option>
              {sources.map(([id, code]) => (
                <option key={id} value={id}>{code}</option>
              ))}
            </select>
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as PoolStatus | "")} aria-label="สถานะ">
              <option value="">ทุกสถานะ</option>
              <option value="ready">พร้อม</option>
              <option value="booked_here">จองแล้ว</option>
              <option value="busy">ติดภารกิจ</option>
              <option value="unavailable">ไม่พร้อม</option>
            </select>
            <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value as "skill" | "all")} aria-label="ทักษะ">
              <option value="skill">มีทักษะนี้</option>
              <option value="all">ทุกคน</option>
            </select>
          </div>

          <ul className="mt-3 max-h-[38rem] space-y-1.5 overflow-y-auto pr-1">
            {list.map((p) => {
              const on = pending.includes(p.user_id);
              const can = selectable(p);
              const hasSkill = p.skills.includes(skill);
              return (
                <li key={p.user_id}>
                  <button
                    type="button"
                    onClick={() => toggle(p)}
                    disabled={!can}
                    aria-pressed={on}
                    className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left ring-1 transition ${on ? "bg-sky ring-brand" : "bg-white ring-line"} ${can ? "hover:ring-brand/50" : "cursor-default"} ${p.status === "unavailable" ? "opacity-70" : ""}`}
                  >
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ring-2 ${on ? "bg-brand text-white ring-brand" : p.status === "booked_here" ? "bg-[#c9d4ea] text-white ring-[#c9d4ea]" : can ? "bg-white ring-[#b8c2d8]" : "bg-paper ring-line"}`}>
                      {(on || p.status === "booked_here") && <Icon name="check" size={16} />}
                    </span>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white" style={{ background: avColor(p.user_id) }}>{initials(p.name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-semibold text-ink">{p.name}{p.nickname ? ` (${p.nickname})` : ""}</span>
                      <span className="block truncate text-[13px] text-muted">
                        {p.employee_code} · {p.warehouse_code} · {p.shift_code ? `${p.shift_code} ${hhmm(p.start_min)}` : "ไม่มีกะ"}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`rounded-lg px-2.5 py-1 text-[13px] font-bold ${TONE[p.status]}`}>{p.status === "booked_here" && p.booked_skill !== skill ? `จองเป็น ${p.booked_skill}` : STATUS_LABEL[p.status]}</span>
                      {p.status !== "ready" && p.status !== "booked_here" && <span className="max-w-32 truncate text-[12px] text-muted">{p.reason}</span>}
                      {!hasSkill && <span className="text-[12px] text-muted">ไม่มีทักษะนี้</span>}
                    </span>
                  </button>
                </li>
              );
            })}
            {list.length === 0 && <li className="py-8 text-center text-muted">ไม่พบพนักงานตามเงื่อนไข</li>}
          </ul>
          <p className="mt-2 text-[13px] text-muted">พร้อม = เข้ากะนี้ตามตารางกะ ไม่ได้ลา และยังไม่ถูกจอง · 1 คนจองได้ 1 คลังต่อวัน</p>
        </Card>

        <Card className="lg:sticky lg:top-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-bold text-brand">
              <Icon name="users" size={24} /> พนักงานที่เลือกแล้ว <span className="whitespace-nowrap text-brand">({chosen.length} / {need ?? "—"})</span>
            </h2>
            {pending.length > 0 && (
              <Button variant="ghost" size="sm" className="text-bad" onClick={() => setPending([])}>
                <Icon name="trash" size={18} /> ล้างที่เลือก
              </Button>
            )}
          </div>
          <ol className="mt-3 space-y-2">
            {Array.from({ length: slots }, (_, i) => {
              const c = chosen[i];
              if (!c)
                return (
                  <li key={`empty-${i}`}>
                    <button type="button" disabled={!canEdit} onClick={() => searchRef.current?.focus()} className="flex min-h-14 w-full items-center gap-3 rounded-xl border-2 border-dashed border-line px-3 text-left text-brand disabled:text-muted">
                      <span className="w-6 text-center font-bold text-muted">{i + 1}</span>
                      <span className="flex flex-1 items-center justify-center gap-2 font-semibold"><Icon name="plus" size={20} /> เพิ่มพนักงาน</span>
                    </button>
                  </li>
                );
              const p = c.person;
              return (
                <li key={c.id} className={`flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 ring-1 ${c.booking ? "bg-white ring-line" : "bg-sky ring-brand/40"}`}>
                  <span className="w-6 text-center font-bold text-muted">{i + 1}</span>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white" style={{ background: avColor(c.id) }}>{initials(p?.name ?? "?")}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{p?.name ?? "พนักงาน"}</span>
                    <span className="block text-[12px] text-muted">{p?.warehouse_code ?? ""}{c.booking ? " · ยืนยันแล้ว" : " · รอบันทึก"}</span>
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => (c.booking ? setCancelling(c.booking) : setPending((s) => s.filter((x) => x !== c.id)))}
                      className="flex h-10 w-10 items-center justify-center rounded-lg text-muted ring-1 ring-line hover:text-bad"
                      aria-label={c.booking ? `ยกเลิกการจอง ${p?.name ?? ""}` : `เอาออก ${p?.name ?? ""}`}
                    >
                      <Icon name="close" size={20} />
                    </button>
                  )}
                </li>
              );
            })}
            {slots === 0 && <li className="py-6 text-center text-muted">ยังไม่มีจำนวนที่ต้องการ เลือกพนักงานจากรายชื่อได้เลย</li>}
          </ol>
          {canEdit && (
            <div className="mt-4 hidden gap-2 lg:flex">
              <Button variant="secondary" className="flex-1" onClick={() => setPending([])} disabled={!pending.length || busy}>
                <Icon name="close" size={20} /> ยกเลิก
              </Button>
              <Button className="flex-[2]" onClick={save} disabled={!pending.length || busy}>
                <Icon name="check" size={20} /> {busy ? "กำลังบันทึก…" : `บันทึกการจอง (${chosen.length} / ${need ?? "—"})`}
              </Button>
            </div>
          )}
        </Card>
      </div>

      {pending.length > 0 && canEdit && (
        <SaveBar className="lg:hidden" text={`เลือกแล้ว ${pending.length} คน`} busy={busy} onCancel={() => setPending([])} onSave={save} saveLabel={`บันทึกการจอง (${chosen.length}/${need ?? "—"})`} />
      )}

      {conflicts.length > 0 && (
        <Modal title="บางคนจองไม่ได้" onClose={() => setConflicts([])}>
          <p className="text-muted">คนที่เหลือบันทึกเรียบร้อยแล้ว รายชื่อต่อไปนี้จองไม่ได้:</p>
          <ul className="mt-3 space-y-2">
            {conflicts.map((c) => (
              <li key={c.user_id} className="rounded-xl bg-[#fdecec] p-3">
                <b className="text-ink">{c.name ?? "พนักงาน"}</b> <span className="text-bad">· {c.reason}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end"><Button onClick={() => setConflicts([])}>รับทราบ</Button></div>
        </Modal>
      )}

      {cancelling && (
        <CancelDialog
          name={byId.get(cancelling.user_id)?.name ?? "พนักงาน"}
          reasons={(opts.pull_cancel_reason ?? []).filter((o) => o.is_active).map((o) => o.label)}
          onClose={() => setCancelling(null)}
          onConfirm={(r) => cancelBooking(cancelling, r)}
        />
      )}
    </AppShell>
  );
}

function Big({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div>
      <p className="text-[15px] font-semibold text-muted">{label}</p>
      <p className="leading-none"><span className={`text-5xl font-bold tabular-nums ${color}`}>{value ?? "—"}</span> <span className={`text-xl font-bold ${color}`}>คน</span></p>
    </div>
  );
}

function CancelDialog({ name, reasons, onClose, onConfirm }: { name: string; reasons: string[]; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`ยกเลิกการจอง · ${name}`} onClose={onClose}>
      <p className="text-muted">{reasons.length ? "เลือกเหตุผล" : "พิมพ์เหตุผล"} (ระบบแจ้งพนักงานว่ายกเลิกแล้ว)</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {reasons.map((r) => (
          <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className={`min-h-12 rounded-xl px-3 text-left font-semibold ring-1 ${reason === r ? "bg-sky text-brand ring-brand" : "bg-white text-ink ring-line"}`}>
            {r}
          </button>
        ))}
      </div>
      <input className={`${inputCls} mt-3`} placeholder={reasons.length ? "รายละเอียดเพิ่มเติม (ไม่บังคับ)" : "เหตุผลการยกเลิก"} maxLength={150} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>ไม่ยกเลิก</Button>
        <Button
          variant="danger"
          disabled={(reasons.length ? !reason : !note.trim()) || busy}
          onClick={async () => {
            setBusy(true);
            await onConfirm(!reason ? note.trim() : note.trim() ? `${reason}: ${note.trim()}` : reason);
            setBusy(false);
          }}
        >
          ยืนยันการยกเลิก
        </Button>
      </div>
    </Modal>
  );
}
