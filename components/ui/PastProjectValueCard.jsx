'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useTorChecklist } from './TorChecklistProvider';

const formatBaht = value => value == null ? 'ยังไม่มีข้อมูล'
    : `${value.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท`;

function comparisonStatus(state) {
    if (!state) return { label: 'กำลังโหลดข้อมูล' };
    const { checklist, error } = state;
    const comparison = checklist?.pastProjectValueComparison;
    if (error?.code === 'TOR_DOCUMENT_UNREADABLE') return { label: 'ไม่สามารถอ่านข้อความใน TOR ได้', tone: 'review' };
    if (error?.status === 409 || comparison?.status === 'pending_extraction') return { label: 'รอประมวลผล TOR' };
    if (!comparison) return { label: 'ไม่สามารถโหลดผลเปรียบเทียบได้', tone: 'review' };
    if (comparison.status === 'not_stated') return { label: 'TOR ไม่ได้ระบุเกณฑ์ขั้นต่ำ' };
    if (comparison.status === 'manual_review') return { label: 'กรุณาตรวจสอบข้อกำหนดใน TOR', tone: 'review' };
    if (comparison.meetsMinimum === null) return { label: 'ยังไม่มีข้อมูลผลงานบริษัท' };
    return comparison.meetsMinimum
        ? { label: 'มูลค่าถึงเกณฑ์', tone: 'met' }
        : { label: 'มูลค่าไม่ถึงเกณฑ์', tone: 'review' };
}

export default function PastProjectValueCard({ pdfUrl }) {
    const headingId = useId();
    const { current } = useTorChecklist();
    const comparison = current?.checklist?.pastProjectValueComparison;
    const status = comparisonStatus(current);
    const evidence = comparison?.evidence ?? [];
    const hasMinimum = comparison?.status === 'found' && comparison.minimumBaht != null;
    const sourcePdf = pdfUrl?.split('#')[0];

    return (
        <section className="tor-summary-card tor-past-project-card" aria-labelledby={headingId}>
            <div className="tor-past-project-heading">
                <div>
                    <p className="tor-section-kicker">เปรียบเทียบมูลค่าผลงานที่ผ่านมา</p>
                    <h2 id={headingId}>มูลค่าผลงานขั้นต่ำตาม TOR</h2>
                </div>
                <p className="tor-past-project-status" data-tone={status.tone} role="status">{status.label}</p>
            </div>
            {comparison && (
                <dl className="tor-past-project-values">
                    <div>
                        <dt>เกณฑ์ขั้นต่ำ</dt>
                        <dd>
                            {hasMinimum && <span>{comparison.operator === '>' ? 'มากกว่า' : 'ไม่น้อยกว่า'} </span>}
                            {formatBaht(hasMinimum ? comparison.minimumBaht : null)}
                        </dd>
                    </div>
                    <div>
                        <dt>มูลค่าผลงานสูงสุดของบริษัท</dt>
                        <dd>{formatBaht(comparison.companyValueBaht)}</dd>
                    </div>
                </dl>
            )}
            {hasMinimum && (
                <p className="tor-past-project-note">
                    {comparison.companyValueBaht == null
                        ? <Link href="/profile">เพิ่มมูลค่าผลงานในโปรไฟล์บริษัท</Link>
                        : 'ผลนี้ใช้เฉพาะเกณฑ์มูลค่าผลงาน กรุณาตรวจสอบคุณสมบัติอื่นใน TOR'}
                </p>
            )}
            {evidence.length > 0 && (
                <div className="tor-past-project-sources">
                    {evidence.map(({ page, clauseText }) => (
                        <details key={`${page}:${clauseText}`}>
                            <summary>ข้อความอ้างอิงจาก TOR หน้า {page}</summary>
                            <blockquote>{clauseText}</blockquote>
                            {sourcePdf && <a href={`${sourcePdf}#page=${page}`} target="_blank" rel="noreferrer">เปิด TOR หน้า {page} ↗</a>}
                        </details>
                    ))}
                </div>
            )}
        </section>
    );
}
