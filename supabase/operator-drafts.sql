-- Trwaly zapis kolejek skanowania na operatora (ADD/MOVE + lokalizacje aktywne).
create table if not exists public.operator_drafts (
  operator_id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.operator_drafts enable row level security;

drop policy if exists operator_drafts_no_client_access on public.operator_drafts;
create policy operator_drafts_no_client_access
on public.operator_drafts
for all
to anon, authenticated
using (false)
with check (false);

create or replace function public.touch_operator_drafts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_operator_drafts_updated_at on public.operator_drafts;
create trigger trg_operator_drafts_updated_at
before update on public.operator_drafts
for each row execute function public.touch_operator_drafts_updated_at();
