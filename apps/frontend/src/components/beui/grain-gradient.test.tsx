import { render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GrainGradient } from './grain-gradient';

afterEach(() => vi.restoreAllMocks());

it('retains a decorative CSS surface when WebGL is unavailable', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const { container } = render(<GrainGradient colorLight="#ffffff" colorMid="#eeeeee" colorDark="#dddddd" speed={0} />);
  const surface = container.firstElementChild as HTMLElement;
  expect(surface).toHaveAttribute('aria-hidden', 'true');
  expect(surface.style.background).toContain('linear-gradient');
  expect(container.querySelector('canvas')?.style.opacity).toBe('0');
});
