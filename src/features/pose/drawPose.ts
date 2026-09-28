import type { PoseLandmark } from './poseMath'

const CONNECTIONS: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25],
  [25, 27], [24, 26], [26, 28], [27, 31], [28, 32],
]

export function drawPose(canvas: HTMLCanvasElement, landmarks: PoseLandmark[]): void {
  const context = canvas.getContext('2d')
  if (!context) return

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.shadowBlur = 16
  context.shadowColor = '#44e8ff'
  context.strokeStyle = '#44e8ff'
  context.lineWidth = Math.max(canvas.width * 0.005, 3)

  for (const [from, to] of CONNECTIONS) {
    const first = landmarks[from]
    const second = landmarks[to]
    if (!first || !second || (first.visibility ?? 1) < 0.4 || (second.visibility ?? 1) < 0.4) continue

    context.beginPath()
    context.moveTo(first.x * canvas.width, first.y * canvas.height)
    context.lineTo(second.x * canvas.width, second.y * canvas.height)
    context.stroke()
  }

  context.fillStyle = '#f0fdff'
  for (const landmark of landmarks) {
    if ((landmark.visibility ?? 1) < 0.5) continue
    context.beginPath()
    context.arc(landmark.x * canvas.width, landmark.y * canvas.height, Math.max(canvas.width * 0.008, 4), 0, Math.PI * 2)
    context.fill()
  }
}
