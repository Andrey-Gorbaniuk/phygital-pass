import { describe, expect, it } from 'vitest'
import { median, reactionLabel } from './reactionStats'

describe('reaction test statistics', () => {
  it('uses the median so one slow tap does not dominate the result', () => {
    expect(median([220, 235, 241, 250, 710])).toBe(241)
  })

  it('labels the result without a medical claim', () => {
    expect(reactionLabel(240)).toBe('Быстрая')
    expect(reactionLabel(320)).toBe('Стабильная')
    expect(reactionLabel(450)).toBe('Есть запас')
  })
})
