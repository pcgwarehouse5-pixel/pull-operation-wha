"use client";

// แถบบันทึกลอยด้านล่าง (โผล่เมื่อมีค่าที่ยังไม่บันทึก) ตำแหน่งเดียวกับหน้าตารางกะ
import type { ReactNode } from "react";
import { Button } from "@/components/ui";

export function SaveBar({ text, busy, onCancel, onSave, children, className = "", saveLabel = "บันทึก" }: { text: string; busy: boolean; onCancel: () => void; onSave: () => void; children?: ReactNode; className?: string; saveLabel?: string }) {
  return (
    <div className={`fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 px-3 lg:bottom-4 lg:left-64 ${className}`}>
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-line">
        <span className="min-w-0 flex-1 text-[15px] font-semibold text-ink">{text}</span>
        {children}
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>ยกเลิก</Button>
        <Button size="sm" onClick={onSave} disabled={busy}>{busy ? "กำลังบันทึก…" : saveLabel}</Button>
      </div>
    </div>
  );
}
