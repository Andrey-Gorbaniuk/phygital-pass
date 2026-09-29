import { SQUAT_PROTOCOL } from './protocol'

export const TARGET_REPETITIONS = 10

export type SquatPhase = 'idle' | 'standing' | 'descending' | 'bottom' | 'ascending' | 'paused'

export type SquatObservation = {
  timestamp: number
  isVisible: boolean
  kneeAngle?: number
}

export type CompletedRep = {
  durationMs: number
  minKneeAngle: number
  qualityScore: number
}

export type RejectionReason = 'shallow' | 'tracking' | 'too_fast'

export type RejectedRep = {
  reason: RejectionReason
  minKneeAngle?: number
}

export type SquatSnapshot = {
  phase: SquatPhase
  repetitions: number
  rejectedAttempts: number
  depthReady: boolean
  feedback: string
  lastRep?: CompletedRep
  lastRejected?: RejectedRep
}

const STANDING_ANGLE = SQUAT_PROTOCOL.standingAngle
const DESCENDING_ANGLE = SQUAT_PROTOCOL.descendingAngle
const BOTTOM_ANGLE = SQUAT_PROTOCOL.bottomAngle
const ASCENDING_ANGLE = SQUAT_PROTOCOL.ascendingAngle
const BOTTOM_HOLD_MS = SQUAT_PROTOCOL.bottomHoldMs
const MIN_REP_DURATION_MS = SQUAT_PROTOCOL.minRepDurationMs
const REP_COOLDOWN_MS = SQUAT_PROTOCOL.repCooldownMs

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

function feedbackFor(phase: SquatPhase): string {
  switch (phase) {
    case 'standing':
      return 'Готово. Начинайте приседание'
    case 'descending':
      return 'Опускайтесь ниже'
    case 'bottom':
      return 'Отлично. Возвращайтесь вверх'
    case 'ascending':
      return 'Вернитесь в исходное положение'
    case 'paused':
      return 'Трекинг на паузе — вернитесь в кадр'
    default:
      return 'Встаньте в полный рост'
  }
}

function qualityFor(minKneeAngle: number, durationMs: number): number {
  const depth = clamp(((125 - minKneeAngle) / 30) * 100, 0, 100)
  const rhythm = clamp(100 - Math.abs(durationMs - 1600) / 14, 0, 100)
  return Math.round(depth * 0.65 + rhythm * 0.35)
}

function rejectionFeedback(reason: RejectionReason): string {
  if (reason === 'shallow') return 'Повтор не засчитан — опуститесь ниже и задержитесь внизу'
  if (reason === 'too_fast') return 'Повтор не засчитан — выполните движение спокойнее'
  return 'Повтор не засчитан — трекинг был потерян'
}

export class SquatMachine {
  private phase: SquatPhase = 'idle'
  private repetitions = 0
  private rejectedAttempts = 0
  private bottomAt?: number
  private repStartedAt?: number
  private minKneeAngle?: number
  private lastRepAt?: number
  private depthReady = false

  reset(): void {
    this.phase = 'idle'
    this.repetitions = 0
    this.rejectedAttempts = 0
    this.bottomAt = undefined
    this.repStartedAt = undefined
    this.minKneeAngle = undefined
    this.lastRepAt = undefined
    this.depthReady = false
  }

  process(observation: SquatObservation): SquatSnapshot {
    const { timestamp, isVisible, kneeAngle } = observation

    if (!isVisible || kneeAngle === undefined) {
      const lastRejected = this.rejectCurrentRep('tracking')
      this.phase = 'paused'
      return this.snapshot(undefined, lastRejected)
    }

    if (this.phase === 'paused' || this.phase === 'idle') {
      this.phase = kneeAngle >= STANDING_ANGLE ? 'standing' : 'idle'
      return this.snapshot()
    }

    if (this.phase === 'standing' && kneeAngle < DESCENDING_ANGLE) {
      this.phase = 'descending'
      this.repStartedAt = timestamp
      this.minKneeAngle = kneeAngle
      return this.snapshot()
    }

    if (this.phase === 'descending') {
      this.captureMinAngle(kneeAngle)
      if (kneeAngle <= BOTTOM_ANGLE) {
        this.phase = 'bottom'
        this.bottomAt = timestamp
      } else if (kneeAngle >= STANDING_ANGLE) {
        this.phase = 'standing'
        const lastRejected = this.rejectCurrentRep('shallow')
        return this.snapshot(undefined, lastRejected)
      }
      return this.snapshot()
    }

    if (this.phase === 'bottom') {
      this.captureMinAngle(kneeAngle)
      const bottomHeldLongEnough = timestamp - (this.bottomAt ?? timestamp) >= BOTTOM_HOLD_MS

      if (bottomHeldLongEnough) this.depthReady = true

      if (kneeAngle >= STANDING_ANGLE && !bottomHeldLongEnough) {
        this.phase = 'standing'
        const lastRejected = this.rejectCurrentRep('shallow')
        return this.snapshot(undefined, lastRejected)
      }

      if (kneeAngle > BOTTOM_ANGLE && !bottomHeldLongEnough) {
        this.phase = 'descending'
        this.bottomAt = undefined
        return this.snapshot()
      }

      if (kneeAngle >= ASCENDING_ANGLE && bottomHeldLongEnough) {
        this.phase = 'ascending'
      }
      return this.snapshot()
    }

    if (this.phase === 'ascending') {
      this.captureMinAngle(kneeAngle)
      if (kneeAngle <= BOTTOM_ANGLE) {
        this.phase = 'bottom'
        this.bottomAt = timestamp
        return this.snapshot()
      }

      if (kneeAngle >= STANDING_ANGLE) {
        const { lastRep, lastRejected } = this.completeRep(timestamp)
        this.phase = 'standing'
        this.clearCurrentRep()
        return this.snapshot(lastRep, lastRejected)
      }
    }

    return this.snapshot()
  }

  private completeRep(timestamp: number): { lastRep?: CompletedRep; lastRejected?: RejectedRep } {
    if (this.repStartedAt === undefined || this.minKneeAngle === undefined) return {}

    const durationMs = timestamp - this.repStartedAt
    if (durationMs < MIN_REP_DURATION_MS || (this.lastRepAt !== undefined && timestamp - this.lastRepAt < REP_COOLDOWN_MS)) {
      return { lastRejected: this.rejectCurrentRep('too_fast') }
    }

    const completed: CompletedRep = {
      durationMs,
      minKneeAngle: this.minKneeAngle,
      qualityScore: qualityFor(this.minKneeAngle, durationMs),
    }
    this.repetitions += 1
    this.lastRepAt = timestamp
    return { lastRep: completed }
  }

  private captureMinAngle(kneeAngle: number): void {
    this.minKneeAngle = Math.min(this.minKneeAngle ?? kneeAngle, kneeAngle)
  }

  private rejectCurrentRep(reason: RejectionReason): RejectedRep | undefined {
    if (this.repStartedAt === undefined) return undefined

    const rejected: RejectedRep = { reason, minKneeAngle: this.minKneeAngle }
    this.rejectedAttempts += 1
    this.clearCurrentRep()
    return rejected
  }

  private clearCurrentRep(): void {
    this.bottomAt = undefined
    this.repStartedAt = undefined
    this.minKneeAngle = undefined
    this.depthReady = false
  }

  private snapshot(lastRep?: CompletedRep, lastRejected?: RejectedRep): SquatSnapshot {
    return {
      phase: this.phase,
      repetitions: this.repetitions,
      rejectedAttempts: this.rejectedAttempts,
      depthReady: this.depthReady,
      feedback: lastRejected ? rejectionFeedback(lastRejected.reason) : feedbackFor(this.phase),
      lastRep,
      lastRejected,
    }
  }
}
