import { useEffect, useRef, useState } from 'react'
import { median, reactionLabel } from './reactionStats'

const REACTION_HISTORY_KEY = 'phygital-pass:reaction-history'
const ROUNDS = 5

export type ReactionResult = {
  completedAt: string
  medianMs: number
  bestMs: number
  falseStarts: number
}

type Stage = 'ready' | 'waiting' | 'go' | 'complete'

function saveResult(result: ReactionResult): void {
  try {
    const raw = window.localStorage.getItem(REACTION_HISTORY_KEY)
    const existing = raw ? (JSON.parse(raw) as ReactionResult[]) : []
    window.localStorage.setItem(REACTION_HISTORY_KEY, JSON.stringify([result, ...existing].slice(0, 12)))
  } catch {
    // Локальное сохранение не должно прерывать тест.
  }
}

export function ReactionLab({ onClose }: { onClose: () => void }) {
  const [stage, setStage] = useState<Stage>('ready')
  const [rounds, setRounds] = useState<number[]>([])
  const [falseStarts, setFalseStarts] = useState(0)
  const [result, setResult] = useState<ReactionResult | null>(null)
  const startedAt = useRef(0)
  const timer = useRef<number | null>(null)

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current) }, [])

  const beginRound = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    setStage('waiting')
    timer.current = window.setTimeout(() => {
      startedAt.current = performance.now()
      setStage('go')
      timer.current = null
    }, 1500 + Math.round(Math.random() * 2500))
  }

  const tap = () => {
    if (stage === 'ready') {
      beginRound()
      return
    }
    if (stage === 'waiting') {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
      setFalseStarts((current) => current + 1)
      setStage('ready')
      return
    }
    if (stage !== 'go') return

    const nextRounds = [...rounds, Math.round(performance.now() - startedAt.current)]
    setRounds(nextRounds)
    if (nextRounds.length < ROUNDS) {
      setStage('ready')
      return
    }

    const completed: ReactionResult = {
      completedAt: new Date().toISOString(),
      medianMs: median(nextRounds),
      bestMs: Math.min(...nextRounds),
      falseStarts,
    }
    saveResult(completed)
    setResult(completed)
    setStage('complete')
  }

  const restart = () => {
    setRounds([])
    setFalseStarts(0)
    setResult(null)
    setStage('ready')
  }

  const label = stage === 'go' ? 'ЖМИ' : stage === 'waiting' ? 'ЖДИ' : stage === 'complete' ? 'ГОТОВО' : 'НАЧАТЬ'
  const instruction = stage === 'go'
    ? 'Нажмите сразу, как поле стало зелёным.'
    : stage === 'waiting'
      ? 'Не нажимайте до смены цвета.'
      : stage === 'complete'
        ? 'Результат сохранён только на этом устройстве.'
        : 'Нажмите на поле. Затем дождитесь зелёного сигнала.'

  return (
    <section className="reaction-screen screen-enter">
      <div className="reaction-header"><div><div className="eyebrow"><span className="pulse-dot" /> REACTION LAB / NO CAMERA</div><h1>Проверь <em>реакцию</em></h1><p>Пять коротких раундов без камеры. Результат — игровой показатель для личной динамики, не медицинский вывод.</p></div><button type="button" className="text-button" onClick={onClose}>На главный экран</button></div>
      <div className="reaction-layout">
        <button type="button" className={`reaction-target ${stage}`} onClick={tap} aria-label={label}><span>{label}</span><small>{instruction}</small></button>
        <aside className="reaction-panel"><span>СЕССИЯ</span><strong>{rounds.length} / {ROUNDS}</strong><p>Ложные старты: {falseStarts}</p>{rounds.length > 0 && <ol>{rounds.map((time, index) => <li key={`${time}-${index}`}><span>РАУНД {index + 1}</span><b>{time} мс</b></li>)}</ol>}{result && <div className="reaction-result"><span>{reactionLabel(result.medianMs)}</span><strong>{result.medianMs} мс</strong><p>медиана · лучший {result.bestMs} мс</p></div>}{stage === 'complete' && <button className="secondary-button" type="button" onClick={restart}>Повторить тест</button>}</aside>
      </div>
    </section>
  )
}
