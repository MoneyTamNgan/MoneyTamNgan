import DraftWorkspace from '@/components/bid-prep/DraftWorkspace';
export default async function BidPrepPage({ searchParams }) {
    const query = await searchParams;
    return <DraftWorkspace initialProjectId={typeof query?.projectId === 'string' ? query.projectId : ''} />;
}
