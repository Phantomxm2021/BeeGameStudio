import { afterEach, beforeAll, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import '../i18n';

// Extend the exact Vitest instance running this workspace. The monorepo also
// contains an older Vitest version, so jest-dom's convenience entrypoint can
// otherwise register its matchers on the wrong instance.
expect.extend(matchers);

// Mock localStorage for all tests
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    }
  };
})();

// Set up localStorage mock globally
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true
  });

  if (!HTMLElement.prototype.scrollTo) {
    HTMLElement.prototype.scrollTo = function scrollTo(options?: ScrollToOptions | number, y?: number) {
      if (typeof options === 'number') {
        this.scrollTop = options;
        return;
      }
      if (typeof y === 'number') {
        this.scrollTop = y;
        return;
      }
      if (typeof options?.top === 'number') {
        this.scrollTop = options.top;
      }
    };
  }

  // Motion's viewport helpers use this browser API. JSDOM intentionally does
  // not implement it, so provide the inert platform equivalent for unit tests.
  if (!globalThis.IntersectionObserver) {
    class IntersectionObserverMock implements IntersectionObserver {
      readonly root: Element | Document | null = null;
      readonly rootMargin = '0px';
      readonly thresholds = [0];
      constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
      disconnect() {}
      observe(_target: Element) {}
      takeRecords(): IntersectionObserverEntry[] { return []; }
      unobserve(_target: Element) {}
    }
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      value: IntersectionObserverMock,
      writable: true,
      configurable: true,
    });
  }
});

// Cleanup after each test case
afterEach(() => {
  cleanup();
});
