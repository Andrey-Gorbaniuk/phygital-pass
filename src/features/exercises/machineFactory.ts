import type { ExerciseId, IExerciseMachine } from './types'
import { SquatMachine } from './machines/squatMachine'
import { PushupMachine } from './machines/pushupMachine'
import { VupMachine } from './machines/vupMachine'
import { PlankMachine } from './machines/plankMachine'
import { SpidermanMachine } from './machines/spidermanMachine'

export function createExerciseMachine(id: ExerciseId, targetReps?: number): IExerciseMachine {
  switch (id) {
    case 'pushups':
      return new PushupMachine(targetReps ?? 12)
    case 'vup':
      return new VupMachine(targetReps ?? 15)
    case 'squat':
      return new SquatMachine(targetReps ?? 10)
    case 'moving_plank':
      return new PlankMachine(targetReps ?? 30)
    case 'spiderman':
      return new SpidermanMachine(targetReps ?? 12)
    default:
      return new SquatMachine(targetReps ?? 10)
  }
}
