create table pregnancy_episode (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id),
  facility_id uuid not null references facility (id),
  lmp_date date,
  estimated_delivery_date date,
  gestational_age_weeks integer check (
    gestational_age_weeks is null or (gestational_age_weeks >= 0 and gestational_age_weeks <= 45)
  ),
  risk_band text check (risk_band is null or risk_band in ('low', 'medium', 'high')),
  status text not null default 'Active' check (
    status in ('Draft', 'Active', 'Referred', 'Delivered', 'PostnatalActive', 'Closed', 'Archived')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pregnancy_episode_person_id_idx on pregnancy_episode (person_id);
create index pregnancy_episode_facility_id_idx on pregnancy_episode (facility_id);
create index pregnancy_episode_status_idx on pregnancy_episode (status);

create table encounter_note (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episode (id),
  recorded_by uuid not null references app_user (id),
  recorded_at timestamptz not null default now(),
  note_text text,
  vitals_json jsonb,
  created_at timestamptz not null default now()
);
create index encounter_note_pregnancy_episode_id_idx on encounter_note (pregnancy_episode_id);

create table care_task (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episode (id),
  task_type text not null check (task_type in ('anc_visit', 'pnc_visit', 'newborn_check')),
  assigned_user_id uuid references app_user (id),
  due_at timestamptz not null,
  completed_at timestamptz,
  status text not null default 'Scheduled' check (status in ('Scheduled', 'Due', 'Completed', 'Missed')),
  priority text not null default 'routine' check (priority in ('routine', 'urgent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index care_task_pregnancy_episode_id_idx on care_task (pregnancy_episode_id);
create index care_task_assigned_user_id_idx on care_task (assigned_user_id);
create index care_task_status_idx on care_task (status);
create index care_task_due_at_idx on care_task (due_at);

alter table pregnancy_episode enable row level security;
alter table encounter_note enable row level security;
alter table care_task enable row level security;
