-- Cache table for Hacienda consultas (TTL handled at query time = 24h)
create table if not exists public.tax_query_cache (
  id bigint generated always as identity primary key,
  cedula text not null unique,
  response_json jsonb not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tax_query_cache_fetched_at
  on public.tax_query_cache (fetched_at desc);

-- Keep updated_at in sync automatically
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tax_query_cache_set_updated_at on public.tax_query_cache;
create trigger tax_query_cache_set_updated_at
before update on public.tax_query_cache
for each row
execute function public.set_updated_at();

-- Optional housekeeping function to purge stale cache rows older than 7 days
create or replace function public.purge_old_tax_query_cache()
returns integer
language plpgsql
as $$
declare
  deleted_count integer;
begin
  delete from public.tax_query_cache
  where fetched_at < now() - interval '7 days';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
