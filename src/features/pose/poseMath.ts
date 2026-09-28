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
}

type Side = {
  shoulder: PoseLandmark
  hip: PoseLandmark
  knee: PoseLandmark
  ankle: PoseLandmark
}

const VISIBILITY_THRESHOLD = 0.58

const LEFT = { shoulder: 11, hip: 23, knee: 25, ankle: 27 }
const RIGHT = { shoulder: 12, hip: 24, knee: 26, ankle: 28 }

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
  return (Math.acos(cosine) * 180) / Math.PI
}

export function assessPose(poses: PoseLandmark[][]): PoseAssessment {
  if (poses.length !== 1) {
    return { poseCount: poses.length, isVisible: false }
  }

  const [landmarks] = poses
  const candidates = [sideFrom(landmarks, LEFT), sideFrom(landmarks, RIGHT)].filter(
    (candidate): candidate is Side => candidate !== undefined,
  )

  if (candidates.length === 0) {
    return { poseCount: 1, isVisible: false }
  }

  const bestSide = candidates.sort((first, second) => sideVisibility(second) - sideVisibility(first))[0]
  if (sideVisibility(bestSide) < VISIBILITY_THRESHOLD) {
    return { poseCount: 1, isVisible: false }
  }

  return {
    poseCount: 1,
    isVisible: true,
    kneeAngle: calculateAngle(bestSide.hip, bestSide.knee, bestSide.ankle),
  }
}

function sideFrom(landmarks: PoseLandmark[], indexes: typeof LEFT): Side | undefined {
  const shoulder = landmarks[indexes.shoulder]
  const hip = landmarks[indexes.hip]
  const knee = landmarks[indexes.knee]
  const ankle = landmarks[indexes.ankle]
  return shoulder && hip && knee && ankle ? { shoulder, hip, knee, ankle } : undefined
}

function sideVisibility(side: Side): number {
  return Math.min(...[side.shoulder, side.hip, side.knee, side.ankle].map((landmark) => landmark.visibility ?? 1))
}
