import { describe, expect, it } from 'vitest'
import { SquatMachine } from './squatMachine'

const visible = (timestamp: number, kneeAngle: number) => ({ timestamp, kneeAngle, isVisible: true })

function completeRep(machine: SquatMachine, offset = 0) {
  machine.process(visible(offset, 170))
  machine.process(visible(offset + 200, 145))
  machine.process(visible(offset + 400, 100))
  machine.process(visible(offset + 620, 100))
  machine.process(visible(offset + 760, 130))
  return machine.process(visible(offset + 1100, 170))
}

describe('SquatMachine', () => {
  it('counts one complete squat only once', () => {
    const machine = new SquatMachine()

    const result = completeRep(machine)
    const duplicate = machine.process(visible(1120, 170))

    expect(result.repetitions).toBe(1)
    expect(result.lastRep?.minKneeAngle).toBe(100)
    expect(duplicate.repetitions).toBe(1)
  })

  it('does not count a shallow squat', () => {
    const machine = new SquatMachine()

    machine.process(visible(0, 170))
    machine.process(visible(200, 145))
    machine.process(visible(420, 112))
    const result = machine.process(visible(800, 170))

    expect(result.repetitions).toBe(0)
  })

  it('pauses a sequence when pose visibility is lost without resetting previous progress', () => {
    const machine = new SquatMachine()
    completeRep(machine)
    machine.process(visible(2000, 145))
    const paused = machine.process({ timestamp: 2200, isVisible: false })
    const recovered = machine.process(visible(2600, 170))

    expect(paused.phase).toBe('paused')
    expect(paused.repetitions).toBe(1)
    expect(recovered.repetitions).toBe(1)
  })
})
