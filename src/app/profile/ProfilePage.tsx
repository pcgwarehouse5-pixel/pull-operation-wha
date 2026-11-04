"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Button, Card, Field, inputCls } from "@/components/ui";
import { errText, sb } from "@/lib/supabase";
import { ROLE_LABEL, fullName } from "@/lib/types";

export default function ProfilePage() {
  const { profile, warehouses, reload, preview } = useApp();
  const [nickname, setNickname] = useState(profile.nickname ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [lineId, setLineId] = useState(profile.line_id ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const wh = warehouses.find((w) => w.id === profile.warehouse_id);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (phone && !/^[0-9+\- ]{6,20}$/.test(phone)) {
      setMsg({ tone: "error", text: "เบอร์โทรใช้ได้เฉพาะตัวเลข" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (!preview) {
        const { error } = await sb()
          .from("profiles")
          .update({ nickname: nickname.trim() || null, phone: phone.trim() || null, line_id: lineId.trim() || null })
          .eq("id", profile.id);
        if (error) throw error;
        await reload();
      }
      setMsg({ tone: "success", text: "บันทึกแล้ว" });
    } catch (e) {
      setMsg({ tone: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  const info: [string, string][] = [
    ["รหัสพนักงาน", profile.employee_code],
    ["ชื่อ-นามสกุล", fullName(profile)],
    ["ตำแหน่ง", profile.position ?? "-"],
    ["คลัง", wh ? `${wh.code} ${wh.name}` : "-"],
    ["บทบาท", ROLE_LABEL[profile.role]],
  ];

  return (
    <AppShell title="ข้อมูลของฉัน">
      <Card className="mb-4">
        <dl className="divide-y divide-line">
          {info.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[13px] text-muted">ข้อมูลข้างบนแก้ได้โดยแอดมินคลัง ถ้าไม่ถูกต้องให้แจ้งแอดมิน</p>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-3 text-lg font-bold text-brand">ข้อมูลติดต่อ</h2>
        <form onSubmit={save} className="space-y-4">
          <Field label="ชื่อเล่น">
            <input className={inputCls} value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={30} />
          </Field>
          <Field label="เบอร์โทร">
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={20} />
          </Field>
          <Field label="LINE ID">
            <input className={inputCls} value={lineId} onChange={(e) => setLineId(e.target.value)} maxLength={50} autoCapitalize="none" />
          </Field>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <Button type="submit" className="w-full sm:w-auto" disabled={busy}>
            {busy ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold text-brand">รหัสผ่าน</h2>
        <p className="mb-3 text-muted">เปลี่ยนรหัสผ่านได้ตลอดเวลา ไม่ต้องรอแอดมิน</p>
        <Link href="/change-password" className="inline-flex min-h-12 items-center rounded-xl bg-white px-5 font-semibold text-brand ring-1 ring-inset ring-line hover:bg-[#f6f8fc]">
          เปลี่ยนรหัสผ่าน
        </Link>
      </Card>
    </AppShell>
  );
}
