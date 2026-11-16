'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/ui/AppShell';
import { bidPrepNotices } from '@/lib/bid-prep/notices';
import { DRAFT_LIMITS, draftPlaceholders, parseDraftContent } from '@/lib/bid-prep/draft-content';
import { bidPrepRequest, downloadBidDraft } from '@/lib/services/bid-prep-client';

function HighlightedText({ text }) {
    return <>{String(text || '').split(/(\[to fill in(?:\s*:[^\]]*)?\])/gi).map((part, i) => /^\[to fill in/i.test(part) ? <mark key={i}>{part}</mark> : part)}</>;
}
export default function DraftEditor({ draftId }) {
    const router = useRouter(), notices = bidPrepNotices();
    const [draft, setDraft] = useState(null), [checklist, setChecklist] = useState(null);
    const [error, setError] = useState(''), [checklistError, setChecklistError] = useState(''), [busy, setBusy] = useState(false);
    const [dirty, setDirty] = useState(false), [saved, setSaved] = useState(false), [conflict, setConflict] = useState(false);
    const [confirmExport, setConfirmExport] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
    async function load() {
        setError('');
        try {
            const data = await bidPrepRequest(`/api/bid-prep/drafts/${encodeURIComponent(draftId)}`);
            setDraft(data); setDirty(false); setConflict(false); setSaved(false);
            try { setChecklist(await bidPrepRequest(`/api/bid-prep/tors/${encodeURIComponent(data.projectId)}/checklist`)); setChecklistError(''); }
            catch (e) { setChecklistError(e.message); }
        } catch (e) { setError(e.message); }
    }
    useEffect(() => { void load(); }, [draftId]);
    useEffect(() => {
        if (!dirty) return;
        const guard = e => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
    }, [dirty]);
    function change(next) { setDraft(current => ({ ...current, ...next })); setDirty(true); setSaved(false); }
    function changeSection(index, next) { change({ sections: draft.sections.map((section, i) => i === index ? { ...section, ...next } : section) }); }
    async function save() {
        setError('');
        const parsed = parseDraftContent({ title: draft.title, sections: draft.sections }, { projectRequired: false });
        if (parsed.code) { setError(parsed.message); return; }
        setBusy(true);
        try {
            const updated = await bidPrepRequest(`/api/bid-prep/drafts/${encodeURIComponent(draftId)}`, { method: 'PATCH', body: { version: draft.version, title: parsed.title, sections: parsed.sections } });
            setDraft(updated); setDirty(false); setSaved(true); setConflict(false);
        } catch (e) { setError(e.message); if (e.status === 409) setConflict(true); }
        finally { setBusy(false); }
    }
    async function exportFile() {
        setConfirmExport(false); setBusy(true); setError('');
        try { await downloadBidDraft(draftId, draft.version); }
        catch (e) { setError(e.message); if (e.status === 409) setConflict(true); }
        finally { setBusy(false); }
    }
    async function remove() {
        setBusy(true); setError('');
        try { await bidPrepRequest(`/api/bid-prep/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' }); setDirty(false); router.push('/bid-prep'); }
        catch (e) { setError(e.message); setBusy(false); setConfirmDelete(false); }
    }
    const placeholders = draftPlaceholders(draft);
    const incomplete = placeholders.length > 0 || checklistError || !checklist?.items?.length
        || checklist.items.some(item => !item.evidencePages?.length) || draft?.sections.some(section => !section.sources?.filter(Boolean).length);
    return <AppShell title="แก้ไขร่างข้อเสนอ"><div className="bid-workspace">
        <div className="bid-notice bid-sticky-notice" role="note"><strong>{notices.aiDraft}</strong><p>{notices.noEgpSubmissionTh}</p></div>
        <Link href="/bid-prep">← ร่างข้อเสนอของฉัน</Link>
        {error && <p className="bid-error" role="alert">{error}</p>}
        {!draft ? <p>กำลังโหลดร่าง หากยังไม่ได้เข้าสู่ระบบ <Link href="/?next=/bid-prep">เข้าสู่ระบบ</Link></p> : <>
            <section className="bid-card"><h1>แก้ไขร่างข้อเสนอ</h1><p>TOR {draft.projectId} · รุ่น {draft.version} · แก้ไขล่าสุด {new Date(draft.updatedAt).toLocaleString('th-TH')}</p>
                <label htmlFor="draft-title">ชื่อร่าง</label><input id="draft-title" maxLength={DRAFT_LIMITS.title} value={draft.title} disabled={busy} onChange={e => change({ title: e.target.value })} />
                <p>อ้างอิงแต่ละข้อความจากแหล่งที่แสดงด้านล่าง หลังแก้ไขต้องตรวจสอบแหล่งอ้างอิงใหม่ด้วยตนเอง</p>
                <p className={placeholders.length ? 'bid-incomplete' : ''} role="status">ส่วนที่ยังต้องเติมข้อมูล: {placeholders.length}</p>
                {placeholders.length > 0 && <ul>{[...new Set(placeholders)].slice(0, 50).map((text, index) => <li key={index}><mark>{text}</mark></li>)}</ul>}
            </section>
            {draft.sections.map((section, i) => <section className="bid-card bid-editor-section" key={i}>
                <label htmlFor={`section-heading-${i}`}>หัวข้อ {i + 1}</label><input id={`section-heading-${i}`} maxLength={DRAFT_LIMITS.heading} value={section.heading} disabled={busy} onChange={e => changeSection(i, { heading: e.target.value })} />
                <label htmlFor={`section-body-${i}`}>ข้อความร่าง</label><textarea id={`section-body-${i}`} rows={5} maxLength={DRAFT_LIMITS.body} value={section.body} disabled={busy} onChange={e => changeSection(i, { body: e.target.value })} />
                <details open={draftPlaceholders({ sections: [section] }).length > 0}><summary>ดูข้อความและส่วนที่ต้องเติม</summary><p className="bid-preview"><HighlightedText text={section.body} /></p></details>
                <p><strong>แหล่งอ้างอิงของข้อความนี้</strong></p>
                <ul className="bid-sources">{section.sources.filter(Boolean).map((source, index) => <li key={index}>{source}</li>)}</ul>
                {!section.sources.filter(Boolean).length && <p className="bid-incomplete">ยังไม่มีแหล่งอ้างอิง โปรดตรวจสอบก่อนใช้</p>}
                <label htmlFor={`section-sources-${i}`}>แก้ไขแหล่งอ้างอิง หนึ่งรายการต่อบรรทัด (สูงสุด 20 รายการ)</label>
                <textarea id={`section-sources-${i}`} rows={2} value={section.sources.join('\n')} disabled={busy} onChange={e => changeSection(i, { sources: e.target.value.split('\n') })} />
                <button className="bid-secondary" disabled={busy} onClick={() => change({ sections: draft.sections.filter((_, index) => i !== index) })}>ลบหัวข้อนี้</button>
            </section>)}
            <div className="bid-actions"><button id="add-draft-section" disabled={busy || draft.sections.length >= DRAFT_LIMITS.sections} onClick={() => change({ sections: [...draft.sections, { heading: '', body: '[to fill in: statement]', sources: [] }] })}>เพิ่มหัวข้อ</button></div>
            <section className="bid-card"><h2>รายการตรวจสอบคุณสมบัติ</h2>
                {checklistError ? <p className="bid-incomplete">ยังไม่มีรายการตรวจสอบ: {checklistError} ไฟล์จะระบุว่ายังต้องตรวจสอบ</p> : checklist ? <>
                    <p>รายการ manual ต้องตรวจสอบเอง ไม่ใช่ผลผ่านคุณสมบัติ</p>
                    <div className="bid-table-scroll"><table><thead><tr><th>ข้อกำหนด</th><th>สถานะ</th><th>เหตุผล</th><th>หน้า</th></tr></thead>
                        <tbody>{checklist.items.map((item, i) => <tr key={i}><td>{item.requirement}</td><td>{item.status}</td><td>{item.reason}</td><td>{item.evidencePages.join(', ') || 'ยังไม่ระบุ'}</td></tr>)}</tbody></table></div>
                    {checklist.truncated && <p className="bid-incomplete">มีข้อกำหนดเพิ่มเติมที่ต้องตรวจสอบใน TOR</p>}
                </> : <p>กำลังโหลดรายการตรวจสอบ...</p>}
            </section>
            {conflict && <div className="bid-error"><p>มีการแก้ไขร่างจากหน้าต่างอื่น ข้อความที่คุณแก้ยังคงอยู่ กรุณาคัดลอกไว้ก่อนโหลดรุ่นล่าสุด</p><button onClick={load}>โหลดรุ่นล่าสุดและทิ้งการแก้ไขในหน้านี้</button></div>}
            <div className="bid-actions"><button id="save-bid-draft" disabled={busy || !dirty || conflict} onClick={save}>บันทึกร่าง</button>
                <button id="export-bid-draft" disabled={busy || dirty || conflict} onClick={() => incomplete ? setConfirmExport(true) : exportFile()}>ดาวน์โหลด DOCX พร้อม checklist</button>
                <button className="bid-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>ลบร่างนี้</button></div>
            <p role="status">{busy ? 'กำลังดำเนินการ...' : dirty ? 'มีการแก้ไขที่ยังไม่ได้บันทึก กรุณาบันทึกก่อนส่งออก' : saved ? 'บันทึกร่างลงฐานข้อมูลแล้ว' : 'กำลังแสดงร่างที่บันทึกไว้'}</p>
        </>}
        {(confirmExport || confirmDelete) && <div className="bid-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="bid-confirm-heading"><div className="bid-card bid-modal">
            <h2 id="bid-confirm-heading">{confirmDelete ? 'ยืนยันลบร่างนี้' : 'ร่างยังมีข้อมูลหรือแหล่งอ้างอิงที่ต้องเติม'}</h2>
            <p>{confirmDelete ? 'ร่างนี้จะถูกนำออกจากรายการของคุณ' : 'ส่วนที่ยังต้องเติมจะอยู่ในไฟล์และถูกเน้นไว้ ต้องตรวจสอบก่อนยื่นข้อเสนอ'}</p>
            <div className="bid-actions"><button id="confirm-bid-action" onClick={confirmDelete ? remove : exportFile}>{confirmDelete ? 'ลบร่าง' : 'ส่งออกโดยคงคำเตือนไว้'}</button>
                <button onClick={() => { setConfirmDelete(false); setConfirmExport(false); }}>ยกเลิก</button></div>
        </div></div>}
    </div></AppShell>;
}
