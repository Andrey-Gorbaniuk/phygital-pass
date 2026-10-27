import type {
  ExerciseCompletedRep,
  ExerciseObservation,
  ExercisePhase,
  ExerciseRejectedRep,
  ExerciseSnapshot,
  IExerciseMachine,
} from '../types'

const TOP_ELBOW_ANGLE = 155
const DESCENDING_ELBOW_ANGLE = 140
const BOTTOM_ELBOW_ANGLE = 95
const ASCENDING_ELBOW_ANGLE = 120
const MIN_BOTTOM_HOLD_MS = 250 // Sablin: фиксация груди внизу
const MIN_REP_DURATION_MS = 600
const REP_COOLDOWN_MS = 450
const MIN_BODY_LINE_ANGLE = 145

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export class PushupMachine implements IExerciseMachine {
  private phase: ExercisePhase = 'idle'
  private repetitions = 0
  private rejectedAttempts = 0
  private bottomAt?: number
  private repStartedAt?: number
  private minElbowAngle?: number
  private minBodyLine?: number
  private lastRepAt?: number
  private targetReps = 12

  constructor(targetReps = 12) {
    this.targetReps = targetReps
  }

  reset(): void {
    this.phase = 'idle'
    this.repetitions = 0
    this.rejectedAttempts = 0
    this.bottomAt = undefined
    this.repStartedAt = undefined
    this.minElbowAngle = undefined
    this.minBodyLine = undefined
    this.lastRepAt = undefined
  }

  process(observation: ExerciseObservation): ExerciseSnapshot {
    const { timestamp, isVisible, assessment } = observation
    const elbowAngle = assessment.elbowAngle
    const bodyLine = assessment.bodyLineAngle

    if (!isVisible || elbowAngle === undefined) {
      const lastRejected = this.rejectCurrentRep('tracking', 'Трекинг потерян — держите руки и корпус в кадре')
      this.phase = 'paused'
      return this.snapshot(undefined, lastRejected, elbowAngle)
    }

    // Body line check (no sagging hips)
    if (bodyLine !== undefined && bodyLine < MIN_BODY_LINE_ANGLE && this.phase !== 'idle' && this.phase !== 'paused') {
      const lastRejected = this.rejectCurrentRep('form_break', 'Держите тело в одну прямую линию: таз не прогибать!')
      this.phase = 'ready'
      return this.snapshot(undefined, lastRejected, elbowAngle)
    }

    if (this.phase === 'paused' || this.phase === 'idle') {
      this.phase = elbowAngle >= TOP_ELBOW_ANGLE ? 'ready' : 'idle'
      return this.snapshot(undefined, undefined, elbowAngle)
    }

    if (this.phase === 'ready' && elbowAngle < DESCENDING_ELBOW_ANGLE) {
      this.phase = 'contracting'
      this.repStartedAt = timestamp
      this.minElbowAngle = elbowAngle
      this.minBodyLine = bodyLine
      return this.snapshot(undefined, undefined, elbowAngle)
    }

    if (this.phase === 'contracting') {
      this.minElbowAngle = Math.min(this.minElbowAngle ?? elbowAngle, elbowAngle)
      if (elbowAngle <= BOTTOM_ELBOW_ANGLE) {
        this.phase = 'peak'
        this.bottomAt = timestamp
      } else if (elbowAngle >= TOP_ELBOW_ANGLE) {
        this.phase = 'ready'
        const lastRejected = this.rejectCurrentRep('shallow', 'Опуститесь ниже: грудь ближе к полу, сгиб 90°')
        return this.snapshot(undefined, lastRejected, elbowAngle)
      }
      return this.snapshot(undefined, undefined, elbowAngle)
    }

    if (this.phase === 'peak') {
      this.minElbowAngle = Math.min(this.minElbowAngle ?? elbowAngle, elbowAngle)
      const bottomHeld = timestamp - (this.bottomAt ?? timestamp) >= MIN_BOTTOM_HOLD_MS

      if (elbowAngle >= TOP_ELBOW_ANGLE && !bottomHeld) {
        this.phase = 'ready'
        const lastRejected = this.rejectCurrentRep('shallow', 'Зафиксируйте грудь внизу на долю секунды')
        return this.snapshot(undefined, lastRejected, elbowAngle)
      }

      if (elbowAngle > BOTTOM_ELBOW_ANGLE && !bottomHeld) {
        this.phase = 'contracting'
        this.bottomAt = undefined
        return this.snapshot(undefined, undefined, elbowAngle)
      }

      if (elbowAngle >= ASCENDING_ELBOW_ANGLE && bottomHeld) {
        this.phase = 'returning'
      }
      return this.snapshot(undefined, undefined, elbowAngle)
    }

    if (this.phase === 'returning') {
      this.minElbowAngle = Math.min(this.minElbowAngle ?? elbowAngle, elbowAngle)
      if (elbowAngle <= BOTTOM_ELBOW_ANGLE) {
        this.phase = 'peak'
        this.bottomAt = timestamp
        return this.snapshot(undefined, undefined, elbowAngle)
      }

      if (elbowAngle >= TOP_ELBOW_ANGLE) {
        const { lastRep, lastRejected } = this.completeRep(timestamp)
        this.phase = 'ready'
        this.clearCurrentRep()
        return this.snapshot(lastRep, lastRejected, elbowAngle)
      }
    }

    return this.snapshot(undefined, undefined, elbowAngle)
  }

  private completeRep(timestamp: number): { lastRep?: ExerciseCompletedRep; lastRejected?: ExerciseRejectedRep } {
    if (this.repStartedAt === undefined || this.minElbowAngle === undefined) return {}

    const durationMs = timestamp - this.repStartedAt
    if (durationMs < MIN_REP_DURATION_MS || (this.lastRepAt !== undefined && timestamp - this.lastRepAt < REP_COOLDOWN_MS)) {
      return {
        lastRejected: this.rejectCurrentRep('too_fast', 'Слишком быстро: отжимайтесь подконтрольно'),
      }
    }

    const depthScore = clamp(((110 - this.minElbowAngle) / 25) * 100, 50, 100)
    const postureScore = clamp((((this.minBodyLine ?? 170) - 140) / 35) * 100, 50, 100)
    const qualityScore = Math.round(depthScore * 0.6 + postureScore * 0.4)

    const completed: ExerciseCompletedRep = {
      durationMs,
      qualityScore,
      metricValue: this.minElbowAngle,
    }
    this.repetitions += 1
    this.lastRepAt = timestamp
    return { lastRep: completed }
  }

  private rejectCurrentRep(reason: ExerciseRejectedRep['reason'], message: string): ExerciseRejectedRep | undefined {
    if (this.repStartedAt === undefined && reason !== 'tracking') return undefined
    const rejected: ExerciseRejectedRep = { reason, message }
    this.rejectedAttempts += 1
    this.clearCurrentRep()
    return rejected
  }

  private clearCurrentRep(): void {
    this.bottomAt = undefined
    this.repStartedAt = undefined
    this.minElbowAngle = undefined
    this.minBodyLine = undefined
  }

  private snapshot(
    lastRep?: ExerciseCompletedRep,
    lastRejected?: ExerciseRejectedRep,
    elbowAngle?: number,
  ): ExerciseSnapshot {
    const feedback = lastRejected
      ? lastRejected.message
      : this.phase === 'ready'
      ? 'Упор лёжа принят. Начинайте отжимание'
      : this.phase === 'contracting'
      ? 'Опускайтесь ниже грудью к полу'
      : this.phase === 'peak'
      ? 'Отлично. Выжимайте себя вверх'
      : this.phase === 'returning'
      ? 'Полностью выпрямляйте руки'
      : this.phase === 'paused'
      ? 'Вернитесь в упор лёжа перед камерой'
      : 'Примите упор лёжа боком к камере'

    const completion = Math.min((this.repetitions / this.targetReps) * 100, 100)
    const attempts = this.repetitions + this.rejectedAttempts
    const acceptance = attempts ? (this.repetitions / attempts) * 100 : 100
    const score = Math.round(completion * 0.65 + acceptance * 0.35)

    return {
      phase: this.phase,
      repetitions: this.repetitions,
      rejectedAttempts: this.rejectedAttempts,
      feedback,
      score,
      quality: lastRep ? lastRep.qualityScore : 90,
      lastRep,
      lastRejected,
      liveMetricLabel: 'Угол локтя',
      liveMetricValue: elbowAngle !== undefined ? `${elbowAngle}°` : '—',
    }
  }
}
