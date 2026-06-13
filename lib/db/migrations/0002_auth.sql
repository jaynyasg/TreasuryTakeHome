-- 0002_auth: add credential storage for the Auth.js Credentials provider.
--
-- JWT session strategy (no database sessions) => no sessions/accounts tables are
-- needed; we only need a password hash on the existing users row. The hash is a
-- scrypt digest in the `scrypt$<saltHex>$<hashHex>` format (lib/auth/password.ts).
--
-- Add-only / expand-contract migration (plan rollout posture): `if not exists`
-- keeps re-runs harmless and lets old code run against the new column.
alter table users add column if not exists password_hash text;
