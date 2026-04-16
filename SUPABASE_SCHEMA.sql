-- CompliantUK Database Schema Updates
-- Run these in your Supabase SQL Editor

-- 1. Contact Submissions Table
CREATE TABLE IF NOT EXISTS public.contact_submissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT,
    message TEXT NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Bulk Orders Table (to handle large property lists)
CREATE TABLE IF NOT EXISTS public.bulk_orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    plan TEXT NOT NULL,
    property_count INTEGER NOT NULL,
    total_gbp DECIMAL(10, 2) NOT NULL,
    landlord_first TEXT NOT NULL,
    landlord_last TEXT NOT NULL,
    landlord_email TEXT NOT NULL,
    price_per_property DECIMAL(10, 2),
    extra_tenant_cost DECIMAL(10, 2),
    properties_data JSONB NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, paid, processed, failed
    stripe_session_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    paid_at TIMESTAMPTZ
);

-- 3. Update Subscribers Table (if not already exists)
CREATE TABLE IF NOT EXISTS public.subscribers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    subscribed BOOLEAN DEFAULT true,
    subscribed_at TIMESTAMPTZ DEFAULT now(),
    unsubscribed_at TIMESTAMPTZ
);

-- Add 'subscribed' and 'unsubscribed_at' if the table exists but lacks these columns
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscribers' AND column_name='subscribed') THEN
        ALTER TABLE public.subscribers ADD COLUMN subscribed BOOLEAN DEFAULT true;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscribers' AND column_name='unsubscribed_at') THEN
        ALTER TABLE public.subscribers ADD COLUMN unsubscribed_at TIMESTAMPTZ;
    END IF;
END $$;

-- 4. Set up Row Level Security (RLS)
-- For security, only allow service_role to access these tables if needed, 
-- or set up specific policies. For serverless functions, service_role is used.
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;

-- Simple policy: service_role has full access (default in Supabase)
-- If you need specific user access, add policies here.
