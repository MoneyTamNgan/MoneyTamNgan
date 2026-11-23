'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
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
    // Saves run one after another so two quick clicks never race on the server.
    const queue = useRef(Promise.resolve());
    const inFlight = useRef(0);

    // Show a manual pass or fail at once. Clearing an override (status null) needs the
    // server's own result, so that case still waits for the response.
    function applyOptimistic(itemIds, status) {
        const ids = new Set(itemIds);
        setResult(previous => {
            const checklist = previous?.checklist;
            if (!checklist || previous.projectId !== projectId || previous.attempt !== attempt) return previous;
            const summary = { ...checklist.summary };
            const items = checklist.items.map(entry => {
                if (!ids.has(entry.id) || entry.status === status) return entry;
                summary[entry.status] = Math.max(0, summary[entry.status] - 1);
                summary[status] = (summary[status] ?? 0) + 1;
                return { ...entry, status, overrideStatus: status, reason: 'Status set manually.' };
            });
            return { ...previous, checklist: { ...checklist, items, summary } };
        });
    }

    function saveStatus(itemId, status) {
        return send(status === null ? [] : [itemId], status, { itemId, status });
    }

    // One request for many items, for example "mark everything as passed".
    function saveStatuses(itemIds, status) {
        return send(itemIds, status, { itemIds, status });
    }

    function send(optimisticIds, status, body) {
        if (optimisticIds.length) applyOptimistic(optimisticIds, status);
        inFlight.current += 1;
        setPendingSaves(count => count + 1);
        const run = queue.current.then(async () => {
            const checklist = await bidPrepRequest(url, { method: 'PATCH', body });
            // Only the last pending save replaces the screen, so earlier answers cannot undo newer clicks.
            if (inFlight.current === 1) {
                setResult(previous => previous?.projectId === projectId && previous?.attempt === attempt
                    ? { ...previous, checklist }
                    : previous);
            }
        });
        queue.current = run.catch(() => {});
        return run.catch(error => {
            setAttempt(value => value + 1); // reload the real state after a failed save
            throw error;
        }).finally(() => {
            inFlight.current -= 1;
            setPendingSaves(count => count - 1);
        });
    }

    return (
        <TorChecklistContext.Provider value={{ current, saveStatus, saveStatuses, isSaving: pendingSaves > 0, retry: () => setAttempt(value => value + 1) }}>
            {children}
        </TorChecklistContext.Provider>
    );
}
