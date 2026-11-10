"use client";

// ผู้จัดการฝ่ายขึ้นไปไม่ลงเวลา ไม่อยู่ในตารางกะ ไม่ใช้ระบบลา: เปิดหน้าลงเวลา/ลา/กะของฉัน จะเห็นคำอธิบายแทน
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Empty } from "@/components/ui";
import { useI18n } from "@/i18n";
import { noTimekeeping } from "@/lib/types";

export function NoTimekeepingGuard({ children }: { children: ReactNode }) {
  const { profile } = useApp();
  const { t } = useI18n();
  if (!noTimekeeping(profile.role)) return <>{children}</>;
  return (
    <AppShell title={t("guard.title")}>
      <Empty>{t("guard.notice")}</Empty>
    </AppShell>
  );
}
