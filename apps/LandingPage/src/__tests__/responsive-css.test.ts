import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

test("narrow layout preserves the full-bleed hero and compact navigation", () => {
  expect(styles).toMatch(
    /\.hero\s*\{[\s\S]*?height:\s*100svh;/,
  );
  expect(styles).toMatch(
    /@media \(max-width: 560px\)[\s\S]*?\.hero-image\s*\{[\s\S]*?object-position:\s*68%\s+center;/,
  );
});

test("provides a visible language selector and motion affordances", () => {
  expect(styles).toMatch(
    /\.language-current\s*\{[\s\S]*?color:\s*#f8f5ef;[\s\S]*?font-size:\s*12px;/,
  );
  expect(styles).toMatch(/\.site-page::before\s*\{[\s\S]*?radial-gradient/);
  expect(styles).toMatch(/\.pointer-orb\s*\{[\s\S]*?position:\s*fixed;/);
  expect(styles).not.toMatch(/@supports\s*\(animation-timeline:\s*view\(\)\)/);
  expect(styles).toMatch(/\.language-selector select:focus-visible\s*\{[^}]*outline:\s*none;/);
  expect(styles).toMatch(
    /@media \(max-width: 560px\)[\s\S]*?\.language-selector,\s*\.language-selector select\s*\{[^}]*min-width:\s*5\.2rem;/,
  );
});

test("defines the restrained depth and one-time section reveal system", () => {
  expect(styles).toMatch(/\.site-page\s*\{[^}]*--parallax-x:\s*0;[^}]*--parallax-y:\s*0;/);
  expect(styles).toMatch(/\.hero-image\s*\{[^}]*transform:\s*translate3d\(/);
  expect(styles).toMatch(/\.section\[data-reveal\]\s*\{[^}]*opacity:\s*0;/);
  expect(styles).toMatch(/\.section\[data-reveal\]\.is-visible\s*\{[^}]*opacity:\s*1;/);
  expect(styles).toMatch(/\.section\[data-reveal\]\s+\[data-reveal-item\]\s*\{/);
  expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?--parallax-x:\s*0;/);
});

test("defines a pinned scroll story for the creation section", () => {
  expect(styles).toMatch(/\.moment\s*\{[^}]*min-height:\s*280vh;/);
  expect(styles).toMatch(/\.process-visual\s*\{[^}]*position:\s*sticky;/);
  expect(styles).toMatch(/\.process-beat\s*\{[^}]*min-height:\s*48vh;/);
  expect(styles).toMatch(/\.process-beat\.is-active\s*\{[^}]*opacity:\s*1;/);
  expect(styles).toMatch(/@media \(max-width: 850px\)[\s\S]*?\.moment\s*\{[^}]*min-height:\s*auto;/);
});
