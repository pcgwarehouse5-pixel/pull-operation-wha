"use client";

// ฟอร์มยื่นใบลา (พนักงานยื่นเอง หรือหัวหน้างานยื่นแทน: ส่ง userId)
import { useEffect, useState } from "react";
import { useApp } from "../AuthProvider";
import { Alert, Button, Field, Modal, inputCls } from "../ui";
import { errText, sb } from "@/lib/supabase";
import { useOptions } from "@/lib/useOptions";
import { todayIso } from "@/lib/shifts";
import { PERIOD_LABEL } from "@/lib/attendance";

const MAX_FILE = 5 * 1024 * 1024;
const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export function LeaveForm({ userId, who, onClose, onDone }: { userId?: string; who?: string; onClose: () => void; onDone: (text: string) => void }) {
  const { profile: me, demo } = useApp();
  const opts = useOptions(["leave_type"]);
  const types = (demo ? demo.PREVIEW_LEAVE_TYPES : (opts.leave_type ?? [])).filter((o) => o.is_active);
  const [type, setType] = useState("");
  const [start, setStart] = useState(todayIso);
  const [end, setEnd] = useState(todayIso);
  const [period, setPeriod] = useState<"full" | "morning" | "afternoon">("full");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [attachTypes, setAttachTypes] = useState<string[]>([]);
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const forSelf = !userId || userId === me.id;
  const leaveType = type || types[0]?.value || "";
  const canAttach = forSelf && attachTypes.includes(leaveType);
  const oneDay = start === end;

  useEffect(() => {
    if (demo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- โหมดดูดีไซน์
      setAttachTypes(["sick"]);
      return;
    }
    sb()
      .rpc("setting", { p_key: "leave.attachment_types" })
      .then(({ data }) => setAttachTypes(Array.isArray(data) ? (data as string[]) : []));
  }, [demo]);

  // จำนวนวันลาตามตารางกะ (คำนวณในฐานข้อมูล)
  useEffect(() => {
    if (!start || !end || end < start) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ช่วงวันที่ยังไม่ครบ
      setDays(null);
      return;
    }
    const p = oneDay ? period : "full";
    if (demo) {
      setDays(p === "full" ? (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1 : 0.5);
      return;
    }
    let live = true;
    sb()
      .rpc("leave_days_preview", { p_start: start, p_end: end, p_period: p, p_user: userId ?? null })
      .then(({ data, error }) => live && setDays(error ? null : Number(data)));
    return () => {
      live = false;
    };
  }, [start, end, period, oneDay, userId, demo]);

  function pickFile(f?: File) {
    setErr("");
    if (!f) return setFile(null);
    if (!FILE_TYPES.includes(f.type)) return setErr("แนบได้เฉพาะรูปภาพ (JPG, PNG, WEBP) หรือ PDF");
    if (f.size > MAX_FILE) return setErr("ไฟล์ใหญ่เกิน 5 MB");
    setFile(f);
  }

  async function submit() {
    setErr("");
    if (!leaveType) return setErr("เลือกประเภทการลา");
    if (end < start) return setErr("วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม");
    if (days !== null && days <= 0) return setErr("ช่วงวันที่เลือกไม่มีวันทำงานตามตารางกะ");
    if (demo) return onDone("โหมดดูดีไซน์: ไม่ได้ส่งจริง");
    setBusy(true);
    let path: string | null = null;
    if (file && canAttach) {
      const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1].replace("jpeg", "jpg");
      path = `${me.id}/${crypto.randomUUID()}.${ext}`;
      const up = await sb().storage.from("leave-attachments").upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) {
        setBusy(false);
        return setErr(`อัปโหลดไฟล์ไม่สำเร็จ: ${errText(up.error)}`);
      }
    }
    const { error } = await sb().rpc("submit_leave", {
      p_type: leaveType,
      p_start: start,
      p_end: end,
      p_period: oneDay ? period : "full",
      p_reason: reason.trim() || null,
      p_attachment: path,
      p_user: userId ?? null,
    });
    setBusy(false);
    if (error) {
      if (path) await sb().storage.from("leave-attachments").remove([path]);
      return setErr(errText(error));
    }
    onDone("ส่งใบลาแล้ว รออนุมัติ");
  }

  return (
    <Modal title={who ? `ยื่นใบลาแทน ${who}` : "ยื่นใบลา"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="ประเภทการลา">
          <select className={inputCls} value={leaveType} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ตั้งแต่วันที่">
            <input type="date" className={inputCls} value={start} onChange={(e) => (setStart(e.target.value), e.target.value > end && setEnd(e.target.value))} />
          </Field>
          <Field label="ถึงวันที่">
            <input type="date" className={inputCls} value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        {oneDay && (
          <div className="flex gap-1.5" role="radiogroup" aria-label="ช่วงเวลา">
            {(["full", "morning", "afternoon"] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={period === p}
                onClick={() => setPeriod(p)}
                className={`min-h-11 flex-1 rounded-xl text-[15px] font-semibold ${period === p ? "bg-brand text-white" : "bg-white ring-1 ring-line"}`}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
        )}
        <p className="rounded-xl bg-paper px-3 py-2 text-[15px]">
          จำนวนวันลา: <b>{days === null ? "-" : `${days} วัน`}</b>
          <span className="block text-[13px] text-muted">นับเฉพาะวันทำงานตามตารางกะ (ไม่นับวันหยุด OFF/HOL)</span>
        </p>
        <Field label="เหตุผล">
          <textarea className={`${inputCls} min-h-20 py-2`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {canAttach && (
          <Field label="แนบใบรับรองแพทย์ (ถ้ามี)" hint="รูปภาพหรือ PDF ไม่เกิน 5 MB · เห็นเฉพาะคุณ หัวหน้า และผู้อนุมัติ">
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className={`${inputCls} py-2.5`} onChange={(e) => pickFile(e.target.files?.[0])} />
          </Field>
        )}
        {err && <Alert tone="error">{err}</Alert>}
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>ยกเลิก</Button>
        <Button className="flex-1" onClick={submit} disabled={busy}>{busy ? "กำลังส่ง..." : "ส่งใบลา"}</Button>
      </div>
    </Modal>
  );
}

/** เปิดไฟล์แนบด้วยลิงก์ชั่วคราว 60 วินาที (ไฟล์อยู่ในที่เก็บแบบปิด) */
export async function openAttachment(path: string): Promise<string | null> {
  const { data, error } = await sb().storage.from("leave-attachments").createSignedUrl(path, 60);
  if (error || !data) return errText(error ?? "เปิดไฟล์ไม่ได้");
  window.open(data.signedUrl, "_blank", "noopener");
  return null;
}
