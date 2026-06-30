import { StudyConfig } from '@/types';

const END_OF_DAY_TIME = 'T23:59:59.999';

export function dateInputToEndsAt(value: string): number | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}${END_OF_DAY_TIME}`);
  return Number.isNaN(date.getTime()) ? undefined : date.getTime();
}

export function endsAtToDateInput(value?: number): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isInterviewClosed(config?: Pick<StudyConfig, 'endsAt'> | null, now = Date.now()): boolean {
  return typeof config?.endsAt === 'number' && now > config.endsAt;
}

export function formatInterviewEndDate(value?: number): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
