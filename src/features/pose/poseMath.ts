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
  ankle?: PoseLandmark
}

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

function sideScore(side: FullSide): number {
  const shoulderVis = side.shoulder.visibility ?? 1
  const hipVis = side.hip.visibility ?? 1
  const elbowVis = side.elbow.visibility ?? 1
  const kneeVis = side.knee.visibility ?? 1
  const wristVis = side.wrist.visibility ?? 1
  const ankleVis = side.ankle ? (side.ankle.visibility ?? 1) : 0.6

  const torso = (shoulderVis + hipVis) / 2
  const limbs = (elbowVis + kneeVis + wristVis + ankleVis) / 4
  return torso * 0.45 + limbs * 0.55
}

function isSideVisible(side: FullSide): boolean {
  const shoulderVis = side.shoulder.visibility ?? 1
  const hipVis = side.hip.visibility ?? 1
  const elbowVis = side.elbow.visibility ?? 1
  const kneeVis = side.knee.visibility ?? 1

  // Torso must be detected
  if (shoulderVis < 0.32 || hipVis < 0.32) return false

  // At least one major limb joint must have detection
  if (elbowVis < 0.28 && kneeVis < 0.28) return false

  return sideScore(side) >= 0.36
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

  const bestSide = candidates.sort((first, second) => sideScore(second) - sideScore(first))[0]
  if (!isSideVisible(bestSide)) {
    return { poseCount: 1, isVisible: false }
  }

  const elbowAngle = calculateAngle(bestSide.shoulder, bestSide.elbow, bestSide.wrist)
  const hipAngle = calculateAngle(bestSide.shoulder, bestSide.hip, bestSide.knee)

  // kneeAngle: use ankle if available
  const kneeAngle = bestSide.ankle
    ? calculateAngle(bestSide.hip, bestSide.knee, bestSide.ankle)
    : undefined

  // bodyLineAngle: if ankle is visible, measure shoulder-hip-ankle.
  // If ankle is off-screen (e.g. floor pushups/plank), fallback to shoulder-hip-knee!
  const bodyLineAngle = bestSide.ankle
    ? calculateAngle(bestSide.shoulder, bestSide.hip, bestSide.ankle)
    : hipAngle

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

  if (!shoulder || !hip) return undefined

  // If ankle exists and has >= 0.2 visibility, keep it; otherwise undefined (so floor exercises won't fail)
  const validAnkle = ankle && (ankle.visibility ?? 1) >= 0.2 ? ankle : undefined

  return {
    shoulder,
    elbow: elbow ?? shoulder,
    wrist: wrist ?? elbow ?? shoulder,
    hip,
    knee: knee ?? hip,
    ankle: validAnkle,
  }
}
