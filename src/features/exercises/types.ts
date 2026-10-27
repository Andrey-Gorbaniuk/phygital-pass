import type { PoseAssessment } from '../pose/poseMath'

export type ExerciseId =
  | 'pushups'
  | 'vup'
  | 'squat'
  | 'superman'
  | 'moving_plank'
  | 'single_leg_bridge'
  | 'spiderman'
  | 'side_plank'
  | 'knee_tucks'
  | 'roll_to_squat'
  | 'split_lunges'
  | 'burpee'

export type ExerciseCategory =
  | 'Силовая выносливость'
  | 'Мышцы кора и пресса'
  | 'Базовая биомеханика'
  | 'Функциональный тренинг'

export type ExerciseDosage = {
  initial: string
  basic: string
  max: string
}

export type ExerciseDefinition = {
  id: ExerciseId
  order: number
  title: string
  shortTitle: string
  category: ExerciseCategory
  isInteractive: boolean
  protocolId?: string
  targetReps: number
  unitLabel: 'повторений' | 'секунд'
  cameraAngle: string
  cameraDistance: string
  bodyPlane: string
  description: string
  technique: string[]
  dosage: ExerciseDosage
  controlJoints: string[]
}

export type ExercisePhase = 'idle' | 'ready' | 'contracting' | 'peak' | 'returning' | 'paused'

export type ExerciseObservation = {
  timestamp: number
  isVisible: boolean
  assessment: PoseAssessment
}

export type ExerciseCompletedRep = {
  durationMs: number
  qualityScore: number
  metricValue?: number
}

export type ExerciseRejectedRep = {
  reason: 'shallow' | 'tracking' | 'too_fast' | 'form_break'
  message: string
}

export type ExerciseSnapshot = {
  phase: ExercisePhase
  repetitions: number
  rejectedAttempts: number
  feedback: string
  score: number
  quality: number
  lastRep?: ExerciseCompletedRep
  lastRejected?: ExerciseRejectedRep
  liveMetricLabel?: string
  liveMetricValue?: string | number
}

export interface IExerciseMachine {
  reset(): void
  process(observation: ExerciseObservation): ExerciseSnapshot
}
