"use client";

// ฟอร์มข้อมูลพนักงาน (ใช้ทั้งหน้าเพิ่มพนักงานและหน้าแก้ไข)
import { Field, inputCls } from "./ui";
import { EMPLOYEE_FLAGS, TITLES, type DropdownOption } from "@/lib/types";

export type EmployeeValues = {
  employee_code: string;
  title: string;
  first_name_th: string;
  last_name_th: string;
  nickname: string;
  position: string;
  department: string;
  employment_type: string;
  subcontractor_company: string;
  salary_code: string;
  phone: string;
  line_id: string;
  birth_date: string;
  flags: Record<string, boolean>;
};

export const EMPTY_EMPLOYEE: EmployeeValues = {
  employee_code: "",
  title: "",
  first_name_th: "",
  last_name_th: "",
  nickname: "",
  position: "",
  department: "",
  employment_type: "",
  subcontractor_company: "",
  salary_code: "",
  phone: "",
  line_id: "",
  birth_date: "",
  flags: { ot_eligible: true, show_in_ot_report: true, show_in_org_chart: true, travel_eligible: false, exclude_from_shift: false, auto_check_in: false },
};

// แปลงค่าจากฟอร์มเป็นข้อมูลที่บันทึก (ช่องว่าง = ไม่มีข้อมูล)
export function toRow(v: EmployeeValues) {
  const n = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    title: n(v.title),
    first_name_th: v.first_name_th.trim(),
    last_name_th: n(v.last_name_th),
    nickname: n(v.nickname),
    position: n(v.position),
    department: n(v.department),
    employment_type: n(v.employment_type),
    subcontractor_company: n(v.subcontractor_company),
    salary_code: n(v.salary_code),
    phone: n(v.phone),
    line_id: n(v.line_id),
    birth_date: n(v.birth_date),
    ...v.flags,
  };
}

export function validateEmployee(v: EmployeeValues, isNew: boolean): string | null {
  if (isNew && !/^[A-Za-z0-9._-]{1,30}$/.test(v.employee_code.trim())) return "รหัสพนักงานใช้ได้เฉพาะ A-Z a-z 0-9 . _ - (ไม่เกิน 30 ตัว)";
  if (!v.first_name_th.trim()) return "กรุณาใส่ชื่อ";
  if (v.phone.trim() && !/^[0-9+\- ]{6,20}$/.test(v.phone.trim())) return "เบอร์โทรใช้ได้เฉพาะตัวเลข";
  return null;
}

function withCurrent(list: DropdownOption[] | undefined, current: string) {
  const items = (list ?? []).filter((o) => o.is_active || o.value === current);
  if (current && !items.some((o) => o.value === current)) items.push({ id: current, category: "", value: current, label: current, sort_order: 999, extra: {}, is_active: true });
  return items;
}

export function EmployeeForm({
  value,
  onChange,
  options,
  isNew,
  readOnly,
}: {
  value: EmployeeValues;
  onChange: (v: EmployeeValues) => void;
  options: Record<string, DropdownOption[]>;
  isNew?: boolean;
  readOnly?: boolean;
}) {
  const set = (k: keyof EmployeeValues, v: string) => onChange({ ...value, [k]: v });
  const select = (k: keyof EmployeeValues, cat: string, placeholder: string) => (
    <select className={inputCls} value={value[k] as string} onChange={(e) => set(k, e.target.value)} disabled={readOnly}>
      <option value="">{placeholder}</option>
      {withCurrent(options[cat], value[k] as string).map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4">
      {isNew && (
        <Field label="รหัสพนักงาน" hint="ใช้เป็นชื่อเข้าระบบ แก้ภายหลังไม่ได้">
          <input className={inputCls} value={value.employee_code} onChange={(e) => set("employee_code", e.target.value)} autoCapitalize="none" maxLength={30} />
        </Field>
      )}
      <div className="grid grid-cols-[110px_1fr] gap-3 sm:grid-cols-[130px_1fr_1fr]">
        <Field label="คำนำหน้า">
          <select className={inputCls} value={value.title} onChange={(e) => set("title", e.target.value)} disabled={readOnly}>
            <option value="">-</option>
            {[...TITLES, ...(value.title && !TITLES.includes(value.title) ? [value.title] : [])].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="ชื่อ">
          <input className={inputCls} value={value.first_name_th} onChange={(e) => set("first_name_th", e.target.value)} disabled={readOnly} maxLength={60} />
        </Field>
        <div className="col-span-2 sm:col-span-1">
          <Field label="นามสกุล">
            <input className={inputCls} value={value.last_name_th} onChange={(e) => set("last_name_th", e.target.value)} disabled={readOnly} maxLength={60} />
          </Field>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ชื่อเล่น">
          <input className={inputCls} value={value.nickname} onChange={(e) => set("nickname", e.target.value)} disabled={readOnly} maxLength={30} />
        </Field>
        <Field label="ตำแหน่ง">{select("position", "position", "เลือกตำแหน่ง")}</Field>
        <Field label="ประเภทพนักงาน">{select("employment_type", "employment_type", "เลือกประเภท")}</Field>
        <Field label="บริษัทรับเหมา" hint="เฉพาะแรงงานรับเหมา">{select("subcontractor_company", "subcontractor_company", "-")}</Field>
        <Field label="แผนก">
          <input className={inputCls} value={value.department} onChange={(e) => set("department", e.target.value)} disabled={readOnly} maxLength={60} />
        </Field>
        <Field label="รหัสเงินเดือน">
          <input className={inputCls} value={value.salary_code} onChange={(e) => set("salary_code", e.target.value)} disabled={readOnly} maxLength={30} />
        </Field>
        <Field label="เบอร์โทร">
          <input className={inputCls} value={value.phone} onChange={(e) => set("phone", e.target.value)} disabled={readOnly} inputMode="tel" maxLength={20} />
        </Field>
        <Field label="LINE ID">
          <input className={inputCls} value={value.line_id} onChange={(e) => set("line_id", e.target.value)} disabled={readOnly} autoCapitalize="none" maxLength={50} />
        </Field>
        <Field label="วันเกิด" hint="ไม่บังคับ">
          <input type="date" className={inputCls} value={value.birth_date} onChange={(e) => set("birth_date", e.target.value)} disabled={readOnly} />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[15px] font-semibold">การคำนวณและการแสดงผล</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {EMPLOYEE_FLAGS.map((f) => (
            <label key={f.key} className="flex min-h-12 items-start gap-2.5 rounded-xl px-3 py-2.5 ring-1 ring-line">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0"
                checked={!!value.flags[f.key]}
                disabled={readOnly}
                onChange={(e) => onChange({ ...value, flags: { ...value.flags, [f.key]: e.target.checked } })}
              />
              <span className="leading-snug">
                <span className="block">{f.label}</span>
                {f.hint && <span className="block text-[13px] text-muted">{f.hint}</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
