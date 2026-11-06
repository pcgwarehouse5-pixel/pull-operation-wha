"use client";

// กฎลงเวลา/ลา (หน้าตั้งค่า): ทุกค่ามีวันที่เริ่มใช้ เปลี่ยนค่า = เพิ่มค่าใหม่ ค่าเก่ายังใช้กับวันก่อนหน้า
// ผู้บริหาร/ผู้ดูแลระบบสูงสุดแก้กฎได้ · แอดมินคลังขึ้นไปตั้งโควตารายคนได้
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "./AuthProvider";
import { Alert, Badge, Button, Card, Field, Loading, Modal, inputCls } from "./ui";
import { EMP_COLS, empName, type Emp } from "./shifts/common";
import { errText, fetchAll, sb } from "@/lib/supabase";
import { useOptions } from "@/lib/useOptions";
import { thaiDate } from "@/lib/format";
import { isGlobal, isManager } from "@/lib/types";
import { todayIso } from "@/lib/shifts";

type Setting = { key: string; effective_from: string; value: unknown; note: string | null; created_at: string };
type Kind = "number" | "quota" | "types";
const META: { key: string; label: string; unit?: string; hint: string; kind: Kind; min?: number; max?: number }[] = [
  { key: "attendance.late_grace_minutes", label: "เวลาผ่อนผันก่อนนับว่าสาย", unit: "นาที", hint: "เข้างานช้ากว่าเวลาเริ่มกะไม่เกินค่านี้ ยังนับว่าปกติ", kind: "number", min: 0, max: 120 },
  { key: "attendance.early_leave_grace_minutes", label: "เวลาผ่อนผันก่อนนับว่าออกก่อน", unit: "นาที", hint: "", kind: "number", min: 0, max: 120 },
  { key: "attendance.no_out_after_hours", label: "เลยเวลาเลิกกะกี่ชั่วโมงจึงนับว่าลืมออก", unit: "ชั่วโมง", hint: "", kind: "number", min: 1, max: 12 },
  { key: "attendance.max_gps_accuracy_m", label: "ความคลาดเคลื่อน GPS สูงสุดที่ยอมรับ", unit: "เมตร", hint: "ถ้า GPS คลาดเคลื่อนมากกว่านี้ ระบบให้ลองใหม่ (รัศมีของแต่ละคลังตั้งในหน้า \"คลัง\")", kind: "number", min: 20, max: 1000 },
  { key: "attendance.correction_max_days", label: "ขอแก้เวลาย้อนหลังได้ไม่เกิน", unit: "วัน", hint: "", kind: "number", min: 1, max: 90 },
  { key: "leave.exec_approval_min_days", label: "ลาตั้งแต่กี่วันต้องให้ผู้บริหารอนุมัติต่อ", unit: "วัน", hint: "ต่ำกว่านี้ หัวหน้างาน/แอดมินคลังอนุมัติจบได้เลย", kind: "number", min: 1, max: 60 },
  { key: "leave.quota", label: "โควตาวันลาต่อปี (ค่ามาตรฐาน)", hint: "เว้นว่าง = ไม่จำกัด/ไม่แสดงคงเหลือ · ตรวจสิทธิ์ตาม พ.ร.บ.คุ้มครองแรงงานฉบับล่าสุดกับกรมสวัสดิการและคุ้มครองแรงงานก่อนตั้ง", kind: "quota" },
  { key: "leave.attachment_types", label: "ประเภทลาที่แนบเอกสารได้", hint: "ใบรับรองแพทย์เป็นข้อมูลสุขภาพ (ข้อมูลอ่อนไหวตาม PDPA) เปิดเฉพาะที่จำเป็น", kind: "types" },
];

export function RulesManager() {
  const { profile: me, demo } = useApp();
  const opts = useOptions(["leave_type"]);
  const types = (demo ? demo.PREVIEW_LEAVE_TYPES : (opts.leave_type ?? [])).filter((o) => o.is_active);
  const [rows, setRows] = useState<Setting[] | null>(null);
  const [edit, setEdit] = useState<(typeof META)[number] | null>(null);
  const [err, setErr] = useState("");
  const canEdit = isGlobal(me.role);
  const today = todayIso();

  const load = useCallback(async () => {
    if (demo) {
      return setRows([
        { key: "attendance.late_grace_minutes", effective_from: "2000-01-01", value: 0, note: null, created_at: "" },
        { key: "leave.exec_approval_min_days", effective_from: "2000-01-01", value: 4, note: null, created_at: "" },
        { key: "leave.quota", effective_from: "2000-01-01", value: { sick: 30, personal: 6, vacation: 6 }, note: null, created_at: "" },
        { key: "leave.attachment_types", effective_from: "2000-01-01", value: ["sick"], note: null, created_at: "" },
      ]);
    }
    const { data, error } = await sb().from("app_settings").select("key, effective_from, value, note, created_at").order("key").order("effective_from", { ascending: false });
    if (error) setErr(errText(error));
    setRows((data ?? []) as Setting[]);
  }, [demo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปิดแท็บ
    load();
  }, [load]);

  const typeLabel = (v: string) => types.find((t) => t.value === v)?.label ?? v;
  const show = (m: (typeof META)[number], v: unknown) => {
    if (v === undefined) return "-";
    if (m.kind === "number") return `${v} ${m.unit ?? ""}`;
    if (m.kind === "types") return (v as string[]).map(typeLabel).join(", ") || "ไม่มี";
    return Object.entries(v as Record<string, number>).map(([k, n]) => `${typeLabel(k)} ${n}`).join(" · ");
  };

  return (
    <div>
      {!canEdit && <div className="mb-3"><Alert tone="info">กฎเหล่านี้มีผลทุกคลัง แก้ได้เฉพาะผู้บริหารและผู้ดูแลระบบสูงสุด</Alert></div>}
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : (
        <ul className="space-y-2">
          {META.map((m) => {
            const hist = rows.filter((r) => r.key === m.key);
            const current = hist.find((r) => r.effective_from <= today);
            const future = hist.filter((r) => r.effective_from > today);
            return (
              <li key={m.key}>
                <Card className="!p-3.5">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{m.label}</p>
                      <p className="text-[15px] text-brand">{show(m, current?.value)}</p>
                      {current && current.effective_from > "2000-01-01" && <p className="text-[13px] text-muted">ใช้ตั้งแต่ {thaiDate(`${current.effective_from}T12:00:00+07:00`)}</p>}
                      {future.map((f) => (
                        <p key={f.effective_from} className="text-[13px] text-[#7a5410]">
                          จะเปลี่ยนเป็น {show(m, f.value)} ตั้งแต่ {thaiDate(`${f.effective_from}T12:00:00+07:00`)}
                        </p>
                      ))}
                      {m.hint && <p className="mt-1 text-[13px] text-muted">{m.hint}</p>}
                      {hist.length > 1 && (
                        <details className="mt-1 text-[13px] text-muted">
                          <summary className="cursor-pointer">ประวัติ ({hist.length})</summary>
                          <ul className="mt-1 space-y-0.5">
                            {hist.map((h) => (
                              <li key={h.effective_from}>
                                {h.effective_from === "2000-01-01" ? "ค่าเริ่มต้น" : thaiDate(`${h.effective_from}T12:00:00+07:00`)}: {show(m, h.value)}
                                {h.note ? ` (${h.note})` : ""}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                    {canEdit && <Button size="sm" variant="secondary" onClick={() => setEdit(m)}>เปลี่ยนค่า</Button>}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {isManager(me.role) && <QuotaOverrides types={types.map((t) => ({ value: t.value, label: t.label }))} />}
      {edit && (
        <EditSetting
          meta={edit}
          current={rows?.find((r) => r.key === edit.key && r.effective_from <= today)?.value}
          types={types.map((t) => ({ value: t.value, label: t.label }))}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function EditSetting({ meta, current, types, onClose, onSaved }: { meta: (typeof META)[number]; current: unknown; types: { value: string; label: string }[]; onClose: () => void; onSaved: () => void }) {
  const { demo } = useApp();
  const [num, setNum] = useState(String(meta.kind === "number" ? (current ?? "") : ""));
  const [quota, setQuota] = useState<Record<string, string>>(() =>
    Object.fromEntries(types.map((t) => [t.value, String((current as Record<string, number> | undefined)?.[t.value] ?? "")])),
  );
  const [sel, setSel] = useState<string[]>(Array.isArray(current) ? (current as string[]) : []);
  const [from, setFrom] = useState(todayIso);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr("");
    let value: unknown;
    if (meta.kind === "number") {
      const n = Number(num);
      if (num === "" || !Number.isFinite(n) || n < (meta.min ?? 0) || n > (meta.max ?? 1e6)) return setErr(`ใส่ตัวเลข ${meta.min ?? 0}–${meta.max}`);
      value = n;
    } else if (meta.kind === "quota") {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(quota)) {
        if (v.trim() === "") continue;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 366) return setErr("โควตาต้องเป็นตัวเลข 0–366");
        out[k] = n;
      }
      value = out;
    } else value = sel;
    if (!from) return setErr("เลือกวันที่เริ่มใช้");
    if (demo) return onSaved();
    setBusy(true);
    const { error } = await sb().from("app_settings").upsert({ key: meta.key, effective_from: from, value, note: note.trim() || null }, { onConflict: "key,effective_from" });
    setBusy(false);
    if (error) return setErr(errText(error));
    onSaved();
  }

  return (
    <Modal title={meta.label} onClose={onClose}>
      <div className="space-y-3">
        {meta.kind === "number" && (
          <Field label={`ค่าใหม่ (${meta.unit})`}>
            <input type="number" inputMode="numeric" min={meta.min} max={meta.max} className={inputCls} value={num} onChange={(e) => setNum(e.target.value)} />
          </Field>
        )}
        {meta.kind === "quota" &&
          types.map((t) => (
            <Field key={t.value} label={`ลา${t.label} (วัน/ปี)`}>
              <input type="number" inputMode="decimal" min={0} max={366} className={inputCls} value={quota[t.value] ?? ""} placeholder="ไม่จำกัด" onChange={(e) => setQuota({ ...quota, [t.value]: e.target.value })} />
            </Field>
          ))}
        {meta.kind === "types" &&
          types.map((t) => (
            <label key={t.value} className="flex min-h-11 items-center gap-3">
              <input type="checkbox" className="h-5 w-5 accent-brand" checked={sel.includes(t.value)} onChange={() => setSel(sel.includes(t.value) ? sel.filter((x) => x !== t.value) : [...sel, t.value])} />
              ลา{t.label}
            </label>
          ))}
        <Field label="เริ่มใช้ตั้งแต่วันที่" hint="วันก่อนหน้านี้ยังใช้ค่าเดิม (ไม่ย้อนแก้ข้อมูลเก่า)">
          <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="หมายเหตุ (เช่น เลขที่ประกาศบริษัท)">
          <input className={inputCls} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {err && <Alert tone="error">{err}</Alert>}
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>ยกเลิก</Button>
        <Button className="flex-1" onClick={save} disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Button>
      </div>
    </Modal>
  );
}

// ---------- โควตารายคน ----------
type Override = { user_id: string; year: number; leave_type: string; days: number; note: string | null; profiles: { employee_code: string; first_name_th: string; nickname: string | null } };

function QuotaOverrides({ types }: { types: { value: string; label: string }[] }) {
  const { profile: me, warehouses, myWarehouseIds, demo } = useApp();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [rows, setRows] = useState<Override[] | null>(null);
  const [form, setForm] = useState(false);
  const [err, setErr] = useState("");
  const whIds = useMemo(() => (isGlobal(me.role) ? warehouses.map((w) => w.id) : myWarehouseIds), [me.role, warehouses, myWarehouseIds]);

  const load = useCallback(async () => {
    if (demo) return setRows([]);
    const { data, error } = await sb().from("leave_quota_overrides").select("*, profiles(employee_code, first_name_th, nickname)").eq("year", year).order("user_id");
    if (error) setErr(errText(error));
    setRows((data ?? []) as Override[]);
  }, [demo, year]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปลี่ยนปี
    load();
  }, [load]);

  async function remove(o: Override) {
    if (!confirm(`ลบโควตารายคนของ ${o.profiles.first_name_th} (กลับไปใช้ค่ามาตรฐาน)?`)) return;
    const { error } = await sb().from("leave_quota_overrides").delete().match({ user_id: o.user_id, year: o.year, leave_type: o.leave_type });
    if (error) return setErr(errText(error));
    load();
  }

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-bold text-brand">โควตาวันลารายคน ปี {year + 543}</h3>
        <select className={`${inputCls} !min-h-10 !w-auto`} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="ปี">
          {[year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>{y + 543}</option>
          ))}
        </select>
        <Button size="sm" className="ml-auto" onClick={() => setForm(true)}>+ ตั้งโควตารายคน</Button>
      </div>
      <p className="mb-2 text-[13px] text-muted">ใช้แทนค่ามาตรฐานสำหรับบางคน เช่น อายุงานครบ 1 ปีได้พักร้อนเพิ่ม (แอดมินคลังตั้งได้เฉพาะพนักงานในคลังที่ดูแล)</p>
      {err && <div className="mb-2"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : !rows.length ? (
        <p className="rounded-2xl bg-white px-4 py-6 text-center text-muted ring-1 ring-line">ยังไม่มีโควตารายคน</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl bg-white ring-1 ring-line">
          {rows.map((o) => (
            <li key={`${o.user_id}-${o.leave_type}`} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <b>{empName(o.profiles)}</b> <span className="text-[13px] text-muted">{o.profiles.employee_code}</span>
                {o.note && <span className="block text-[13px] text-muted">{o.note}</span>}
              </span>
              <Badge tone="blue">
                ลา{types.find((t) => t.value === o.leave_type)?.label ?? o.leave_type} {Number(o.days)} วัน
              </Badge>
              <Button size="sm" variant="ghost" onClick={() => remove(o)}>ลบ</Button>
            </li>
          ))}
        </ul>
      )}
      {form && <OverrideForm year={year} types={types} whIds={whIds} onClose={() => setForm(false)} onSaved={() => (setForm(false), load())} />}
    </div>
  );
}

function OverrideForm({ year, types, whIds, onClose, onSaved }: { year: number; types: { value: string; label: string }[]; whIds: string[]; onClose: () => void; onSaved: () => void }) {
  const [emps, setEmps] = useState<Emp[] | null>(null);
  const [q, setQ] = useState("");
  const [user, setUser] = useState<Emp | null>(null);
  const [type, setType] = useState(types[0]?.value ?? "");
  const [days, setDays] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    fetchAll<Emp>((f, t) => sb().from("profiles").select(EMP_COLS).in("warehouse_id", whIds.length ? whIds : ["00000000-0000-0000-0000-000000000000"]).eq("status", "active").order("employee_code").range(f, t)).then(setEmps, () => setEmps([]));
  }, [whIds]);

  async function save() {
    setErr("");
    const n = Number(days);
    if (!user) return setErr("เลือกพนักงาน");
    if (days === "" || !Number.isFinite(n) || n < 0 || n > 366) return setErr("จำนวนวัน 0–366");
    const { error } = await sb().from("leave_quota_overrides").upsert({ user_id: user.id, year, leave_type: type, days: n, note: note.trim() || null }, { onConflict: "user_id,year,leave_type" });
    if (error) return setErr(errText(error));
    onSaved();
  }

  const shown = (emps ?? []).filter((e) => !q || `${e.employee_code} ${e.first_name_th} ${e.last_name_th ?? ""} ${e.nickname ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  return (
    <Modal title={`ตั้งโควตารายคน ปี ${year + 543}`} onClose={onClose}>
      <div className="space-y-3">
        {user ? (
          <div className="flex items-center gap-2 rounded-xl bg-paper px-3 py-2">
            <span className="flex-1 font-semibold">{empName(user)} <span className="font-normal text-muted">{user.employee_code}</span></span>
            <Button size="sm" variant="ghost" onClick={() => setUser(null)}>เปลี่ยน</Button>
          </div>
        ) : (
          <Field label="พนักงาน">
            <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ / รหัส" />
            <ul className="mt-1 max-h-48 divide-y divide-line overflow-y-auto">
              {!emps ? (
                <li className="py-2 text-muted">กำลังโหลด...</li>
              ) : (
                shown.map((e) => (
                  <li key={e.id}>
                    <button type="button" className="min-h-11 w-full px-1 text-left hover:bg-paper" onClick={() => setUser(e)}>
                      {empName(e)} <span className="text-[13px] text-muted">{e.employee_code}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="ประเภทการลา">
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label="วันต่อปี">
            <input type="number" inputMode="decimal" min={0} max={366} className={inputCls} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </div>
        <Field label="หมายเหตุ">
          <input className={inputCls} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น อายุงานครบ 3 ปี" />
        </Field>
        {err && <Alert tone="error">{err}</Alert>}
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>ยกเลิก</Button>
        <Button className="flex-1" onClick={save}>บันทึก</Button>
      </div>
    </Modal>
  );
}
