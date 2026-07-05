-- Interviewer subscription plans + Razorpay payments.
-- Adds plan fields to "User" and a "Payment" audit table.

alter table public."User"
  add column if not exists "subscriptionPlan" text not null default 'free',
  add column if not exists "planExpiresAt" timestamptz;

create table if not exists public."Payment" (
  "id" text primary key default gen_random_uuid()::text,
  "userId" text references public."User"("id") on delete set null,
  "plan" text not null,
  "amount" integer not null default 0,
  "currency" text not null default 'INR',
  "razorpayOrderId" text,
  "razorpayPaymentId" text,
  "status" text not null default 'created',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists "Payment_userId_idx" on public."Payment"("userId");
create index if not exists "Payment_razorpayOrderId_idx" on public."Payment"("razorpayOrderId");

drop trigger if exists "Payment_set_updated_at" on public."Payment";
create trigger "Payment_set_updated_at"
before update on public."Payment"
for each row execute function public.set_updated_at();
