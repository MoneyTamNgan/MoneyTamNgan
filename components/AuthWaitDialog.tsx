"use client";

import { useEffect, useRef, useState } from 'react';

export default function AuthWaitDialog({ until, onClose }: { until: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((until - Date.now()) / 1000)));
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const tick = () => setSeconds(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => { window.clearInterval(timer); element?.close(); };
  }, [until]);
  const remaining = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  return <dialog ref={dialog} className="auth-wait-dialog" aria-labelledby="auth-wait-title" aria-describedby="auth-wait-description" onCancel={onClose}>
    <div className="auth-wait-icon" aria-hidden="true">◷</div>
    <h2 id="auth-wait-title">{seconds ? 'กรุณารอสักครู่' : 'พร้อมเข้าสู่ระบบแล้ว'}</h2>
    <p id="auth-wait-description">{seconds ? 'มีการพยายามเข้าสู่ระบบหลายครั้ง กรุณารอแล้วลองอีกครั้ง' : 'คุณสามารถลองเข้าสู่ระบบอีกครั้งได้แล้ว'}</p>
    <div className="auth-wait-time" role="timer" aria-label={`เหลือเวลา ${Math.floor(seconds / 60)} นาที ${seconds % 60} วินาที`}>{remaining}</div>
    <p className="auth-wait-caption" role="status">{seconds ? 'เวลาที่เหลือก่อนลองอีกครั้ง' : 'หมดเวลารอแล้ว'}</p>
    <button type="button" onClick={onClose}>{seconds ? 'รับทราบ' : 'กลับไปเข้าสู่ระบบ'}</button>
  </dialog>;
}
