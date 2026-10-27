import type {
  ExerciseCompletedRep,
  ExerciseObservation,
  ExercisePhase,
  ExerciseRejectedRep,
  ExerciseSnapshot,
  IExerciseMachine,
} from '../types'

const STANDING_ANGLE = 160
const DESCENDING_ANGLE = 150
const BOTTOM_ANGLE = 105
const ASCENDING_ANGLE = 120
const BOTTOM_HOLD_MS = 140
const MIN_REP_DURATION_MS = 650
const REP_COOLDOWN_MS = 500

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export class SquatMachine implements IExerciseMachine {
  private phase: ExercisePhase = 'idle'
  private repetitions = 0
  private rejectedAttempts = 0
  private bottomAt?: number
  private repStartedAt?: number
  private minKneeAngle?: number
  private lastRepAt?: number
  private targetReps = 10

  constructor(targetReps = 10) {
    this.targetReps = targetReps
  }

  reset(): void {
    this.phase = 'idle'
    this.repetitions = 0
    this.rejectedAttempts = 0
    this.bottomAt = undefined
    this.repStartedAt = undefined
    this.minKneeAngle = undefined
    this.lastRepAt = undefined
  }

  process(observation: ExerciseObservation): ExerciseSnapshot {
    const { timestamp, isVisible, assessment } = observation
    const kneeAngle = assessment.kneeAngle

    if (!isVisible || kneeAngle === undefined) {
      const lastRejected = this.rejectCurrentRep('tracking', 'Трекинг потерян — вернитесь в кадр')
      this.phase = 'paused'
      return this.snapshot(undefined, lastRejected, kneeAngle)
    }

    if (this.phase === 'paused' || this.phase === 'idle') {
      this.phase = kneeAngle >= STANDING_ANGLE ? 'ready' : 'idle'
      return this.snapshot(undefined, undefined, kneeAngle)
    }

    if (this.phase === 'ready' && kneeAngle < DESCENDING_ANGLE) {
      this.phase = 'contracting'
      this.repStartedAt = timestamp
      this.minKneeAngle = kneeAngle
      return this.snapshot(undefined, undefined, kneeAngle)
    }

    if (this.phase === 'contracting') {
      this.minKneeAngle = Math.min(this.minKneeAngle ?? kneeAngle, kneeAngle)
      if (kneeAngle <= BOTTOM_ANGLE) {
        this.phase = 'peak'
        this.bottomAt = timestamp
      } else if (kneeAngle >= STANDING_ANGLE) {
        this.phase = 'ready'
        const lastRejected = this.rejectCurrentRep('shallow', 'Опуститесь ниже: бедро параллельно полу')
        return this.snapshot(undefined, lastRejected, kneeAngle)
      }
      return this.snapshot(undefined, undefined, kneeAngle)
    }

    if (this.phase === 'peak') {
      this.minKneeAngle = Math.min(this.minKneeAngle ?? kneeAngle, kneeAngle)
      const bottomHeld = timestamp - (this.bottomAt ?? timestamp) >= BOTTOM_HOLD_MS

      if (kneeAngle >= STANDING_ANGLE && !bottomHeld) {
        this.phase = 'ready'
        const lastRejected = this.rejectCurrentRep('shallow', 'Зафиксируйте нижнюю точку приседания')
        return this.snapshot(undefined, lastRejected, kneeAngle)
      }

      if (kneeAngle > BOTTOM_ANGLE && !bottomHeld) {
        this.phase = 'contracting'
        this.bottomAt = undefined
        return this.snapshot(undefined, undefined, kneeAngle)
      }

      if (kneeAngle >= ASCENDING_ANGLE && bottomHeld) {
        this.phase = 'returning'
      }
      return this.snapshot(undefined, undefined, kneeAngle)
    }

    if (this.phase === 'returning') {
      this.minKneeAngle = Math.min(this.minKneeAngle ?? kneeAngle, kneeAngle)
      if (kneeAngle <= BOTTOM_ANGLE) {
        this.phase = 'peak'
        this.bottomAt = timestamp
        return this.snapshot(undefined, undefined, kneeAngle)
      }

      if (kneeAngle >= STANDING_ANGLE) {
        const { lastRep, lastRejected } = this.completeRep(timestamp)
        this.phase = 'ready'
        this.clearCurrentRep()
        return this.snapshot(lastRep, lastRejected, kneeAngle)
      }
    }

    return this.snapshot(undefined, undefined, kneeAngle)
  }

  private completeRep(timestamp: number): { lastRep?: ExerciseCompletedRep; lastRejected?: ExerciseRejectedRep } {
    if (this.repStartedAt === undefined || this.minKneeAngle === undefined) return {}

    const durationMs = timestamp - this.repStartedAt
    if (durationMs < MIN_REP_DURATION_MS || (this.lastRepAt !== undefined && timestamp - this.lastRepAt < REP_COOLDOWN_MS)) {
      return {
        lastRejected: this.rejectCurrentRep('too_fast', 'Слишком быстро: выполняйте присед спокойно и подконтрольно'),
      }
    }

    const depthScore = clamp(((120 - this.minKneeAngle) / 25) * 100, 40, 100)
    const rhythmScore = clamp(100 - Math.abs(durationMs - 1600) / 16, 40, 100)
    const qualityScore = Math.round(depthScore * 0.7 + rhythmScore * 0.3)

    const completed: ExerciseCompletedRep = {
      durationMs,
      qualityScore,
      metricValue: this.minKneeAngle,
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
    this.minKneeAngle = undefined
  }

  private snapshot(
    lastRep?: ExerciseCompletedRep,
    lastRejected?: ExerciseRejectedRep,
    kneeAngle?: number,
  ): ExerciseSnapshot {
    const feedback = lastRejected
      ? lastRejected.message
      : this.phase === 'ready'
      ? 'Готово. Начинайте приседание'
      : this.phase === 'contracting'
      ? 'Опускайтесь глубже'
      : this.phase === 'peak'
      ? 'Отлично. Возвращайтесь вверх'
      : this.phase === 'returning'
      ? 'Выпрямляйтесь полностью'
      : this.phase === 'paused'
      ? 'Вернитесь в кадр'
      : 'Встаньте в полный рост боком к камере'

    const completion = Math.min((this.repetitions / this.targetReps) * 100, 100)
    const attempts = this.repetitions + this.rejectedAttempts
    const acceptance = attempts ? (this.repetitions / attempts) * 100 : 100
    const score = Math.round(completion * 0.6 + acceptance * 0.4)

    return {
      phase: this.phase,
      repetitions: this.repetitions,
      rejectedAttempts: this.rejectedAttempts,
      feedback,
      score,
      quality: lastRep ? lastRep.qualityScore : 88,
      lastRep,
      lastRejected,
      liveMetricLabel: 'Угол колена',
      liveMetricValue: kneeAngle !== undefined ? `${kneeAngle}°` : '—',
    }
  }
}
