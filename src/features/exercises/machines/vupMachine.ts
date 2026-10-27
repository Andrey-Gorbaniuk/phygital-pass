import type {
  ExerciseCompletedRep,
  ExerciseObservation,
  ExercisePhase,
  ExerciseRejectedRep,
  ExerciseSnapshot,
  IExerciseMachine,
} from '../types'

const FLAT_HIP_ANGLE = 150
const CONTRACTING_HIP_ANGLE = 135
const PEAK_HIP_ANGLE = 100
const RETURNING_HIP_ANGLE = 125
const MIN_REP_DURATION_MS = 600
const REP_COOLDOWN_MS = 450

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export class VupMachine implements IExerciseMachine {
  private phase: ExercisePhase = 'idle'
  private repetitions = 0
  private rejectedAttempts = 0
  private repStartedAt?: number
  private minHipAngle?: number
  private lastRepAt?: number
  private targetReps = 15

  constructor(targetReps = 15) {
    this.targetReps = targetReps
  }

  reset(): void {
    this.phase = 'idle'
    this.repetitions = 0
    this.rejectedAttempts = 0
    this.repStartedAt = undefined
    this.minHipAngle = undefined
    this.lastRepAt = undefined
  }

  process(observation: ExerciseObservation): ExerciseSnapshot {
    const { timestamp, isVisible, assessment } = observation
    const hipAngle = assessment.hipAngle

    if (!isVisible || hipAngle === undefined) {
      const lastRejected = this.rejectCurrentRep('tracking', 'Трекинг потерян — оставайтесь в кадре лёжа на полу')
      this.phase = 'paused'
      return this.snapshot(undefined, lastRejected, hipAngle)
    }

    if (this.phase === 'paused' || this.phase === 'idle') {
      this.phase = hipAngle >= FLAT_HIP_ANGLE ? 'ready' : 'idle'
      return this.snapshot(undefined, undefined, hipAngle)
    }

    if (this.phase === 'ready' && hipAngle < CONTRACTING_HIP_ANGLE) {
      this.phase = 'contracting'
      this.repStartedAt = timestamp
      this.minHipAngle = hipAngle
      return this.snapshot(undefined, undefined, hipAngle)
    }

    if (this.phase === 'contracting') {
      this.minHipAngle = Math.min(this.minHipAngle ?? hipAngle, hipAngle)
      if (hipAngle <= PEAK_HIP_ANGLE) {
        this.phase = 'peak'
      } else if (hipAngle >= FLAT_HIP_ANGLE) {
        this.phase = 'ready'
        const lastRejected = this.rejectCurrentRep('shallow', 'Поднимайте ноги и корпус выше до прямого угла 90°')
        return this.snapshot(undefined, lastRejected, hipAngle)
      }
      return this.snapshot(undefined, undefined, hipAngle)
    }

    if (this.phase === 'peak') {
      this.minHipAngle = Math.min(this.minHipAngle ?? hipAngle, hipAngle)
      if (hipAngle >= RETURNING_HIP_ANGLE) {
        this.phase = 'returning'
      }
      return this.snapshot(undefined, undefined, hipAngle)
    }

    if (this.phase === 'returning') {
      this.minHipAngle = Math.min(this.minHipAngle ?? hipAngle, hipAngle)
      if (hipAngle <= PEAK_HIP_ANGLE) {
        this.phase = 'peak'
        return this.snapshot(undefined, undefined, hipAngle)
      }

      if (hipAngle >= FLAT_HIP_ANGLE) {
        const { lastRep, lastRejected } = this.completeRep(timestamp)
        this.phase = 'ready'
        this.clearCurrentRep()
        return this.snapshot(lastRep, lastRejected, hipAngle)
      }
    }

    return this.snapshot(undefined, undefined, hipAngle)
  }

  private completeRep(timestamp: number): { lastRep?: ExerciseCompletedRep; lastRejected?: ExerciseRejectedRep } {
    if (this.repStartedAt === undefined || this.minHipAngle === undefined) return {}

    const durationMs = timestamp - this.repStartedAt
    if (durationMs < MIN_REP_DURATION_MS || (this.lastRepAt !== undefined && timestamp - this.lastRepAt < REP_COOLDOWN_MS)) {
      return {
        lastRejected: this.rejectCurrentRep('too_fast', 'Слишком быстро: тянитесь к носкам подконтрольно'),
      }
    }

    const peakScore = clamp(((115 - this.minHipAngle) / 25) * 100, 50, 100)
    const rhythmScore = clamp(100 - Math.abs(durationMs - 1500) / 16, 50, 100)
    const qualityScore = Math.round(peakScore * 0.7 + rhythmScore * 0.3)

    const completed: ExerciseCompletedRep = {
      durationMs,
      qualityScore,
      metricValue: this.minHipAngle,
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
    this.minHipAngle = undefined
  }

  private snapshot(
    lastRep?: ExerciseCompletedRep,
    lastRejected?: ExerciseRejectedRep,
    hipAngle?: number,
  ): ExerciseSnapshot {
    const feedback = lastRejected
      ? lastRejected.message
      : this.phase === 'ready'
      ? 'Лёжа на полу. Поднимайте ноги и плечи к носкам'
      : this.phase === 'contracting'
      ? 'Тянитесь руками к носкам до угла 90°'
      : this.phase === 'peak'
      ? 'Отлично! Плавно опускайтесь обратно'
      : this.phase === 'returning'
      ? 'Возврат: не касайтесь пола пятками'
      : this.phase === 'paused'
      ? 'Вернитесь в кадр на коврик'
      : 'Лягте на спину боком к камере'

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
      quality: lastRep ? lastRep.qualityScore : 91,
      lastRep,
      lastRejected,
      liveMetricLabel: 'Угол корпуса',
      liveMetricValue: hipAngle !== undefined ? `${hipAngle}°` : '—',
    }
  }
}
