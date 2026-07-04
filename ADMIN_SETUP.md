# Admin console — setup & deployment

The admin console (`admin/`) is a standalone Next.js app that manages the whole
platform through the backend's `/api/admin/*` routes. This doc covers the env
vars it needs and the cross-site cookie caveat that decides whether admin login
"sticks".

## How admin auth works

1. An admin signs in on the **user app** (`/login` → Admin tab). Login can be:
   - the **legacy admin password** (`ADMIN_PASSWORD`) — session has no user id, but
     is treated as a global admin, or
   - any user account whose **`role = 'admin'`** (set it via the Users page or the
     `/api/admin/fix-role` route).
2. The backend sets the `research-auth` session cookie.
3. The browser is redirected to the admin app (`NEXT_PUBLIC_ADMIN_URL`), which
   calls the backend with `credentials: 'include'`.

All `/api/admin/*` routes authorize through the shared `requireAdmin()` helper
(`backend/server/app/lib/adminAuth.ts`), which accepts **both** login styles. (The
old per-route check rejected the legacy admin, which is why every stat showed 0.)

## Required environment variables

### Backend (`backend/`)
| Var | Purpose |
|-----|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | DB access for admin queries/mutations |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SESSION_SECRET` | JWT signing secret (falls back to `ADMIN_PASSWORD`) |
| `ADMIN_PASSWORD` | Legacy admin password login |
| `CORS_ORIGIN` | Extra allowed origins (comma-separated). `kalpira-admin.vercel.app` is already baseline-allowed |
| `DEPLOYMENT_MODE` | `standalone` (default) or `hosted`. **Legacy admin password only works in `standalone`** — in `hosted` a session must carry a user id, so use a `role=admin` account instead |
| `COOKIE_DOMAIN` | Optional. Set to a shared parent domain (e.g. `.kalpira.in`) to make the session cookie first-party across subdomains — see below |
| `CROSS_SITE_COOKIES` | Optional `true` to force `SameSite=None; Secure` if `NODE_ENV` isn't `production` |

### Admin app (`admin/`)
| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_API_URL` | **Required.** Absolute backend URL, e.g. `https://api.kalpira.in`. Without it the admin app calls its own origin and every request 404s |
| `NEXT_PUBLIC_MAIN_APP_URL` | User app URL for "Back to App" / logout redirect |

### User app (`user/`)
| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_ADMIN_URL` | Admin app URL. Without it, the `/admin` redirect falls back to `http://localhost:3001` |

> `NEXT_PUBLIC_*` values are inlined at **build time** — after changing any of
> them you must **redeploy**, not just restart.

## Cross-site cookie caveat (read this if login "doesn't stick")

The session cookie is set on the **backend's** domain. When the admin app lives on
a different registrable domain (e.g. `kalpira-admin.vercel.app`) than the backend
(e.g. `*.onrender.com`), that cookie is **third-party**. The code already sends it
correctly (`SameSite=None; Secure`), but Chrome/Safari increasingly **block
third-party cookies outright**, so the admin app's requests arrive with no cookie
and `requireAdmin()` returns 401 → zeros again.

**Recommended fix — make the cookie first-party:**
- Serve the backend from a **subdomain of the frontend domain**, e.g.
  `api.kalpira.in` with the admin app on `admin.kalpira.in`.
- Set `COOKIE_DOMAIN=.kalpira.in` on the backend.

Then the cookie is first-party to `*.kalpira.in` and rides every request even with
third-party cookies disabled. The `*.vercel.app` domains are fine for development
but will hit the third-party-cookie wall in production browsers.

## New DB migration

This change adds `backend/supabase/migrations/20260704000000_add_interview_feedback.sql`
(the `InterviewFeedback` table for candidate → interviewer ratings). Apply it with
`supabase db push` (or run the SQL in the Supabase SQL editor) before deploying.
