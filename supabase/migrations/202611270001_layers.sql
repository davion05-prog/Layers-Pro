create table public.layer_records (
  owner uuid not null references auth.users on delete cascade,
  id text not null,
  farm_id text not null,
  kind text not null check (kind in ('farm','house','flock','egg','movement','product','stock','money','schedule')),
  record jsonb not null,
  changed_at timestamptz not null default clock_timestamp(),
  primary key(owner,id),
  foreign key(owner,farm_id) references public.layer_records(owner,id) deferrable initially deferred,
  check (length(id) between 1 and 150),
  check (kind <> 'egg' or id = concat('egg:',record #>> '{data,flock}',':',record ->> 'date'))
);
create index layer_records_scope on public.layer_records(owner,farm_id,kind);
create table public.layer_operations (
  owner uuid not null references auth.users on delete cascade,
  id uuid not null,
  primary key(owner,id)
);
create table public.layer_audit (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users on delete cascade,
  record_id text not null,
  changed_at timestamptz not null default clock_timestamp(),
  previous jsonb,
  current jsonb not null
);
create index layer_audit_scope on public.layer_audit(owner,changed_at desc);
create table public.layer_notifications (
  id text not null,
  owner uuid not null references auth.users on delete cascade,
  farm_id text not null,
  message text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(owner,id)
);
create table public.layer_accounts (
  owner uuid primary key references auth.users on delete cascade,
  deletion_at timestamptz,
  suspended boolean not null default false,
  push_subscription jsonb
);
create table public.layer_admins (owner uuid primary key references auth.users on delete cascade);
create table public.layer_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor uuid references auth.users on delete set null,
  action text not null,
  target text not null,
  created_at timestamptz not null default now()
);
create table public.layer_references (key text primary key check(key in ('breeds','feed','vaccines')), value jsonb not null);

alter table public.layer_records enable row level security;
alter table public.layer_operations enable row level security;
alter table public.layer_audit enable row level security;
alter table public.layer_notifications enable row level security;
alter table public.layer_accounts enable row level security;
alter table public.layer_admins enable row level security;
alter table public.layer_admin_audit enable row level security;
alter table public.layer_references enable row level security;

revoke all on public.layer_records, public.layer_operations, public.layer_audit, public.layer_notifications, public.layer_accounts, public.layer_admins, public.layer_admin_audit, public.layer_references from anon, authenticated;
grant select on public.layer_records, public.layer_audit, public.layer_notifications to authenticated;

create function public.layer_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not exists (
    select 1 from public.layer_accounts where owner=auth.uid() and suspended
  )
$$;
revoke all on function public.layer_active() from public;
grant execute on function public.layer_active() to authenticated;

create policy layer_records_read on public.layer_records for select to authenticated using (owner = (select auth.uid()) and (select public.layer_active()));
create policy layer_audit_read on public.layer_audit for select to authenticated using (owner = (select auth.uid()) and (select public.layer_active()));
create policy layer_notifications_read on public.layer_notifications for select to authenticated using (owner = (select auth.uid()) and (select public.layer_active()));

create function public.layer_snapshot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if not public.layer_active() then raise exception 'Account is unavailable'; end if;
  return jsonb_build_object(
    'rows',coalesce((select jsonb_agg(record order by changed_at) from public.layer_records where owner=uid),'[]'::jsonb),
    'audits',coalesce((select jsonb_agg(to_jsonb(a) - 'owner' order by changed_at desc) from public.layer_audit a where owner=uid),'[]'::jsonb),
    'notifications',coalesce((select jsonb_agg(to_jsonb(n) - 'owner' order by created_at desc) from public.layer_notifications n where owner=uid),'[]'::jsonb),
    'references',coalesce((select jsonb_object_agg(key,value) from public.layer_references),'{}'::jsonb),
    'deletionAt',(select deletion_at from public.layer_accounts where owner=uid),
    'admin',exists(select 1 from public.layer_admins where owner=uid),
    'syncedAt',now()
  );
end $$;

create function public.layer_sync(ops jsonb) returns jsonb
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
      on conflict(owner,id) do update set record=excluded.record,changed_at=clock_timestamp();
    insert into public.layer_audit(owner,record_id,previous,current) values (uid,entry_id,prior,entry);
  end loop;
  return public.layer_snapshot();
end $$;

create function public.layer_account(action text, payload jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if not public.layer_active() then raise exception 'Account is unavailable'; end if;
  insert into public.layer_accounts(owner) values(uid) on conflict do nothing;
  if action='request-deletion' then
    update public.layer_accounts set deletion_at=coalesce(deletion_at,now()+interval '30 days') where owner=uid;
  elsif action='cancel-deletion' then
    update public.layer_accounts set deletion_at=null where owner=uid;
  elsif action='push' then
    update public.layer_accounts set push_subscription=payload where owner=uid;
  else raise exception 'Unknown account action';
  end if;
end $$;

revoke all on function public.layer_snapshot(), public.layer_sync(jsonb), public.layer_account(text,jsonb) from public;
grant execute on function public.layer_snapshot(), public.layer_account(text,jsonb) to authenticated;
create function public.layer_sync_for(account uuid, ops jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claim.sub',account::text,true);
  return public.layer_sync(ops);
end $$;
revoke all on function public.layer_sync_for(uuid,jsonb) from public;
grant execute on function public.layer_sync_for(uuid,jsonb) to service_role;

create table public.layer_deliveries (
  owner uuid not null references auth.users on delete cascade,
  id text not null,
  channel text not null check(channel in ('push','email')),
  delivered_at timestamptz not null default now(),
  primary key(owner,id,channel)
);
alter table public.layer_deliveries enable row level security;
revoke all on public.layer_deliveries from anon, authenticated;

grant all on public.layer_records, public.layer_operations, public.layer_audit, public.layer_notifications, public.layer_accounts, public.layer_admins, public.layer_admin_audit, public.layer_references, public.layer_deliveries to service_role;

create function public.layer_stats() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'accounts',(select count(*) from auth.users),
    'farms',(select count(*) from public.layer_records where kind='farm'),
    'flocks',(select count(*) from public.layer_records where kind='flock' and record #>> '{data,archived}'='false'),
    'suspended',(select count(*) from public.layer_accounts where suspended)
  )
$$;
revoke all on function public.layer_stats() from public;
grant execute on function public.layer_stats() to service_role;

create function public.layer_admin_update(actor_id uuid, account_id uuid, suspend boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if actor_id=account_id or not exists(select 1 from public.layer_admins where owner=actor_id) then raise exception 'Administrator required'; end if;
  insert into public.layer_accounts(owner,suspended) values (account_id,suspend)
    on conflict(owner) do update set suspended=excluded.suspended;
  insert into public.layer_admin_audit(actor,action,target) values(actor_id,case when suspend then 'suspend' else 'reactivate' end,account_id::text);
end $$;

create function public.layer_reference_update(actor_id uuid, values_json jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.layer_admins where owner=actor_id) then raise exception 'Administrator required'; end if;
  insert into public.layer_references(key,value) select key,value from jsonb_each(values_json)
    on conflict(key) do update set value=excluded.value;
  insert into public.layer_admin_audit(actor,action,target) values(actor_id,'update references','breeds, feed, vaccines');
end $$;
revoke all on function public.layer_admin_update(uuid,uuid,boolean), public.layer_reference_update(uuid,jsonb) from public;
grant execute on function public.layer_admin_update(uuid,uuid,boolean), public.layer_reference_update(uuid,jsonb) to service_role;

create function public.layer_purge_expired(max_accounts integer default 100) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  total integer;
begin
  with due as (
    select owner from public.layer_accounts
    where deletion_at <= now()
    order by deletion_at,owner
    limit greatest(1,least(max_accounts,500))
    for update skip locked
  )
  delete from auth.users using due where id=due.owner;
  get diagnostics total = row_count;
  return total;
end $$;
revoke all on function public.layer_purge_expired(integer) from public;
grant execute on function public.layer_purge_expired(integer) to service_role;
