import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { useCallback, useEffect, useRef, useState } from 'react'
import { drawPose } from './drawPose'
import type { PoseLandmark } from './poseMath'

export type CameraStatus = 'idle' | 'loading' | 'ready' | 'error'
export type CameraFacing = 'user' | 'environment'

export type PoseFrame = {
  timestamp: number
  landmarks: PoseLandmark[][]
}

type UsePoseCameraOptions = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  onFrame: (frame: PoseFrame) => void
}

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_PATH = '/models/pose_landmarker_lite.task'
const FRAME_INTERVAL_MS = 67

export function usePoseCamera({ videoRef, canvasRef, onFrame }: UsePoseCameraOptions) {
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [facingMode, setFacingMode] = useState<CameraFacing>('user')
  const [error, setError] = useState<string | null>(null)

  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastInferenceAtRef = useRef(0)
  const onFrameRef = useRef(onFrame)
  const runLoopRef = useRef<() => void>(() => undefined)
  const facingModeRef = useRef<CameraFacing>('user')

  useEffect(() => {
    onFrameRef.current = onFrame
  }, [onFrame])

  const stopCamera = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStatus('idle')
  }, [videoRef])

  const runLoop = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const landmarker = landmarkerRef.current

    if (!video || !canvas || !landmarker || !streamRef.current) return

    const timestamp = performance.now()
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && timestamp - lastInferenceAtRef.current >= FRAME_INTERVAL_MS) {
      lastInferenceAtRef.current = timestamp
      const result = landmarker.detectForVideo(video, timestamp)
      const landmarks = result.landmarks as PoseLandmark[][]

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }

      drawPose(canvas, landmarks[0] ?? [])
      onFrameRef.current({ timestamp, landmarks })
    }

    animationFrameRef.current = window.requestAnimationFrame(() => runLoopRef.current())
  }, [canvasRef, videoRef])

  useEffect(() => {
    runLoopRef.current = runLoop
  }, [runLoop])

  const startCamera = useCallback(async (preferredFacing?: CameraFacing) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Этот браузер не поддерживает доступ к камере.')
      setStatus('error')
      return
    }

    const targetFacing = preferredFacing ?? facingModeRef.current
    setFacingMode(targetFacing)
    facingModeRef.current = targetFacing

    try {
      setStatus('loading')
      setError(null)

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: targetFacing },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
      })

      if (!landmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(WASM_ROOT)
        const modelAssetPath = new URL(MODEL_PATH, window.location.origin).toString()
        landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath },
          runningMode: 'VIDEO',
          numPoses: 2,
          minPoseDetectionConfidence: 0.48,
          minPosePresenceConfidence: 0.48,
          minTrackingConfidence: 0.48,
        })
      }

      const video = videoRef.current
      if (!video) throw new Error('Видеоэлемент недоступен.')

      streamRef.current = stream
      video.srcObject = stream
      await video.play()
      lastInferenceAtRef.current = 0
      setStatus('ready')
      animationFrameRef.current = window.requestAnimationFrame(runLoop)
    } catch (caughtError) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      const message = caughtError instanceof Error ? caughtError.message : 'Не удалось запустить камеру.'
      setError(message.includes('NotAllowed') ? 'Доступ к камере запрещён. Разрешите его и попробуйте снова.' : message)
      setStatus('error')
    }
  }, [runLoop, videoRef])

  const toggleCameraFacing = useCallback(async () => {
    const nextFacing: CameraFacing = facingModeRef.current === 'user' ? 'environment' : 'user'
    setFacingMode(nextFacing)
    facingModeRef.current = nextFacing

    if (streamRef.current && status === 'ready') {
      try {
        if (animationFrameRef.current !== null) {
          window.cancelAnimationFrame(animationFrameRef.current)
          animationFrameRef.current = null
        }
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null

        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: nextFacing },
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
        })
        const video = videoRef.current
        if (video) {
          streamRef.current = newStream
          video.srcObject = newStream
          await video.play()
          lastInferenceAtRef.current = 0
          animationFrameRef.current = window.requestAnimationFrame(() => runLoopRef.current())
        }
      } catch {
        // Fall back to original facing mode if device does not support requested orientation
        setFacingMode('user')
        facingModeRef.current = 'user'
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: 'user' },
              width: { ideal: 1280 },
              height: { ideal: 960 },
            },
          })
          const video = videoRef.current
          if (video) {
            streamRef.current = fallbackStream
            video.srcObject = fallbackStream
            await video.play()
            animationFrameRef.current = window.requestAnimationFrame(() => runLoopRef.current())
          }
        } catch {
          // ignore fallback error
        }
      }
    }
  }, [status, videoRef])

  useEffect(() => stopCamera, [stopCamera])

  return {
    error,
    facingMode,
    startCamera,
    status,
    stopCamera,
    toggleCameraFacing,
  }
}
