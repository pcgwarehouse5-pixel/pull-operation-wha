"use client";

// วันหยุดประจำปี: หัวหน้างานขึ้นไปดูได้ · แอดมินคลังขึ้นไปเพิ่ม/แก้/ลบ/คัดลอกจากปีก่อน
import { AppShell } from "@/components/AppShell";
import { HolidaysManager } from "@/components/HolidaysManager";
import { PageHelper } from "@/components/Puinun";

export default function HolidaysPage() {
  return (
    <AppShell title="วันหยุดประจำปี" minRole="supervisor">
      <PageHelper pose="docs" title="วันหยุดประจำปี">
        ตั้งวันหยุดตามประกาศของบริษัท ตารางกะจะแสดงวันหยุดให้เอง และคิด OT ให้คนที่ต้องมาทำงาน
      </PageHelper>
      <HolidaysManager />
    </AppShell>
  );
}
