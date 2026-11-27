"use client";

// เมนูเสริมตามหน่วยงาน (เช่น Pull Operation): หน่วยงานที่ไม่ได้เปิดใช้ จะเห็นคำอธิบายแทน และไม่โหลดข้อมูลของหน้านั้น
// (ฐานข้อมูลกันซ้ำอีกชั้นด้วยกฎหน่วยงาน migration 0034)
import type { ReactNode } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Empty } from "@/components/ui";
import { useI18n } from "@/i18n";
import type { UnitModule } from "@/lib/types";

export function ModuleGuard({ module, children }: { module: UnitModule; children: ReactNode }) {
  const { modules } = useApp();
  const { t } = useI18n();
  if (modules.includes(module)) return <>{children}</>;
  return (
    <AppShell title={t("guard.module.title")}>
      <Empty>
        {t("guard.module.notice")}{" "}
        <Link href="/" className="font-semibold underline">{t("common.goHome")}</Link>
      </Empty>
    </AppShell>
  );
}
