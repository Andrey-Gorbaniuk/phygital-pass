type ShareableResult = {
  score: number
  repetitions: number
  attempts: number
  quality: number
  tempo: number
  amplitude: string
}

export function downloadResultCard(result: ShareableResult): void {
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 900
  const context = canvas.getContext('2d')
  if (!context) return

  const background = context.createLinearGradient(0, 0, canvas.width, canvas.height)
  background.addColorStop(0, '#163b56')
  background.addColorStop(.56, '#081224')
  background.addColorStop(1, '#202357')
  context.fillStyle = background
  context.fillRect(0, 0, canvas.width, canvas.height)

  context.strokeStyle = 'rgba(122, 230, 249, .55)'
  context.lineWidth = 2
  context.strokeRect(68, 68, canvas.width - 136, canvas.height - 136)
  context.fillStyle = '#8deffc'
  context.font = '700 24px system-ui, sans-serif'
  context.letterSpacing = '5px'
  context.fillText('PHYGITAL PASS / MOTION PROFILE', 112, 135)
  context.fillStyle = '#effeff'
  context.font = '800 310px system-ui, sans-serif'
  context.letterSpacing = '-20px'
  context.fillText(String(result.score), 110, 485)
  context.fillStyle = '#98e9f4'
  context.font = '600 44px system-ui, sans-serif'
  context.letterSpacing = '0px'
  context.fillText('/ 100', 570, 450)
  context.fillStyle = '#78efff'
  context.font = '700 22px system-ui, sans-serif'
  context.letterSpacing = '4px'
  context.fillText('PHYGITAL SCORE', 116, 540)

  const metrics = [
    [`${result.repetitions}/${result.attempts}`, 'ЗАСЧИТАНО / ПОПЫТКИ'],
    [`${result.quality}%`, 'КАЧЕСТВО'],
    [`${result.tempo}`, 'ПОВТОРОВ В МИНУТУ'],
    [result.amplitude.toUpperCase(), 'АМПЛИТУДА'],
  ]
  metrics.forEach(([value, label], index) => {
    const x = 112 + index * 370
    context.fillStyle = 'rgba(5, 16, 31, .5)'
    context.fillRect(x, 625, 345, 135)
    context.fillStyle = '#eafbff'
    context.font = '700 38px system-ui, sans-serif'
    context.fillText(value, x + 25, 682)
    context.fillStyle = 'rgba(193, 234, 244, .72)'
    context.font = '600 16px system-ui, sans-serif'
    context.letterSpacing = '2px'
    context.fillText(label, x + 25, 722)
  })
  context.fillStyle = 'rgba(198, 234, 244, .6)'
  context.font = '600 18px system-ui, sans-serif'
  context.letterSpacing = '3px'
  context.fillText('ЛОКАЛЬНЫЙ АНАЛИЗ ДВИЖЕНИЯ · ВИДЕО НЕ СОХРАНЯЕТСЯ', 112, 822)

  canvas.toBlob((blob) => {
    if (!blob) return
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'phygital-pass-result.png'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }, 'image/png')
}
