export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { getRequestContext } from '@/lib/researcherContext';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export async function POST(request: Request) {
  try {
    const { authorized, context, researcherId, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: 'Supabase upload is not configured. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const kind = formData.get('kind');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    if (kind !== 'avatar' && kind !== 'cover') {
      return NextResponse.json({ error: 'Invalid media kind' }, { status: 400 });
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Only PNG, JPG, WEBP, or GIF images are allowed' }, { status: 400 });
    }

    if (file.size > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: 'Image must be 5 MB or smaller' }, { status: 400 });
    }

    const userId = researcherId || context.userId;
    if (!userId) {
      return NextResponse.json({ error: 'No profile identity' }, { status: 401 });
    }

    const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const objectPath = `${userId}/${kind}-${randomUUID()}.${extension}`;
    const bytes = await file.arrayBuffer();

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: uploadError } = await supabase.storage
      .from('profile-images')
      .upload(objectPath, bytes, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data } = supabase.storage.from('profile-images').getPublicUrl(objectPath);

    return NextResponse.json({
      bucket: 'profile-images',
      objectPath,
      publicUrl: data.publicUrl,
      kind,
    });
  } catch (error) {
    console.error('Profile media upload error:', error);
    return NextResponse.json({ error: 'Failed to upload media' }, { status: 500 });
  }
}
