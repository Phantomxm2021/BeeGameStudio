/** Compare the visible RGB composition, rather than filenames or encoded bytes. */
export const COVER_SAMPLE_WIDTH = 64;
export const COVER_SAMPLE_HEIGHT = 36;

export function coverImagesSimilar(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  let difference = 0;
  for (let offset = 0; offset < COVER_SAMPLE_WIDTH * COVER_SAMPLE_HEIGHT * 4; offset += 4) {
    difference += Math.abs(left[offset] - right[offset]);
    difference += Math.abs(left[offset + 1] - right[offset + 1]);
    difference += Math.abs(left[offset + 2] - right[offset + 2]);
  }
  // Ignore compression noise and small title-screen animations, not just exact copies.
  return difference / (COVER_SAMPLE_WIDTH * COVER_SAMPLE_HEIGHT * 3) < 12;
}
