import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'
import type { ServerConfig } from './config.js'
import type { Database } from './database.js'
import { queryOne } from './database.js'
import { calculateScore } from './scoring.js'
import { createOrganizerToken, createParticipantToken, hashToken, matchesSecret, verifyOrganizerToken } from './security.js'

const aliasSchema = z.string().trim().min(2).max(24).regex(/^[\p{L}\p{N}_ -]+$/u, 'Используйте буквы, цифры, пробел, дефис или подчёркивание.')
const idSchema = z.string().uuid()
const protocolIdSchema = z.string().trim().min(3).max(48).regex(/^[a-z0-9-]+$/)

const participantSchema = z.object({
  alias: aliasSchema,
  consent: z.literal(true),
})

const submissionSchema = z.object({
  protocolVersion: protocolIdSchema,
  repetitions: z.literal(10),
  attempts: z.number().int().min(10).max(99),
  quality: z.number().int().min(0).max(100),
  tempo: z.number().int().min(0).max(180),
  amplitude: z.enum(['Отличная', 'Достаточная', 'Нужна глубже']),
  shallowRejected: z.number().int().min(0).max(99),
  tooFastRejected: z.number().int().min(0).max(99),
  trackingRejected: z.number().int().min(0).max(99),
  completedAt: z.string().datetime(),
}).superRefine((value, context) => {
  const rejected = value.shallowRejected + value.tooFastRejected + value.trackingRejected
  if (value.attempts !== value.repetitions + rejected) {
    context.addIssue({ code: 'custom', message: 'Количество попыток не совпадает с расшифровкой незачётов.' })
  }
})

const challengeSchema = z.object({
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().max(500).default(''),
  protocolVersion: protocolIdSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  publish: z.boolean().default(false),
}).superRefine((value, context) => {
  if (new Date(value.endsAt) <= new Date(value.startsAt)) {
    context.addIssue({ code: 'custom', message: 'Дата завершения должна быть позже даты старта.' })
  }
})

const protocolSchema = z.object({
  id: protocolIdSchema,
  configuration: z.object({
    standingAngle: z.number().min(140).max(180),
    descendingAngle: z.number().min(120).max(170),
    bottomAngle: z.number().min(70).max(130),
    ascendingAngle: z.number().min(100).max(160),
    bottomHoldMs: z.number().int().min(0).max(1000),
    minRepDurationMs: z.number().int().min(400).max(5000),
  }),
})

type Participant = { id: string; alias: string; team_id: string | null }

function apiError(message: string, status = 400) {
  return { error: message, status }
}

async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<{ success: true; data: z.output<T> } | { success: false; message: string }> {
  try {
    const input: unknown = await request.json()
    const parsed = schema.safeParse(input)
    if (!parsed.success) return { success: false, message: parsed.error.issues[0]?.message ?? 'Некорректные данные.' }
    return { success: true, data: parsed.data }
  } catch {
    return { success: false, message: 'Ожидался JSON-запрос.' }
  }
}

function bearerToken(header?: string): string | null {
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim() || null
}

async function currentParticipant(database: Database, header?: string): Promise<Participant | null> {
  const token = bearerToken(header)
  if (!token) return null

  return queryOne<Participant>(
    database,
    'SELECT id, alias, team_id FROM participants WHERE token_hash = $1 AND deleted_at IS NULL',
    [hashToken(token)],
  )
}

async function organizerAllowed(header: string | undefined, config: ServerConfig): Promise<boolean> {
  const token = bearerToken(header)
  return token ? verifyOrganizerToken(token, config.SESSION_SECRET) : false
}

function csvValue(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function createApp(database: Database, config: ServerConfig) {
  const app = new Hono()

  app.use('/api/*', cors({ origin: config.PUBLIC_ORIGIN ?? '*', allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'] }))

  app.get('/api/health', (context) => context.json({ ok: true }))
  app.get('/api/policy', (context) => context.json({
    videoStorage: 'none',
    participantData: 'Псевдоним, команда по желанию и результат теста.',
    leaderboardRule: 'В рейтинг попадают только проверенные организатором результаты.',
    deletion: 'Участник может запросить удаление своего псевдонима и результатов у организатора.',
  }))

  app.get('/api/challenges', async (context) => {
    const result = await database.query(
      `SELECT id, title, description, protocol_version_id AS "protocolVersion", starts_at AS "startsAt", ends_at AS "endsAt"
       FROM challenges
       WHERE status = 'published' AND starts_at <= NOW() AND ends_at > NOW()
       ORDER BY starts_at ASC`,
    )
    return context.json({ challenges: result.rows })
  })

  app.get('/api/challenges/:id/leaderboard', async (context) => {
    const parsedId = idSchema.safeParse(context.req.param('id'))
    if (!parsedId.success) return context.json(apiError('Некорректный идентификатор челленджа.'), 400)

    const challenge = await queryOne<{ id: string; title: string; ends_at: string; protocol_version_id: string }>(
      database,
      `SELECT id, title, ends_at, protocol_version_id
       FROM challenges WHERE id = $1 AND status IN ('published', 'closed')`,
      [parsedId.data],
    )
    if (!challenge) return context.json(apiError('Челлендж не найден.', 404), 404)

    const [individual, teams] = await Promise.all([
      database.query(
        `SELECT ROW_NUMBER() OVER (ORDER BY s.score DESC, s.quality DESC, s.created_at ASC) AS rank,
                p.alias, t.name AS team, s.score, s.quality, s.tempo, s.repetitions, s.attempts
         FROM submissions s
         JOIN participants p ON p.id = s.participant_id
         LEFT JOIN teams t ON t.id = p.team_id
         WHERE s.challenge_id = $1 AND s.verification_status = 'verified' AND p.deleted_at IS NULL
         ORDER BY s.score DESC, s.quality DESC, s.created_at ASC
         LIMIT 100`,
        [parsedId.data],
      ),
      database.query(
        `SELECT t.name AS team, COUNT(*)::int AS participants, ROUND(AVG(s.score))::int AS score
         FROM submissions s
         JOIN participants p ON p.id = s.participant_id
         JOIN teams t ON t.id = p.team_id
         WHERE s.challenge_id = $1 AND s.verification_status = 'verified' AND p.deleted_at IS NULL
         GROUP BY t.id, t.name
         ORDER BY score DESC, participants DESC, t.name ASC
         LIMIT 20`,
        [parsedId.data],
      ),
    ])

    return context.json({
      challenge: { id: challenge.id, title: challenge.title, endsAt: challenge.ends_at, protocolVersion: challenge.protocol_version_id },
      leaderboard: individual.rows,
      teams: teams.rows,
      verificationNotice: 'Рейтинг показывает только проверенные результаты; неподтверждённые попытки в него не попадают.',
    })
  })

  app.post('/api/participants', async (context) => {
    const body = await parseBody(context.req.raw, participantSchema)
    if (!body.success) return context.json(apiError(body.message), 400)

    const token = createParticipantToken()
    try {
      const participant = await queryOne<{ id: string; alias: string }>(
        database,
        `INSERT INTO participants (alias, token_hash, consent_at)
         VALUES ($1, $2, NOW()) RETURNING id, alias`,
        [body.data.alias, hashToken(token)],
      )
      return context.json({ participant, token }, 201)
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return context.json(apiError('Этот псевдоним уже занят.'), 409)
      throw error
    }
  })

  app.post('/api/challenges/:id/submissions', async (context) => {
    const challengeId = idSchema.safeParse(context.req.param('id'))
    if (!challengeId.success) return context.json(apiError('Некорректный идентификатор челленджа.'), 400)
    const participant = await currentParticipant(database, context.req.header('Authorization'))
    if (!participant) return context.json(apiError('Нужен локальный токен участника.', 401), 401)

    const body = await parseBody(context.req.raw, submissionSchema)
    if (!body.success) return context.json(apiError(body.message), 400)

    const challenge = await queryOne<{ protocol_version_id: string }>(
      database,
      `SELECT protocol_version_id FROM challenges
       WHERE id = $1 AND status = 'published' AND starts_at <= NOW() AND ends_at >= NOW()`,
      [challengeId.data],
    )
    if (!challenge) return context.json(apiError('Челлендж не принимает новые результаты.', 409), 409)
    if (challenge.protocol_version_id !== body.data.protocolVersion) {
      return context.json(apiError('Результат использует другую версию правил теста.', 409), 409)
    }

    const score = calculateScore(body.data)
    try {
      const submission = await queryOne<{ id: string; verification_status: string }>(
        database,
        `INSERT INTO submissions (
           challenge_id, participant_id, protocol_version_id, score, repetitions, attempts, quality, tempo, amplitude,
           shallow_rejected, too_fast_rejected, tracking_rejected, completed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, verification_status`,
        [
          challengeId.data, participant.id, body.data.protocolVersion, score, body.data.repetitions, body.data.attempts,
          body.data.quality, body.data.tempo, body.data.amplitude, body.data.shallowRejected,
          body.data.tooFastRejected, body.data.trackingRejected, body.data.completedAt,
        ],
      )
      return context.json({ submission, score, notice: 'Результат ожидает проверки и пока не показан в лидерборде.' }, 201)
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return context.json(apiError('Для этого челленджа уже отправлен результат.', 409), 409)
      throw error
    }
  })

  app.post('/api/admin/session', async (context) => {
    const body = await parseBody(context.req.raw, z.object({ username: z.string(), password: z.string() }))
    if (!body.success) return context.json(apiError(body.message), 400)
    if (!matchesSecret(body.data.username, config.ORGANIZER_USERNAME) || !matchesSecret(body.data.password, config.ORGANIZER_PASSWORD)) {
      return context.json(apiError('Неверные данные организатора.', 401), 401)
    }
    return context.json({ token: await createOrganizerToken(config.ORGANIZER_USERNAME, config.SESSION_SECRET), expiresIn: '8h' })
  })

  app.get('/api/admin/summary', async (context) => {
    if (!await organizerAllowed(context.req.header('Authorization'), config)) return context.json(apiError('Нужна роль организатора.', 401), 401)
    const summary = await queryOne<{ participants: number; pending: number; verified: number; average_score: number | null }>(
      database,
      `SELECT
        (SELECT COUNT(*)::int FROM participants WHERE deleted_at IS NULL) AS participants,
        (SELECT COUNT(*)::int FROM submissions WHERE verification_status = 'pending') AS pending,
        (SELECT COUNT(*)::int FROM submissions WHERE verification_status = 'verified') AS verified,
        (SELECT ROUND(AVG(score))::int FROM submissions WHERE verification_status = 'verified') AS average_score`,
    )
    return context.json({ summary })
  })

  app.get('/api/admin/teams', async (context) => {
    if (!await organizerAllowed(context.req.header('Authorization'), config)) return context.json(apiError('Нужна роль организатора.', 401), 401)
    const result = await database.query('SELECT id, name FROM teams ORDER BY name ASC')
    return context.json({ teams: result.rows })
  })

  app.get('/api/admin/participants', async (context) => {
    if (!await organizerAllowed(context.req.header('Authorization'), config)) return context.json(apiError('Нужна роль организатора.', 401), 401)
    const result = await database.query(
      `SELECT p.id, p.alias, p.team_id AS "teamId", t.name AS team
       FROM participants p LEFT JOIN teams t ON t.id = p.team_id
       WHERE p.deleted_at IS NULL
       ORDER BY p.created_at DESC LIMIT 200`,
    )
    return context.json({ participants: result.rows })
  })

  app.post('/api/admin/challenges', async (context) => {
    if (!await organizerAllowed(context.req.header('Authorization'), config)) return context.json(apiError('Нужна роль организатора.', 401), 401)
    const body = await parseBody(context.req.raw, challengeSchema)
    if (!body.success) return context.json(apiError(body.message), 400)
    const protocol = await queryOne<{ id: string }>(database, 'SELECT id FROM protocol_versions WHERE id = $1 AND retired_at IS NULL', [body.data.protocolVersion])
    if (!protocol) return context.json(apiError('Версия правил не найдена или закрыта.', 409), 409)

    const challenge = await queryOne(
      database,
      `INSERT INTO challenges (title, description, protocol_version_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, status, starts_at AS "startsAt", ends_at AS "endsAt"`,
      [body.data.title, body.data.description, body.data.protocolVersion, body.data.startsAt, body.data.endsAt, body.data.publish ? 'published' : 'draft'],
    )
    return context.json({ challenge }, 201)
  })

  app.post('/api/admin/protocols', async (context) => {
    if (!await organizerAllowed(context.req.header('Authorization'), config)) return context.json(apiError('Нужна роль организатора.', 401), 401)
    const body = await parseBody(context.req.raw, protocolSchema)
    if (!body.success) return context.json(apiError(body.message), 400)
    try {
      const protocol = await queryOne(database, 'INSERT INTO protocol_versions (id, exercise, configuration) VALUES ($1, $2, $3) RETURNING id, configuration', [body.data.id, 'squat', body.data.configuration])
      return context.json({ protocol }, 201)
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return context.json(apiError('Такая версия правил уже существует.', 409), 409)
      throw error
    }
  })

  app.get('/api/admin/submissions', async (context) => {
    if (!await organizerAllowed(context.req.header('Authorization'), config)) return context.json(apiError('Нужна роль организатора.', 401), 401)
    const status = z.enum(['pending', 'verified', 'rejected']).catch('pending').parse(context.req.query('status'))
    const result = await database.query(
      `SELECT s.id, s.score, s.quality, s.tempo, s.repetitions, s.attempts, s.amplitude, s.shallow_rejected AS "shallowRejected",
              s.too_fast_rejected AS "tooFastRejected", s.tracking_rejected AS "trackingRejected", s.completed_at AS "completedAt",
              s.verification_status AS status, p.alias, c.title AS challenge
       FROM submissions s
       JOIN participants p ON p.id = s.participant_id
       JOIN challenges c ON c.id = s.challenge_id
       WHERE s.verification_status = $1
       ORDER BY s.created_at ASC
       LIMIT 200`,
      [status],
    )
    return context.json({ submissions: result.rows })
  })

  app.patch('/api/admin/submissions/:id', async (context) => {
    if (!await organizerAllowed(context.req.header('Authorization'), config)) return context.json(apiError('Нужна роль организатора.', 401), 401)
    const submissionId = idSchema.safeParse(context.req.param('id'))
    if (!submissionId.success) return context.json(apiError('Некорректный идентификатор результата.'), 400)
    const body = await parseBody(context.req.raw, z.object({ status: z.enum(['verified', 'rejected']), note: z.string().trim().max(280).optional() }))
    if (!body.success) return context.json(apiError(body.message), 400)
    const submission = await queryOne(
      database,
      `UPDATE submissions SET verification_status = $1, reviewer_note = $2, reviewed_at = NOW()
       WHERE id = $3 AND verification_status = 'pending'
       RETURNING id, verification_status AS status`,
      [body.data.status, body.data.note ?? null, submissionId.data],
    )
    if (!submission) return context.json(apiError('Неподтверждённый результат не найден.', 404), 404)
    return context.json({ submission })
  })

  app.post('/api/admin/teams', async (context) => {
    if (!await organizerAllowed(context.req.header('Authorization'), config)) return context.json(apiError('Нужна роль организатора.', 401), 401)
    const body = await parseBody(context.req.raw, z.object({ name: z.string().trim().min(2).max(48) }))
    if (!body.success) return context.json(apiError(body.message), 400)
    try {
      const team = await queryOne(database, 'INSERT INTO teams (name) VALUES ($1) RETURNING id, name', [body.data.name])
      return context.json({ team }, 201)
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return context.json(apiError('Команда с таким названием уже есть.', 409), 409)
      throw error
    }
  })

  app.patch('/api/admin/participants/:id/team', async (context) => {
    if (!await organizerAllowed(context.req.header('Authorization'), config)) return context.json(apiError('Нужна роль организатора.', 401), 401)
    const participantId = idSchema.safeParse(context.req.param('id'))
    if (!participantId.success) return context.json(apiError('Некорректный идентификатор участника.'), 400)
    const body = await parseBody(context.req.raw, z.object({ teamId: idSchema.nullable() }))
    if (!body.success) return context.json(apiError(body.message), 400)
    const participant = await queryOne(database, 'UPDATE participants SET team_id = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id, alias, team_id AS "teamId"', [body.data.teamId, participantId.data])
    if (!participant) return context.json(apiError('Участник не найден.', 404), 404)
    return context.json({ participant })
  })

  app.delete('/api/admin/participants/:id', async (context) => {
    if (!await organizerAllowed(context.req.header('Authorization'), config)) return context.json(apiError('Нужна роль организатора.', 401), 401)
    const participantId = idSchema.safeParse(context.req.param('id'))
    if (!participantId.success) return context.json(apiError('Некорректный идентификатор участника.'), 400)
    const result = await database.query('DELETE FROM participants WHERE id = $1 RETURNING id', [participantId.data])
    if (!result.rowCount) return context.json(apiError('Участник не найден.', 404), 404)
    return context.body(null, 204)
  })

  app.get('/api/admin/export', async (context) => {
    if (!await organizerAllowed(context.req.header('Authorization'), config)) return context.json(apiError('Нужна роль организатора.', 401), 401)
    const result = await database.query(
      `SELECT c.title AS challenge, p.alias, COALESCE(t.name, '') AS team, s.score, s.quality, s.tempo,
              s.repetitions, s.attempts, s.amplitude, s.verification_status, s.completed_at
       FROM submissions s
       JOIN participants p ON p.id = s.participant_id
       JOIN challenges c ON c.id = s.challenge_id
       LEFT JOIN teams t ON t.id = p.team_id
       ORDER BY c.starts_at DESC, s.created_at ASC`,
    )
    const columns = ['challenge', 'alias', 'team', 'score', 'quality', 'tempo', 'repetitions', 'attempts', 'amplitude', 'verification_status', 'completed_at']
    const csv = [columns.join(','), ...result.rows.map((row) => columns.map((column) => csvValue(row[column])).join(','))].join('\n')
    return context.text(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="phygital-pass-export.csv"' })
  })

  return app
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === '23505'
}
