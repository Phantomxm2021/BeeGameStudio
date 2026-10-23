# Parameter Boundary Model

## Purpose

Use this reference to make design parameters tunable and testable.

Trace each value to its source definition. Distinguish confirmed requirements, design choices and estimates; do not promote an estimate into a confirmed requirement. Preserve explicitly supplied constraints.

## Useful parameter definitions

- Consequential runtime values need a value, meaning, unit (or explicit dimensionless meaning) and scope. Explain assumptions or non-obvious choices; do not justify every ID, index or incidental number.
- Give bounds when invalid/extreme values can change the rules or cause a demonstrated balance risk. Distinguish hard legal bounds from tentative tuning ranges; do not invent precise minima/maxima merely to fill a table.
- Derived formulas must name variables and boundary behavior.
- Risk notes should identify parameters likely to destabilize difficulty, pacing, readability, or fairness.

## Review Questions

- Can QA verify the parameter without asking for hidden assumptions?
- Can implementation expose the value as a named constant or configuration?
- Is the boundary engine-neutral and independent of runtime-specific APIs?
