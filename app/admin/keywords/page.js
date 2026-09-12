'use client';

import { useEffect, useState } from 'react';

const CATEGORIES = ['software', 'non-software'];

export default function KeywordAdminPage() {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [newKeyword, setNewKeyword] = useState('');
    const [newCategory, setNewCategory] = useState('software');

    useEffect(() => {
        fetch('/api/admin/keywords')
            .then((res) => res.json())
            .then((data) => {
                if (Array.isArray(data)) setRows(data);
                else setMessage('โหลดไม่สำเร็จ: ' + (data.error?.message ?? 'unknown'));
            })
            .catch((err) => setMessage('โหลดไม่สำเร็จ: ' + err.message))
            .finally(() => setLoading(false));
    }, []);

    function addRow() {
        const keyword = newKeyword.trim();
        if (!keyword) return;
        setRows((prev) => [...prev, { keyword, category: newCategory }]);
        setNewKeyword('');
    }

    function removeRow(index) {
        setRows((prev) => prev.filter((_, i) => i !== index));
    }

    async function save() {
        setMessage('กำลังบันทึก...');
        const payload = rows.map((r) => ({ keyword: r.keyword, category: r.category }));
        try {
            const res = await fetch('/api/admin/keywords', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) {
                setMessage('บันทึกไม่สำเร็จ: ' + (data.error?.message ?? res.status));
                return;
            }
            setRows(data);
            setMessage('บันทึกแล้ว ✓');
        } catch (err) {
            setMessage('บันทึกไม่สำเร็จ: ' + err.message);
        }
    }

    async function reclassify() {
        setMessage('กำลังจำแนก TOR ใหม่...');
        try {
            const res = await fetch('/api/admin/classification/run', { method: 'POST' });
            const data = await res.json();
            if (!res.ok) {
                setMessage('จำแนกไม่สำเร็จ: ' + (data.error?.message ?? res.status));
                return;
            }
            setMessage(`จำแนกเสร็จ — สแกน ${data.scanned} รายการ, อัปเดต ${data.updated} รายการ`);
        } catch (err) {
            setMessage('จำแนกไม่สำเร็จ: ' + err.message);
        }
    }

    if (loading) return <main style={styles.main}>กำลังโหลด…</main>;

    const sorted = rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => a.row.category.localeCompare(b.row.category)
            || a.row.keyword.localeCompare(b.row.keyword));

    return (
        <main style={styles.main}>
            <h1 style={styles.h1}>จัดการคีย์เวิร์ดจำแนก TOR</h1>
            <p style={styles.hint}>
                เพิ่ม/ลบคำแล้วกด “บันทึก”. คำที่บันทึกจะถูกใช้ในการจำแนก TOR รอบถัดไป
                กด “จำแนก TOR ใหม่” เพื่อจำแนกรายการที่ยังไม่รู้ผลด้วยคำล่าสุดทันที.
            </p>

            <section style={styles.addRow}>
                <input
                    style={styles.input}
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addRow()}
                    placeholder="พิมพ์คำใหม่"
                />
                <select
                    style={styles.input}
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button style={styles.button} onClick={addRow}>เพิ่ม</button>
            </section>

            <ul style={styles.list}>
                {sorted.map(({ row, index }) => (
                    <li key={index} style={styles.li}>
                        <span style={styles.tag}>{row.category}</span>
                        <span style={styles.keyword}>{row.keyword}</span>
                        <button style={styles.removeBtn} onClick={() => removeRow(index)}>ลบ</button>
                    </li>
                ))}
            </ul>

            <p style={styles.count}>
                รวม {rows.length} คำ · software {rows.filter((r) => r.category === 'software').length} ·
                non-software {rows.filter((r) => r.category === 'non-software').length}
            </p>

            <section style={styles.actions}>
                <button style={styles.primary} onClick={save}>บันทึก</button>
                <button style={styles.button} onClick={reclassify}>จำแนก TOR ใหม่</button>
            </section>

            {message && <p style={styles.message}>{message}</p>}
        </main>
    );
}

const styles = {
    main: { padding: 24, maxWidth: 760, margin: '0 auto', fontFamily: 'system-ui, sans-serif' },
    h1: { fontSize: 22, marginBottom: 4 },
    hint: { color: '#555', fontSize: 14, lineHeight: 1.6, marginBottom: 20 },
    addRow: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
    input: { padding: '6px 10px', fontSize: 14, border: '1px solid #ccc', borderRadius: 6 },
    button: { padding: '6px 14px', fontSize: 14, borderRadius: 6, border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer' },
    primary: { padding: '6px 14px', fontSize: 14, borderRadius: 6, border: '1px solid #2563eb', background: '#2563eb', color: '#fff', cursor: 'pointer' },
    list: { listStyle: 'none', padding: 0, margin: 0, border: '1px solid #eee', borderRadius: 8 },
    li: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderBottom: '1px solid #f0f0f0' },
    tag: { fontSize: 11, textTransform: 'uppercase', color: '#888', minWidth: 96 },
    keyword: { flex: 1, fontSize: 14 },
    removeBtn: { fontSize: 13, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer' },
    count: { color: '#666', fontSize: 13, margin: '12px 0' },
    actions: { display: 'flex', gap: 8, marginTop: 8 },
    message: { marginTop: 16, fontSize: 14 },
};
