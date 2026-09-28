import { useCallback, useEffect, useRef, useState } from 'react'
import './styles.css'
import { assessPose } from './features/pose/poseMath'
import { usePoseCamera } from './features/pose/usePoseCamera'
import {
  type CompletedRep,
  type RejectedRep,
  type SquatPhase,
  SquatMachine,
  TARGET_REPETITIONS,
} from './features/squat/squatMachine'

type View = 'landing' | 'setup' | 'countdown' | 'active' | 'result'

type Tracking = {
  kind: 'waiting' | 'ready' | 'multiple' | 'lost'
  label: string
}

type TestResult = {
  completedAt: string
  repetitions: number
  attempts: number
  rejectedAttempts: number
  shallowRejected: number
  trackingRejected: number
  tooFastRejected: number
  score: number
  quality: number
  tempo: number
  amplitude: string
  recommendation: string
}

const LAST_RESULT_KEY = 'phygital-pass:last-result'

const phaseLabels: Record<SquatPhase, string> = {
  idle: 'Калибровка',
  standing: 'Готовность',
  descending: 'Движение',
  bottom: 'Глубина',
  ascending: 'Подъём',
  paused: 'Пауза',
}

function readLastResult(): TestResult | null {
  try {
    const stored = window.localStorage.getItem(LAST_RESULT_KEY)
    return stored ? (JSON.parse(stored) as TestResult) : null
  } catch {
    return null
  }
}

function buildResult(repetitions: number, reps: CompletedRep[], rejectedReps: RejectedRep[]): TestResult {
  const quality = reps.length
    ? Math.round(reps.reduce((total, rep) => total + rep.qualityScore, 0) / reps.length)
    : 0
  const averageDuration = reps.length
    ? reps.reduce((total, rep) => total + rep.durationMs, 0) / reps.length
    : 0
  const averageDepth = reps.length
    ? reps.reduce((total, rep) => total + rep.minKneeAngle, 0) / reps.length
    : 180
  const tempo = averageDuration ? Math.round(60000 / averageDuration) : 0
  const completion = Math.min(repetitions / TARGET_REPETITIONS, 1) * 100
  const attempts = repetitions + rejectedReps.length
  const acceptance = attempts ? (repetitions / attempts) * 100 : 0
  const shallowRejected = rejectedReps.filter((rep) => rep.reason === 'shallow').length
  const trackingRejected = rejectedReps.filter((rep) => rep.reason === 'tracking').length
  const tooFastRejected = rejectedReps.filter((rep) => rep.reason === 'too_fast').length
  const score = Math.round(completion * 0.3 + quality * 0.45 + acceptance * 0.25)
  const amplitude = averageDepth <= 98 ? 'Отличная' : averageDepth <= 105 ? 'Достаточная' : 'Нужна глубже'
  const recommendation =
    trackingRejected > 0
      ? 'В следующем тесте держите всё тело в кадре: часть попыток потеряла трекинг.'
      : shallowRejected > 0 || averageDepth > 101
      ? 'Сохраняйте ровный темп и опускайтесь чуть глубже.'
      : tooFastRejected > 0
        ? 'Сделайте движение спокойнее: быстрые попытки не засчитываются.'
      : quality >= 80
        ? 'Отличный контроль движения. Следующий шаг — новый челлендж.'
        : 'Сделайте движение спокойнее: контроль важнее скорости.'

  return {
    completedAt: new Date().toISOString(),
    repetitions,
    attempts,
    rejectedAttempts: rejectedReps.length,
    shallowRejected,
    trackingRejected,
    tooFastRejected,
    score,
    quality,
    tempo,
    amplitude,
    recommendation,
  }
}

function saveResult(result: TestResult): void {
  try {
    window.localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(result))
  } catch {
    // Сохранение результата не должно мешать прохождению теста.
  }
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const machineRef = useRef(new SquatMachine())
  const viewRef = useRef<View>('landing')
  const repsRef = useRef<CompletedRep[]>([])
  const rejectedRepsRef = useRef<RejectedRep[]>([])
  const [view, setView] = useState<View>('landing')
  const [countdown, setCountdown] = useState(3)
  const [repetitions, setRepetitions] = useState(0)
  const [rejectedAttempts, setRejectedAttempts] = useState(0)
  const [phase, setPhase] = useState<SquatPhase>('idle')
  const [feedback, setFeedback] = useState('Встаньте в полный рост')
  const [tracking, setTracking] = useState<Tracking>({ kind: 'waiting', label: 'Ищем силуэт' })
  const [result, setResult] = useState<TestResult | null>(null)
  const [lastResult] = useState<TestResult | null>(() => readLastResult())

  useEffect(() => {
    viewRef.current = view
  }, [view])

  const updateTracking = useCallback((next: Tracking) => {
    setTracking((current) => (current.kind === next.kind && current.label === next.label ? current : next))
  }, [])

  const onFrame = useCallback(
    ({ timestamp, landmarks }: { timestamp: number; landmarks: Parameters<typeof assessPose>[0] }) => {
      const assessment = assessPose(landmarks)
      const nextTracking: Tracking =
        assessment.poseCount > 1
          ? { kind: 'multiple', label: 'В кадре должен быть один человек' }
          : assessment.isVisible
            ? { kind: 'ready', label: 'Тело распознано. Можно начинать' }
            : { kind: 'lost', label: 'Покажите в кадре плечо, таз, колено и стопу' }
      updateTracking(nextTracking)

      if (viewRef.current !== 'active') return

      const snapshot = machineRef.current.process({
        timestamp,
        isVisible: assessment.isVisible && assessment.poseCount === 1,
        kneeAngle: assessment.kneeAngle,
      })

      setPhase((current) => (current === snapshot.phase ? current : snapshot.phase))
      setFeedback((current) => (current === snapshot.feedback ? current : snapshot.feedback))
      setRepetitions((current) => (current === snapshot.repetitions ? current : snapshot.repetitions))
      setRejectedAttempts((current) => (current === snapshot.rejectedAttempts ? current : snapshot.rejectedAttempts))

      if (snapshot.lastRejected) {
        rejectedRepsRef.current = [...rejectedRepsRef.current, snapshot.lastRejected]
      }

      if (!snapshot.lastRep) return

      const allReps = [...repsRef.current, snapshot.lastRep]
      repsRef.current = allReps
      if (snapshot.repetitions < TARGET_REPETITIONS) return

      const completed = buildResult(snapshot.repetitions, allReps, rejectedRepsRef.current)
      saveResult(completed)
      setResult(completed)
      setView('result')
    },
    [updateTracking],
  )

  const { error, startCamera, status: cameraStatus, stopCamera } = usePoseCamera({
    videoRef,
    canvasRef,
    onFrame,
  })

  useEffect(() => {
    if (view === 'result') stopCamera()
  }, [stopCamera, view])

  useEffect(() => {
    if (view !== 'countdown') return

    const timer = window.setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(timer)
          machineRef.current.reset()
          repsRef.current = []
          rejectedRepsRef.current = []
          setRepetitions(0)
          setRejectedAttempts(0)
          setPhase('standing')
          setFeedback('Готово. Начинайте приседание')
          setView('active')
          return 0
        }
        return current - 1
      })
    }, 1000)

    return () => window.clearInterval(timer)
  }, [view])

  const openCamera = () => {
    setResult(null)
    setView('setup')
    void startCamera()
  }

  const startTest = () => {
    if (cameraStatus !== 'ready' || tracking.kind !== 'ready') return
    setCountdown(3)
    setView('countdown')
  }

  const closeTest = () => {
    stopCamera()
    setView('landing')
  }

  const newTest = () => {
    machineRef.current.reset()
    repsRef.current = []
    rejectedRepsRef.current = []
    setRepetitions(0)
    setRejectedAttempts(0)
    setPhase('idle')
    setFeedback('Встаньте в полный рост')
    setResult(null)
    setView('setup')
    void startCamera()
  }

  const canStart = cameraStatus === 'ready' && tracking.kind === 'ready'

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="grid-overlay" />
      <header className="topbar">
        <button className="brand" type="button" onClick={closeTest} aria-label="На главный экран">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>PHYGITAL <b>PASS</b></span>
        </button>
        <span className="topbar-note">MOTION INTELLIGENCE / 01</span>
      </header>

      {view === 'landing' && (
        <section className="landing screen-enter">
          <div className="hero-visual" aria-hidden="true">
            <div className="hero-orbit orbit-large" />
            <div className="hero-orbit orbit-medium" />
            <div className="hero-orbit orbit-small" />
            <div className="hero-core"><i /><i /><i /></div>
            <span className="hud-tag tag-one">POSE_33</span>
            <span className="hud-tag tag-two">LIVE</span>
            <span className="hud-tag tag-three">MOTION / 01</span>
          </div>
          <div className="eyebrow"><span className="pulse-dot" /> CAMPUS MOTION SCAN</div>
          <h1>Твой спорт.<br /><em>Твой цифровой след.</em></h1>
          <p className="hero-copy">
            Пройди короткий тест по камере и получи фиджитал-паспорт движения.
            Никаких датчиков, регистрации и отправки видео.
          </p>
          <div className="hero-actions">
            <button className="primary-button" type="button" onClick={openCamera}>
              <span>Начать сканирование</span><b>→</b>
            </button>
            <span className="privacy-note">Видео обрабатывается только на устройстве</span>
          </div>
          <div className="hero-stats">
            <Stat label="Тест" value="10" suffix=" повторов" />
            <Stat label="Режим" value="LIVE" suffix=" анализ" />
            <Stat label="Данные" value="0" suffix=" видео" />
          </div>
          {lastResult && (
            <div className="last-result">
              <span>Последний результат на этом устройстве</span>
              <strong>{lastResult.score} <small>PHYGITAL SCORE</small></strong>
              <p>{lastResult.repetitions}/{lastResult.attempts ?? TARGET_REPETITIONS} засчитано / попытки · {lastResult.tempo} повторов/мин</p>
            </div>
          )}
        </section>
      )}

      {(view === 'setup' || view === 'countdown' || view === 'active') && (
        <section className="test-screen screen-enter">
          <div className="camera-stage">
            <video ref={videoRef} className="camera-feed" muted playsInline />
            <canvas ref={canvasRef} className="pose-canvas" />
            <div className="camera-vignette" />
            <span className="corner corner-top-left" />
            <span className="corner corner-top-right" />
            <span className="corner corner-bottom-left" />
            <span className="corner corner-bottom-right" />

            <div className="scan-line" />
            {cameraStatus === 'loading' && <div className="camera-message"><LoadingMark /> Подключаем камеру и модель движения…</div>}
            {cameraStatus === 'error' && <div className="camera-message error-message">{error ?? 'Не удалось запустить камеру.'}</div>}
            {view === 'countdown' && <div className="countdown">{countdown}</div>}
            {view === 'active' && <div className="live-feedback">{feedback}</div>}
          </div>

          <aside className="test-panel">
            <div className="test-panel-head">
              <span className={`status-pill ${tracking.kind}`}><i /> {cameraStatus === 'loading' ? 'Подключение' : tracking.label}</span>
              <button type="button" className="quiet-button" onClick={closeTest}>Закрыть</button>
            </div>

            <div className="exercise-label">ТЕСТ 01 / ПРИСЕДАНИЯ</div>
            <div className="rep-display"><strong>{repetitions}</strong><span>/ {TARGET_REPETITIONS}</span></div>
            <div className="progress-track"><span style={{ width: `${(repetitions / TARGET_REPETITIONS) * 100}%` }} /></div>
            <p className="attempt-counter">Засчитано: {repetitions} · Не засчитано: {rejectedAttempts}</p>

            <div className="phase-card">
              <span>СТАТУС ДВИЖЕНИЯ</span>
              <strong>{phaseLabels[phase]}</strong>
              <p>{feedback}</p>
            </div>

            {view === 'setup' && (
              <div className="setup-instructions">
                <span className="step-index">01</span>
                <div><strong>Встаньте целиком в кадр</strong><p>Камере должны быть видны плечо, таз, колени и стопы. Рядом не должно быть других людей.</p></div>
              </div>
            )}

            {view === 'setup' && cameraStatus === 'error' && (
              <button className="secondary-button" type="button" onClick={() => void startCamera()}>Попробовать снова</button>
            )}
            {view === 'setup' && cameraStatus !== 'error' && (
              <button className="primary-button start-button" type="button" disabled={!canStart} onClick={startTest}>
                <span>{canStart ? 'Начать тест' : 'Ждём готовность камеры'}</span><b>→</b>
              </button>
            )}
            {view === 'active' && <p className="active-note">Тест завершится после 10 засчитанных повторов. Недостаточно глубокие, слишком быстрые попытки и потеря трекинга не входят в результат.</p>}
          </aside>
        </section>
      )}

      {view === 'result' && result && (
        <section className="result-screen screen-enter">
          <div className="result-header">
            <div className="eyebrow"><span className="pulse-dot" /> TEST COMPLETED</div>
            <h1>Твой фиджитал-<em>паспорт</em></h1>
            <p>Результат этого теста сохранён только в браузере на устройстве.</p>
          </div>
          <div className="passport-card">
            <div className="passport-top"><span>PHYGITAL PASS / MOTION PROFILE</span><span>TEST 01</span></div>
            <div className="score-block">
              <span>PHYGITAL SCORE</span>
              <strong>{result.score}</strong><small>/ 100</small>
              <div className="score-orbit" />
            </div>
            <div className="passport-metrics">
              <Metric value={`${result.repetitions}/${result.attempts}`} label="засчитано / попытки" />
              <Metric value={`${result.quality}%`} label="качество теста" />
              <Metric value={`${result.tempo}`} label="повторов в минуту" />
              <Metric value={result.amplitude} label="амплитуда" />
            </div>
            <div className="audit-line">
              <span>ПРОЗРАЧНОСТЬ ТЕСТА</span>
              <p>{result.rejectedAttempts === 0 ? 'Все начатые попытки были засчитаны.' : `Не засчитано: ${result.shallowRejected} из-за глубины, ${result.tooFastRejected} из-за темпа, ${result.trackingRejected} из-за трекинга.`}</p>
            </div>
            <div className="recommendation"><span>СЛЕДУЮЩИЙ ШАГ</span><p>{result.recommendation}</p></div>
            <div className="passport-bottom"><span>AI-ASSISTED MOTION TEST</span><span>LOCAL PROCESSING</span></div>
          </div>
          <div className="result-actions">
            <button className="primary-button" type="button" onClick={newTest}><span>Пройти ещё раз</span><b>↻</b></button>
            <button className="text-button" type="button" onClick={closeTest}>На главный экран</button>
          </div>
        </section>
      )}
    </main>
  )
}

function Stat({ label, value, suffix }: { label: string; value: string; suffix: string }) {
  return <div><span>{label}</span><strong>{value}<small>{suffix}</small></strong></div>
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>
}

function LoadingMark() {
  return <span className="loading-mark"><i /><i /><i /></span>
}
