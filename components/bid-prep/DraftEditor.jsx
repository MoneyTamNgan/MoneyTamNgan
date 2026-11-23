'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import BidWorkspaceLayout from './BidWorkspaceLayout';
import TorBidChecklistCard from '@/components/ui/TorBidChecklistCard';
import TorChecklistProvider, { useTorChecklist } from '@/components/ui/TorChecklistProvider';
import { DRAFT_LIMITS, checklistPassed, draftPlaceholders, parseDraftContent } from '@/lib/bid-prep/draft-content';
import { bidPrepRequest, downloadBidDraft } from '@/lib/services/bid-prep-client';

const EDITOR_TABS = [
    { id: 'draft', label: 'ชื่อร่างและหัวข้อ' },
    { id: 'checklist', label: 'รายการตรวจสอบคุณสมบัติ' },
];

function HighlightedText({ text }) {
    return <>{String(text || '').split(/(\[to fill in(?:\s*:[^\]]*)?\])/gi).map((part, i) => /^\[to fill in/i.test(part) ? <mark key={i}>{part}</mark> : part)}</>;
}
export default function DraftEditor({ draftId }) {
    const [draft, setDraft] = useState(null);

    return (
        <TorChecklistProvider projectId={draft?.projectId}>
            <DraftEditorForm draftId={draftId} draft={draft} setDraft={setDraft} />
        </TorChecklistProvider>
    );
}

function DraftEditorForm({ draftId, draft, setDraft }) {
    const router = useRouter();
    const { current, isSaving: checklistSaving, retry } = useTorChecklist();
    const checklist = current?.checklist;
    const [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [dirty, setDirty] = useState(false), [saved, setSaved] = useState(false), [conflict, setConflict] = useState(false);
    const [confirmExport, setConfirmExport] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
    const [activeTab, setActiveTab] = useState('draft');
    async function load() {
        setError('');
        try {
            const data = await bidPrepRequest(`/api/bid-prep/drafts/${encodeURIComponent(draftId)}`);
            setDraft(data); setDirty(false); setConflict(false); setSaved(false);
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
        if (!canExport) return;
        setConfirmExport(false); setBusy(true); setError('');
        try { await downloadBidDraft(draftId, draft.version); }
        catch (e) {
            if (e.code === 'CHECKLIST_NOT_PASSED') {
                setError('รายการตรวจสอบมีการเปลี่ยนแปลง กรุณาตรวจสอบสถานะทุกข้อก่อนดาวน์โหลด');
                setActiveTab('checklist');
                retry();
            } else {
                setError(e.message);
                if (e.status === 409) setConflict(true);
            }
        }
        finally { setBusy(false); }
    }
    async function remove() {
        setBusy(true); setError('');
        try { await bidPrepRequest(`/api/bid-prep/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' }); setDirty(false); router.push('/bid-prep'); }
        catch (e) { setError(e.message); setBusy(false); setConfirmDelete(false); }
    }
    function switchTabWithKeyboard(event, index) {
        const lastIndex = EDITOR_TABS.length - 1;
        const targets = {
            ArrowLeft: (index + lastIndex) % EDITOR_TABS.length,
            ArrowRight: (index + 1) % EDITOR_TABS.length,
            Home: 0,
            End: lastIndex,
        };
        if (!Object.hasOwn(targets, event.key)) return;
        event.preventDefault();
        const nextIndex = targets[event.key];
        setActiveTab(EDITOR_TABS[nextIndex].id);
        event.currentTarget.parentElement.children[nextIndex].focus();
    }

    const placeholders = draftPlaceholders(draft);
    const allQualificationsPassed = checklistPassed(checklist);
    const canExport = Boolean(draft && allQualificationsPassed && !checklistSaving && !busy && !dirty && !conflict);
    const hasMissingReferences = checklist?.items.some(item => !item.evidencePages?.length)
        || draft?.sections.some(section => !section.sources?.filter(Boolean).length);
    const needsExportWarning = placeholders.length > 0 || hasMissingReferences;
    const headerDetails = draft && (
        <p className="bid-workspace-meta">TOR {draft.projectId} · รุ่น {draft.version} · แก้ไขล่าสุด {new Date(draft.updatedAt).toLocaleString('th-TH')}</p>
    );

    return (
        <BidWorkspaceLayout
            title="แก้ไขร่างข้อเสนอ"
            navigation={{
                title: 'เตรียมข้อเสนอ',
                href: '/bid-prep',
                label: 'กลับสู่รายการร่าง',
                torDetailsHref: draft ? `/tors/${encodeURIComponent(draft.projectId)}` : undefined,
            }}
            headerDetails={headerDetails}
        >
            {error && (
                <p className="bid-error" role="alert">
                    {error} {!draft && <Link href="/?next=/bid-prep">เข้าสู่ระบบ</Link>}
                </p>
            )}
            {!draft && !error && <p className="bid-card" role="status">กำลังโหลดร่าง...</p>}
            {draft && <>
                <div className="bid-editor-tabs" role="tablist" aria-label="ส่วนของร่างข้อเสนอ">
                    {EDITOR_TABS.map((tab, index) => (
                        <button
                            key={tab.id}
                            id={`bid-tab-${tab.id}`}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            aria-controls={`bid-panel-${tab.id}`}
                            tabIndex={activeTab === tab.id ? 0 : -1}
                            onClick={() => setActiveTab(tab.id)}
                            onKeyDown={event => switchTabWithKeyboard(event, index)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                <div id="bid-panel-draft" className="bid-editor-panel" role="tabpanel" aria-labelledby="bid-tab-draft" hidden={activeTab !== 'draft'}>
                    <div className="bid-card">
                        <label htmlFor="draft-title">ชื่อร่าง</label>
                        <input id="draft-title" maxLength={DRAFT_LIMITS.title} value={draft.title} disabled={busy} onChange={e => change({ title: e.target.value })} />
                        <p>อ้างอิงแต่ละข้อความจากแหล่งที่แสดงด้านล่าง หลังแก้ไขต้องตรวจสอบแหล่งอ้างอิงใหม่ด้วยตนเอง</p>
                        <p className={placeholders.length ? 'bid-incomplete' : ''} role="status">ส่วนที่ยังต้องเติมข้อมูล: {placeholders.length}</p>
                        {placeholders.length > 0 && <ul>{[...new Set(placeholders)].slice(0, 50).map((text, index) => <li key={index}><mark>{text}</mark></li>)}</ul>}
                    </div>
                    {draft.sections.map((section, i) => (
                        <section className="bid-card bid-editor-section" key={i}>
                            <label htmlFor={`section-heading-${i}`}>หัวข้อ {i + 1}</label>
                            <input id={`section-heading-${i}`} maxLength={DRAFT_LIMITS.heading} value={section.heading} disabled={busy} onChange={e => changeSection(i, { heading: e.target.value })} />
                            <label htmlFor={`section-body-${i}`}>ข้อความร่าง</label>
                            <textarea id={`section-body-${i}`} rows={5} maxLength={DRAFT_LIMITS.body} value={section.body} disabled={busy} onChange={e => changeSection(i, { body: e.target.value })} />
                            <details open={draftPlaceholders({ sections: [section] }).length > 0}>
                                <summary>ดูข้อความและส่วนที่ต้องเติม</summary>
                                <p className="bid-preview"><HighlightedText text={section.body} /></p>
                            </details>
                            <p><strong>แหล่งอ้างอิงของข้อความนี้</strong></p>
                            <ul className="bid-sources">{section.sources.filter(Boolean).map((source, index) => <li key={index}>{source}</li>)}</ul>
                            {!section.sources.filter(Boolean).length && <p className="bid-incomplete">ยังไม่มีแหล่งอ้างอิง โปรดตรวจสอบก่อนใช้</p>}
                            <label htmlFor={`section-sources-${i}`}>แก้ไขแหล่งอ้างอิง หนึ่งรายการต่อบรรทัด (สูงสุด 20 รายการ)</label>
                            <textarea id={`section-sources-${i}`} rows={2} value={section.sources.join('\n')} disabled={busy} onChange={e => changeSection(i, { sources: e.target.value.split('\n') })} />
                            <div className="bid-actions">
                                <button className="bid-secondary" disabled={busy} onClick={() => change({ sections: draft.sections.filter((_, index) => i !== index) })}>ลบหัวข้อนี้</button>
                            </div>
                        </section>
                    ))}
                    <div className="bid-actions">
                        <button id="add-draft-section" className="bid-secondary" disabled={busy || draft.sections.length >= DRAFT_LIMITS.sections} onClick={() => change({ sections: [...draft.sections, { heading: '', body: '[to fill in: statement]', sources: [] }] })}>เพิ่มหัวข้อ</button>
                    </div>
                </div>
                <div id="bid-panel-checklist" className="bid-editor-panel" role="tabpanel" aria-labelledby="bid-tab-checklist" tabIndex={0} hidden={activeTab !== 'checklist'}>
                    <TorBidChecklistCard
                        projectId={draft.projectId}
                        loginReturnPath={`/bid-prep/drafts/${encodeURIComponent(draftId)}`}
                        showSubmissionNotice={false}
                    />
                </div>
                {conflict && <div className="bid-error"><p>มีการแก้ไขร่างจากหน้าต่างอื่น ข้อความที่คุณแก้ยังคงอยู่ กรุณาคัดลอกไว้ก่อนโหลดรุ่นล่าสุด</p><button className="bid-secondary" onClick={load}>โหลดรุ่นล่าสุดและทิ้งการแก้ไขในหน้านี้</button></div>}
                <div className="bid-card bid-editor-actions">
                    <div className="bid-actions">
                        <button id="save-bid-draft" className="bid-primary" disabled={busy || !dirty || conflict} onClick={save}>บันทึกร่าง</button>
                        <button id="export-bid-draft" className="bid-secondary" disabled={!canExport} aria-describedby={allQualificationsPassed ? undefined : 'bid-export-checklist-note'} onClick={() => needsExportWarning ? setConfirmExport(true) : exportFile()}>ดาวน์โหลด DOCX พร้อม checklist</button>
                        <button className="bid-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>ลบร่างนี้</button>
                    </div>
                    {!allQualificationsPassed && (
                        <p className="bid-incomplete" id="bid-export-checklist-note">
                            {checklist?.truncated ? 'รายการตรวจสอบแสดงข้อกำหนดไม่ครบ จึงยังดาวน์โหลดไม่ได้'
                                : 'ตรวจสอบคุณสมบัติให้ครบและให้ทุกข้อมีสถานะ “ผ่าน” ก่อนดาวน์โหลด'}
                        </p>
                    )}
                    {error && <p className="bid-error" role="alert">{error}</p>}
                    {!busy && !dirty && !conflict && <p className="bid-save-hint">ปุ่มบันทึกจะใช้ได้เมื่อมีการแก้ไขข้อความ</p>}
                    {conflict && <p className="bid-save-hint">บันทึกไม่ได้เพราะร่างนี้ถูกแก้จากที่อื่น ใช้ปุ่ม “โหลดรุ่นล่าสุด” ด้านบน</p>}
                    <p role="status">{busy ? 'กำลังดำเนินการ...' : dirty ? 'มีการแก้ไขที่ยังไม่ได้บันทึก กรุณาบันทึกก่อนส่งออก' : saved ? 'บันทึกร่างลงฐานข้อมูลแล้ว' : 'กำลังแสดงร่างที่บันทึกไว้'}</p>
                </div>
            </>}
            {(confirmExport || confirmDelete) && (
                <div className="bid-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="bid-confirm-heading">
                    <div className="bid-card bid-modal">
                        <h2 id="bid-confirm-heading">{confirmDelete ? 'ยืนยันลบร่างนี้' : 'ร่างยังมีข้อมูลหรือแหล่งอ้างอิงที่ต้องเติม'}</h2>
                        <p>{confirmDelete ? 'ร่างนี้จะถูกนำออกจากรายการของคุณ' : 'ส่วนที่ยังต้องเติมจะอยู่ในไฟล์และถูกเน้นไว้ ต้องตรวจสอบก่อนยื่นข้อเสนอ'}</p>
                        <div className="bid-actions">
                            <button id="confirm-bid-action" className={confirmDelete ? 'bid-danger' : 'bid-primary'} disabled={!confirmDelete && !canExport} onClick={confirmDelete ? remove : exportFile}>{confirmDelete ? 'ลบร่าง' : 'ส่งออกโดยคงคำเตือนไว้'}</button>
                            <button className="bid-secondary" onClick={() => { setConfirmDelete(false); setConfirmExport(false); }}>ยกเลิก</button>
                        </div>
                    </div>
                </div>
            )}
        </BidWorkspaceLayout>
    );
}
