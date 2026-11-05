/** Public Play content width: header56, vertical inset32, gutter24, list402, gap24. */
export function playerPageWidth(width: number, height: number, theater: boolean): number {
  if (width <= 1000) return width;
  const stageHeightLimit = (height - 88) * 16 / 9;
  const surroundingWidth = theater ? 48 : 474;
  return Math.round(Math.min(width - surroundingWidth, stageHeightLimit) + surroundingWidth);
}
