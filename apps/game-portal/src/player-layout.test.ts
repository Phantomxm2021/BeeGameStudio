import { describe, expect, test } from 'bun:test';
import { playerPageWidth } from './player-layout';
describe('reference Play layout across both modes', () => {
  test('matches measured reference widths in normal and theater layouts', () => {
    expect(playerPageWidth(1512, 766, false)).toBe(1512);
    expect(playerPageWidth(1512, 766, true)).toBe(1253);
    expect(playerPageWidth(1512, 710, true)).toBe(1154);
    expect(playerPageWidth(1512, 610, true)).toBe(976);
  });
  test('also constrains normal mode in a wide, short window', () => {
    expect(playerPageWidth(1920, 710, false)).toBe(1580);
    expect(playerPageWidth(1920, 710, true)).toBe(1154);
    expect(playerPageWidth(1280, 766, true)).toBe(1253);
    expect(playerPageWidth(1024, 766, true)).toBe(1024);
  });
  test('uses narrow layout through the exact 1000px boundary', () => {
    expect(playerPageWidth(1000, 610, false)).toBe(1000);
    expect(playerPageWidth(1000, 610, true)).toBe(1000);
    expect(playerPageWidth(390, 844, true)).toBe(390);
  });
});
