'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { bidPrepRequest } from '@/lib/services/bid-prep-client';

const TorChecklistContext = createContext(null);

export function useTorChecklist() {
    return useContext(TorChecklistContext);
}

export default function TorChecklistProvider({ projectId, children }) {
    const [attempt, setAttempt] = useState(0);
    const [result, setResult] = useState(null);
    const [pendingSaves, setPendingSaves] = useState(0);
    const url = `/api/bid-prep/tors/${encodeURIComponent(projectId)}/checklist`;

    useEffect(() => {
        if (!projectId) return;
        const controller = new AbortController();
        bidPrepRequest(url, { signal: controller.signal })
            .then(checklist => {
                if (!controller.signal.aborted) setResult({ projectId, attempt, checklist });
            })
            .catch(error => {
                if (!controller.signal.aborted) setResult({ projectId, attempt, error });
            });
        return () => controller.abort();
    }, [projectId, url, attempt]);

    const current = result && result.projectId === projectId && result.attempt === attempt ? result : null;
    async function saveStatus(itemId, status) {
        setPendingSaves(count => count + 1);
        try {
            const checklist = await bidPrepRequest(url, { method: 'PATCH', body: { itemId, status } });
            setResult(previous => previous?.projectId === projectId && previous?.attempt === attempt
                ? { ...previous, checklist }
                : previous);
        } finally {
            setPendingSaves(count => count - 1);
        }
    }

    return (
        <TorChecklistContext.Provider value={{ current, saveStatus, isSaving: pendingSaves > 0, retry: () => setAttempt(value => value + 1) }}>
            {children}
        </TorChecklistContext.Provider>
    );
}
