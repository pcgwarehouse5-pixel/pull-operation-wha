"use client";

// ขอแก้เวลา (ลืมกด / GPS ใช้ไม่ได้) — หัวหน้างานยื่นแทนพนักงานได้ (ส่ง userId)
import { useState } from "react";
import { useApp } from "../AuthProvider";
import { Alert, Button, Field, Modal, inputCls } from "../ui";
import { errText, sb } from "@/lib/supabase";
import { todayIso } from "@/lib/shifts";

export function CorrectionModal({
  date, userId, who, onClose, onDone,
}: {
  date: string;
  userId?: string;
  who?: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const { demo } = useApp();
  const [d, setD] = useState(date);
  const [tin, setTin] = useState("");
  const [tout, setTout] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    setErr("");
    if (!tin && !tout) return setErr("ใส่เวลาเข้าหรือเวลาออกอย่างน้อย 1 อย่าง");
    if (!reason.trim()) return setErr("กรุณาระบุเหตุผล");
    if (demo) return onDone("โหมดดูดีไซน์: ไม่ได้ส่งจริง");
    setBusy(true);
    const { error } = await sb().rpc("request_correction", { p_date: d, p_in: tin || null, p_out: tout || null, p_reason: reason.trim(), p_user: userId ?? null });
    setBusy(false);
    if (error) return setErr(errText(error));
    onDone("ส่งคำขอแก้เวลาแล้ว รอหัวหน้างานอนุมัติ");
  }

  return (
    <Modal title={who ? `ขอแก้เวลาแทน ${who}` : "ขอแก้เวลา"} onClose={onClose}>
      <p className="-mt-2 mb-3 text-[15px] text-muted">ใช้เมื่อลืมกด หรือกดไม่ได้ (เช่น GPS มีปัญหา) หัวหน้างานอนุมัติแล้วเวลาจะถูกบันทึกและล็อก</p>
      <div className="space-y-3">
        <Field label="วันที่ทำงาน (วันที่เริ่มกะ)">
          <input type="date" className={inputCls} value={d} max={todayIso()} onChange={(e) => setD(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="เวลาเข้า">
            <input type="time" className={inputCls} value={tin} onChange={(e) => setTin(e.target.value)} />
          </Field>
          <Field label="เวลาออก" hint="กะดึกใส่เวลาออกตอนเช้าได้เลย">
            <input type="time" className={inputCls} value={tout} onChange={(e) => setTout(e.target.value)} />
          </Field>
        </div>
        <Field label="เหตุผล">
          <textarea className={`${inputCls} min-h-20 py-2`} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ลืมกดออก / โทรศัพท์แบตหมด" />
        </Field>
        {err && <Alert tone="error">{err}</Alert>}
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>ยกเลิก</Button>
        <Button className="flex-1" onClick={send} disabled={busy}>{busy ? "กำลังส่ง..." : "ส่งคำขอ"}</Button>
      </div>
    </Modal>
  );
}
