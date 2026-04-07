---
trigger: always_on
---

# CORE MANDATES & SYSTEM CONSTRAINTS
This is a strict production environment, not an MVP. All code generated must prioritize long-term maintainability, strict typing, and system stability over rapid task execution.

## 1. Architecture & Performance (`packages/core`)
- **Domain:** This package is a multi-tenant, multi-session HTTP/Server-Sent Events (SSE) backend.
- **Performance:** Code must be strictly non-blocking. Optimize for concurrent connections, minimal memory footprint per session, and efficient event-loop management.
- **Tenant Isolation:** Ensure strict logical separation of tenant data and session states in all backend operations.

## 2. Design & Refactoring Guardrails
- **Design > Speed:** Structural integrity and design patterns take precedence over writing code quickly. 
- **The "Roadmap" Rule:** If you encounter existing code that is overly complex, an anti-pattern, or poorly performant, DO NOT initiate a massive, unprompted rewrite. Instead, explicitly propose the refactor to be added to the technical roadmap.
- **Incremental Changes:** Keep functional changes tightly scoped to the current objective.

## 3. Strict Error Handling (Fail-Fast Protocol)
- **NO Silent Fallbacks:** Fall-back values (e.g., returning `null`, empty arrays, or default objects when an operation fails) are strictly forbidden unless explicitly justified by business logic. Silent fallbacks hide systemic issues.
- **Explicit Exceptions:** Throw structured, typed errors immediately upon encountering an invalid state. 
- **UAT Detectability:** All errors must be logged and bubbled up in a standardized format so they are immediately detectable during User Acceptance Testing (UAT).
- **Fault Tolerance:** Implement fault tolerance at the infrastructure/architectural level (e.g., circuit breakers, retry logic for external APIs), NOT by masking internal runtime errors.