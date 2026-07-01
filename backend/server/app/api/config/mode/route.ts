// GET /api/config/mode - Returns deployment mode
// Used by client to decide whether to show OAuth or password login

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDeploymentMode } from '@/lib/mode';

export async function GET() {
  return NextResponse.json({ mode: getDeploymentMode() });
}
