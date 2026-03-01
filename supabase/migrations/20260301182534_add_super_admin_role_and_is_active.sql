-- Add 'super_admin' to the app_role enum (before 'admin' for logical ordering)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin' BEFORE 'admin';

-- Add is_active column to profiles (default true for all existing users)
ALTER TABLE public.profiles
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Index for efficient filtering by active status
CREATE INDEX idx_profiles_is_active ON public.profiles (is_active);
