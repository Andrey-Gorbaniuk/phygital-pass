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
    expect(result.rejectedAttempts).toBe(1)
    expect(result.lastRejected?.reason).toBe('shallow')
  })

  it('rejects a movement that reaches depth but is completed too quickly', () => {
    const machine = new SquatMachine()

    machine.process(visible(0, 170))
    machine.process(visible(20, 145))
    machine.process(visible(100, 100))
    machine.process(visible(280, 125))
    const result = machine.process(visible(500, 170))

    expect(result.repetitions).toBe(0)
    expect(result.rejectedAttempts).toBe(1)
    expect(result.lastRejected?.reason).toBe('too_fast')
  })

  it('rejects a bottom position that was not held long enough', () => {
    const machine = new SquatMachine()

    machine.process(visible(0, 170))
    machine.process(visible(200, 145))
    machine.process(visible(400, 100))
    machine.process(visible(500, 130))
    const result = machine.process(visible(800, 170))

    expect(result.repetitions).toBe(0)
    expect(result.rejectedAttempts).toBe(1)
    expect(result.lastRejected?.reason).toBe('shallow')
  })

  it('marks the depth as ready only after the required bottom hold', () => {
    const machine = new SquatMachine()

    machine.process(visible(0, 170))
    machine.process(visible(200, 145))
    const reachedDepth = machine.process(visible(400, 100))
    const readyToRise = machine.process(visible(560, 100))
    const rising = machine.process(visible(620, 130))

    expect(reachedDepth.depthReady).toBe(false)
    expect(readyToRise.depthReady).toBe(true)
    expect(rising.depthReady).toBe(true)
  })

  it('pauses a sequence when pose visibility is lost without resetting previous progress', () => {
    const machine = new SquatMachine()
    completeRep(machine)
    machine.process(visible(2000, 145))
    const paused = machine.process({ timestamp: 2200, isVisible: false })
    const recovered = machine.process(visible(2600, 170))

    expect(paused.phase).toBe('paused')
    expect(paused.repetitions).toBe(1)
    expect(paused.rejectedAttempts).toBe(1)
    expect(paused.lastRejected?.reason).toBe('tracking')
    expect(recovered.repetitions).toBe(1)
  })
})
