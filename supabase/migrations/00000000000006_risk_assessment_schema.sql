create table risk_assessment (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episode (id),
  assessment_time timestamptz not null default now(),
  rule_score numeric(10, 4) not null,
  ml_score numeric(10, 4),
  final_risk_band text not null check (final_risk_band in ('low', 'medium', 'high')),
  explanation_json jsonb not null default '{}'::jsonb,
  overridden_by uuid references app_user (id),
  override_reason text,
  status text not null check (
    status in ('Pending', 'Computed', 'Overridden', 'Failed', 'FallbackRuleOnly')
  ),
  created_at timestamptz not null default now()
);
create index risk_assessment_pregnancy_episode_id_idx on risk_assessment (pregnancy_episode_id);
create index risk_assessment_assessment_time_idx on risk_assessment (assessment_time);
create index risk_assessment_status_idx on risk_assessment (status);

alter table risk_assessment enable row level security;
