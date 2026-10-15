const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('frontend Supabase config contains placeholders, not a real project', () => {
  const config = read('supabase-config.js');
  assert.match(config, /TU-PROYECTO/);
  assert.match(config, /REEMPLAZAR/);
  assert.doesNotMatch(config, /sb_secret_[A-Za-z0-9_-]{20,}/);
  
});

test('service-role credential is only referenced by the server-side Edge Function', () => {
  const app = read('app.js');
  const html = read('index.html');
  const config = read('supabase-config.js');
  assert.doesNotMatch(app, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
  assert.doesNotMatch(html, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
  assert.doesNotMatch(config, /SUPABASE_SERVICE_ROLE_KEY/i);
  
  assert.match(read('supabase/functions/admin-invite-user/index.ts'), /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
});

test('source does not ship predictable default user passwords', () => {
  const app = read('app.js');
  assert.match(app, /const DEFAULT_USERS = \[\];/);
  assert.doesNotMatch(app, /admin2026|admin123|carga123|pass\s*\|\|\s*'1234'/);
});

test('central login and remote records are wired into the application', () => {
  const app = read('app.js');
  assert.match(app, /signInWithPassword/);
  assert.match(app, /loadCloudRecords/);
  assert.match(app, /syncCloudRecords/);
  assert.match(app, /postgres_changes/);
  assert.match(app, /admin-invite-user/);
});

test('database migration enables RLS and ties roles to active profiles', () => {
  const sql = read('supabase/migrations/202610150001_initial_schema.sql');
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /create policy/i);
  assert.match(sql, /active = true/i);
  assert.match(sql, /references auth\.users/i);
});
