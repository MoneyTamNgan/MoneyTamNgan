'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { NO_EGP_SUBMISSION_NOTICE_TH } from '@/lib/bid-prep/notices';
import { useTorChecklist } from './TorChecklistProvider';

const PAGE_SIZE = 5;
const STATUSES = [
    ['pass', 'ผ่าน'],
    ['fail', 'ไม่ผ่าน'],
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

export default function TorBidChecklistCard({ projectId, pdfUrl }) {
    const headingId = useId();
    const [page, setPage] = useState(1);
    const [savingItem, setSavingItem] = useState(null);
    const [saveError, setSaveError] = useState('');
    const { current, retry, saveStatus } = useTorChecklist();
    const { checklist, error } = current ?? {};
    const items = checklist?.items ?? [];
    const missing = checklist?.missingProfileFields ?? [];
    const lastPage = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const visiblePage = Math.min(page, lastPage);
    const start = (visiblePage - 1) * PAGE_SIZE;
    const sourcePdf = pdfUrl?.split('#')[0];

    async function changeStatus(itemId, status) {
        setSavingItem(itemId);
        setSaveError('');
        try {
            await saveStatus(itemId, status || null);
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

    return (
        <section className="tor-summary-card tor-bid-checklist" aria-labelledby={headingId}>
            <p className="tor-section-kicker">เตรียมยื่นข้อเสนอ</p>
            <h2 id={headingId}>รายการตรวจสอบคุณสมบัติ</h2>
            <aside className="tor-bid-checklist-note" role="note">
                <p>ผลการตรวจสอบเบื้องต้น กรุณายืนยันคุณสมบัติกับเอกสาร TOR ต้นฉบับก่อนยื่นข้อเสนอ</p>
                <p>{NO_EGP_SUBMISSION_NOTICE_TH}</p>
            </aside>
            {saveError && <p role="alert">{saveError}</p>}
            {!current && <p role="status">กำลังโหลดรายการตรวจสอบ…</p>}
            {error && (
                <div className="tor-bid-checklist-error">
                    <p role="alert">{errorMessage(error)}</p>
                    {error.status === 401
                        ? <Link href={`/?next=${encodeURIComponent(`/tors/${projectId}`)}`}>เข้าสู่ระบบ</Link>
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
                        <ul className="tor-bid-checklist-items">
                            {items.slice(start, start + PAGE_SIZE).map((item, offset) => (
                                <li key={item.id ?? start + offset}>
                                    <div className="tor-bid-checklist-item-heading">
                                        <p>{item.requirement}</p>
                                        <span data-status={item.status}>{STATUSES.find(([status]) => status === item.status)?.[1] ?? 'ตรวจสอบเอง'}</span>
                                    </div>
                                    {!item.overrideStatus && !item.needsReview && item.reason && (
                                        <p className="tor-bid-checklist-reason">{item.reason}</p>
                                    )}
                                    <div className="tor-bid-checklist-pages">
                                        <span>หน้าอ้างอิง</span>
                                        {item.evidencePages.length > 0 ? item.evidencePages.map(pageNumber => sourcePdf
                                            ? <a key={pageNumber} href={`${sourcePdf}#page=${pageNumber}`} target="_blank" rel="noreferrer" aria-label={`เปิด TOR หน้า ${pageNumber}`}>{pageNumber} ↗</a>
                                            : <span key={pageNumber}>{pageNumber}</span>) : <span>ไม่ระบุ</span>}
                                    </div>
                                    {item.id && (
                                        <label className="tor-bid-checklist-status-control">
                                            <span>กำหนดสถานะเอง</span>
                                            <select
                                                aria-label={`กำหนดสถานะเอง ข้อ ${start + offset + 1}`}
                                                value={item.overrideStatus ?? ''}
                                                disabled={savingItem !== null}
                                                onChange={event => void changeStatus(item.id, event.target.value)}
                                            >
                                                <option value="">ใช้ผลจากระบบ</option>
                                                {STATUSES.map(([status, label]) => <option key={status} value={status}>{label}</option>)}
                                            </select>
                                            {savingItem === item.id && <span role="status">กำลังบันทึก…</span>}
                                        </label>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    {lastPage > 1 && (
                        <nav className="tor-qualification-pagination" aria-label="หน้ารายการตรวจสอบคุณสมบัติ">
                            <button type="button" disabled={visiblePage === 1} onClick={() => setPage(visiblePage - 1)}>← ก่อนหน้า</button>
                            <p aria-live="polite">หน้า {visiblePage} / {lastPage}</p>
                            <button type="button" disabled={visiblePage === lastPage} onClick={() => setPage(visiblePage + 1)}>ถัดไป →</button>
                        </nav>
                    )}
                    {checklist.truncated && <p>มีข้อกำหนดเพิ่มเติมในเอกสาร TOR ต้นฉบับ</p>}
                </>
            )}
        </section>
    );
}
