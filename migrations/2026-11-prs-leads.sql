-- CompliantUK — PRS Database pivot (Nov 2026)
-- Run once in Supabase → SQL Editor. Stores leads from /api/prs-readiness
-- (free readiness checker, early-access reservations, agency quote requests).
-- Applied to Supabase project ihfbagpupottobyeciwq on 26 Nov 2026.
-- Also creates subscribers + contact_submissions (defined in SUPABASE_SCHEMA.sql but missing from the database).
CREATE TABLE IF NOT EXISTS public.subscribers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text UNIQUE NOT NULL,
  subscribed boolean DEFAULT true,
  subscribed_at timestamptz DEFAULT now(),
  unsubscribed_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.contact_submissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  subject text,
  message text NOT NULL,
  submitted_at timestamptz DEFAULT now()
);
ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.prs_leads (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),
  type          text NOT NULL CHECK (type IN ('check','reserve','agent')),
  email         text NOT NULL,
  name          text,
  company       text,
  role          text,
  postcode      text,
  country       text,
  region        text,
  council       text,
  let_status    text,
  tenancy_type  text,
  gas           text,
  hmo           text,
  plan          text,
  properties    integer,
  fee_estimate  text,
  message       text,
  optin         boolean DEFAULT true
);
CREATE INDEX IF NOT EXISTS prs_leads_email_idx  ON public.prs_leads (email);
CREATE INDEX IF NOT EXISTS prs_leads_region_idx ON public.prs_leads (region);
CREATE INDEX IF NOT EXISTS prs_leads_type_idx   ON public.prs_leads (type);
-- Only the service role (used by API functions) can read/write. No public policies.
ALTER TABLE public.prs_leads ENABLE ROW LEVEL SECURITY;
