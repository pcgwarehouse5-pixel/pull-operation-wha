"use client";

// คนที่เหลือหลังทุกคลังจองแล้ว (ยังพร้อม ไม่ถูกจอง) + หมายเหตุว่าจะให้ไปทำอะไร
// หัวหน้าคลังของพนักงานคนนั้นใส่/แก้หมายเหตุได้ · หัวหน้างานขึ้นไปทุกคลังเห็น
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AuthProvider";
import { Alert, Button, Card, Modal, inputCls } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { WorkerIcon } from "@/components/pull/WorkerIcon";
import { errText } from "@/lib/supabase";
import { isGlobal, ROLE_RANK } from "@/lib/types";
import { loadLeftoverNotes, saveLeftoverNotes, type LeftoverNote } from "@/lib/pull-data";
import { SHIFT_LABEL, hhmm, skillStyle, type PoolPerson, type PullShift } from "@/lib/pull";
import { shortDay } from "@/lib/format";

const MAX = 200;
const posOf = (p: PoolPerson) => p.emp_position?.trim() || "ไม่ระบุตำแหน่ง";

export function LeftoverStaff({ pool, date, shift, canEditDate }: { pool: PoolPerson[]; date: string; shift: PullShift; canEditDate: boolean }) {
  const { profile, myWarehouseIds, demo } = useApp();
  const [notes, setNotes] = useState<Map<string, LeftoverNote>>(new Map());
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [wh, setWh] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<string[] | null>(null);

  // หน้าแม่ใส่ key ตามวัน/กะ → เปลี่ยนวัน/กะแล้วเริ่มใหม่ทั้งหมด (ที่เลือกไว้ ข้อความแจ้ง)
  useEffect(() => {
    if (demo) return;
    let live = true;
    loadLeftoverNotes(date, shift)
      .then((m) => live && (setNotes(m), setErr("")))
      .catch((e) => live && setErr(errText(e)));
    return () => {
      live = false;
    };
  }, [demo, date, shift]);

  const left = useMemo(
    () =>
      pool
        .filter((p) => p.status === "ready")
        .sort((a, b) => a.warehouse_code.localeCompare(b.warehouse_code, "th", { numeric: true }) || posOf(a).localeCompare(posOf(b), "th") || (a.start_min ?? 9999) - (b.start_min ?? 9999) || a.employee_code.localeCompare(b.employee_code)),
    [pool],
  );
  const whs = [...new Map(left.map((p) => [p.warehouse_id, p.warehouse_code])).entries()];
  const shown = left.filter((p) => !wh || p.warehouse_id === wh);
  const canNote = (p: PoolPerson) => canEditDate && (isGlobal(profile.role) || (ROLE_RANK[profile.role] >= ROLE_RANK.supervisor && myWarehouseIds.includes(p.warehouse_id)));
  const mineShown = shown.filter(canNote);
  const byId = new Map(left.map((p) => [p.user_id, p]));
  const toggle = (id: string) => setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allOn = mineShown.length > 0 && mineShown.every((p) => picked.includes(p.user_id));

  async function save(users: string[], note: string) {
    const text = note.trim();
    if (demo) {
      setNotes((m) => {
        const n = new Map(m);
        for (const u of users) {
          if (text) n.set(u, { user_id: u, note: text, updated_at: new Date().toISOString() });
          else n.delete(u);
        }
        return n;
      });
    } else {
      await saveLeftoverNotes(date, shift, users, text);
      setNotes(await loadLeftoverNotes(date, shift));
    }
    setEditing(null);
    setPicked([]);
    setMsg(`${text ? "บันทึกหมายเหตุ" : "ลบหมายเหตุ"} ${users.length} คนแล้ว · ทุกคลังเห็น${demo ? " (โหมดตัวอย่าง ไม่ได้บันทึกจริง)" : ""}`);
  }

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-brand"><Icon name="users" size={24} /> กำลังคนที่เหลือ หลังทุกคลังจองแล้ว</h2>
          <p className="text-[14px] text-muted">
            {shortDay(date)} {SHIFT_LABEL[shift]} · คนที่เข้ากะนี้ ไม่ได้ลา และยังไม่ถูกจองเข้าคลังไหน · หัวหน้าคลังใส่หมายเหตุว่าจะให้ไปทำอะไร ทุกคลังเห็น
          </p>
        </div>
        <span className="rounded-xl bg-[#fdf3e1] px-3 py-1.5 text-lg font-bold text-[#b45309]">เหลือ {left.length} คน</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="เลือกคลัง">
        {[["", "ทุกคลัง", left.length] as const, ...whs.map(([id, code]) => [id, `คลัง ${code}`, left.filter((p) => p.warehouse_id === id).length] as const)].map(([id, label, n]) => (
          <button key={id || "all"} type="button" aria-pressed={wh === id} onClick={() => { setWh(id); setPicked([]); }}
            className={`min-h-11 rounded-xl px-4 font-semibold ring-1 ${wh === id ? "bg-brand text-white ring-brand" : "bg-white text-ink ring-line"}`}>
            {label} <span className="tabular-nums opacity-80">({n})</span>
          </button>
        ))}
      </div>

      {err && <div className="mt-3"><Alert tone="error">{err}</Alert></div>}
      {msg && <div className="mt-3"><Alert tone="success">{msg}</Alert></div>}

      {mineShown.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-paper p-2.5">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 px-1 font-semibold text-ink">
            <input type="checkbox" className="h-5 w-5 accent-brand" checked={allOn}
              onChange={() => setPicked(allOn ? [] : mineShown.map((p) => p.user_id))} />
            เลือกทั้งหมดที่ใส่ได้ ({mineShown.length})
          </label>
          <span className="flex-1" />
          <Button size="sm" disabled={!picked.length} onClick={() => setEditing(picked)}>
            <Icon name="clipboard" size={18} /> ใส่หมายเหตุ {picked.length ? `${picked.length} คน` : ""}
          </Button>
        </div>
      )}

      <ul className="mt-3 divide-y divide-line">
        {shown.map((p) => {
          const n = notes.get(p.user_id);
          const can = canNote(p);
          return (
            <li key={p.user_id} className="flex items-start gap-3 py-2.5">
              {can ? (
                <input type="checkbox" className="mt-3 h-5 w-5 shrink-0 accent-brand" checked={picked.includes(p.user_id)} onChange={() => toggle(p.user_id)} aria-label={`เลือก ${p.name}`} />
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <span className="mt-0.5 shrink-0"><WorkerIcon size={40} color={skillStyle(posOf(p)).color} seed={p.user_id} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold text-ink">{p.name}{p.nickname ? ` (${p.nickname})` : ""}</span>
                <span className="block truncate text-[13px] text-muted">
                  {p.employee_code} · คลัง {p.warehouse_code} · {posOf(p)} · {p.shift_code} {hhmm(p.start_min)}
                </span>
                {n ? (
                  <span className="mt-1 block rounded-lg bg-[#fff6d6] px-2.5 py-1.5 text-[14px] font-semibold break-words text-[#6b4e00]">📝 {n.note}</span>
                ) : (
                  <span className="mt-0.5 block text-[13px] text-muted">ยังไม่มีหมายเหตุ</span>
                )}
              </span>
              {can && (
                <button type="button" onClick={() => setEditing([p.user_id])} aria-label={`แก้หมายเหตุ ${p.name}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-brand ring-1 ring-line hover:bg-brand/6">
                  <Icon name="clipboard" size={20} />
                </button>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="py-8 text-center text-muted">ไม่มีคนเหลือ ทุกคนที่พร้อมถูกจองแล้ว</li>}
      </ul>
      {!canEditDate && <p className="mt-2 text-[13px] text-muted">วันที่ผ่านไปแล้ว ดูหมายเหตุได้อย่างเดียว</p>}

      {editing && (
        <NoteDialog
          names={editing.map((id) => byId.get(id)?.name ?? "พนักงาน")}
          initial={editing.length === 1 ? (notes.get(editing[0])?.note ?? "") : ""}
          hasNote={editing.some((id) => notes.has(id))}
          onClose={() => setEditing(null)}
          onSave={(note) => save(editing, note)}
        />
      )}
    </Card>
  );
}

function NoteDialog({ names, initial, hasNote, onClose, onSave }: { names: string[]; initial: string; hasNote: boolean; onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (note: string) => {
    setBusy(true);
    setErr("");
    try {
      await onSave(note);
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };
  return (
    <Modal title={names.length === 1 ? `หมายเหตุ · ${names[0]}` : `หมายเหตุ ${names.length} คน`} onClose={onClose}>
      {names.length > 1 && <p className="mb-2 text-[14px] text-muted">{names.slice(0, 6).join(", ")}{names.length > 6 ? ` และอีก ${names.length - 6} คน` : ""} · ใช้ข้อความเดียวกันทุกคน</p>}
      <label htmlFor="leftover-note" className="font-semibold text-ink">จะให้ไปทำอะไร</label>
      <textarea id="leftover-note" className={`${inputCls} mt-1 min-h-28`} maxLength={MAX} value={text} autoFocus
        placeholder="เช่น ช่วยเคลียร์พื้นที่ Zone B / ไปช่วยคลัง 32 นับสต็อก / อบรม 5ส" onChange={(e) => setText(e.target.value)} />
      <p className="mt-1 text-right text-[13px] text-muted">{text.length}/{MAX}</p>
      {err && <div className="mt-2"><Alert tone="error">{err}</Alert></div>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {hasNote && <Button variant="ghost" className="text-bad" disabled={busy} onClick={() => run("")}><Icon name="trash" size={18} /> ลบหมายเหตุ</Button>}
        <Button variant="secondary" disabled={busy} onClick={onClose}>ยกเลิก</Button>
        <Button disabled={busy || !text.trim()} onClick={() => run(text)}><Icon name="check" size={18} /> {busy ? "กำลังบันทึก…" : "บันทึก"}</Button>
      </div>
    </Modal>
  );
}
