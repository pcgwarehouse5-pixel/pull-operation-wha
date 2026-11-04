"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/AuthProvider";
import { Alert, Button, Card, Field, inputCls } from "@/components/ui";
import { Logo } from "@/components/AppShell";
import { api, codeToEmail, sb } from "@/lib/supabase";
import { passwordProblem } from "@/lib/types";

export default function ChangePasswordPage() {
  const { profile, reload, signOut, preview } = useApp();
  const router = useRouter();
  const forced = profile.must_change_password;
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const problem = pw ? passwordProblem(pw, profile.employee_code) : null;
  const mismatch = !!pw2 && pw !== pw2;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem || mismatch) return;
    setBusy(true);
    setErr("");
    try {
      if (!preview) {
        await api("/api/me/password", "POST", { password: pw });
        // เปลี่ยนรหัสแล้ว Supabase ยกเลิกการล็อกอินเดิม จึงล็อกอินใหม่ให้ด้วยรหัสที่เพิ่งตั้ง
        const { error } = await sb().auth.signInWithPassword({ email: codeToEmail(profile.employee_code), password: pw });
        if (error) {
          await signOut();
          return;
        }
      }
      setDone(true);
      await reload();
      setTimeout(() => router.replace("/"), 1200);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-brand px-4 py-4">
        <div className="mx-auto flex max-w-md items-center justify-between">
          <Logo onDark />
          {!forced && (
            <Link href="/profile" className="rounded-lg px-3 py-2 text-white/90 hover:bg-white/10">ยกเลิก</Link>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-6">
        <h1 className="text-2xl font-bold text-brand">{forced ? "ตั้งรหัสผ่านใหม่ก่อนใช้งาน" : "เปลี่ยนรหัสผ่าน"}</h1>
        {forced && (
          <p className="mt-1 text-muted">
            คุณ{profile.first_name_th} ยังใช้รหัสผ่านเริ่มต้นอยู่ เพื่อป้องกันคนอื่นเข้าบัญชีของคุณ กรุณาตั้งรหัสผ่านของตัวเองก่อน
          </p>
        )}
        <Card className="mt-5">
          {done ? (
            <Alert tone="success">ตั้งรหัสผ่านใหม่แล้ว กำลังพาไปหน้าหลัก...</Alert>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 8 ตัว ไม่ใช้เลขเรียง และไม่มีรหัสพนักงานอยู่ในรหัสผ่าน">
                <input type={show ? "text" : "password"} className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required autoFocus />
              </Field>
              <Field label="พิมพ์รหัสผ่านใหม่อีกครั้ง">
                <input type={show ? "text" : "password"} className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required />
              </Field>
              <label className="flex min-h-11 items-center gap-2 text-[15px]">
                <input type="checkbox" className="h-5 w-5" checked={show} onChange={(e) => setShow(e.target.checked)} />
                แสดงรหัสผ่าน
              </label>
              {problem && <Alert tone="warning">{problem}</Alert>}
              {mismatch && <Alert tone="warning">รหัสผ่านทั้ง 2 ช่องไม่ตรงกัน</Alert>}
              {err && <Alert tone="error">{err}</Alert>}
              <Button type="submit" size="lg" className="w-full" disabled={busy || !pw || !pw2 || !!problem || mismatch}>
                {busy ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}
              </Button>
            </form>
          )}
        </Card>
        {forced && (
          <button onClick={signOut} className="mt-6 w-full text-center text-[15px] text-muted underline">
            ไม่ใช่บัญชีของคุณ? ออกจากระบบ
          </button>
        )}
      </main>
    </div>
  );
}
