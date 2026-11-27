-- GoTrue's email uniqueness index protects normal signups. Normalize every
-- incoming address and guard against duplicates across all identity providers.
create function public.layer_normalize_auth_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.email := nullif(lower(btrim(new.email)), '');
  if new.email is null then return new; end if;
  if tg_op = 'UPDATE' and new.email is not distinct from old.email then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.email, 12043));
  if exists (select 1 from auth.users where lower(btrim(email))=new.email and id<>new.id) then
    raise unique_violation using message = 'Email address is already registered';
  end if;
  return new;
end $$;
revoke all on function public.layer_normalize_auth_email() from public, anon, authenticated, service_role;
create trigger layer_normalize_auth_email
before insert or update of email on auth.users
for each row execute function public.layer_normalize_auth_email();

create function public.layer_email_registered(address text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users where lower(btrim(email))=lower(btrim(address)))
$$;
revoke all on function public.layer_email_registered(text) from public, anon, authenticated, service_role;
grant execute on function public.layer_email_registered(text) to service_role;

create table public.layer_security_events (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users on delete cascade,
  event text not null,
  occurred_at timestamptz not null default clock_timestamp()
);
create index layer_security_events_owner on public.layer_security_events(owner, occurred_at desc);

create table public.layer_auth_devices (
  owner uuid not null references auth.users on delete cascade,
  fingerprint text not null,
  primary key (owner, fingerprint)
);

create table public.layer_auth_limits (
  key text primary key,
  bucket timestamptz not null,
  attempts integer not null
);

alter table public.layer_security_events enable row level security;
alter table public.layer_auth_devices enable row level security;
alter table public.layer_auth_limits enable row level security;
revoke all on public.layer_security_events, public.layer_auth_devices, public.layer_auth_limits from public, anon, authenticated, service_role;
grant select on public.layer_security_events to authenticated;
grant all on public.layer_security_events, public.layer_auth_devices, public.layer_auth_limits to service_role;

create function public.layer_session_valid() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.sessions where user_id = auth.uid()
    and id::text = auth.jwt()->>'session_id' and (not_after is null or not_after > now()))
$$;

create or replace function public.layer_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users where id=auth.uid()) and not exists (
    select 1 from public.layer_accounts where owner=auth.uid() and suspended
  ) and (
    auth.jwt()->>'role' = 'service_role'
    or (
      public.layer_session_valid() and (
        auth.jwt()->>'aal' = 'aal2' or not exists (
          select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified'
        )
      )
    )
  )
$$;

create policy layer_security_events_read on public.layer_security_events for select
  to authenticated using (owner = (select auth.uid()) and (select public.layer_active()));

create function public.layer_auth_limit(limit_key text, maximum integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  active_bucket timestamptz := date_bin(interval '15 minutes', now(), '2000-01-01'::timestamptz);
  total integer;
begin
  insert into public.layer_auth_limits as limits(key,bucket,attempts)
    values(limit_key,active_bucket,1)
    on conflict(key) do update set bucket = excluded.bucket,
      attempts = case when limits.bucket=excluded.bucket then limits.attempts+1 else 1 end
    returning attempts into total;
  return total <= maximum;
end $$;

create function public.layer_security_record(account uuid, action text, fingerprint text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare is_new boolean := false;
begin
  if action = 'Sign-in' and fingerprint is not null then
    insert into public.layer_auth_devices(owner,fingerprint) values(account,fingerprint) on conflict do nothing;
    is_new := found;
  end if;
  insert into public.layer_security_events(owner,event) values(account,case when is_new then 'New device sign-in' else action end);
end $$;

create function public.layer_security_user_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.email is distinct from new.email then
    insert into public.layer_security_events(owner,event) values(new.id,'Email changed');
  end if;
  if old.encrypted_password is distinct from new.encrypted_password then
    insert into public.layer_security_events(owner,event) values(new.id,'Password changed');
  end if;
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    insert into public.layer_security_events(owner,event) values(new.id,'Email confirmed');
  end if;
  return new;
end $$;

create trigger layer_security_auth_changes
after update of email, encrypted_password, email_confirmed_at on auth.users
for each row execute function public.layer_security_user_changed();

-- Explicitly revoke inherited Data API defaults before granting exact audiences.
revoke all on function public.layer_session_valid(), public.layer_auth_limit(text,integer),
  public.layer_security_record(uuid,text,text), public.layer_security_user_changed()
  from public, anon, authenticated, service_role;
grant execute on function public.layer_session_valid() to authenticated;
grant execute on function public.layer_auth_limit(text,integer), public.layer_security_record(uuid,text,text) to service_role;

create function public.layer_security_cleanup() returns void
language sql security definer set search_path = '' as $$
  delete from public.layer_auth_limits where bucket < now() - interval '1 day';
  delete from public.layer_security_events where occurred_at < now() - interval '180 days';
$$;
revoke all on function public.layer_security_cleanup() from public, anon, authenticated, service_role;
grant execute on function public.layer_security_cleanup() to service_role;

-- Preserve payments added independently on separate devices. Operation IDs still
-- deduplicate network retries, and payment IDs deduplicate overlapping edits.
create function public.layer_preserve_sale_payments() returns trigger
language plpgsql set search_path = '' as $$
declare
  merged jsonb;
  received numeric;
begin
  if old.record #> '{data,sale,payments}' is null then return new; end if;
  if new.record #> '{data,sale,payments}' is null then raise exception 'A recorded egg sale requires its payment history'; end if;
  select coalesce(jsonb_agg(payment order by payment->>'date', payment->>'id'),'[]'::jsonb),
    coalesce(sum((payment->>'amount')::numeric),0)
  into merged, received
  from (
    select distinct on (payment->>'id') payment
    from (
      select value as payment, 1 as priority from jsonb_array_elements(old.record #> '{data,sale,payments}')
      union all
      select value as payment, 2 as priority from jsonb_array_elements(new.record #> '{data,sale,payments}')
    ) combined
    order by payment->>'id', priority
  ) unique_payments;
  if received > (new.record #>> '{data,amount}')::numeric + 0.0001 then
    raise exception 'Concurrent payments exceed the sale total. Review the balance and retry.';
  end if;
  new.record := jsonb_set(new.record, '{data,sale,payments}', merged);
  return new;
end $$;
revoke all on function public.layer_preserve_sale_payments() from public, anon, authenticated, service_role;
create trigger layer_sale_payments
before update of record on public.layer_records
for each row when (old.kind='money')
execute function public.layer_preserve_sale_payments();

create or replace function public.layer_sync(ops jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  entry jsonb;
  prior jsonb;
  entry_id text;
  farm text;
  kind_name text;
  data jsonb;
  ref text;
begin
  if not public.layer_active() then raise exception 'Account is unavailable'; end if;
  if jsonb_typeof(ops) <> 'array' or jsonb_array_length(ops) > 100 then raise exception 'Invalid sync batch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  for item in select value from jsonb_array_elements(ops) loop
    insert into public.layer_operations values (uid,(item->>'id')::uuid) on conflict do nothing;
    if not found then continue; end if;
    entry := item->'row';
    entry_id := entry->>'id';
    farm := entry->>'farmId';
    kind_name := entry->>'type';
    data := entry->'data';
    if jsonb_typeof(data) is distinct from 'object' or (entry->>'date')::date is null then raise exception 'Invalid record'; end if;
    if kind_name = 'farm' then
      if entry_id is distinct from farm then raise exception 'Invalid farm'; end if;
    elsif not exists (select 1 from public.layer_records r where r.owner=uid and r.id=farm and r.kind='farm') then
      raise exception 'Farm is unavailable';
    end if;
    select record into prior from public.layer_records where owner=uid and id=entry_id;
    if prior is not null and (prior->>'type' <> kind_name or prior->>'farmId' <> farm) then
      raise exception 'Record scope cannot change';
    end if;
    if kind_name='flock' and prior is not null and (prior->'data'->'initial' is distinct from data->'initial' or prior->>'date' is distinct from entry->>'date') then
      raise exception 'Use the movement ledger to change population';
    end if;
    if kind_name='egg' and (entry_id <> concat('egg:',data->>'flock',':',entry->>'date') or (data->>'broken')::integer > (data->>'eggs')::integer) then
      raise exception 'Invalid egg collection';
    end if;
    ref := nullif(data->>'flock','');
    if (kind_name in ('egg','movement','schedule') and ref is null) or
      (ref is not null and not exists (select 1 from public.layer_records r where r.owner=uid and r.id=ref and r.farm_id=farm and r.kind='flock')) then
      raise exception 'Flock is unavailable for this farm';
    end if;
    ref := nullif(data->>'house','');
    if ref is not null and not exists (select 1 from public.layer_records r where r.owner=uid and r.id=ref and r.farm_id=farm and r.kind='house') then
      raise exception 'House is unavailable for this farm';
    end if;
    ref := nullif(data->>'product','');
    if kind_name='stock' and (ref is null or not exists (select 1 from public.layer_records r where r.owner=uid and r.id=ref and r.farm_id=farm and r.kind='product')) then
      raise exception 'Feed product is unavailable for this farm';
    end if;
    insert into public.layer_records(owner,id,farm_id,kind,record) values (uid,entry_id,farm,kind_name,entry)
      on conflict(owner,id) do update set record=excluded.record,changed_at=clock_timestamp()
      returning record into entry;
    insert into public.layer_audit(owner,record_id,previous,current) values (uid,entry_id,prior,entry);
  end loop;
  return public.layer_snapshot();
end $$;
