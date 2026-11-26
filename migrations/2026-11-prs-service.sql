-- CompliantUK — Rental Property Register service (paid features)
-- Applied to Supabase project ihfbagpupottobyeciwq on 26 Nov 2026.

-- 0. SECURITY FIX: the old "Service role full access" policies were granted to the
--    PUBLIC role with USING (true), which let anyone holding the public anon key read
--    and modify every order and tenancy. The service role bypasses RLS anyway, so
--    these policies are removed. Duplicate "Users can view own" policies are tidied.
drop policy if exists "Service role full access orders" on public.orders;
drop policy if exists "Service role full access tenancies" on public.tenancies;
drop policy if exists "Users can view own orders" on public.orders;
drop policy if exists "Users can view own tenancies" on public.tenancies;

-- 1. Entitlements created by the Stripe webhook (service role only writes)
create table if not exists public.prs_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product text not null check (product in ('register_ready','monitor')),
  properties integer not null check (properties between 1 and 500),
  status text not null default 'active' check (status in ('active','past_due','canceled')),
  amount_paid integer,
  stripe_session_id text unique,
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prs_entitlements_user_idx on public.prs_entitlements(user_id);
alter table public.prs_entitlements enable row level security;
drop policy if exists "Own entitlements readable" on public.prs_entitlements;
create policy "Own entitlements readable" on public.prs_entitlements
  for select to authenticated using ((select auth.uid()) = user_id);

-- 2. Landlord profile (landlord number from the GOV.UK service, contact details)
create table if not exists public.prs_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  correspondence_address text,
  landlord_ref text,
  account_created_on date,
  agent_name text,
  updated_at timestamptz not null default now()
);
alter table public.prs_profiles enable row level security;
drop policy if exists "Own profile" on public.prs_profiles;
create policy "Own profile" on public.prs_profiles
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 3. Properties
create table if not exists public.prs_properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null,
  postcode text,
  region text,
  property_type text,
  bedrooms integer,
  is_hmo boolean default false,
  licence_ref text,
  tenancy_status text,
  epc_rating text,
  deposit_scheme text,
  property_ref text,
  record_started_on date,
  record_completed boolean not null default false,
  fee_paid_on date,
  notes text,
  deadline_alerts_sent integer[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prs_properties_user_idx on public.prs_properties(user_id);
alter table public.prs_properties enable row level security;
drop policy if exists "Own properties" on public.prs_properties;
create policy "Own properties" on public.prs_properties
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Paid-property limit: a user can add as many properties as their active entitlements cover
create or replace function public.prs_enforce_property_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed integer;
  used integer;
begin
  select coalesce(sum(e.properties), 0) into allowed
    from public.prs_entitlements e
   where e.user_id = new.user_id and e.status in ('active','past_due');
  select count(*) into used from public.prs_properties p where p.user_id = new.user_id;
  if used >= allowed then
    raise exception 'PROPERTY_LIMIT: your plan covers % propert(y/ies). Buy more to add another.', allowed
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.prs_enforce_property_limit() from public, anon, authenticated;
drop trigger if exists prs_property_limit on public.prs_properties;
create trigger prs_property_limit before insert on public.prs_properties
  for each row execute function public.prs_enforce_property_limit();

-- 4. Certificates (files live in the private "prs-vault" bucket under <user_id>/...)
create table if not exists public.prs_certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.prs_properties(id) on delete cascade,
  cert_type text not null check (cert_type in ('gas','eicr','epc','licence','deposit','how_to_rent','other')),
  issued_on date,
  expires_on date,
  epc_rating text,
  file_path text,
  file_name text,
  alerts_sent integer[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists prs_certificates_user_idx on public.prs_certificates(user_id);
create index if not exists prs_certificates_property_idx on public.prs_certificates(property_id);
create index if not exists prs_certificates_expiry_idx on public.prs_certificates(expires_on);
alter table public.prs_certificates enable row level security;
drop policy if exists "Own certificates" on public.prs_certificates;
create policy "Own certificates" on public.prs_certificates
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.prs_properties p where p.id = property_id and p.user_id = (select auth.uid()))
  );

-- 5. Private storage bucket for the certificate vault
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prs-vault', 'prs-vault', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "prs-vault own read" on storage.objects;
drop policy if exists "prs-vault own insert" on storage.objects;
drop policy if exists "prs-vault own update" on storage.objects;
drop policy if exists "prs-vault own delete" on storage.objects;
create policy "prs-vault own read" on storage.objects for select to authenticated
  using (bucket_id = 'prs-vault' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "prs-vault own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'prs-vault' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "prs-vault own update" on storage.objects for update to authenticated
  using (bucket_id = 'prs-vault' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "prs-vault own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'prs-vault' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 6. Extra fields the GOV.UK service asks for (applied as migration prs_properties_govuk_fields)
alter table public.prs_properties
  add column if not exists has_gas boolean not null default true,
  add column if not exists rent_amount numeric(10,2),
  add column if not exists rent_frequency text,
  add column if not exists tenancy_type text,
  add column if not exists agent_contact text,
  add column if not exists freeholder_contact text,
  add column if not exists superior_landlord_contact text,
  add column if not exists joint_landlords text;
alter table public.prs_certificates
  add column if not exists on_register boolean not null default false;
alter table public.prs_profiles
  add column if not exists landlord_type text,
  add column if not exists company_number text;
