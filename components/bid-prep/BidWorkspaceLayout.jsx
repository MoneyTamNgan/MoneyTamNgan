import Link from 'next/link';
import AppShell from '@/components/ui/AppShell';
import NoEgpSubmissionNotice from '@/components/ui/NoEgpSubmissionNotice';
import { AI_DRAFT_NOTICE } from '@/lib/bid-prep/notices';

export default function BidWorkspaceLayout({ title, navigation, headerDetails, children }) {
    return (
        <AppShell title={title} hideTitle>
            <div className={`bid-workspace${navigation ? ' tor-overview-layout' : ''}`}>
                {navigation && (
                    <aside className="tor-overview-side">
                        <p>{navigation.title}</p>
                        <div className="tor-overview-utility">
                            <Link className="tor-overview-button" href={navigation.href}>← {navigation.label}</Link>
                            {navigation.torDetailsHref && (
                                <Link className="tor-overview-button" href={navigation.torDetailsHref} target="_blank" rel="noreferrer">เปิดรายละเอียด TOR ↗</Link>
                            )}
                        </div>
                    </aside>
                )}
                <div className="bid-workspace-content">
                    <NoEgpSubmissionNotice />
                    <header className="bid-workspace-header">
                        <h1>{title}</h1>
                        {headerDetails}
                    </header>
                    <p className="bid-notice" role="note" lang="en"><strong>{AI_DRAFT_NOTICE}</strong></p>
                    {children}
                </div>
            </div>
        </AppShell>
    );
}
