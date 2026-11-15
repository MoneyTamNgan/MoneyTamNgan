import DraftEditor from '@/components/bid-prep/DraftEditor';
export default async function DraftEditorPage({ params }) {
    const { id } = await params;
    return <DraftEditor draftId={id} />;
}
