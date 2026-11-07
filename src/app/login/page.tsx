"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { codeToEmail, sb } from "@/lib/supabase";
import { Alert, Button, Field, inputCls } from "@/components/ui";
import { Logo } from "@/components/AppShell";
import { Puinun } from "@/components/Puinun";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { localizeError, useI18n } from "@/i18n";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
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
      setErr(localizeError((e as Error)?.message ?? String(e), t));
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* ภาพปุยนุ่นในคลัง (จอใหญ่) */}
      <div className="relative hidden overflow-hidden bg-brand lg:block">
        <Image src="/mascot/scene-warehouse.jpg" alt="" fill priority sizes="50vw" className="object-cover object-[50%_35%]" />
        <div className="absolute inset-0 bg-gradient-to-t from-brand via-brand/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-10 text-white">
          <Logo onDark />
          <p className="mt-4 max-w-md text-lg leading-relaxed text-white/90">{t("login.greeting")}</p>
        </div>
        <span className="absolute inset-y-0 right-0 flex w-[5px] gap-[2px]" aria-hidden="true">
          <span className="w-[2px] bg-white/30" />
          <span className="w-[3px] bg-piping" />
        </span>
      </div>

      <div className="flex min-h-screen flex-col">
        <div className="flex items-center justify-between px-5 pt-5 lg:justify-end lg:px-10">
          <span className="lg:hidden">
            <Logo />
          </span>
          <LanguageSwitch />
        </div>

        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 pb-10">
          {/* ปุยนุ่นไหว้ทักทาย (มือถือ) */}
          <div className="mt-4 mb-2 flex items-end gap-3 rounded-[24px] bg-sky pr-4 pl-1 lg:hidden">
            <Puinun pose="wai" height={124} priority animate className="-mb-1" />
            <p className="pb-4 text-[15px] leading-snug text-brand">{t("login.greeting")}</p>
          </div>

          <h1 className="mt-6 text-[28px] leading-tight font-bold text-brand">{t("login.title")}</h1>
          <p className="mb-6 text-muted">{t("login.subtitle")}</p>
          <form onSubmit={submit} className="space-y-4">
            <Field label={t("login.code")}>
              <input
                className={`${inputCls} num text-lg`}
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
            <Field label={t("login.password")}>
              <input type="password" className={`${inputCls} text-lg`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </Field>
            {err && <Alert tone="error">{err}</Alert>}
            <Button type="submit" size="lg" className="w-full" disabled={busy || !code.trim() || !password}>
              {busy ? t("login.submitting") : t("login.submit")}
            </Button>
          </form>
          <p className="mt-6 text-center text-[14px] text-muted">{t("login.forgot")}</p>
        </main>
      </div>
    </div>
  );
}
