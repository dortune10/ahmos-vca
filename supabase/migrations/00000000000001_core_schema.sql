create table facility (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  type text not null check (type in ('community', 'clinic', 'hospital')),
  contact_phone text,
  accepting_referrals boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table person (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  first_name text not null,
  last_name text,
  phone_primary text,
  date_of_birth date,
  address_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index person_phone_primary_idx on person (phone_primary);
create index person_tenant_id_idx on person (tenant_id);

create table app_user (
  id uuid primary key references auth.users (id),
  tenant_id uuid not null,
  email text not null,
  role text not null check (role in ('chw', 'nurse', 'clinician', 'supervisor', 'admin')),
  facility_id uuid references facility (id),
  full_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index app_user_tenant_id_idx on app_user (tenant_id);

alter table facility enable row level security;
alter table person enable row level security;
alter table app_user enable row level security;
