'use client';

import { useEffect, useState } from 'react';
import { bidPrepRequest } from '@/lib/services/bid-prep-client';

const formatBaht = value => value == null ? 'ยังไม่มีข้อมูล'
    : `${value.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท`;

function comparisonMessage(comparison) {
    if (comparison.status === 'not_stated') return 'TOR ไม่ได้ระบุมูลค่าผลงานขั้นต่ำ';
    if (comparison.status === 'manual_review') return 'กรุณาตรวจสอบข้อกำหนดใน TOR';
    if (comparison.status === 'pending_extraction') return 'รอประมวลผลข้อกำหนดจาก TOR';
    if (comparison.meetsMinimum === null) return 'เพิ่มข้อมูลมูลค่าผลงานในโปรไฟล์บริษัทเพื่อเปรียบเทียบ';
    return comparison.meetsMinimum ? 'มูลค่าถึงเกณฑ์ที่ระบุ' : 'มูลค่าไม่ถึงเกณฑ์ที่ระบุ';
}

export default function PastProjectValueCard({ projectId, pdfUrl }) {
    const [state, setState] = useState(null);
    useEffect(() => {
        let active = true;
        bidPrepRequest(`/api/bid-prep/tors/${encodeURIComponent(projectId)}/checklist`)
            .then(data => { if (active) setState({ projectId, comparison: data.pastProjectValueComparison }); })
            .catch(error => { if (active) setState({ projectId, error }); });
        return () => { active = false; };
    }, [projectId]);
    const current = state?.projectId === projectId ? state : null;
    const comparison = current?.comparison;
    const message = !current ? 'กำลังโหลดข้อมูล'
        : current.error?.code === 'TOR_DOCUMENT_UNREADABLE' ? 'ไม่สามารถอ่านข้อความใน TOR ได้ กรุณาตรวจสอบเอกสารต้นฉบับ'
        : current.error?.status === 409 ? 'รอประมวลผลข้อกำหนดจาก TOR'
        : comparison ? comparisonMessage(comparison) : 'ไม่สามารถโหลดข้อมูลการเปรียบเทียบได้';

    return <section className="tor-detail-card">
        <h2>เปรียบเทียบมูลค่าผลงานที่ผ่านมา</h2>
        <p role="status">{message}</p>
        {comparison && <dl>
            <div><dt>มูลค่าผลงานสูงสุดของบริษัท</dt><dd>{formatBaht(comparison.companyValueBaht)}</dd></div>
            {comparison.minimumBaht != null && <div>
                <dt>มูลค่าที่ TOR กำหนด</dt>
                <dd>{comparison.operator === '>' ? 'มากกว่า' : 'ไม่น้อยกว่า'} {formatBaht(comparison.minimumBaht)}</dd>
            </div>}
        </dl>}
        {comparison?.status === 'found' && <p>ผลนี้เปรียบเทียบเฉพาะมูลค่า กรุณาตรวจสอบคุณสมบัติอื่นตามเอกสาร TOR</p>}
        {comparison?.evidence.length > 0 && <ul>
            {comparison.evidence.map(({ page, clauseText }) => <li key={`${page}:${clauseText}`}>
                {pdfUrl ? <a href={`${pdfUrl.split('#')[0]}#page=${page}`} target="_blank" rel="noreferrer">TOR หน้า {page} ↗</a>
                    : <span>TOR หน้า {page}</span>}
                <blockquote>{clauseText}</blockquote>
            </li>)}
        </ul>}
    </section>;
}
