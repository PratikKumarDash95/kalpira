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

The server database adapter expects the tables defined in `schema.sql`.
