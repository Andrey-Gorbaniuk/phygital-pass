export type SubmissionMetrics = {
  repetitions: number
  attempts: number
  quality: number
}

export function calculateScore({ repetitions, attempts, quality }: SubmissionMetrics): number {
  const completion = Math.min(repetitions / 10, 1) * 100
  const acceptance = attempts ? (repetitions / attempts) * 100 : 0
  return Math.round(completion * 0.3 + quality * 0.45 + acceptance * 0.25)
}
