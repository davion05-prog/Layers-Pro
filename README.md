# Layers Pro

Layers Pro is a mobile-first poultry management workspace for layer and Kenbro farms. It tracks flocks, production, feed, finances, and reminders across multiple farms.

## Run locally

Requires Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). The workspace opens with two sample farms and a working demo. Demo records stay in this browser and are separate from authenticated accounts.

```bash
npm run typecheck
npm run build
npm start
```

Use the production build over HTTPS or localhost to test installation and offline reopening. Load the app online once so it can cache the app shell. Authenticated workspaces need one successful sync before their history is available offline. Browser storage policies can evict local data, so let the outbox sync regularly.

## Repository structure

| Path | Responsibility |
| --- | --- |
| `app/` | Next.js page, responsive styles, authentication callbacks, API routes |
| `components/` | Workspace screens, forms, charts and browser sync state |
| `lib/` | Domain validation, ledgers, reports, demo data and IndexedDB storage |
| `public/` | PWA manifest, icons and offline service worker |
| `supabase/migrations/` | PostgreSQL tables, policies, sync and admin functions |

The stack uses Next.js, React, TypeScript, Tailwind CSS, Supabase Auth and PostgreSQL, Recharts, and IndexedDB.

## Connect Supabase

1. Create a Supabase project and apply `supabase/migrations/202611270001_layers.sql` using the SQL editor or `supabase db push` against your linked project.
2. Copy `.env.example` to `.env.local`. Set the Supabase URL, publishable key and server-only service-role key. Keep the service-role key out of the browser and Git.
3. Under **Authentication → URL Configuration**, set the site URL and add the local and deployed `/auth/confirm` URLs as allowed redirects. Enable email confirmation. For confirmation from a different device, the Supabase email template can link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}`. Set up custom SMTP if Supabase’s default test-email restrictions prevent delivery to your test accounts.
4. Set a short JWT lifetime appropriate to the deployment, such as 900 seconds. Supabase Auth handles password hashing, auth rate limits and refresh rotation. Next.js stores the session in HTTP-only, SameSite cookies, with Secure enabled in production. For a local HTTP test of the production build, set `ALLOW_INSECURE_COOKIES=true` locally only.
5. For an admin account, first register and verify the user, then add its UUID through the Supabase SQL editor with `insert into public.layer_admins(owner) values ('USER_UUID');`. Admin screens expose account identity, counts and global references. Farm ledgers stay within their owner workspace.

The application validates writes server-side, authorizes them using the verified Supabase user ID, and checks farm and flock references in the database. RLS protects direct reads. Sync uses server timestamps and idempotent operation IDs. Editing one flock’s egg collection for a date replaces that date’s row and saves the prior values in the audit history. Stock and population warnings preserve conflicting entries so the farmer can review them.

## Deploy and schedule reminders

Import this repository into Vercel as a Next.js project. Set the Supabase variables and `APP_ORIGIN` to your deployment URL, then add that URL to Supabase. Once deployed, the app can generate PDF reports for authenticated accounts with access to the relevant records.

Set a randomly generated `CRON_SECRET` in Vercel, then use [Supabase Cron](https://supabase.com/docs/guides/cron) with `pg_net` and [Vault](https://supabase.com/docs/guides/database/vault). Store the deployed origin and matching secret in Vault under the names in this example. Schedule the job in UTC at `0 3 * * *` for 06:00 Africa/Nairobi.

```sql
select cron.schedule(
  'layers-pro-maintenance', '0 3 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'layers_pro_origin')
      || '/api/maintenance',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'layers_pro_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
```

The job refreshes in-app reminders and processes account deletion after the 30-day grace period. Email delivery uses Resend with a verified sender and Web Push uses a VAPID key pair. Both are optional and use the corresponding environment variables. Farmers select channels per farm and register their browser for push in Settings.

Draft pre-lay vaccine reminders use the [Kenchic Layer/Kenbro vaccination windows](https://www.kenchic.com/health-management/). The first day of each published window is used as the draft reminder date. The recurring laying-period item is a configurable review placeholder. Have the farm veterinarian review the template before enabling vaccination notifications.

## Demo walkthrough

- Use the farm picker and flock selector to change scope.
- In **Daily entry**, save an egg count, then edit that date to see the previous values in **Sync & audit**.
- In **Flocks**, record a mortality or other bird movement to see the live count recalculate.
- In **Feed inventory**, log a purchase to increase stock and see the expense in **Finances**.
- Use **Schedules** to review the calendar and log completions, then **Reports** to export data.
