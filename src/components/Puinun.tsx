"use client";

// ปุยนุ่น มาสคอตประจำคลัง — ภาพพื้นขาว ใช้บนพื้นสีอ่อนเท่านั้น (class .mascot ทำให้พื้นขาวกลืนไปกับพื้นหลัง)
import Image from "next/image";
import type { ReactNode } from "react";

export type Pose =
  | "wai" | "wave" | "happy" | "run" | "point" | "docs" | "paper" | "fight"
  | "ask" | "think" | "team" | "oops" | "sad" | "hello" | "please";

// ขนาดจริงของไฟล์ (กว้าง x สูง) ใน public/mascot
const SIZE: Record<Pose, [number, number]> = {
  wai: [356, 520], wave: [383, 520], happy: [339, 520], run: [462, 520], point: [402, 520], docs: [351, 520],
  paper: [352, 520], fight: [375, 520], ask: [332, 520], think: [342, 520], team: [520, 423], oops: [345, 520],
  sad: [365, 520], hello: [384, 520], please: [336, 520],
};

export function Puinun({ pose, height = 120, className = "", priority, animate }: { pose: Pose; height?: number; className?: string; priority?: boolean; animate?: boolean }) {
  const [w, h] = SIZE[pose];
  return (
    <Image
      src={`/mascot/${pose}.jpg`}
      alt=""
      width={Math.round((w / h) * height)}
      height={height}
      priority={priority}
      className={`mascot shrink-0 ${animate ? "puinun-in" : ""} ${className}`}
      aria-hidden="true"
    />
  );
}

/** แถบผู้ช่วยปุยนุ่นบนหัวหน้า: ท่าทางตามหน้า + คำอธิบายสั้นๆ ว่าหน้านี้ทำอะไร */
export function PageHelper({ pose, title, children, action }: { pose: Pose; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className="relative mb-4 flex items-end gap-2 overflow-hidden rounded-[22px] bg-sky pr-4 pl-1 print:hidden">
      <Puinun pose={pose} height={112} animate className="-mb-1" />
      <div className="min-w-0 flex-1 py-3.5">
        <h1 className="text-[22px] leading-tight font-bold text-brand sm:text-2xl">{title}</h1>
        {children && <p className="mt-1 text-[14px] leading-snug text-ink/80 sm:text-[15px]">{children}</p>}
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </section>
  );
}
