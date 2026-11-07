-- Frozen effective DAILY labour rate, MAD/day (monthly rate / 26).
-- Historical rates are unknown: deliberately no UPDATE or default/backfill.
ALTER TABLE people.work_day
  ADD COLUMN IF NOT EXISTS cost_snapshot_mad numeric(14,6);
