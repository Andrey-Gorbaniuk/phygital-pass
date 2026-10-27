import { useCallback, useEffect, useRef, useState } from 'react'
import './styles.css'
import { assessPose } from './features/pose/poseMath'
import { usePoseCamera } from './features/pose/usePoseCamera'
import { ChallengeHub, ChallengeSubmission } from './features/challenge/ChallengeHub'
import { OrganizerConsole } from './features/admin/OrganizerConsole'
import { downloadResultCard } from './features/share/shareResult'
import { EXERCISE_REGISTRY } from './features/exercises/registry'
import { createExerciseMachine } from './features/exercises/machineFactory'
import type {
  ExerciseCategory,
  ExerciseCompletedRep,
  ExerciseDefinition,
  ExercisePhase,
  ExerciseRejectedRep,
  IExerciseMachine,
} from './features/exercises/types'

type View =
  | 'catalog'
  | 'setup'
  | 'positioning'
  | 'calibrating'
  | 'countdown'
  | 'active'
  | 'result'
  | 'challenges'
  | 'organizer'

type Tracking = {
  kind: 'waiting' | 'ready' | 'multiple' | 'lost'
  label: string
}

type MotionSignal = {
  id: number
  kind: 'accepted' | 'rejected'
  message: string
}

type TestResult = {
  completedAt: string
  exerciseTitle: string
  repetitions: number
  attempts: number
  rejectedAttempts: number
  shallowRejected: number
  trackingRejected: number
  tooFastRejected: number
  score: number
  quality: number
  tempo: number
  amplitude: 'Отличная' | 'Достаточная' | 'Нужна глубже'
  recommendation: string
}

const LAST_RESULT_KEY = 'phygital-pass:last-result'
const RESULT_HISTORY_KEY = 'phygital-pass:result-history'
const MAX_LOCAL_RESULTS = 12

function readLastResult(): TestResult | null {
  try {
    const stored = window.localStorage.getItem(LAST_RESULT_KEY)
    return stored ? (JSON.parse(stored) as TestResult) : null
  } catch {
    return null
  }
}

function readResultHistory(): TestResult[] {
  try {
    const stored = window.localStorage.getItem(RESULT_HISTORY_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) return parsed.slice(0, MAX_LOCAL_RESULTS) as TestResult[]
    }

    const lastResult = readLastResult()
    return lastResult ? [lastResult] : []
  } catch {
    return []
  }
}

function speakText(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'ru-RU'
    utterance.rate = 1.05
    window.speechSynthesis.speak(utterance)
  } catch {
    // voice feedback is an enhancement
  }
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const machineRef = useRef<IExerciseMachine | null>(null)
  const viewRef = useRef<View>('catalog')
  const repsRef = useRef<ExerciseCompletedRep[]>([])
  const rejectedRepsRef = useRef<ExerciseRejectedRep[]>([])

  const [view, setView] = useState<View>('catalog')
  const [selectedExercise, setSelectedExercise] = useState<ExerciseDefinition>(EXERCISE_REGISTRY[0])
  const [detailExercise, setDetailExercise] = useState<ExerciseDefinition | null>(null)
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const catalogScrollYRef = useRef<number>(0)

  useEffect(() => {
    if (detailExercise) {
      const savedScrollY = window.scrollY
      document.body.classList.add('modal-open')
      return () => {
        document.body.classList.remove('modal-open')
        window.scrollTo({ top: savedScrollY, behavior: 'instant' })
      }
    }
  }, [detailExercise])

  const [countdown, setCountdown] = useState(3)
  const [repetitions, setRepetitions] = useState(0)
  const [rejectedAttempts, setRejectedAttempts] = useState(0)
  const [phase, setPhase] = useState<ExercisePhase>('idle')
  const [feedback, setFeedback] = useState('Примите исходное положение')
  const [tracking, setTracking] = useState<Tracking>({ kind: 'waiting', label: 'Ищем силуэт' })
  const [motionSignal, setMotionSignal] = useState<MotionSignal | null>(null)
  const [liveMetric, setLiveMetric] = useState<{ label?: string; value?: string | number }>({})
  const [result, setResult] = useState<TestResult | null>(null)
  const [history, setHistory] = useState<TestResult[]>(() => readResultHistory())
  const lastResult = history[0] ?? null

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    if (!motionSignal || view !== 'active') return
    const timer = window.setTimeout(() => setMotionSignal(null), 1200)
    return () => window.clearTimeout(timer)
  }, [motionSignal, view])

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
          ? { kind: 'ready', label: 'Тело распознано. Можно выполнять' }
          : { kind: 'lost', label: 'Покажите ключевые суставы в кадре' }
      updateTracking(nextTracking)

      if (viewRef.current !== 'active' || !machineRef.current) return

      const snapshot = machineRef.current.process({
        timestamp,
        isVisible: assessment.isVisible && assessment.poseCount === 1,
        assessment,
      })

      setPhase((current) => (current === snapshot.phase ? current : snapshot.phase))
      setFeedback((current) => (current === snapshot.feedback ? current : snapshot.feedback))
      setRepetitions((current) => (current === snapshot.repetitions ? current : snapshot.repetitions))
      setRejectedAttempts((current) => (current === snapshot.rejectedAttempts ? current : snapshot.rejectedAttempts))
      setLiveMetric({ label: snapshot.liveMetricLabel, value: snapshot.liveMetricValue })

      if (snapshot.lastRejected) {
        rejectedRepsRef.current = [...rejectedRepsRef.current, snapshot.lastRejected]
        setMotionSignal({
          id: timestamp,
          kind: 'rejected',
          message: snapshot.feedback,
        })
      }

      if (!snapshot.lastRep) return

      setMotionSignal({ id: timestamp, kind: 'accepted', message: `Засчитано: ${snapshot.repetitions}` })
      speakText(`${snapshot.repetitions}`)
      if ('vibrate' in navigator) navigator.vibrate(20)

      const allReps = [...repsRef.current, snapshot.lastRep]
      repsRef.current = allReps

      if (snapshot.repetitions < selectedExercise.targetReps) return

      // Completed target reps!
      const totalDuration = allReps.reduce((sum, r) => sum + r.durationMs, 0)
      const averageDuration = allReps.length ? totalDuration / allReps.length : 1500
      const tempo = Math.round(60000 / averageDuration)
      const quality = Math.round(allReps.reduce((sum, r) => sum + r.qualityScore, 0) / allReps.length)
      const attempts = snapshot.repetitions + rejectedRepsRef.current.length
      const acceptance = attempts ? (snapshot.repetitions / attempts) * 100 : 100
      const score = Math.round(quality * 0.6 + acceptance * 0.4)

      const shallowCount = rejectedRepsRef.current.filter((r) => r.reason === 'shallow').length
      const trackingCount = rejectedRepsRef.current.filter((r) => r.reason === 'tracking').length
      const tooFastCount = rejectedRepsRef.current.filter((r) => r.reason === 'too_fast').length

      const completedResult: TestResult = {
        completedAt: new Date().toISOString(),
        exerciseTitle: selectedExercise.title,
        repetitions: snapshot.repetitions,
        attempts,
        rejectedAttempts: rejectedRepsRef.current.length,
        shallowRejected: shallowCount,
        trackingRejected: trackingCount,
        tooFastRejected: tooFastCount,
        score,
        quality,
        tempo,
        amplitude: quality >= 85 ? 'Отличная' : quality >= 70 ? 'Достаточная' : 'Нужна глубже',
        recommendation:
          shallowCount > 0
            ? 'Следите за полнотой амплитуды и дожимайте в пиковой фазе.'
            : tooFastCount > 0
            ? 'Соблюдайте темп: резкие повторы скрадывают технику.'
            : 'Отличная фиксация суставов. Норматив сдан на высокий балл!',
      }

      try {
        const existingResults = readResultHistory().filter((item) => item.completedAt !== completedResult.completedAt)
        window.localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(completedResult))
        window.localStorage.setItem(
          RESULT_HISTORY_KEY,
          JSON.stringify([completedResult, ...existingResults].slice(0, MAX_LOCAL_RESULTS)),
        )
      } catch {
        // local storage fallback
      }

      setHistory((existing) => [completedResult, ...existing.filter((i) => i.completedAt !== completedResult.completedAt)].slice(0, MAX_LOCAL_RESULTS))
      setResult(completedResult)
      setView('result')
      speakText('Норматив выполнен!')
    },
    [selectedExercise, updateTracking],
  )

  const { error, startCamera, status: cameraStatus, stopCamera } = usePoseCamera({
    videoRef,
    canvasRef,
    onFrame,
  })

  useEffect(() => {
    if (view === 'result') stopCamera()
  }, [stopCamera, view])

  // Positioning countdown (7s to get into frame)
  useEffect(() => {
    if (view !== 'positioning') return

    const timer = window.setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(timer)
          setView('calibrating')
          return 0
        }
        return current - 1
      })
    }, 1000)

    return () => window.clearInterval(timer)
  }, [view])

  // Calibration transition once ready
  useEffect(() => {
    if (view !== 'calibrating' || tracking.kind !== 'ready') return

    const timer = window.setTimeout(() => {
      if (viewRef.current !== 'calibrating') return
      setCountdown(3)
      setView('countdown')
      speakText('Приготовиться. Три, два, один')
    }, 850)

    return () => window.clearTimeout(timer)
  }, [tracking.kind, view])

  // 3-2-1 Countdown before active workout
  useEffect(() => {
    if (view !== 'countdown') return

    const timer = window.setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(timer)
          machineRef.current = createExerciseMachine(selectedExercise.id, selectedExercise.targetReps)
          machineRef.current.reset()
          repsRef.current = []
          rejectedRepsRef.current = []
          setRepetitions(0)
          setRejectedAttempts(0)
          setPhase('ready')
          setFeedback('Начинайте выполнение')
          setView('active')
          speakText('Старт!')
          return 0
        }
        return current - 1
      })
    }, 1000)

    return () => window.clearInterval(timer)
  }, [selectedExercise, view])

  const startExercise = (exercise: ExerciseDefinition) => {
    catalogScrollYRef.current = window.scrollY
    setSelectedExercise(exercise)
    setMotionSignal(null)
    setResult(null)
    machineRef.current = createExerciseMachine(exercise.id, exercise.targetReps)
    setView('setup')
    window.scrollTo({ top: 0, behavior: 'instant' })
    void startCamera()
  }

  const startTestFromSetup = () => {
    if (cameraStatus !== 'ready') return
    setCountdown(6)
    setView('positioning')
  }

  const closeToHome = () => {
    stopCamera()
    setView('catalog')
    requestAnimationFrame(() => {
      window.scrollTo({ top: catalogScrollYRef.current, behavior: 'instant' })
    })
  }

  const restartCurrentTest = () => {
    if (machineRef.current) machineRef.current.reset()
    repsRef.current = []
    rejectedRepsRef.current = []
    setRepetitions(0)
    setRejectedAttempts(0)
    setPhase('idle')
    setFeedback('Примите исходное положение')
    setMotionSignal(null)
    setResult(null)
    setView('setup')
    void startCamera()
  }

  const canStart = cameraStatus === 'ready'

  // Filter exercises
  const filteredExercises = EXERCISE_REGISTRY.filter((item) => {
    if (filterCategory === 'interactive') return item.isInteractive
    if (filterCategory === 'all') return true
    return item.category === filterCategory
  })

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="grid-overlay" />

      {(view === 'catalog' || view === 'challenges' || view === 'organizer' || view === 'result') && (
        <header className="topbar">
          <div className="brand" aria-label="Phygital Pass">
            <span className="brand-mark"><i /><i /><i /></span>
            <span>PHYGITAL <b>PASS</b></span>
          </div>
          <div className="topbar-links">
            <button
              type="button"
              className={view === 'catalog' || view === 'result' ? 'active-nav' : ''}
              onClick={() => { stopCamera(); setView('catalog') }}
            >
              Нормативы
            </button>
            <button
              type="button"
              className={view === 'challenges' ? 'active-nav' : ''}
              onClick={() => { stopCamera(); setView('challenges') }}
            >
              Челленджи
            </button>
            <button
              type="button"
              className={view === 'organizer' ? 'active-nav' : ''}
              onClick={() => { stopCamera(); setView('organizer') }}
            >
              Организатор
            </button>
            <span className="topbar-note">МТУСИ / КАФЕДРА ФИЗВОСПИТАНИЯ</span>
          </div>
        </header>
      )}

      {/* VIEW: CATALOG OF 12 STANDARDS (DEFAULT HOME) */}
      {view === 'catalog' && (
        <section className="catalog-screen screen-enter">
          <div className="catalog-header">
            <h1>Комплекс <em>нормативов</em></h1>
            <p>
              Методический комплекс упражнений ОФП кафедры физвоспитания МТУСИ. Интерактивные нормативы проверяются в реальном времени с камеры смартфона с помощью нейросетевого зрения.
            </p>
          </div>

          <div className="catalog-nav-row">
            <div className="category-filters">
              <button
                type="button"
                className={`filter-pill ${filterCategory === 'all' ? 'active' : ''}`}
                onClick={() => setFilterCategory('all')}
              >
                Все нормативы (12)
              </button>
              <button
                type="button"
                className={`filter-pill ${filterCategory === 'interactive' ? 'active' : ''}`}
                onClick={() => setFilterCategory('interactive')}
              >
                ● Доступны онлайн (5)
              </button>
              <button
                type="button"
                className={`filter-pill ${filterCategory === 'Силовая выносливость' ? 'active' : ''}`}
                onClick={() => setFilterCategory('Силовая выносливость')}
              >
                Силовые
              </button>
              <button
                type="button"
                className={`filter-pill ${filterCategory === 'Мышцы кора и пресса' ? 'active' : ''}`}
                onClick={() => setFilterCategory('Мышцы кора и пресса')}
              >
                Мышцы кора
              </button>
              <button
                type="button"
                className={`filter-pill ${filterCategory === 'Функциональный тренинг' ? 'active' : ''}`}
                onClick={() => setFilterCategory('Функциональный тренинг')}
              >
                Функциональные
              </button>
            </div>
          </div>

          {lastResult && (
            <div className="last-result" style={{ marginBottom: 25 }}>
              <span>Последний сданный норматив на устройстве</span>
              <strong>{lastResult.score} <small>PHYGITAL SCORE</small></strong>
              <p>
                {lastResult.exerciseTitle} · {lastResult.repetitions} {lastResult.repetitions === 1 ? 'повтор' : 'повторов'} · качество {lastResult.quality}% · Сохранено локально
              </p>
            </div>
          )}

          <div className="exercises-grid">
            {filteredExercises.map((exercise) => (
              <article
                key={exercise.id}
                className={`exercise-card ${exercise.isInteractive ? 'interactive' : 'spec'}`}
                onClick={() => setDetailExercise(exercise)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setDetailExercise(exercise)
                  }
                }}
              >
                <div className="card-top">
                  <span className="card-order">№ {exercise.order < 10 ? `0${exercise.order}` : exercise.order}</span>
                  <span className={`card-badge ${exercise.isInteractive ? 'interactive' : 'spec'}`}>
                    {exercise.isInteractive ? '● ИНТЕРАКТИВНЫЙ ИИ-ТЕСТ' : 'НОРМАТИВ КАФЕДРЫ'}
                  </span>
                </div>

                <h3>{exercise.title}</h3>
                <p>{exercise.description}</p>

                <div className="card-specs">
                  <div className="spec-item">
                    <span>Ракурс камеры</span>
                    <strong>{exercise.cameraAngle}</strong>
                  </div>
                  <div className="spec-item">
                    <span>Норма теста</span>
                    <strong>{exercise.targetReps} {exercise.unitLabel}</strong>
                  </div>
                </div>

                <div className="card-dosage-preview">
                  <strong>Дозировка:</strong> {exercise.dosage.basic}
                </div>

                {exercise.isInteractive ? (
                  <div className="card-actions-group">
                    <button
                      className="card-btn start-interactive"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        startExercise(exercise)
                      }}
                    >
                      <span>Сдать норматив на камеру</span>
                      <b>→</b>
                    </button>
                    <button
                      className="card-btn view-spec-secondary"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDetailExercise(exercise)
                      }}
                    >
                      <span>Методические правила и углы</span>
                      <b>↗</b>
                    </button>
                  </div>
                ) : (
                  <button
                    className="card-btn view-spec"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDetailExercise(exercise)
                    }}
                  >
                    <span>Методические правила и углы</span>
                    <b>↗</b>
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* DETAIL MODAL FOR SPECIFICATION / DOSAGE DETAILS */}
      {detailExercise && (
        <div className="modal-overlay" onClick={() => setDetailExercise(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setDetailExercise(null)}>
              ×
            </button>

            <div className="modal-head">
              <span className="dept-badge">МЕТОДИЧЕСКИЙ НОРМАТИВ № {detailExercise.order}</span>
              <h2>{detailExercise.title}</h2>
              <p style={{ color: 'rgba(215, 239, 250, .72)' }}>{detailExercise.description}</p>
            </div>

            {detailExercise.imageUrl && (
              <div className="modal-illustration-card">
                <img
                  src={detailExercise.imageUrl}
                  alt={detailExercise.title}
                  className="modal-illustration-img"
                  loading="lazy"
                />
              </div>
            )}

            <div className="modal-grid">
              <div className="modal-box">
                <span>Требуемый ракурс камеры</span>
                <strong>{detailExercise.cameraAngle}</strong>
                <p style={{ fontSize: 11, color: '#8be9fd' }}>Дистанция: {detailExercise.cameraDistance}</p>
              </div>
              <div className="modal-box">
                <span>Плоскость движения</span>
                <strong>{detailExercise.bodyPlane}</strong>
                <p style={{ fontSize: 11, color: '#8be9fd' }}>Контрольные суставы: {detailExercise.controlJoints.join(', ')}</p>
              </div>
            </div>

            <h4 style={{ margin: '18px 0 8px', color: '#68edff', fontSize: 13, textTransform: 'uppercase', letterSpacing: '.1em' }}>
              Технические требования:
            </h4>
            <ul className="technique-list">
              {detailExercise.technique.map((rule, idx) => (
                <li key={idx}>{rule}</li>
              ))}
            </ul>

            <h4 style={{ margin: '18px 0 8px', color: '#68edff', fontSize: 13, textTransform: 'uppercase', letterSpacing: '.1em' }}>
              Уровни дозировки:
            </h4>
            <table className="dosage-table">
              <thead>
                <tr>
                  <th>Уровень подготовки</th>
                  <th>Норматив</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Начальный уровень</strong></td>
                  <td>{detailExercise.dosage.initial}</td>
                </tr>
                <tr>
                  <td><strong>Базовый уровень</strong></td>
                  <td>{detailExercise.dosage.basic}</td>
                </tr>
                <tr>
                  <td><strong>Максимальный уровень</strong></td>
                  <td>{detailExercise.dosage.max}</td>
                </tr>
              </tbody>
            </table>

            <div className="modal-footer">
              <button className="secondary-button" type="button" onClick={() => setDetailExercise(null)}>
                Понятно, закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: CHALLENGES */}
      {view === 'challenges' && <ChallengeHub onClose={closeToHome} />}

      {/* VIEW: ORGANIZER */}
      {view === 'organizer' && <OrganizerConsole onClose={closeToHome} />}

      {/* VIEW: TEST & ACTIVE CAMERA SCREEN */}
      {(view === 'setup' || view === 'positioning' || view === 'calibrating' || view === 'countdown' || view === 'active') && (
        <section className="test-screen screen-enter">
          <div className="camera-stage">
            <video ref={videoRef} className="camera-feed" muted playsInline />
            <canvas ref={canvasRef} className="pose-canvas" />
            <div className="camera-vignette" />

            <span className="corner corner-top-left" />
            <span className="corner corner-top-right" />
            <span className="corner corner-bottom-left" />
            <span className="corner corner-bottom-right" />

            {/* TOP BAR OVERLAY FOR CAMERA MODE */}
            <div className="camera-top-actions">
              <button type="button" className="camera-exit-button" onClick={closeToHome}>
                ✕ Выход
              </button>
              <div className="live-camera-angle-hint">
                РАКУРС: {selectedExercise.cameraAngle.toUpperCase()}
              </div>
            </div>

            {liveMetric.value !== undefined && (
              <div className="live-metric-pill">
                {liveMetric.label}: {liveMetric.value}
              </div>
            )}

            {(view === 'setup' || view === 'positioning' || view === 'calibrating') && (
              <div className={`body-guide ${tracking.kind}`} aria-hidden="true">
                <i className="guide-head" />
                <i className="guide-torso" />
                <i className="guide-arm guide-arm-left" />
                <i className="guide-arm guide-arm-right" />
                <i className="guide-leg guide-leg-left" />
                <i className="guide-leg guide-leg-right" />
                <span>ВЕСЬ СИЛУЭТ В КАДРЕ</span>
              </div>
            )}

            <div className="scan-line" />
            {cameraStatus === 'loading' && <div className="camera-message"><LoadingMark /> Подключаем камеру и нейросетевую модель…</div>}
            {cameraStatus === 'error' && <div className="camera-message error-message">{error ?? 'Не удалось запустить камеру.'}</div>}
            {view === 'positioning' && (
              <div className="camera-transition">
                <span>ВСТАНЬТЕ В КАДР</span>
                <strong>{countdown}</strong>
                <p>Установите телефон на уровне {selectedExercise.cameraDistance}. Займите исходное положение.</p>
              </div>
            )}
            {view === 'calibrating' && (
              <div className="camera-transition camera-transition-ready">
                <span>КАЛИБРОВКА УГЛОВ</span>
                <strong>⌁</strong>
                <p>{tracking.kind === 'ready' ? 'Суставы распознаны. Готовим старт…' : 'Покажите тело целиком в ракурсе сбоку.'}</p>
              </div>
            )}
            {view === 'countdown' && <div className="countdown">{countdown}</div>}
            {view === 'active' && (
              <div className={`live-feedback ${motionSignal?.kind ?? ''}`} aria-live="polite">
                {motionSignal?.message ?? feedback}
              </div>
            )}
          </div>

          <aside className="test-panel">
            <div className="test-panel-head">
              <span className={`status-pill ${tracking.kind}`}>
                <i /> {cameraStatus === 'loading' ? 'Подключение' : tracking.label}
              </span>
            </div>

            {view === 'setup' ? (
              <div className="setup-panel-body">
                <div className="setup-summary-row">
                  <span className="setup-exercise-title">
                    НОРМАТИВ {selectedExercise.order} · {selectedExercise.shortTitle.toUpperCase()}
                  </span>
                  <span className="setup-target-badge">
                    Норма: <strong>{selectedExercise.targetReps} {selectedExercise.unitLabel}</strong>
                  </span>
                </div>

                <div className="setup-hint-box">
                  <span className="setup-hint-step">01</span>
                  <div className="setup-hint-text">
                    <strong>{selectedExercise.cameraAngle}</strong>
                    <span>({selectedExercise.cameraDistance}) · 6 сек на подготовку</span>
                  </div>
                </div>

                {cameraStatus === 'error' && (
                  <button className="secondary-button" type="button" onClick={() => void startCamera()}>
                    Попробовать снова
                  </button>
                )}
                {cameraStatus !== 'error' && (
                  <button className="primary-button start-button" type="button" disabled={!canStart} onClick={startTestFromSetup}>
                    <span>{canStart ? 'Я готов — отойду к камере' : 'Подключаем камеру'}</span>
                    <b>→</b>
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="exercise-label">
                  НОРМАТИВ {selectedExercise.order} / {selectedExercise.shortTitle.toUpperCase()}
                </div>
                <div className={`rep-display ${motionSignal?.kind ?? ''}`}>
                  <strong key={motionSignal?.id ?? 'counter'}>{repetitions}</strong>
                  <span>/ {selectedExercise.targetReps} {selectedExercise.unitLabel}</span>
                </div>
                <div className="progress-track">
                  <span style={{ width: `${Math.min((repetitions / selectedExercise.targetReps) * 100, 100)}%` }} />
                </div>
                <p className="attempt-counter">
                  Засчитано: {repetitions} · Замечания техники: {rejectedAttempts}
                </p>

                <div className="phase-card">
                  <span>СТАТУС БИОМЕХАНИКИ</span>
                  <strong>{feedback}</strong>
                  <p>Требование: {selectedExercise.controlJoints[0] ?? 'Контроль суставов'}</p>
                </div>

                {view === 'active' && (
                  <p className="active-note">
                    Тест завершится автоматически по выполнению {selectedExercise.targetReps} {selectedExercise.unitLabel}.
                    Ошибки амплитуды и фальстарт бракуются алгоритмом.
                  </p>
                )}
              </>
            )}
          </aside>
        </section>
      )}

      {/* VIEW: RESULT SCREEN */}
      {view === 'result' && result && (
        <section className="result-screen screen-enter">
          <div className="result-header">
            <div className="eyebrow"><span className="pulse-dot" /> СТАНДАРТ КАФЕДРЫ МТУСИ ВЫПОЛНЕН</div>
            <h1>Норматив <em>зачтён</em></h1>
            <p>Результат биомеханического анализа {result.exerciseTitle} сохранён в фиджитал-паспорт.</p>
          </div>

          <div className="passport-card">
            <div className="passport-top">
              <span>PHYGITAL PASS / MTUCI PE DEPT</span>
              <span>{selectedExercise.shortTitle.toUpperCase()}</span>
            </div>
            <div className="score-block">
              <span>PHYGITAL SCORE</span>
              <strong>{result.score}</strong><small>/ 100</small>
              <div className="score-orbit" />
            </div>
            <div className="passport-metrics">
              <Metric value={`${result.repetitions}/${result.attempts}`} label="засчитано / попытки" />
              <Metric value={`${result.quality}%`} label="качество техники" />
              <Metric value={`${result.tempo}`} label="темп движения" />
              <Metric value={result.amplitude} label="амплитуда" />
            </div>

            <div className="audit-line">
              <span>ПРОЗРАЧНОСТЬ ОЦЕНКИ</span>
              <p>
                {result.rejectedAttempts === 0
                  ? 'Все зафиксированные попытки выполнены по методическому регламенту кафедры.'
                  : `Замечания: ${result.shallowRejected} по глубине сгиба, ${result.tooFastRejected} по темпу, ${result.trackingRejected} по видимости суставов.`}
              </p>
            </div>

            <div className="recommendation">
              <span>ЗАКЛЮЧЕНИЕ СИСТЕМЫ</span>
              <p>{result.recommendation}</p>
            </div>
            <div className="passport-bottom">
              <span>ИИ-ПРОТОКОЛ: {selectedExercise.protocolId ?? 'CUSTOM-V1'}</span>
              <span>МТУСИ ЭЛЕКТИВНАЯ ФИЗКУЛЬТУРА</span>
            </div>
          </div>

          <ChallengeSubmission
            result={result}
            protocolVersion={selectedExercise.protocolId}
          />

          <div className="result-actions">
            <button className="primary-button" type="button" onClick={restartCurrentTest}>
              <span>Сдать ещё раз</span><b>↻</b>
            </button>
            <button className="text-button" type="button" onClick={() => downloadResultCard(result)}>
              Скачать карточку результата
            </button>
            <button className="text-button" type="button" onClick={closeToHome}>
              В каталог 12 нормативов
            </button>
          </div>
        </section>
      )}
    </main>
  )
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>
}

function LoadingMark() {
  return <span className="loading-mark"><i /><i /><i /></span>
}
