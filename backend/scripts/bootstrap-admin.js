#!/usr/bin/env node
/**
 * Bootstrap the first admin account for a fresh AMHOS deployment.
 *
 * Why this exists: POST /api/v1/users (the normal way to create a staff account) requires
 * being authenticated as an admin already -- a chicken-and-egg problem for a brand-new
 * deployment with zero app_user rows. This script creates the Supabase Auth identity and
 * the matching app_user row directly, the same way UsersService.createStaffUser does
 * internally, without needing an existing admin session. See docs/DECISIONS.md's "Still
 * Open" section for the full context on why this gap exists.
 *
 * Usage:
 *   node --env-file=.env scripts/bootstrap-admin.js --email you@example.com
 *   node --env-file=.env scripts/bootstrap-admin.js --email you@example.com --password 'a real password' --full-name 'Jane Admin'
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (backend/.env
 * covers both -- --env-file loads it automatically, no extra dependency needed).
 *
 * Idempotent: refuses to create a second account for an email that already has an
 * app_user row, rather than silently creating a duplicate.
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

function parseArgs(argv) {
  const args = { email: null, password: null, fullName: 'Admin' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--email') args.email = argv[++i];
    else if (arg === '--password') args.password = argv[++i];
    else if (arg === '--full-name') args.fullName = argv[++i];
  }
  return args;
}

function generatePassword() {
  return crypto.randomBytes(15).toString('base64').replace(/[=+/]/g, '').slice(0, 20);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email) {
    console.error('Usage: node --env-file=.env scripts/bootstrap-admin.js --email you@example.com [--password ...] [--full-name "Jane Admin"]');
    process.exitCode = 1;
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with --env-file=.env, or export them first.');
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: existing, error: existingError } = await supabase
    .from('app_user')
    .select('id, email, role, tenant_id')
    .eq('email', args.email)
    .maybeSingle();
  if (existingError) {
    console.error('Failed to check for an existing account:', existingError.message);
    process.exitCode = 1;
    return;
  }
  if (existing) {
    console.error(
      `An app_user row already exists for ${args.email} (id ${existing.id}, role ${existing.role}). ` +
        'Refusing to create a duplicate. To reset this account\'s password instead, use the ' +
        'Supabase dashboard (Authentication > Users) or the Admin API directly.',
    );
    process.exitCode = 1;
    return;
  }

  // Reuse an existing tenant if one already has staff in it (so this admin can see/manage
  // the same data other accounts already belong to), rather than creating a disconnected
  // admin in a brand-new, empty tenant every time this script runs.
  const { data: anyExisting } = await supabase.from('app_user').select('tenant_id').limit(1).maybeSingle();
  const tenantId = anyExisting ? anyExisting.tenant_id : crypto.randomUUID();

  const password = args.password || generatePassword();
  const generatedPassword = !args.password;

  const { data: authResult, error: authError } = await supabase.auth.admin.createUser({
    email: args.email,
    password,
    email_confirm: true,
  });
  if (authError || !authResult.user) {
    console.error('Failed to create the Supabase Auth user:', authError ? authError.message : 'unknown error');
    process.exitCode = 1;
    return;
  }

  const { error: insertError } = await supabase.from('app_user').insert({
    id: authResult.user.id,
    tenant_id: tenantId,
    email: args.email,
    role: 'admin',
    facility_id: null,
    full_name: args.fullName,
  });
  if (insertError) {
    console.error(
      'Auth user was created but the app_user row failed to insert:',
      insertError.message,
      `\nAuth user id ${authResult.user.id} now exists without a matching app_user row -- ` +
        'clean it up via the Supabase dashboard (Authentication > Users) before retrying, ' +
        'or manually insert the app_user row with this id.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('Admin account created.');
  console.log(`  Email:     ${args.email}`);
  if (generatedPassword) {
    console.log(`  Password:  ${password}  (generated -- store this now, it will not be shown again)`);
  }
  console.log(`  Tenant ID: ${tenantId}${anyExisting ? ' (reused from an existing account)' : ' (new tenant)'}`);
  console.log(`  User ID:   ${authResult.user.id}`);
  console.log('\nLog in at the frontend /login page, or obtain a session token directly:');
  console.log(`  curl -s -X POST "${supabaseUrl}/auth/v1/token?grant_type=password" \\`);
  console.log('    -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \\');
  console.log(`    -d '{"email": "${args.email}", "password": "<password>"}'`);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
