/** User-facing copy. This file stays free of server-only imports so the UI can use it. */

export const DELETE_COMPANY_DATA_CONFIRMATION = 'DELETE_COMPANY_DATA';

export const AI_DRAFT_NOTICE = 'This is an AI draft. Check every statement and its source before submitting.';

export const NO_EGP_SUBMISSION_NOTICE = 'MoneyTamNgan does not submit a bid to e-GP. The seller must review this draft and submit it with their own digital signature.';

export const NO_EGP_SUBMISSION_NOTICE_TH = 'ระบบนี้ไม่ยื่นซองต่อ e-GP ให้ผู้ใช้ ผู้ขายต้องตรวจสอบเอกสารแล้วไปยื่นด้วยลายมือชื่อดิจิทัลของตนเอง';

export function bidPrepNotices() {
    return {
        aiDraft: AI_DRAFT_NOTICE,
        noEgpSubmission: NO_EGP_SUBMISSION_NOTICE,
        noEgpSubmissionTh: NO_EGP_SUBMISSION_NOTICE_TH,
    };
}
