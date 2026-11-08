"use client";

// กฎลงเวลา / ลา / OT / เบี้ยขยัน / ค่าเดินทาง / แจ้งเตือน (หน้าตั้งค่า)
// ทุกค่ามีวันที่เริ่มใช้: เปลี่ยนค่า = เพิ่มค่าใหม่ ค่าเก่ายังใช้กับวันก่อนหน้า
// ผู้บริหาร/ผู้ดูแลระบบสูงสุดแก้กฎได้ · แอดมินคลังขึ้นไปตั้งโควตาวันลารายคนได้
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
type Kind = "number" | "quota" | "types" | "rates" | "steps" | "dilrules" | "date";
type Opt = { value: string; label: string };
type Meta = { key: string; label: string; unit?: string; hint: string; kind: Kind; min?: number; max?: number; source?: "leave" | "employment"; group: string };
type Rates = Record<string, { workday?: number; holiday_normal?: number; holiday_ot?: number }>;
type DilRules = { absent?: boolean; late?: boolean; no_punch?: boolean; leave_types?: string[] };

const LAW = "ตรวจกับ พ.ร.บ.คุ้มครองแรงงานฉบับล่าสุด (กรมสวัสดิการและคุ้มครองแรงงาน) ก่อนใช้";
const META: Meta[] = [
  { group: "ลงเวลา", key: "attendance.go_live_date", label: "วันเริ่มใช้ลงเวลาในแอป", hint: "ก่อนวันนี้ วันที่ไม่มีเวลาเข้า-ออกจะไม่นับเป็นขาดงาน ไม่แจ้งเตือน และไม่คิดเบี้ยขยัน (ตั้งเมื่อพร้อมให้พนักงานเริ่มกดลงเวลาจริง)", kind: "date" },
  { group: "ลงเวลา", key: "attendance.late_grace_minutes", label: "เวลาผ่อนผันก่อนนับว่าสาย", unit: "นาที", hint: "เข้างานช้ากว่าเวลาเริ่มกะไม่เกินค่านี้ ยังนับว่าปกติ", kind: "number", min: 0, max: 120 },
  { group: "ลงเวลา", key: "attendance.early_leave_grace_minutes", label: "เวลาผ่อนผันก่อนนับว่าออกก่อน", unit: "นาที", hint: "", kind: "number", min: 0, max: 120 },
  { group: "ลงเวลา", key: "attendance.no_out_after_hours", label: "เลยเวลาเลิกกะกี่ชั่วโมงจึงนับว่าลืมออก", unit: "ชั่วโมง", hint: "", kind: "number", min: 1, max: 12 },
  { group: "ลงเวลา", key: "attendance.max_gps_accuracy_m", label: "ความคลาดเคลื่อน GPS สูงสุดที่ยอมรับ", unit: "เมตร", hint: "รัศมีของแต่ละคลังตั้งในหน้า \"คลัง\"", kind: "number", min: 20, max: 1000 },
  { group: "ลงเวลา", key: "attendance.correction_max_days", label: "ขอแก้เวลาย้อนหลังได้ไม่เกิน", unit: "วัน", hint: "", kind: "number", min: 1, max: 90 },
  { group: "ลา", key: "leave.exec_approval_min_days", label: "ลาตั้งแต่กี่วันต้องให้ผู้บริหารอนุมัติต่อ", unit: "วัน", hint: "ต่ำกว่านี้ หัวหน้างาน/แอดมินคลังอนุมัติจบได้เลย", kind: "number", min: 1, max: 60 },
  { group: "ลา", key: "leave.quota", label: "โควตาวันลาต่อปี (ค่ามาตรฐาน)", hint: `เว้นว่าง = ไม่จำกัด · ${LAW}`, kind: "quota", source: "leave" },
  { group: "ลา", key: "leave.attachment_types", label: "ประเภทลาที่แนบเอกสารได้", hint: "ใบรับรองแพทย์เป็นข้อมูลสุขภาพ (ข้อมูลอ่อนไหวตาม PDPA) เปิดเฉพาะที่จำเป็น", kind: "types", source: "leave" },
  { group: "OT", key: "ot.rates", label: "อัตรา OT แยกประเภทพนักงาน (เท่าของค่าจ้างต่อชั่วโมง)", hint: `"ค่าเริ่มต้น" ใช้กับประเภทที่ไม่ได้ตั้งเฉพาะ · ${LAW}`, kind: "rates", source: "employment" },
  { group: "OT", key: "ot.min_minutes", label: "ไม่นับ OT ถ้าเกินเวลาเลิกกะไม่ถึง", unit: "นาที", hint: "ตามที่บริษัทเลือก (เกณฑ์นี้อาจถูกโต้แย้งได้ถ้าพนักงานทำงานจริงตามคำสั่ง ปรึกษานักกฎหมายแรงงาน)", kind: "number", min: 0, max: 240 },
  { group: "OT", key: "ot.round_minutes", label: "ปัดชั่วโมง OT ลงทีละ", unit: "นาที", hint: "", kind: "number", min: 1, max: 60 },
  { group: "OT", key: "ot.break_minutes", label: "หักเวลาพักเมื่อทำงานวันหยุด", unit: "นาที", hint: "", kind: "number", min: 0, max: 120 },
  { group: "OT", key: "ot.break_after_minutes", label: "ทำงานวันหยุดครบกี่นาทีจึงหักพัก", unit: "นาที", hint: "", kind: "number", min: 0, max: 720 },
  { group: "OT", key: "ot.holiday_normal_hours", label: "ชั่วโมงปกติของการทำงานวันหยุด (กะที่ไม่มีเวลา เช่น OFF)", unit: "ชั่วโมง", hint: "ส่วนที่เกินคิดอัตรา OT วันหยุด", kind: "number", min: 1, max: 12 },
  { group: "OT", key: "ot.max_hours_per_day", label: "เพดานชั่วโมงต่อวัน (กันคำนวณผิด)", unit: "ชั่วโมง", hint: "", kind: "number", min: 1, max: 24 },
  { group: "เบี้ยขยัน/ค่าเดินทาง", key: "payroll.cutoff_day", label: "วันตัดรอบเงินเดือน", unit: "", hint: "0 = ทั้งเดือน (1–สิ้นเดือน) · 20 = รอบ 21 ของเดือนก่อน ถึง 20", kind: "number", min: 0, max: 28 },
  { group: "เบี้ยขยัน/ค่าเดินทาง", key: "diligence.steps", label: "เบี้ยขยันขั้นบันได (บาท/เดือน)", hint: "เดือนที่ 1, 2, 3... ที่ไม่มีเหตุติดต่อกัน", kind: "steps" },
  { group: "เบี้ยขยัน/ค่าเดินทาง", key: "diligence.rules", label: "เหตุที่ทำให้ไม่ได้เบี้ยขยัน", hint: "", kind: "dilrules", source: "leave" },
  { group: "เบี้ยขยัน/ค่าเดินทาง", key: "diligence.employment_types", label: "ประเภทพนักงานที่ได้เบี้ยขยัน", hint: "ไม่เลือกเลย = ทุกประเภท", kind: "types", source: "employment" },
  { group: "เบี้ยขยัน/ค่าเดินทาง", key: "travel.rate_per_day", label: "ค่าเดินทางต่อวันที่มาทำงาน", unit: "บาท", hint: "เฉพาะพนักงานที่ติ๊ก \"ได้ค่าเดินทาง\" ในทะเบียน", kind: "number", min: 0, max: 5000 },
  { group: "Pull Operation", key: "pull.morning_from_hour", label: "กะเช้า: เวลาเข้างานตั้งแต่", unit: "นาฬิกา", hint: "รหัสกะที่เริ่มงานตั้งแต่เวลานี้ ถึงเวลาด้านล่าง นับเป็นกะเช้า (ใช้แยกคนในคลังกลางตามกะ)", kind: "number", min: 0, max: 23 },
  { group: "Pull Operation", key: "pull.morning_to_hour", label: "กะเช้า: เวลาเข้างานถึง (รวมทั้งชั่วโมงนั้น)", unit: "นาฬิกา", hint: "เช่น 13 = เข้างานถึง 13:59 ยังเป็นกะเช้า หลังจากนั้นเป็นกะดึก", kind: "number", min: 0, max: 23 },
  { group: "แจ้งเตือน", key: "notify.missing_in_minutes", label: "กะเริ่มแล้วกี่นาทียังไม่ลงเวลา จึงแจ้งเตือนพนักงาน", unit: "นาที", hint: "", kind: "number", min: 5, max: 240 },
  { group: "แจ้งเตือน", key: "notify.absent_streak_days", label: "ขาดงานติดต่อกันกี่วันทำงาน จึงแจ้งหัวหน้า/แอดมิน", unit: "วัน", hint: "เป็นการแจ้งให้ตรวจสอบเท่านั้น ไม่ได้ทำให้พ้นสภาพพนักงาน", kind: "number", min: 1, max: 14 },
  { group: "แจ้งเตือน", key: "notify.daily_hour", label: "เวลาส่งสรุปประจำวัน (ขาดงานติดต่อกัน / OT รออนุมัติ)", unit: "นาฬิกา", hint: "", kind: "number", min: 0, max: 23 },
];
const GROUPS = [...new Set(META.map((m) => m.group))];

export function RulesManager() {
  const { profile: me, demo } = useApp();
  const opts = useOptions(["leave_type", "employment_type"]);
  const leaveTypes: Opt[] = (demo ? demo.PREVIEW_LEAVE_TYPES : (opts.leave_type ?? [])).filter((o) => o.is_active).map((o) => ({ value: o.value, label: o.label }));
  const empTypes: Opt[] = (opts.employment_type ?? []).filter((o) => o.is_active).map((o) => ({ value: o.value, label: o.label }));
  const [rows, setRows] = useState<Setting[] | null>(null);
  const [edit, setEdit] = useState<Meta | null>(null);
  const [group, setGroup] = useState(GROUPS[0]);
  const [err, setErr] = useState("");
  const canEdit = isGlobal(me.role);
  const today = todayIso();

  const load = useCallback(async () => {
    if (demo) {
      return setRows([
        { key: "attendance.late_grace_minutes", effective_from: "2000-01-01", value: 0, note: null, created_at: "" },
        { key: "leave.quota", effective_from: "2000-01-01", value: { sick: 30, personal: 6, vacation: 6 }, note: null, created_at: "" },
        { key: "ot.rates", effective_from: "2000-01-01", value: { default: { workday: 1.5, holiday_normal: 1, holiday_ot: 3 }, daily_worker: { workday: 1.5, holiday_normal: 2, holiday_ot: 3 } }, note: null, created_at: "" },
        { key: "ot.min_minutes", effective_from: "2000-01-01", value: 60, note: null, created_at: "" },
        { key: "diligence.steps", effective_from: "2000-01-01", value: [300, 400, 500], note: null, created_at: "" },
        { key: "diligence.rules", effective_from: "2000-01-01", value: { absent: true, late: true, no_punch: true, leave_types: ["sick", "personal"] }, note: null, created_at: "" },
        { key: "travel.rate_per_day", effective_from: "2000-01-01", value: 30, note: null, created_at: "" },
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

  const optsOf = (m: Meta) => (m.source === "employment" ? empTypes : leaveTypes);
  const labelIn = (list: Opt[], v: string) => (v === "default" ? "ค่าเริ่มต้น" : (list.find((t) => t.value === v)?.label ?? v));
  const show = (m: Meta, v: unknown): string => {
    if (v === undefined || v === null) return m.kind === "date" ? "ยังไม่ตั้ง (ยังไม่เริ่มนับ)" : "-";
    const list = optsOf(m);
    switch (m.kind) {
      case "number":
        return `${v} ${m.unit ?? ""}`;
      case "date":
        return typeof v === "string" ? thaiDate(`${v}T12:00:00+07:00`) : "ยังไม่ตั้ง";
      case "types":
        return (v as string[]).map((x) => labelIn(list, x)).join(", ") || (m.source === "employment" ? "ทุกประเภท" : "ไม่มี");
      case "quota":
        return Object.entries(v as Record<string, number>).map(([k, n]) => `${labelIn(list, k)} ${n}`).join(" · ");
      case "steps":
        return (v as number[]).map((n) => n.toLocaleString("th-TH")).join(" → ") + " บาท";
      case "rates":
        return Object.entries(v as Rates)
          .map(([k, r]) => `${labelIn(list, k)}: วันทำงาน ${r.workday ?? "-"} / ทำงานวันหยุด ${r.holiday_normal ?? "-"} / OT วันหยุด ${r.holiday_ot ?? "-"}`)
          .join(" · ");
      case "dilrules": {
        const r = v as DilRules;
        const parts = [r.absent && "ขาด", r.late && "สาย", r.no_punch && "ลืมลงเวลา", ...(r.leave_types ?? []).map((x) => `ลา${labelIn(leaveTypes, x)}`)].filter(Boolean);
        return parts.join(", ") || "ไม่มี";
      }
    }
  };

  return (
    <div>
      {!canEdit && <div className="mb-3"><Alert tone="info">กฎเหล่านี้มีผลทุกคลัง แก้ได้เฉพาะผู้บริหารและผู้ดูแลระบบสูงสุด</Alert></div>}
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="กลุ่มกฎ">
        {GROUPS.map((g) => (
          <button key={g} role="tab" aria-selected={group === g} onClick={() => setGroup(g)} className={`min-h-10 rounded-full px-3.5 text-[14px] font-semibold ${group === g ? "bg-ink text-white" : "bg-white ring-1 ring-line"}`}>
            {g}
          </button>
        ))}
      </div>
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : (
        <ul className="space-y-2">
          {META.filter((m) => m.group === group).map((m) => {
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
      {group === "ลา" && isManager(me.role) && <QuotaOverrides types={leaveTypes} />}
      {edit && (
        <EditSetting
          meta={edit}
          current={rows?.find((r) => r.key === edit.key && r.effective_from <= today)?.value}
          options={optsOf(edit)}
          leaveTypes={leaveTypes}
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

function EditSetting({ meta, current, options, leaveTypes, onClose, onSaved }: { meta: Meta; current: unknown; options: Opt[]; leaveTypes: Opt[]; onClose: () => void; onSaved: () => void }) {
  const { demo } = useApp();
  const [num, setNum] = useState(String(meta.kind === "number" || meta.kind === "date" ? (current ?? "") : ""));
  const [quota, setQuota] = useState<Record<string, string>>(() =>
    Object.fromEntries(options.map((t) => [t.value, String((current as Record<string, number> | undefined)?.[t.value] ?? "")])),
  );
  const [sel, setSel] = useState<string[]>(Array.isArray(current) && meta.kind === "types" ? (current as string[]) : []);
  const [steps, setSteps] = useState(Array.isArray(current) && meta.kind === "steps" ? (current as number[]).join(", ") : "");
  const [rates, setRates] = useState<Record<string, Record<string, string>>>(() => {
    const cur = (meta.kind === "rates" ? current : {}) as Rates;
    return Object.fromEntries(
      ["default", ...options.map((o) => o.value)].map((k) => [
        k,
        { workday: String(cur?.[k]?.workday ?? ""), holiday_normal: String(cur?.[k]?.holiday_normal ?? ""), holiday_ot: String(cur?.[k]?.holiday_ot ?? "") },
      ]),
    );
  });
  const [dil, setDil] = useState<DilRules>(() => (meta.kind === "dilrules" ? { ...(current as DilRules) } : {}));
  const [from, setFrom] = useState(todayIso);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function build(): unknown | string {
    switch (meta.kind) {
      case "number": {
        const n = Number(num);
        if (num === "" || !Number.isFinite(n) || n < (meta.min ?? 0) || n > (meta.max ?? 1e6)) return `ใส่ตัวเลข ${meta.min ?? 0}–${meta.max}`;
        return n;
      }
      case "quota": {
        const out: Record<string, number> = {};
        for (const [k, v] of Object.entries(quota)) {
          if (v.trim() === "") continue;
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0 || n > 366) return "โควตาต้องเป็นตัวเลข 0–366";
          out[k] = n;
        }
        return out;
      }
      case "types":
        return sel;
      case "date":
        return /^d{4}-d{2}-d{2}$/.test(num) ? num : null;
      case "steps": {
        const list = steps.split(/[,\s]+/).filter(Boolean).map(Number);
        if (!list.length || list.some((n) => !Number.isFinite(n) || n < 0 || n > 100000)) return "ใส่จำนวนเงินคั่นด้วยจุลภาค เช่น 300, 400, 500";
        return list;
      }
      case "rates": {
        const out: Rates = {};
        for (const [k, r] of Object.entries(rates)) {
          const vals = Object.entries(r).filter(([, v]) => v.trim() !== "");
          if (!vals.length) continue;
          if (k === "default" && vals.length < 3) return "ค่าเริ่มต้นต้องใส่ครบ 3 อัตรา";
          const o: Record<string, number> = {};
          for (const [f, v] of vals) {
            const n = Number(v);
            if (!Number.isFinite(n) || n < 0 || n > 10) return "อัตราต้องเป็นตัวเลข 0–10 เท่า";
            o[f] = n;
          }
          out[k] = o;
        }
        if (!out.default) return "ต้องมีค่าเริ่มต้น";
        return out;
      }
      case "dilrules":
        return { absent: !!dil.absent, late: !!dil.late, no_punch: !!dil.no_punch, leave_types: dil.leave_types ?? [] };
    }
  }

  async function save() {
    setErr("");
    const value = build();
    if (typeof value === "string") return setErr(value);
    if (!from) return setErr("เลือกวันที่เริ่มใช้");
    if (demo) return onSaved();
    setBusy(true);
    const { error } = await sb().from("app_settings").upsert({ key: meta.key, effective_from: from, value, note: note.trim() || null }, { onConflict: "key,effective_from" });
    setBusy(false);
    if (error) return setErr(errText(error));
    onSaved();
  }

  const check = (on: boolean, set: () => void, label: string, k: string) => (
    <label key={k} className="flex min-h-11 items-center gap-3">
      <input type="checkbox" className="h-5 w-5 accent-brand" checked={on} onChange={set} />
      {label}
    </label>
  );

  return (
    <Modal title={meta.label} onClose={onClose}>
      <div className="space-y-3">
        {meta.kind === "number" && (
          <Field label={`ค่าใหม่${meta.unit ? ` (${meta.unit})` : ""}`}>
            <input type="number" inputMode="numeric" min={meta.min} max={meta.max} className={inputCls} value={num} onChange={(e) => setNum(e.target.value)} />
          </Field>
        )}
        {meta.kind === "date" && (
          <Field label="วันที่" hint="เว้นว่างแล้วบันทึก = กลับไปเป็นยังไม่เริ่มใช้">
            <input type="date" className={inputCls} value={num} onChange={(e) => setNum(e.target.value)} />
          </Field>
        )}
        {meta.kind === "quota" &&
          options.map((t) => (
            <Field key={t.value} label={`ลา${t.label} (วัน/ปี)`}>
              <input type="number" inputMode="decimal" min={0} max={366} className={inputCls} value={quota[t.value] ?? ""} placeholder="ไม่จำกัด" onChange={(e) => setQuota({ ...quota, [t.value]: e.target.value })} />
            </Field>
          ))}
        {meta.kind === "types" && options.map((t) => check(sel.includes(t.value), () => setSel(sel.includes(t.value) ? sel.filter((x) => x !== t.value) : [...sel, t.value]), t.label, t.value))}
        {meta.kind === "steps" && (
          <Field label="จำนวนเงินแต่ละขั้น (บาท) คั่นด้วยจุลภาค">
            <input className={inputCls} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="300, 400, 500" />
          </Field>
        )}
        {meta.kind === "rates" && (
          <div className="space-y-3">
            {Object.keys(rates).map((k) => (
              <div key={k} className="rounded-xl p-3 ring-1 ring-line">
                <p className="mb-2 font-semibold">{k === "default" ? "ค่าเริ่มต้น (ทุกประเภทที่ไม่ได้ตั้งเฉพาะ)" : (options.find((o) => o.value === k)?.label ?? k)}</p>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["workday", "OT วันทำงาน"],
                      ["holiday_normal", "ทำงานวันหยุด"],
                      ["holiday_ot", "OT วันหยุด"],
                    ] as const
                  ).map(([f, l]) => (
                    <label key={f} className="text-[13px]">
                      {l}
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        min={0}
                        max={10}
                        className={`${inputCls} !min-h-10`}
                        value={rates[k][f]}
                        placeholder={k === "default" ? "" : "ใช้ค่าเริ่มต้น"}
                        onChange={(e) => setRates({ ...rates, [k]: { ...rates[k], [f]: e.target.value } })}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {meta.kind === "dilrules" && (
          <div>
            {check(!!dil.absent, () => setDil({ ...dil, absent: !dil.absent }), "ขาดงาน", "absent")}
            {check(!!dil.late, () => setDil({ ...dil, late: !dil.late }), "มาสาย (เกินเวลาผ่อนผัน)", "late")}
            {check(!!dil.no_punch, () => setDil({ ...dil, no_punch: !dil.no_punch }), "ลืมลงเวลาเข้า/ออก (ที่ยังไม่ได้แก้)", "no_punch")}
            <p className="mt-2 mb-1 text-[14px] font-semibold">ลาประเภทใดบ้างที่ทำให้ไม่ได้</p>
            {leaveTypes.map((t) =>
              check(
                (dil.leave_types ?? []).includes(t.value),
                () => {
                  const cur = dil.leave_types ?? [];
                  setDil({ ...dil, leave_types: cur.includes(t.value) ? cur.filter((x) => x !== t.value) : [...cur, t.value] });
                },
                `ลา${t.label}`,
                `l-${t.value}`,
              ),
            )}
          </div>
        )}
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
