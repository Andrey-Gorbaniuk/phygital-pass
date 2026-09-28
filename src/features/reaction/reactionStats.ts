export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

export function reactionLabel(milliseconds: number): string {
  if (milliseconds <= 260) return 'Быстрая'
  if (milliseconds <= 360) return 'Стабильная'
  return 'Есть запас'
}
