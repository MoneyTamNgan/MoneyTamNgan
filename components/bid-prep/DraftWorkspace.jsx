'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import BidWorkspaceLayout from './BidWorkspaceLayout';
import { proposalToSections } from '@/lib/bid-prep/draft-content';
import { bidPrepRequest } from '@/lib/services/bid-prep-client';

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export default function DraftWorkspace({ initialProjectId = '' }) {
    const router = useRouter();
    const [projectId, setProjectId] = useState(initialProjectId);
    const [drafts, setDrafts] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [job, setJob] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const controller = new AbortController();
        bidPrepRequest('/api/bid-prep/drafts', { signal: controller.signal }).then(data => setDrafts(data.drafts))
            .catch(e => { if (e.name !== 'AbortError') setError(e.message); }).finally(() => setLoading(false));
        return () => controller.abort();
    }, []);
    async function create(sections) {
        const draft = await bidPrepRequest('/api/bid-prep/drafts', { method: 'POST', body: { projectId, title: `ร่างข้อเสนอ ${projectId}`, sections } });
        router.push(`/bid-prep/drafts/${draft.id}`);
    }
    useEffect(() => {
        if (!job) return;
        const controller = new AbortController(); let timer, stopped = false;
        const startedAt = Date.now();
        async function poll() {
            try {
                const data = await bidPrepRequest(`/api/tors/${encodeURIComponent(job.projectId)}/proposal-draft?jobId=${job.id}`, { signal: controller.signal });
                if (stopped) return;
                if (data.status === 'completed' && data.draft) {
                    const sections = proposalToSections(data.draft);
                    const stored = await bidPrepRequest('/api/bid-prep/drafts', { method: 'POST', signal: controller.signal,
                        body: { projectId: job.projectId, title: `ร่างข้อเสนอ ${job.projectId}`, sections } });
                    setJob(null); router.push(`/bid-prep/drafts/${stored.id}`); return;
                }
                if (data.status === 'failed') throw new Error('การสร้างร่างไม่สำเร็จ โปรดลองอีกครั้ง');
                if (Date.now() - startedAt > 15 * 60 * 1000) throw new Error('หยุดรอผลแล้ว งานบนเซิร์ฟเวอร์อาจยังทำงานอยู่');
                timer = setTimeout(poll, 2000);
            } catch (e) { if (!stopped) { setError(e.message); setJob(null); setBusy(false); } }
        }
        void poll();
        return () => { stopped = true; clearTimeout(timer); controller.abort(); };
    }, [job, router]);
    async function start(generate) {
        setError(''); setBusy(true);
        try {
            if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error('กรุณาระบุรหัส TOR ที่ถูกต้อง');
            if (generate) {
                const data = await bidPrepRequest(`/api/tors/${encodeURIComponent(projectId)}/proposal-draft`, { method: 'POST' });
                setJob({ id: data.jobId, projectId });
            } else await create([{ heading: 'ข้อมูลบริษัท', body: '[to fill in: company overview]', sources: ['profile.company_name'] },
                { heading: 'แนวทางดำเนินงาน', body: '[to fill in: proposal]', sources: [] }]);
        } catch (e) { setError(e.message); setBusy(false); }
    }
    const navigation = PROJECT_ID_PATTERN.test(initialProjectId) ? {
        title: 'ภาพรวม TOR',
        href: `/tors/${encodeURIComponent(initialProjectId)}`,
        label: 'กลับสู่รายละเอียด',
    } : {
        title: 'เตรียมข้อเสนอ',
        href: '/dashboard',
        label: 'กลับสู่หน้าแรก',
    };

    return (
        <BidWorkspaceLayout title="ร่างข้อเสนอของฉัน" navigation={navigation}>
            <section className="bid-card">
                <h2>เริ่มร่างสำหรับ TOR</h2>
                <label htmlFor="draft-project-id">รหัสโครงการ TOR</label>
                <input id="draft-project-id" value={projectId} maxLength={64} disabled={busy} onChange={e => setProjectId(e.target.value.trim())} />
                <div className="bid-actions">
                    <button id="create-bid-draft" className="bid-primary" disabled={busy || loading} onClick={() => start(false)}>สร้างร่างเพื่อแก้ไข</button>
                    <button id="generate-ai-bid-draft" className="bid-secondary" disabled={busy || loading} onClick={() => start(true)}>สร้างร่างด้วย AI</button>
                </div>
                {job && <p role="status">กำลังรอผล AI ให้รัน worker เพื่อประมวลผลงาน หมายเลขงาน {job.id}</p>}
                <p>AI ใช้ระบบสร้างร่างและคิวเดิม ผลที่ได้จะบันทึกเป็นร่างส่วนตัวก่อนแก้ไข</p>
            </section>
            {error && <p className="bid-error" role="alert">{error} <Link href="/?next=/bid-prep">เข้าสู่ระบบ</Link></p>}
            <section className="bid-card">
                <h2>ร่างที่บันทึกไว้</h2>
                {loading ? <p role="status">กำลังโหลด...</p> : drafts.length ? <ul className="bid-draft-list">{drafts.map(draft => <li key={draft.id}>
                    <Link href={`/bid-prep/drafts/${draft.id}`}>{draft.title || draft.projectId}</Link>
                    <span>TOR {draft.projectId} · รุ่น {draft.version} · {new Date(draft.updatedAt).toLocaleString('th-TH')}</span>
                </li>)}</ul> : <p>ยังไม่มีร่างที่บันทึกไว้</p>}
            </section>
        </BidWorkspaceLayout>
    );
}
