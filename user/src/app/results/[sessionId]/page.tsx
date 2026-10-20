import InterviewResults from '@/components/InterviewResults';
import RequireAuth from '@/components/RequireAuth';

interface Props {
    params: Promise<{ sessionId: string }>;
}

export default async function ResultsPage({ params }: Props) {
    const { sessionId } = await params;
    return (
        <RequireAuth redirectTo="/login">
            <InterviewResults sessionId={sessionId} />
        </RequireAuth>
    );
}

