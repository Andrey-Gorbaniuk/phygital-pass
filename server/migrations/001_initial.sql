CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE protocol_versions (
  id TEXT PRIMARY KEY,
  exercise TEXT NOT NULL CHECK (exercise = 'squat'),
  configuration JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ
);

INSERT INTO protocol_versions (id, exercise, configuration)
VALUES (
  'squat-v1',
  'squat',
  '{"standingAngle":160,"descendingAngle":150,"bottomAngle":105,"ascendingAngle":120,"bottomHoldMs":150,"minRepDurationMs":700}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 48),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias TEXT NOT NULL UNIQUE CHECK (char_length(alias) BETWEEN 2 AND 24),
  token_hash TEXT NOT NULL UNIQUE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  consent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  description TEXT NOT NULL DEFAULT '',
  protocol_version_id TEXT NOT NULL REFERENCES protocol_versions(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  protocol_version_id TEXT NOT NULL REFERENCES protocol_versions(id),
  score SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  repetitions SMALLINT NOT NULL CHECK (repetitions BETWEEN 0 AND 10),
  attempts SMALLINT NOT NULL CHECK (attempts >= repetitions AND attempts <= 99),
  quality SMALLINT NOT NULL CHECK (quality BETWEEN 0 AND 100),
  tempo SMALLINT NOT NULL CHECK (tempo BETWEEN 0 AND 180),
  amplitude TEXT NOT NULL CHECK (amplitude IN ('Отличная', 'Достаточная', 'Нужна глубже')),
  shallow_rejected SMALLINT NOT NULL DEFAULT 0 CHECK (shallow_rejected >= 0),
  too_fast_rejected SMALLINT NOT NULL DEFAULT 0 CHECK (too_fast_rejected >= 0),
  tracking_rejected SMALLINT NOT NULL DEFAULT 0 CHECK (tracking_rejected >= 0),
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  reviewer_note TEXT,
  reviewed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (challenge_id, participant_id)
);

CREATE INDEX submissions_leaderboard_idx ON submissions (challenge_id, verification_status, score DESC, quality DESC, created_at ASC);
CREATE INDEX challenges_public_idx ON challenges (status, starts_at, ends_at);
