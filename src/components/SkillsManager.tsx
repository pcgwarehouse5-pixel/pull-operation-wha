"use client";

// จัดการรายการทักษะ แยกตามตำแหน่ง (หน้าตั้งค่าตัวเลือก → ทักษะ)
import { useCallback, useEffect, useState } from "react";
import { useApp } from "./AuthProvider";
import { Alert, Badge, Button, Card, Empty, Field, Loading, Modal, inputCls } from "./ui";
import { Icon } from "./Icon";
import { errText, fetchAll, sb } from "@/lib/supabase";
import { useOptions } from "@/lib/useOptions";
import type { Skill } from "@/lib/types";

type Form = { id?: string; position: string; name: string; sort_order: string; is_active: boolean };

export function SkillsManager() {
  const { demo } = useApp();
  const opts = useOptions(["position"]);
  const [rows, setRows] = useState<Skill[] | null>(null);
  const [pos, setPos] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (demo) return setRows(demo.PREVIEW_SKILLS);
    try {
      setRows(await fetchAll<Skill>((f, t) => sb().from("skills").select("*").order("position").order("sort_order").order("name").range(f, t)));
    } catch (e) {
      setErr(errText(e));
    }
  }, [demo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปิดแท็บ
    load();
  }, [load]);

  const positions = [...new Set([...(opts.position ?? []).map((o) => o.value), ...(rows ?? []).map((r) => r.position)])];
  const shown = (rows ?? []).filter((r) => !pos || r.position === pos);
  const grouped = shown.reduce<Record<string, Skill[]>>((a, s) => ((a[s.position] ??= []).push(s), a), {});

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <Field label="ตำแหน่ง">
            <select className={inputCls} value={pos} onChange={(e) => setPos(e.target.value)}>
              <option value="">ทุกตำแหน่ง</option>
              {positions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
        </div>
        <Button onClick={() => setForm({ position: pos, name: "", sort_order: String((grouped[pos]?.length ?? 0) + 1), is_active: true })}>
          <Icon name="plus" size={20} /> เพิ่มทักษะ
        </Button>
      </div>
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Empty>ยังไม่มีทักษะ{pos ? `ของตำแหน่ง ${pos}` : ""}</Empty>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([p, list]) => (
            <Card key={p} className="!p-3.5">
              <h3 className="mb-2 font-bold text-brand">{p} <span className="text-[14px] font-normal text-muted">({list.length})</span></h3>
              <ul className="flex flex-wrap gap-2">
                {list.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setForm({ id: s.id, position: s.position, name: s.name, sort_order: String(s.sort_order), is_active: s.is_active })}
                      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-[15px] ring-1 ring-line hover:ring-brand/40 ${s.is_active ? "bg-white" : "bg-paper text-muted line-through"}`}
                    >
                      {s.name}
                      {!s.is_active && <Badge tone="red">ปิด</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {form && <SkillForm initial={form} positions={positions} demo={!!demo} onClose={() => setForm(null)} onSaved={load} />}
    </div>
  );
}

function SkillForm({ initial, positions, demo, onClose, onSaved }: { initial: Form; positions: string[]; demo: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    const sort = Number(f.sort_order);
    if (!f.position) return setErr("กรุณาเลือกตำแหน่ง");
    if (!f.name.trim()) return setErr("กรุณาใส่ชื่อทักษะ");
    if (!Number.isInteger(sort)) return setErr("ลำดับต้องเป็นตัวเลข");
    setBusy(true);
    setErr("");
    try {
      if (!demo) {
        const row = { position: f.position, name: f.name.trim(), sort_order: sort, is_active: f.is_active };
        const { error } = f.id ? await sb().from("skills").update(row).eq("id", f.id) : await sb().from("skills").insert(row);
        if (error) throw error;
        await onSaved();
      }
      onClose();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={f.id ? "แก้ไขทักษะ" : "เพิ่มทักษะ"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="ตำแหน่ง">
          <select className={inputCls} value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} disabled={!!f.id}>
            <option value="">เลือกตำแหน่ง</option>
            {positions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field label="ชื่อทักษะ" hint="เช่น RT ยกรับ, เช็คจ่าย(Export)">
          <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} />
        </Field>
        <Field label="ลำดับการแสดง">
          <input className={inputCls} value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} inputMode="numeric" />
        </Field>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="h-5 w-5" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />
          เปิดใช้งาน (ปิดแล้วจะไม่แสดงให้เลือก แต่คนที่มีทักษะนี้อยู่แล้วยังเก็บไว้)
        </label>
        {err && <Alert tone="error">{err}</Alert>}
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button className="flex-1" onClick={save} disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Button>
        </div>
      </div>
    </Modal>
  );
}
