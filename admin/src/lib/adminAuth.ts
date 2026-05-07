import { cookies } from 'next/headers';
import prisma from './prisma';
import { SESSION_COOKIE_NAME, verifySessionToken } from './auth';

export async function isAdminSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return false;

  const session = await verifySessionToken(token);
  if (!session.valid) return false;

  if (!session.researcherId) return true;

  const user = await prisma.user.findUnique({
    where: { id: session.researcherId },
    select: { role: true },
  });

  return user?.role === 'admin';
}
