"use client";

// ใส่เหตุผลก่อนไม่อนุมัติ (ใช้ทั้งคำขอแก้เวลาและใบลา)
import { useState } from "react";
import { Button, Field, Modal, inputCls } from "../ui";

export function RejectModal({ title, label = "เหตุผล (แจ้งให้พนักงานทราบ)", okText = "ยืนยันไม่อนุมัติ", onClose, onOk, busy }: {
  title: string;
  label?: string;
  okText?: string;
  onClose: () => void;
  onOk: (note: string) => void;
  busy?: boolean;
}) {
  const [note, setNote] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <Field label={label}>
        <textarea className={`${inputCls} min-h-20 py-2`} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>ปิด</Button>
        <Button variant="danger" className="flex-1" disabled={busy || !note.trim()} onClick={() => onOk(note.trim())}>{okText}</Button>
      </div>
    </Modal>
  );
}
