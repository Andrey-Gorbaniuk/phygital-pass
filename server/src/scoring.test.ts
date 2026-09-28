import { describe, expect, it } from 'vitest'
import { calculateScore } from './scoring.js'

describe('calculateScore', () => {
  it('matches the client formula and rewards accepted attempts', () => {
    expect(calculateScore({ repetitions: 10, attempts: 10, quality: 89 })).toBe(95)
    expect(calculateScore({ repetitions: 10, attempts: 18, quality: 86 })).toBe(83)
  })

  it('does not award completion above the ten-repetition target', () => {
    expect(calculateScore({ repetitions: 12, attempts: 12, quality: 100 })).toBe(100)
  })
})
