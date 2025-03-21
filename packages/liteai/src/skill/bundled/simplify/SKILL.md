---
name: simplify
description: Simplify and reduce complexity in code — remove unnecessary abstractions and dead code
argument-hint: "[focus area or file path]"
---

# Code Simplification Workflow

Analyze the codebase and simplify it. Focus area: $ARGUMENTS

## 1. Analyze Complexity

- Read the target code thoroughly
- Identify areas of unnecessary complexity:
  - Over-abstracted code (too many layers of indirection)
  - Dead code (unused functions, variables, imports)
  - Redundant logic (duplicate conditions, unnecessary wrappers)
  - Over-engineered patterns (premature generalization)
  - Unnecessary type annotations that can be inferred

## 2. Plan Simplifications

For each identified issue, plan the simplification:

- **Remove dead code**: Delete unused imports, functions, variables, and types
- **Flatten abstractions**: Inline functions that are only called once and don't add clarity
- **Simplify control flow**: Replace complex conditionals with early returns; remove unnecessary else blocks
- **Reduce indirection**: Merge small modules that are always used together
- **Simplify types**: Remove interfaces/types that can be inferred; use simpler type expressions

## 3. Apply Changes

- Make one logical change at a time
- Ensure each change preserves behavior (no functional changes)
- Run tests after each significant change to verify nothing is broken

## 4. Verify

- Run the full test suite
- Confirm no functionality was lost
- Review the diff to ensure all changes are purely simplification
