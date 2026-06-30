import { redirect } from 'next/navigation';

type PageProps = {
    searchParams?: Record<string, string | string[] | undefined>;
};

const firstParam = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

export default function InterviewerLoginPage({ searchParams }: PageProps) {
    const params = new URLSearchParams({ role: 'interviewer' });

    for (const key of ['redirect', 'error', 'detail']) {
        const value = firstParam(searchParams?.[key]);
        if (value) params.set(key, value);
    }

    redirect(`/login?${params.toString()}`);
}

export const metadata = {
    title: 'Interviewer Sign In | OpenInterviewer',
    description: 'Sign in to your interviewer account to manage interviews and view candidate results.',
};
