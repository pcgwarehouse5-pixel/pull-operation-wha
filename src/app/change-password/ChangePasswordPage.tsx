"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/AuthProvider";
import { Alert, Button, Card, Field, inputCls } from "@/components/ui";
import { Logo } from "@/components/AppShell";
import { Puinun } from "@/components/Puinun";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { api, codeToEmail, sb } from "@/lib/supabase";
import { passwordProblemKey } from "@/lib/types";
import { localizeError, useI18n } from "@/i18n";

export default function ChangePasswordPage() {
  const { profile, reload, signOut, preview } = useApp();
  const { t } = useI18n();
  const router = useRouter();
  const forced = profile.must_change_password;
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const problem = pw ? passwordProblemKey(pw, profile.employee_code) : null;
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
      setErr(localizeError((e as Error).message, t));
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="relative bg-brand px-4 pt-4 pb-5">
        <div className="mx-auto flex max-w-md items-center justify-between gap-2">
          <Logo onDark />
          <div className="flex items-center gap-1">
            <LanguageSwitch onDark />
            {!forced && (
              <Link href="/profile" className="rounded-lg px-3 py-2 text-white/90 hover:bg-white/10">{t("common.cancel")}</Link>
            )}
          </div>
        </div>
        <span className="absolute inset-x-0 bottom-0 flex h-[5px] flex-col gap-[2px]" aria-hidden="true">
          <span className="h-[2px] bg-white/25" />
          <span className="h-[3px] bg-piping" />
        </span>
      </header>
      <main className="mx-auto max-w-md px-4 py-6">
        <div className="mb-4 flex items-end gap-2 rounded-[22px] bg-sky pr-4 pl-1">
          <Puinun pose={done ? "happy" : "please"} height={112} animate className="-mb-1" />
          <div className="pb-3.5">
            <h1 className="text-[22px] leading-tight font-bold text-brand">{forced ? t("pw.titleForced") : t("pw.titleChange")}</h1>
            {forced && <p className="mt-1 text-[14px] leading-snug text-ink/80">{t("pw.forcedIntro", { name: profile.first_name_th })}</p>}
          </div>
        </div>
        <Card>
          {done ? (
            <Alert tone="success">{t("pw.done")}</Alert>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <Field label={t("pw.new")} hint={t("pw.newHint")}>
                <input type={show ? "text" : "password"} className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required autoFocus />
              </Field>
              <Field label={t("pw.confirm")}>
                <input type={show ? "text" : "password"} className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required />
              </Field>
              <label className="flex min-h-11 items-center gap-2 text-[15px]">
                <input type="checkbox" className="h-5 w-5 accent-brand" checked={show} onChange={(e) => setShow(e.target.checked)} />
                {t("pw.show")}
              </label>
              {problem && <Alert tone="warning">{t(problem)}</Alert>}
              {mismatch && <Alert tone="warning">{t("pw.mismatch")}</Alert>}
              {err && <Alert tone="error">{err}</Alert>}
              <Button type="submit" size="lg" className="w-full" disabled={busy || !pw || !pw2 || !!problem || mismatch}>
                {busy ? t("common.saving") : t("pw.submit")}
              </Button>
            </form>
          )}
        </Card>
        {forced && (
          <button onClick={signOut} className="mt-6 w-full text-center text-[15px] text-muted underline">
            {t("pw.notYou")}
          </button>
        )}
      </main>
    </div>
  );
}
