import { NO_EGP_SUBMISSION_NOTICE_TH } from '@/lib/bid-prep/notices';

export default function NoEgpSubmissionNotice() {
    return (
        <p className="no-egp-notice" role="note">
            {NO_EGP_SUBMISSION_NOTICE_TH}
        </p>
    );
}
