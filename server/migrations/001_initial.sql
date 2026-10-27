CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS protocol_versions (
  id TEXT PRIMARY KEY,
  exercise TEXT NOT NULL CHECK (exercise IN ('squat', 'pushups', 'vup', 'plank', 'spiderman')),
  configuration JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ
);

INSERT INTO protocol_versions (id, exercise, configuration)
VALUES
  (
    'squat-v1',
    'squat',
    '{"standingAngle":160,"descendingAngle":150,"bottomAngle":105,"ascendingAngle":120,"bottomHoldMs":140,"minRepDurationMs":650}'::jsonb
  ),
  (
    'pushup-v1',
    'pushups',
    '{"topElbowAngle":155,"descendingElbowAngle":140,"bottomElbowAngle":95,"ascendingElbowAngle":120,"bottomHoldMs":250,"minRepDurationMs":600}'::jsonb
  ),
  (
    'vup-v1',
    'vup',
    '{"flatHipAngle":150,"contractingHipAngle":135,"peakHipAngle":100,"returningHipAngle":125,"minRepDurationMs":600}'::jsonb
  ),
  (
    'plank-v1',
    'plank',
    '{"minBodyLine":150,"maxPikeAngle":140,"targetSeconds":30}'::jsonb
  ),
  (
    'spiderman-v1',
    'spiderman',
    '{"startDistance":0.38,"peakDistance":0.22,"returnDistance":0.35,"minRepDurationMs":650}'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET configuration = EXCLUDED.configuration, exercise = EXCLUDED.exercise;

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 48),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed basic MTUCI faculties
INSERT INTO teams (name)
VALUES
  ('МТУСИ — Факультет ИТ'),
  ('МТУСИ — Факультет РиТ'),
  ('МТУСИ — Факультет КиИБ'),
  ('МТУСИ — Факультет СиСС')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias TEXT NOT NULL UNIQUE CHECK (char_length(alias) BETWEEN 2 AND 24),
  token_hash TEXT NOT NULL UNIQUE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  consent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  description TEXT NOT NULL DEFAULT '',
  protocol_version_id TEXT NOT NULL REFERENCES protocol_versions(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  protocol_version_id TEXT NOT NULL REFERENCES protocol_versions(id),
  score SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  repetitions SMALLINT NOT NULL CHECK (repetitions BETWEEN 0 AND 120),
  attempts SMALLINT NOT NULL CHECK (attempts >= repetitions AND attempts <= 199),
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

CREATE INDEX IF NOT EXISTS submissions_leaderboard_idx ON submissions (challenge_id, verification_status, score DESC, quality DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS challenges_public_idx ON challenges (status, starts_at, ends_at);

-- Initial 5 MTUCI challenges ready for live testing
INSERT INTO challenges (id, title, description, protocol_version_id, starts_at, ends_at, status)
VALUES
  (
    'f810e95f-1c21-4b0e-b19c-5c229bdbdd60',
    'Осенний кубок МТУСИ: Приседания',
    'Норматив кафедры физвоспитания МТУСИ. 10 зачётных приседаний с контролем бедра параллельно полу.',
    'squat-v1',
    '2026-09-01 00:00:00+00',
    '2026-12-31 23:59:59+00',
    'published'
  ),
  (
    'a110e95f-1c21-4b0e-b19c-5c229bdbdd61',
    'Кафедра физвоспитания МТУСИ: Отжимания от пола',
    'Норматив №1 ОФП. 12 зачётных отжиманий с фиксацией груди у пола не менее 0.5 сек и контролем прямой спины.',
    'pushup-v1',
    '2026-09-01 00:00:00+00',
    '2026-12-31 23:59:59+00',
    'published'
  ),
  (
    'b210e95f-1c21-4b0e-b19c-5c229bdbdd62',
    'Кафедра физвоспитания МТУСИ: Пресс угол',
    'Норматив №2 ОФП. 15 подъёмов прямых ног и корпуса до прямого угла 90° без касания пола пятками.',
    'vup-v1',
    '2026-09-01 00:00:00+00',
    '2026-12-31 23:59:59+00',
    'published'
  ),
  (
    'c310e95f-1c21-4b0e-b19c-5c229bdbdd63',
    'Кафедра физвоспитания МТУСИ: Планка на время',
    'Норматив №5 ОФП. 30 секунд непрерывного удержания ровной планки с контролем прогиба таза.',
    'plank-v1',
    '2026-09-01 00:00:00+00',
    '2026-12-31 23:59:59+00',
    'published'
  ),
  (
    'd410e95f-1c21-4b0e-b19c-5c229bdbdd64',
    'Кафедра физвоспитания МТУСИ: Спайдермен',
    'Норматив №7 ОФП. 12 подтягиваний колена к локтю через сторону в упоре лёжа.',
    'spiderman-v1',
    '2026-09-01 00:00:00+00',
    '2026-12-31 23:59:59+00',
    'published'
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  ends_at = EXCLUDED.ends_at,
  status = EXCLUDED.status;
