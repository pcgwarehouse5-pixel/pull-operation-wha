"use client";

import { type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-2 active:translate-y-px disabled:bg-[#a9b4d0]",
  secondary: "bg-white text-brand ring-1 ring-inset ring-line hover:bg-[#f6f8fc] hover:ring-brand/40 disabled:text-muted/60",
  danger: "bg-bad text-white hover:bg-[#a61b22] active:translate-y-px disabled:bg-[#e7a3a6]",
  ghost: "bg-transparent text-brand hover:bg-brand/5",
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
      className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition disabled:cursor-not-allowed ${sz} ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-4 ring-1 ring-line sm:p-5 ${className}`}>{children}</div>;
}

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "warning" | "success"; children: ReactNode }) {
  const cls = {
    info: "bg-[#eaf0fb] text-brand border-brand",
    error: "bg-[#fcecec] text-[#8f141a] border-bad",
    warning: "bg-[#fdf5e2] text-[#6d4a0c] border-warn",
    success: "bg-[#eaf5ee] text-[#155c33] border-ok",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-r-xl border-l-4 px-4 py-3 ${cls}`}>
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
  "w-full min-h-12 rounded-xl border border-line bg-white px-3.5 text-base text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10 disabled:bg-paper disabled:text-muted";

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0b1530]/50 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line sm:hidden" aria-hidden="true" />
        <h2 className="mb-4 text-xl font-bold text-brand">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Loading({ text = "กำลังโหลด..." }: { text?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-muted" role="status">
      <span className="h-8 w-8 animate-spin rounded-full border-4 border-line border-t-brand" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

export function PageIntro({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-2xl font-bold leading-tight text-brand">{title}</h2>
        {children && <div className="mt-1 text-[15px] text-muted">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "blue" | "green" | "amber" | "red" }) {
  const cls = {
    slate: "bg-paper text-muted ring-line",
    blue: "bg-[#eaf0fb] text-brand ring-[#c7d4f0]",
    green: "bg-[#e3f3e9] text-ok ring-[#a9d8bb]",
    amber: "bg-[#fdf2d6] text-[#7a5410] ring-[#f0d48f]",
    red: "bg-[#fce6e7] text-bad ring-[#f3b8bb]",
  }[tone];
  return <span className={`inline-flex items-center whitespace-nowrap rounded-lg px-2 py-0.5 text-[13px] font-semibold ring-1 ring-inset ${cls}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl bg-white px-4 py-10 text-center text-muted ring-1 ring-line">{children}</p>;
}
