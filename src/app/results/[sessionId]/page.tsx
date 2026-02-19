import InterviewResults from '@/components/InterviewResults';

interface Props {
    params: Promise<{ sessionId: string }>;
}

export default async function ResultsPage({ params }: Props) {
    const { sessionId } = await params;
    return <InterviewResults sessionId={sessionId} />;
}
