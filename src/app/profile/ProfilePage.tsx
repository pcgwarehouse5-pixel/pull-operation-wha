"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Button, Card, Field, inputCls } from "@/components/ui";
import { PageHelper } from "@/components/Puinun";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { sb } from "@/lib/supabase";
import { fullName } from "@/lib/types";
import { localizeError, useI18n } from "@/i18n";
import type { MsgKey } from "@/i18n/th";

export default function ProfilePage() {
  const { profile, warehouses, reload, preview, signOut } = useApp();
  const { t } = useI18n();
  const [nickname, setNickname] = useState(profile.nickname ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [lineId, setLineId] = useState(profile.line_id ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const wh = warehouses.find((w) => w.id === profile.warehouse_id);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (phone && !/^[0-9+\- ]{6,20}$/.test(phone)) {
      setMsg({ tone: "error", text: t("pf.phoneBad") });
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
      setMsg({ tone: "success", text: t("common.saved") });
    } catch (e) {
      setMsg({ tone: "error", text: localizeError((e as Error).message ?? String(e), t) });
    } finally {
      setBusy(false);
    }
  }

  const info: [string, string][] = [
    [t("pf.code"), profile.employee_code],
    [t("pf.name"), fullName(profile)],
    [t("pf.position"), profile.position ?? "-"],
    [t("pf.warehouse"), wh ? `${wh.code} ${wh.name}` : "-"],
    [t("pf.role"), t(`role.${profile.role}` as MsgKey)],
  ];

  return (
    <AppShell title={t("pf.title")}>
      <PageHelper pose="hello" title={t("pf.title")}>
        {t("pf.helper")}
      </PageHelper>
      <Card className="mb-4">
        <dl className="divide-y divide-line">
          {info.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[13px] text-muted">{t("pf.adminNote")}</p>
      </Card>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-brand">{t("pf.language")}</h2>
          <LanguageSwitch />
        </div>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-3 text-lg font-bold text-brand">{t("pf.contact")}</h2>
        <form onSubmit={save} className="space-y-4">
          <Field label={t("pf.nickname")}>
            <input className={inputCls} value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={30} />
          </Field>
          <Field label={t("pf.phone")}>
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={20} />
          </Field>
          <Field label={t("pf.line")}>
            <input className={inputCls} value={lineId} onChange={(e) => setLineId(e.target.value)} maxLength={50} autoCapitalize="none" />
          </Field>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <Button type="submit" className="w-full sm:w-auto" disabled={busy}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold text-brand">{t("pf.password")}</h2>
        <p className="mb-3 text-muted">{t("pf.passwordNote")}</p>
        <Link
          href="/change-password"
          className="inline-flex min-h-12 items-center rounded-[14px] border-b-[3px] border-[#cfd6e6] bg-white px-5 font-semibold text-brand ring-1 ring-line ring-inset hover:ring-brand/40"
        >
          {t("pf.changePassword")}
        </Link>
      </Card>

      {/* ออกจากระบบ (อีกทางหนึ่ง นอกจากเมนู) */}
      <button onClick={signOut} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-bad ring-1 ring-line">
        <Icon name="logout" size={20} /> {t("common.logout")}
      </button>
    </AppShell>
  );
}
