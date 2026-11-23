'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { NO_EGP_SUBMISSION_NOTICE_TH } from '@/lib/bid-prep/notices';
import { useTorChecklist } from './TorChecklistProvider';

const DECISIONS = [
    ['pass', 'ผ่าน'],
    ['fail', 'ไม่ผ่าน'],
];
const STATUSES = [
    ...DECISIONS,
    ['manual', 'ตรวจสอบเอง'],
];
const PROFILE_FIELDS = {
    company_name: 'ชื่อบริษัท',
    skills: 'ทักษะและเทคโนโลยี',
    registered_capital: 'ทุนจดทะเบียน',
    highest_past_project_value: 'มูลค่าผลงานที่ผ่านมา',
    concurrent_project_capacity: 'จำนวนโครงการที่รองรับพร้อมกัน',
    certifications: 'ใบรับรองและมาตรฐาน',
};

function errorMessage(error) {
    if (error.code === 'TOR_DOCUMENT_UNREADABLE') return 'ไม่สามารถอ่านข้อความใน TOR ได้ กรุณาตรวจสอบเอกสารต้นฉบับ';
    if (error.status === 409) return 'รายการตรวจสอบจะพร้อมเมื่อประมวลผล TOR เสร็จ';
    if (error.status === 404) return 'ไม่พบข้อมูลสำหรับรายการตรวจสอบของ TOR นี้';
    if (error.status === 401) return 'กรุณาเข้าสู่ระบบเพื่อดูรายการตรวจสอบ';
    if (error.status === 429) return 'มีคำขอมากเกินไป กรุณารอสักครู่แล้วลองอีกครั้ง';
    return 'โหลดรายการตรวจสอบไม่สำเร็จ';
}

export default function TorBidChecklistCard({ projectId, pdfUrl, loginReturnPath = `/tors/${projectId}`, showSubmissionNotice = true }) {
    const headingId = useId();
    const [savingItem, setSavingItem] = useState(null);
    const [saveError, setSaveError] = useState('');
    const { current, retry, saveStatus } = useTorChecklist();
    const { checklist, error } = current ?? {};
    const items = checklist?.items ?? [];
    const missing = checklist?.missingProfileFields ?? [];
    const sourcePdf = pdfUrl?.split('#')[0];

    async function changeStatus(itemId, status) {
        setSavingItem(itemId);
        setSaveError('');
        try {
            await saveStatus(itemId, status);
        } catch (error) {
            if (error.code === 'CHECKLIST_CHANGED' || error.code === 'CHECKLIST_ITEM_NOT_FOUND') {
                setSaveError('ข้อมูลรายการตรวจสอบเปลี่ยนไป กรุณาลองอีกครั้งเมื่อโหลดเสร็จ');
                retry();
            } else if (error.status === 409) {
                setSaveError(errorMessage(error));
            } else {
                setSaveError('บันทึกสถานะไม่สำเร็จ กรุณาลองอีกครั้ง');
            }
        } finally {
            setSavingItem(null);
        }
    }

    async function passAll() {
        for (const item of items) {
            if (item.id && item.status !== 'pass') await changeStatus(item.id, 'pass');
        }
    }
    const undecided = items.filter(item => item.id && item.status !== 'pass').length;

    return (
        <section className="tor-summary-card tor-bid-checklist" aria-labelledby={headingId}>
            <p className="tor-section-kicker">เตรียมยื่นข้อเสนอ</p>
            <h2 id={headingId}>รายการตรวจสอบคุณสมบัติ</h2>
            <aside className="tor-bid-checklist-note" role="note">
                <p>ผลการตรวจสอบเบื้องต้น กรุณายืนยันคุณสมบัติกับเอกสาร TOR ต้นฉบับก่อนยื่นข้อเสนอ</p>
                {showSubmissionNotice && <p>{NO_EGP_SUBMISSION_NOTICE_TH}</p>}
            </aside>
            {saveError && <p role="alert">{saveError}</p>}
            {!current && <p role="status">กำลังโหลดรายการตรวจสอบ…</p>}
            {error && (
                <div className="tor-bid-checklist-error">
                    <p role="alert">{errorMessage(error)}</p>
                    {error.status === 401
                        ? <Link href={`/?next=${encodeURIComponent(loginReturnPath)}`}>เข้าสู่ระบบ</Link>
                        : <button type="button" className="tor-summary-toggle" onClick={retry}>ลองอีกครั้ง</button>}
                </div>
            )}
            {checklist && (
                <>
                    <dl className="tor-bid-checklist-counts" aria-label="สรุปผลการตรวจสอบ">
                        {STATUSES.map(([status, label]) => (
                            <div key={status} data-status={status}>
                                <dt>{label}</dt><dd>{checklist.summary[status]}</dd>
                            </div>
                        ))}
                    </dl>
                    {missing.length > 0 && (
                        <div className="tor-bid-checklist-profile">
                            <p><strong>ข้อมูลบริษัทที่ยังขาด</strong></p>
                            <ul>{missing.map(field => <li key={field}>{PROFILE_FIELDS[field] ?? field}</li>)}</ul>
                            <Link href="/profile">แก้ไขโปรไฟล์บริษัท →</Link>
                        </div>
                    )}
                    {items.length === 0 ? <p role="status">ยังไม่มีรายการคุณสมบัติสำหรับตรวจสอบใน TOR นี้</p> : (
                        <>
                            <div className="tor-check-bar">
                                <p>ตรวจแล้ว <strong>{items.length - undecided}</strong> จาก {items.length} ข้อ</p>
                                {undecided > 0 && <button type="button" className="tor-check-all" onClick={() => void passAll()}>✓ ติ๊กผ่านทั้งหมด ({undecided} ข้อ)</button>}
                            </div>
                            <ul className="tor-check-list">
                                {items.map((item, index) => {
                                    const label = STATUSES.find(([status]) => status === item.status)?.[1] ?? 'ตรวจสอบเอง';
                                    return (
                                        <li key={item.id ?? index} data-status={item.status}>
                                            <span className="tor-check-mark" data-status={item.status} aria-label={label}>{item.status === 'pass' ? '✓' : item.status === 'fail' ? '✕' : '?'}</span>
                                            <div className="tor-check-main">
                                                <p>{item.requirement}</p>
                                                <small>
                                                    {item.evidencePages.length > 0
                                                        ? <>หน้า {item.evidencePages.map((pageNumber, i) => <span key={pageNumber}>{i > 0 && ', '}{sourcePdf
                                                            ? <a href={`${sourcePdf}#page=${pageNumber}`} target="_blank" rel="noreferrer" aria-label={`เปิด TOR หน้า ${pageNumber}`}>{pageNumber}</a>
                                                            : pageNumber}</span>)}</>
                                                        : 'ไม่ระบุหน้า'}
                                                    {item.status === 'manual' && ' · ต้องตรวจเอง'}
                                                </small>
                                            </div>
                                            {item.id && (
                                                <div className="tor-check-actions" role="group" aria-label={`กำหนดสถานะ ข้อ ${index + 1}`}>
                                                    {DECISIONS.map(([status, text]) => (
                                                        <button
                                                            key={status}
                                                            type="button"
                                                            data-status={status}
                                                            aria-pressed={item.overrideStatus === status}
                                                            title={item.overrideStatus === status ? 'กดอีกครั้งเพื่อใช้ผลจากระบบ' : undefined}
                                                            onClick={() => void changeStatus(item.id, item.overrideStatus === status ? null : status)}
                                                        >
                                                            {text}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </>
                    )}
                    {checklist.truncated && <p>มีข้อกำหนดเพิ่มเติมในเอกสาร TOR ต้นฉบับ</p>}
                </>
            )}
        </section>
    );
}
