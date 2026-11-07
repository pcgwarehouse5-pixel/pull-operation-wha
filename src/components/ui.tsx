"use client";

// ส่วนประกอบหน้าจอที่ใช้ทั้งแอป (สีจากเสื้อโปโลปุยนุ่น: กรมท่า + แถบแดง)
import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import { Puinun, type Pose } from "./Puinun";

type Variant = "primary" | "secondary" | "danger" | "ghost";

// ปุ่มแบบมีขอบล่างหนา กดแล้วยุบลง ให้รู้สึกเหมือนกดปุ่มจริง
const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-white border-b-[3px] border-brand-deep hover:bg-brand-2 active:translate-y-[2px] active:border-b-[1px] disabled:bg-[#a7b0cc] disabled:border-[#8e98b8]",
  secondary: "bg-white text-brand ring-1 ring-inset ring-line border-b-[3px] border-[#cfd6e6] hover:ring-brand/40 active:translate-y-[2px] active:border-b-[1px] disabled:text-muted/60",
  danger: "bg-bad text-white border-b-[3px] border-[#8f1420] hover:bg-[#b01c2a] active:translate-y-[2px] active:border-b-[1px] disabled:bg-[#e3a2a8] disabled:border-[#d58c93]",
  ghost: "bg-transparent text-brand hover:bg-brand/6",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sz = size === "lg" ? "min-h-14 px-6 text-[17px]" : size === "sm" ? "min-h-10 px-3.5 text-[15px]" : "min-h-12 px-5 text-base";
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] font-semibold transition-[transform,background-color] duration-75 disabled:cursor-not-allowed disabled:active:translate-y-0 ${sz} ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[20px] bg-white p-4 ring-1 ring-line sm:p-5 ${className}`}>{children}</div>;
}

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "warning" | "success"; children: ReactNode }) {
  const cls = {
    info: "bg-sky text-brand",
    error: "bg-[#fdecee] text-[#8f1420]",
    warning: "bg-[#fff6d6] text-[#6b4e00]",
    success: "bg-[#e5f5ec] text-[#14603c]",
  }[tone];
  const bar = { info: "bg-brand", error: "bg-bad", warning: "bg-warn", success: "bg-ok" }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`relative overflow-hidden rounded-2xl py-3 pr-4 pl-5 ${cls}`}>
      <span className={`absolute inset-y-0 left-0 w-1.5 ${bar}`} aria-hidden="true" />
      {children}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[15px] font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[13px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full min-h-12 rounded-[14px] border-2 border-line bg-white px-3.5 text-base text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10 disabled:bg-paper disabled:text-muted";

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0b1433]/55 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-[0_-8px_30px_rgba(17,28,65,0.18)] sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line sm:hidden" aria-hidden="true" />
        <h2 className="mb-4 text-xl font-bold text-brand">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Loading({ text }: { text?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-muted" role="status">
      <span className="h-9 w-9 animate-spin rounded-full border-4 border-line border-t-brand" aria-hidden="true" />
      <span>{text ?? t("common.loading")}</span>
    </div>
  );
}

export function PageIntro({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-2xl leading-tight font-bold text-brand">{title}</h2>
        {children && <div className="mt-1 text-[15px] text-muted">{children}</div>}
      </div>
      {action}
    </div>
  );
}

// ป้ายสถานะแบบป้ายตำแหน่งชั้นวางในคลัง: แถบสีด้านซ้าย + ข้อความ
export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "blue" | "green" | "amber" | "red" }) {
  const cls = {
    slate: "bg-paper text-muted ring-line",
    blue: "bg-sky text-brand ring-[#c9d6f0]",
    green: "bg-[#e5f5ec] text-[#14603c] ring-[#b4dfc6]",
    amber: "bg-[#fff6d6] text-[#6b4e00] ring-[#f3dc8a]",
    red: "bg-[#fdecee] text-[#8f1420] ring-[#f2bcc2]",
  }[tone];
  const bar = { slate: "bg-[#a9b2c8]", blue: "bg-brand", green: "bg-ok", amber: "bg-warn", red: "bg-bad" }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 overflow-hidden rounded-md py-0.5 pr-2 text-[13px] font-semibold whitespace-nowrap ring-1 ring-inset ${cls}`}>
      <span className={`h-full min-h-[22px] w-1 self-stretch ${bar}`} aria-hidden="true" />
      {children}
    </span>
  );
}

/** ไม่มีข้อมูล: ปุยนุ่นทำท่าสงสัย พร้อมข้อความบอกว่าทำอะไรต่อได้ */
export function Empty({ children, pose = "ask" }: { children: ReactNode; pose?: Pose }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[20px] bg-white px-4 pt-5 pb-7 text-center text-muted ring-1 ring-line">
      <Puinun pose={pose} height={96} />
      <div className="max-w-sm">{children}</div>
    </div>
  );
}
