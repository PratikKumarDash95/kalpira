# Supabase Database Setup

Run `schema.sql` in your Supabase project before using the app.

Options:

1. Open Supabase Dashboard -> SQL Editor, paste `schema.sql`, and run it.
2. Or use Supabase CLI from this repo:

```bash
supabase db push
```

Required server env vars:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Optional payments env vars:

```bash
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
```

The server database adapter expects the tables defined in `schema.sql`.

## Optional media buckets

This repo includes `migrations/20260518000000_media_storage.sql` for Supabase Storage:

- `profile-images`: public bucket for user avatars/profile images, 5 MB max.
- `interview-media`: private bucket for interview images/videos, 500 MB max.
- `MediaAsset`: Postgres metadata table linking uploaded files to users, studies, or sessions.

Run migrations with:

```bash
supabase db push
```

For uploaded files, store the file in Supabase Storage and save only the URL/object path in Postgres.
