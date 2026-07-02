# Kalpira Architecture (post-consolidation)

## Model
Four processes. The **backend owns all logic**; the three apps are **frontend only**.

| Process       | Port | Role                                                                 |
|---------------|------|---------------------------------------------------------------------|
| `backend`     | 3003 | Express webserver. ALL API routes, auth, email, OAuth, AI, Supabase |
| `user`        | 3000 | Frontend only (static). Calls the backend.                          |
| `admin`       | 3001 | Frontend only (static). Calls the backend.                          |
| `interviewer` | 3002 | Frontend only (static). Calls the backend.                          |

The frontends talk to the backend via `NEXT_PUBLIC_API_URL` (default `http://localhost:3003`),
used by `src/lib/apiClient.ts` (`apiFetch` / `apiUrl`). No frontend contains API routes,
middleware, or server-only libraries anymore.

## Backend internals
- `backend/server/server.ts` — entry point (run via `tsx`). CORS (all 3 origins, credentials),
  JSON body parsing, AI rate limiting, then mounts routes.
- `backend/server/next-compat/` — thin compatibility layer so the migrated Next.js
  App-Router route files run **unchanged**:
  - `next-server.ts` — `NextResponse` / `NextRequest` over the Node global `Response`/`Request`.
  - `next-headers.ts` — `cookies()` / `headers()` (hybrid sync+await), backed by the active request.
  - `context.ts` — `AsyncLocalStorage` request scope + cookie parsing.
  - `adapt.ts` — Express `(req,res)` ⇄ Web `Request`/`Response`, flushes `Set-Cookie`.
  - `route-loader.ts` — auto-mounts `server/app/api/**/route.ts` (`[id]` → `:id`).
- `backend/server/app/` — mirror of the old `user/src` server code:
  - `app/api/**` — the 53 migrated route files (65 HTTP handlers).
  - `app/lib/**`, `app/utils/**`, `app/types.ts` — server libraries (Supabase, auth, email, AI providers…).
  - `@/*` resolves here (tsconfig `paths`).
- `backend/server/routes/*.js` — the pre-existing hand-written AI interview routes (kept).

## Env
- `backend/.env` holds **all secrets** (Supabase service role, SESSION_SECRET, BREVO, OAuth, AI keys).
- Each frontend `.env` holds only `NEXT_PUBLIC_*` (API URL + public Supabase values).

## Run
```
npm run dev      # all four (concurrently)
# or individually:
cd backend && npm run dev      # tsx watch, port 3003
cd user && npm run dev         # port 3000
```

## Known follow-up
The three apps are configured with Next `output: 'export'`. Pages with runtime-dynamic
segments (`/studies/[id]`, `/candidate/interview/[id]`, `/p/[token]`, `/results/[sessionId]`, …)
need either `generateStaticParams()` or a switch to client-side routing to complete a static
`next build`. This predates the backend consolidation (these apps previously ran only via
`next dev`). See the deployment decision below.
