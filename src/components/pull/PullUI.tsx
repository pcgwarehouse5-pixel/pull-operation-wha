"use client";

// ส่วนประกอบหน้าตาร่วมของ Pull Operation (ตามสไลด์: แถบหัวสีกรมท่า ไอคอนวงกลมสีตามทักษะ สวิตช์เปิด/ปิด)
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { skillStyle } from "@/lib/pull";
import { thaiDate } from "@/lib/format";

export function SkillIcon({ name, size = 44 }: { name: string; size?: number }) {
  const s = skillStyle(name);
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full text-white" style={{ width: size, height: size, background: s.color }} aria-hidden="true">
      <Icon name={s.icon as IconName} size={Math.round(size * 0.52)} />
    </span>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? "bg-ok" : "bg-[#c9d1e1]"}`}
    >
      <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? "translate-x-7" : "translate-x-1"}`} />
    </button>
  );
}

/** แถบหัวสีกรมท่า: ชื่อหน้า + ตัวเลือก (คลัง วันที่ ...) */
export function PullBar({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-brand px-4 py-3.5 text-white shadow-sm sm:px-5">
      <div className="min-w-0">
        <h1 className="text-xl leading-tight font-bold">{title}</h1>
        {sub && <p className="text-[14px] text-white/75">{sub}</p>}
      </div>
      {children && <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">{children}</div>}
    </div>
  );
}

/** ตัวเลือกบนแถบหัว (พื้นขาว) */
export function BarSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-11 flex-1 items-center gap-2 rounded-xl bg-white px-3 text-ink sm:flex-none">
      <span className="text-[14px] font-semibold text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="min-h-11 flex-1 bg-transparent font-semibold outline-none">
        {children}
      </select>
    </label>
  );
}

/** ปุ่มขั้นตอน 1–4 พร้อมเครื่องหมายว่าตั้งค่าครบหรือยัง */
export function StepTabs<T extends string>({ steps, active, onChange }: { steps: { key: T; label: string; done: boolean }[]; active: T; onChange: (k: T) => void }) {
  return (
    <div className="-mx-3 mb-4 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0" role="tablist">
      {steps.map((s, i) => {
        const on = s.key === active;
        return (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(s.key)}
            className={`flex min-h-12 shrink-0 items-center gap-2 rounded-xl px-3.5 text-[15px] font-semibold ring-1 transition ${on ? "bg-brand text-white ring-brand" : "bg-white text-ink ring-line hover:ring-brand/40"}`}
          >
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[14px] ${s.done ? "bg-ok text-white" : on ? "bg-white/20" : "bg-paper text-muted"}`}>
              {s.done ? <Icon name="check" size={16} /> : i + 1}
            </span>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

/** วันที่เริ่มใช้แบบอ่านง่าย (ค่าตั้งต้นของระบบเขียนว่า "ค่าเริ่มต้น") */
export function fromLabel(ymd: string): string {
  return ymd <= "2000-01-01" ? "ค่าเริ่มต้น" : thaiDate(ymd);
}
