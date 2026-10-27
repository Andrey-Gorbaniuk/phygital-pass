import type {
  ExerciseCompletedRep,
  ExerciseObservation,
  ExercisePhase,
  ExerciseRejectedRep,
  ExerciseSnapshot,
  IExerciseMachine,
} from '../types'

const MIN_BODY_LINE = 150
const MAX_PIKE_ANGLE = 140 // hip angle

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export class PlankMachine implements IExerciseMachine {
  private phase: ExercisePhase = 'idle'
  private heldSeconds = 0
  private lastSecondTick?: number
  private rejectedAttempts = 0
  private targetSeconds = 30
  private formBreaks = 0
  private totalChecks = 0
  private goodChecks = 0

  constructor(targetSeconds = 30) {
    this.targetSeconds = targetSeconds
  }

  reset(): void {
    this.phase = 'idle'
    this.heldSeconds = 0
    this.lastSecondTick = undefined
    this.rejectedAttempts = 0
    this.formBreaks = 0
    this.totalChecks = 0
    this.goodChecks = 0
  }

  process(observation: ExerciseObservation): ExerciseSnapshot {
    const { timestamp, isVisible, assessment } = observation
    const bodyLine = assessment.bodyLineAngle
    const hipAngle = assessment.hipAngle

    if (!isVisible || bodyLine === undefined) {
      this.phase = 'paused'
      return this.snapshot('Трекинг потерян — примите упор в планке в кадре', bodyLine)
    }

    // Check if in plank position (prone body line)
    const isSagging = bodyLine < MIN_BODY_LINE
    const isPiking = hipAngle !== undefined && hipAngle < MAX_PIKE_ANGLE
    const isGoodForm = !isSagging && !isPiking

    this.totalChecks += 1
    if (isGoodForm) this.goodChecks += 1

    if (isSagging) {
      this.formBreaks += 1
      return this.snapshot('Поднимите таз! Тело должно быть прямой линией', bodyLine)
    }

    if (isPiking) {
      this.formBreaks += 1
      return this.snapshot('Опустите таз! Не задирайте ягодицы вверх', bodyLine)
    }

    // Form is good
    if (this.phase === 'idle' || this.phase === 'paused' || this.phase === 'ready') {
      this.phase = 'contracting'
      this.lastSecondTick = timestamp
    }

    if (this.phase === 'contracting') {
      if (this.lastSecondTick === undefined) {
        this.lastSecondTick = timestamp
      } else if (timestamp - this.lastSecondTick >= 1000) {
        const deltaSec = Math.floor((timestamp - this.lastSecondTick) / 1000)
        this.heldSeconds = Math.min(this.heldSeconds + deltaSec, this.targetSeconds)
        this.lastSecondTick = timestamp

        if (this.heldSeconds >= this.targetSeconds) {
          this.phase = 'peak'
        }
      }
    }

    const feedback =
      this.heldSeconds >= this.targetSeconds
        ? 'Норматив удержан! Отличная фиксация!'
        : `Удерживайте планку: ${this.heldSeconds} из ${this.targetSeconds} сек`

    return this.snapshot(feedback, bodyLine)
  }

  private snapshot(feedback: string, bodyLine?: number): ExerciseSnapshot {
    const completion = Math.min((this.heldSeconds / this.targetSeconds) * 100, 100)
    const qualityRatio = this.totalChecks ? (this.goodChecks / this.totalChecks) * 100 : 100
    const quality = Math.round(clamp(qualityRatio - this.formBreaks * 2, 50, 100))
    const score = Math.round(completion * 0.7 + quality * 0.3)

    const lastRep: ExerciseCompletedRep | undefined =
      this.heldSeconds >= this.targetSeconds
        ? {
            durationMs: this.heldSeconds * 1000,
            qualityScore: quality,
            metricValue: this.heldSeconds,
          }
        : undefined

    return {
      phase: this.phase,
      repetitions: this.heldSeconds,
      rejectedAttempts: this.formBreaks,
      feedback,
      score,
      quality,
      lastRep,
      liveMetricLabel: 'Линия спины',
      liveMetricValue: bodyLine !== undefined ? `${bodyLine}°` : '—',
    }
  }
}
