-- Adds profile media fields for avatar and cover images.

alter table public."User"
add column if not exists "coverUrl" text;
