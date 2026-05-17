-- Optional media storage buckets for profile images and interview media.
-- Run with `supabase db push`, or paste this file into the Supabase SQL editor.
-- These buckets store files in Supabase Storage; table columns should store
-- the resulting public URL or object path.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-images',
  'profile-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'interview-media',
  'interview-media',
  false,
  524288000,
  array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Keep lightweight metadata in Postgres so uploaded media can be connected
-- to users, studies, and sessions without storing large files in SQL rows.
create table if not exists public."MediaAsset" (
  "id" text primary key default gen_random_uuid()::text,
  "userId" text references public."User"("id") on delete set null,
  "studyId" text references public."Study"("id") on delete set null,
  "sessionId" text references public."InterviewSession"("id") on delete set null,
  "bucket" text not null,
  "objectPath" text not null,
  "publicUrl" text,
  "mediaType" text not null,
  "mimeType" text,
  "fileSize" bigint,
  "createdAt" timestamptz not null default now(),
  unique ("bucket", "objectPath")
);

create index if not exists "MediaAsset_userId_idx" on public."MediaAsset"("userId");
create index if not exists "MediaAsset_studyId_idx" on public."MediaAsset"("studyId");
create index if not exists "MediaAsset_sessionId_idx" on public."MediaAsset"("sessionId");

-- Storage RLS examples. These are intentionally permissive for local/dev use
-- with anon client uploads to the profile-images bucket. Tighten these policies
-- before production if you expose browser uploads.
drop policy if exists "Public can read profile images" on storage.objects;
create policy "Public can read profile images"
on storage.objects for select
using (bucket_id = 'profile-images');

drop policy if exists "Authenticated clients can upload profile images" on storage.objects;
create policy "Authenticated clients can upload profile images"
on storage.objects for insert
with check (bucket_id = 'profile-images');

drop policy if exists "Authenticated clients can update profile images" on storage.objects;
create policy "Authenticated clients can update profile images"
on storage.objects for update
using (bucket_id = 'profile-images')
with check (bucket_id = 'profile-images');

drop policy if exists "Authenticated clients can read interview media" on storage.objects;
create policy "Authenticated clients can read interview media"
on storage.objects for select
using (bucket_id = 'interview-media');

drop policy if exists "Authenticated clients can upload interview media" on storage.objects;
create policy "Authenticated clients can upload interview media"
on storage.objects for insert
with check (bucket_id = 'interview-media');
