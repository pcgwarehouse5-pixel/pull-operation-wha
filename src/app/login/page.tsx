"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { codeToEmail, errText, sb } from "@/lib/supabase";
import { Alert, Button, Field, inputCls } from "@/components/ui";
import { Logo } from "@/components/AppShell";

export default function LoginPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // ล็อกอินค้างไว้แล้ว → ไปหน้าหลัก
  useEffect(() => {
    try {
      sb().auth.getSession().then(({ data }) => data.session && router.replace("/"));
    } catch {
      // ยังไม่ได้ตั้งค่า Supabase: แสดงฟอร์มไว้ก่อน
    }
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const { error } = await sb().auth.signInWithPassword({ email: codeToEmail(code), password });
      if (error) throw error;
      await sb().rpc("log_login");
      router.replace("/");
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand">
      <div className="px-5 pt-10 pb-8 sm:pt-16">
        <div className="mx-auto max-w-sm">
          <Logo onDark />
        </div>
      </div>
      <main className="flex-1 rounded-t-3xl bg-paper px-5 pt-8 pb-10 sm:mx-auto sm:mb-16 sm:w-full sm:max-w-md sm:flex-none sm:rounded-3xl">
        <h1 className="mb-1 text-2xl font-bold text-brand">เข้าสู่ระบบ</h1>
        <p className="mb-6 text-muted">ใช้รหัสพนักงานของคุณ</p>
        <form onSubmit={submit} className="space-y-4">
          <Field label="รหัสพนักงาน">
            <input
              className={inputCls}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="text"
              required
              autoFocus
            />
          </Field>
          <Field label="รหัสผ่าน">
            <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          {err && <Alert tone="error">{err}</Alert>}
          <Button type="submit" size="lg" className="w-full" disabled={busy || !code.trim() || !password}>
            {busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </Button>
        </form>
        <p className="mt-6 text-center text-[14px] text-muted">ลืมรหัสผ่าน? ติดต่อแอดมินคลังเพื่อรีเซ็ตให้</p>
      </main>
    </div>
  );
}
