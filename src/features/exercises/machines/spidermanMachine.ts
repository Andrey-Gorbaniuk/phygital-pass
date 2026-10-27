import type {
  ExerciseCompletedRep,
  ExerciseObservation,
  ExercisePhase,
  ExerciseRejectedRep,
  ExerciseSnapshot,
  IExerciseMachine,
} from '../types'

const START_DISTANCE = 0.38
const PEAK_DISTANCE = 0.22
const RETURN_DISTANCE = 0.35
const MIN_REP_DURATION_MS = 650
const REP_COOLDOWN_MS = 400

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export class SpidermanMachine implements IExerciseMachine {
  private phase: ExercisePhase = 'idle'
  private repetitions = 0
  private rejectedAttempts = 0
  private repStartedAt?: number
  private minDistance?: number
  private lastRepAt?: number
  private targetReps = 12

  constructor(targetReps = 12) {
    this.targetReps = targetReps
  }

  reset(): void {
    this.phase = 'idle'
    this.repetitions = 0
    this.rejectedAttempts = 0
    this.repStartedAt = undefined
    this.minDistance = undefined
    this.lastRepAt = undefined
  }

  process(observation: ExerciseObservation): ExerciseSnapshot {
    const { timestamp, isVisible, assessment } = observation
    const distance = assessment.kneeToElbowDistance

    if (!isVisible || distance === undefined) {
      const lastRejected = this.rejectCurrentRep('tracking', 'Трекинг потерян — примите упор лёжа перед камерой')
      this.phase = 'paused'
      return this.snapshot(undefined, lastRejected, distance)
    }

    if (this.phase === 'paused' || this.phase === 'idle') {
      this.phase = distance >= START_DISTANCE ? 'ready' : 'idle'
      return this.snapshot(undefined, undefined, distance)
    }

    if (this.phase === 'ready' && distance < START_DISTANCE) {
      this.phase = 'contracting'
      this.repStartedAt = timestamp
      this.minDistance = distance
      return this.snapshot(undefined, undefined, distance)
    }

    if (this.phase === 'contracting') {
      this.minDistance = Math.min(this.minDistance ?? distance, distance)
      if (distance <= PEAK_DISTANCE) {
        this.phase = 'peak'
      } else if (distance >= START_DISTANCE) {
        this.phase = 'ready'
        const lastRejected = this.rejectCurrentRep('shallow', 'Тяните колено ближе к локтю через сторону')
        return this.snapshot(undefined, lastRejected, distance)
      }
      return this.snapshot(undefined, undefined, distance)
    }

    if (this.phase === 'peak') {
      this.minDistance = Math.min(this.minDistance ?? distance, distance)
      if (distance >= RETURN_DISTANCE) {
        const { lastRep, lastRejected } = this.completeRep(timestamp)
        this.phase = 'ready'
        this.clearCurrentRep()
        return this.snapshot(lastRep, lastRejected, distance)
      }
    }

    return this.snapshot(undefined, undefined, distance)
  }

  private completeRep(timestamp: number): { lastRep?: ExerciseCompletedRep; lastRejected?: ExerciseRejectedRep } {
    if (this.repStartedAt === undefined || this.minDistance === undefined) return {}

    const durationMs = timestamp - this.repStartedAt
    if (durationMs < MIN_REP_DURATION_MS || (this.lastRepAt !== undefined && timestamp - this.lastRepAt < REP_COOLDOWN_MS)) {
      return {
        lastRejected: this.rejectCurrentRep('too_fast', 'Слишком резкое движение — тяните колено подконтрольно'),
      }
    }

    const proximityScore = clamp(((0.26 - this.minDistance) / 0.12) * 100, 50, 100)
    const rhythmScore = clamp(100 - Math.abs(durationMs - 1400) / 16, 50, 100)
    const qualityScore = Math.round(proximityScore * 0.7 + rhythmScore * 0.3)

    const completed: ExerciseCompletedRep = {
      durationMs,
      qualityScore,
      metricValue: Math.round(this.minDistance * 100),
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
    this.repStartedAt = undefined
    this.minDistance = undefined
  }

  private snapshot(
    lastRep?: ExerciseCompletedRep,
    lastRejected?: ExerciseRejectedRep,
    distance?: number,
  ): ExerciseSnapshot {
    const feedback = lastRejected
      ? lastRejected.message
      : this.phase === 'ready'
      ? 'Упор принят. Тяните колено к локтю через сторону'
      : this.phase === 'contracting'
      ? 'Тяните колено ближе к локтю'
      : this.phase === 'peak'
      ? 'Отлично! Возвращайте ногу назад'
      : this.phase === 'paused'
      ? 'Вернитесь в кадр в упор лёжа'
      : 'Примите упор лёжа под углом 30–45° к камере'

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
      quality: lastRep ? lastRep.qualityScore : 89,
      lastRep,
      lastRejected,
      liveMetricLabel: 'Дистанция колено-локоть',
      liveMetricValue: distance !== undefined ? `${Math.round(distance * 100)} см` : '—',
    }
  }
}
