import type { ReactNode } from "react";
import { ModuleGuard } from "@/components/ModuleGuard";

// ทุกหน้าใต้ /pull ใช้ได้เฉพาะหน่วยงานที่เปิดเมนู Pull Operation
export default function PullLayout({ children }: { children: ReactNode }) {
  return <ModuleGuard module="pull">{children}</ModuleGuard>;
}
