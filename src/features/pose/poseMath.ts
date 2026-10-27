export type PoseLandmark = {
  x: number
  y: number
  z?: number
  visibility?: number
}

export type PoseAssessment = {
  poseCount: number
  isVisible: boolean
  kneeAngle?: number
  elbowAngle?: number
  hipAngle?: number
  bodyLineAngle?: number
  kneeToElbowDistance?: number
  landmarks?: PoseLandmark[]
}

type FullSide = {
  shoulder: PoseLandmark
  elbow: PoseLandmark
  wrist: PoseLandmark
  hip: PoseLandmark
  knee: PoseLandmark
  ankle: PoseLandmark
}

const VISIBILITY_THRESHOLD = 0.52

const LEFT = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 }
const RIGHT = { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 }

export function calculateAngle(first: PoseLandmark, vertex: PoseLandmark, third: PoseLandmark): number {
  const firstVector = { x: first.x - vertex.x, y: first.y - vertex.y }
  const thirdVector = { x: third.x - vertex.x, y: third.y - vertex.y }
  const dot = firstVector.x * thirdVector.x + firstVector.y * thirdVector.y
  const firstLength = Math.hypot(firstVector.x, firstVector.y)
  const thirdLength = Math.hypot(thirdVector.x, thirdVector.y)

  if (firstLength === 0 || thirdLength === 0) {
    return 0
  }

  const cosine = Math.min(Math.max(dot / (firstLength * thirdLength), -1), 1)
  return Math.round((Math.acos(cosine) * 180) / Math.PI)
}

export function assessPose(poses: PoseLandmark[][]): PoseAssessment {
  if (poses.length !== 1) {
    return { poseCount: poses.length, isVisible: false }
  }

  const [landmarks] = poses
  const candidates = [sideFrom(landmarks, LEFT), sideFrom(landmarks, RIGHT)].filter(
    (candidate): candidate is FullSide => candidate !== undefined,
  )

  if (candidates.length === 0) {
    return { poseCount: 1, isVisible: false }
  }

  const bestSide = candidates.sort((first, second) => sideVisibility(second) - sideVisibility(first))[0]
  if (sideVisibility(bestSide) < VISIBILITY_THRESHOLD) {
    return { poseCount: 1, isVisible: false }
  }

  const kneeAngle = calculateAngle(bestSide.hip, bestSide.knee, bestSide.ankle)
  const elbowAngle = calculateAngle(bestSide.shoulder, bestSide.elbow, bestSide.wrist)
  const hipAngle = calculateAngle(bestSide.shoulder, bestSide.hip, bestSide.knee)
  const bodyLineAngle = calculateAngle(bestSide.shoulder, bestSide.hip, bestSide.ankle)
  const kneeToElbowDistance = Number(
    Math.hypot(bestSide.knee.x - bestSide.elbow.x, bestSide.knee.y - bestSide.elbow.y).toFixed(3),
  )

  return {
    poseCount: 1,
    isVisible: true,
    kneeAngle,
    elbowAngle,
    hipAngle,
    bodyLineAngle,
    kneeToElbowDistance,
    landmarks,
  }
}

function sideFrom(landmarks: PoseLandmark[], indexes: typeof LEFT): FullSide | undefined {
  const shoulder = landmarks[indexes.shoulder]
  const elbow = landmarks[indexes.elbow]
  const wrist = landmarks[indexes.wrist]
  const hip = landmarks[indexes.hip]
  const knee = landmarks[indexes.knee]
  const ankle = landmarks[indexes.ankle]
  return shoulder && elbow && wrist && hip && knee && ankle
    ? { shoulder, elbow, wrist, hip, knee, ankle }
    : undefined
}

function sideVisibility(side: FullSide): number {
  return Math.min(
    ...[side.shoulder, side.elbow, side.wrist, side.hip, side.knee, side.ankle].map(
      (landmark) => landmark.visibility ?? 1,
    ),
  )
}
