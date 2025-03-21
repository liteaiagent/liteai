---
name: debug
description: Debug an issue with systematic analysis — reproduce, isolate, and fix
argument-hint: "[description of the issue]"
---

# Debugging Workflow

Follow this systematic debugging approach:

## 1. Understand the Problem

- Read and understand the error or bug description: $ARGUMENTS
- Identify the expected vs actual behavior
- Note any error messages, stack traces, or logs

## 2. Reproduce the Issue

- Find the minimal steps to reproduce the issue
- If there are tests, run relevant tests to see the failure
- Confirm the issue is reproducible before proceeding

## 3. Isolate the Root Cause

- Trace the execution flow from the point of failure backward
- Check recent changes that may have introduced the issue
- Look for common causes:
  - Off-by-one errors
  - Null/undefined handling
  - Race conditions
  - Incorrect assumptions about data shape
  - Missing error handling

## 4. Develop a Fix

- Make the minimal change needed to fix the issue
- Avoid changing unrelated code
- Consider edge cases the fix might affect

## 5. Verify the Fix

- Run the relevant tests to confirm the fix
- If no tests exist, manually verify the fix resolves the issue
- Check that the fix doesn't introduce new issues
- Consider adding a test to prevent regression
