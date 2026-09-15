export const motionDurations = {
  hover: 120,
  content: 180,
} as const

export const motionEasing: [number, number, number, number] = [0.2, 0, 0, 1]

export const motionPressTransition = {
  type: 'spring' as const,
  stiffness: 500,
  damping: 30,
  mass: 0.6,
}

export const motionTabsTransition = {
  type: 'spring' as const,
  stiffness: 170,
  damping: 30,
  mass: 1.2,
}
