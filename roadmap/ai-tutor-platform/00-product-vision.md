# AI Tutor Platform — Product Vision & Feature Specification

> **Status:** Ideation  
> **Created:** 2026-05-09  
> **Scope:** Feature definition — no technical evaluation  
> **Working Name:** **Aura** (أورا)  

---

## 1. Vision Statement

An AI-powered tutoring platform where **parents** (or self-enrolled university students) onboard learners into a personalized, multi-agent educational ecosystem. Each learner receives a dedicated **Academic Advisor agent** and **per-subject Tutor agents** that collaborate to produce study plans, conduct live tutoring sessions, assign homework, run quizzes, and continuously report progress — all accessible through the communication channels kids and students already use daily.

---

## 1.1 V1 Scope & Market Focus

| Dimension | V1 Decision |
|---|---|
| **Geography** | Egypt & Middle East (international school market) |
| **Curriculum Tracks** | American Diploma, IGCSE (British). French & German deferred. |
| **Grade Range** | Grades 4–12 (design for full range, launch focused on pre-IG / pre-SAT — roughly grades 9–10) |
| **Grade Naming** | Elementary (1–5), Middle School (6–8), High School (9–12). IG/SAT prep spans grades 9–11. |
| **Platform** | **Mobile-only** (iOS + Android). Full dashboard inside the app. Parents use phone, kids use tablet. Web app optional/secondary. |
| **Account Model** | Parent-managed only in V1. Child gets own credentials + biometric login. University self-managed deferred to V2. |
| **AI Tutor Model** | AI is the **sole tutor** — no human tutor marketplace. Tutor agents are **per-school, per-grade** — shared across all learners in the same school/grade, with per-student memory overlays. |
| **Live Session Presence** | Each Subject Tutor has a **distinct persona** (name, voice, personality). Static avatar on Google Meet / Teams + AI-controlled whiteboard via screen share. Animated/realistic Web UI avatars are a late-stage enhancement. |
| **Language Policy** | English for all subjects. Arabic for Arabic-language subjects (Arabic, Social Studies). Conversational code-switching (Arabic ↔ English) supported. Reports in English. |
| **Monetization** | Monthly subscription, tiered by subject count (see §14). |
| **Institutional** | Not in V1, but architecture must support future SaaS and on-premise school deployments. |
| **Escalation** | Always via instant messaging (WhatsApp preferred). Email reserved for async reports and non-urgent updates only. |
| **Multi-Child** | Per-child dashboard, no sibling session sharing. Co-parent access supported. |

---

## 2. Target Personas

| Persona | V1 | Description |
|---|---|---|
| **Parent (K-12)** | ✅ | Primary account holder. Manages children, uploads curricula, monitors progress, receives reports. |
| **Child / Learner (K-12)** | ✅ | Interacts with tutor agents through approved channels. Completes assignments, attends sessions, asks questions. |
| **Co-Parent** | ✅ | Secondary parent with shared access to child accounts. Full visibility, no duplicate billing. |
| **University Student** | V2 | Self-managed account. Uploads own course materials, manages own schedule, interacts directly with agents. |
| **School Admin (Future)** | V3 | Institutional accounts (SaaS or on-premise), bulk student onboarding, teacher dashboards, district-level reporting. |

---

## 3. Core Agents

### 3.1 Academic Advisor / School Counselor Agent

The orchestrating agent for each learner. Responsibilities:

- **Holistic View:** Maintains awareness of all subjects, scores, schedule, and workload balance.
- **Study Plan Generation:** Proposes weekly/monthly study plans considering upcoming exams, weak areas, and parent priorities.
- **Priority Balancing:** When a parent selects focus subjects, the Advisor redistributes time across the plan.
- **Progress Reporting:** Generates periodic progress summaries for the parent (daily digest, weekly report, exam-prep alerts).
- **Escalation:** Flags struggling areas to the parent with specific recommendations (e.g., "Math scores declining — recommend 2 extra sessions/week").
- **Schedule Coordination:** Resolves conflicts between subject sessions, school events, and personal time.
- **Motivational Coaching:** Encourages the learner, celebrates milestones, and adapts tone to the child's age and personality.

### 3.2 Subject Tutor Agents

One agent per enrolled subject per school per grade (e.g., "Grade 10 IGCSE Math Tutor at AIS"). The tutor is **shared** across all learners in that school/grade combination — it accumulates collective teaching intelligence — while maintaining **per-student memory overlays** for individualized instruction.

#### Distinct Personas

Each Subject Tutor has a unique persona — name, voice, personality, and avatar — to make interactions feel natural and varied:

| Subject Area | Persona Example | Personality Traits | Voice |
|---|---|---|---|
| Mathematics | **Kai** | Precise, patient, methodical, celebrates small wins | Calm, measured male voice |
| Sciences | **Nova** | Curious, enthusiastic, loves "why?" questions | Energetic female voice |
| English / Language Arts | **Sage** | Warm, expressive, storyteller, encourages creativity | Soft, articulate female voice |
| Social Studies / History | **Atlas** | Narrative-driven, connects events to modern life | Deep, engaging male voice |
| Arabic Language | **Reem** (ريم) | Culturally warm, poetic, encouraging | Natural Arabic female voice |

> Persona names, voices, and traits are configurable per deployment and can be customized by the platform team. These are defaults.

#### Responsibilities

- **Curriculum Mastery:** Deeply understands the specific textbooks, worksheets, and syllabus for the school's grade level and curriculum edition.
- **Live Tutoring Sessions:** Conducts scheduled or on-demand interactive sessions (voice/video via meeting integrations, or text-based via chat) using its distinct persona.
- **Quiz & Assessment:** Generates topic-specific quizzes, timed tests, and practice exams aligned with the curriculum.
- **Homework Assignment:** Creates and assigns homework exercises, tracks completion, provides feedback.
- **Adaptive Difficulty:** Adjusts explanation depth and exercise difficulty based on learner performance history.
- **Exam Preparation:** Builds targeted revision plans as exam dates approach, focusing on weak topics.
- **Concept Linking:** Uses GraphRAG to connect related concepts across chapters and even across subjects when relevant.

#### Per-School-Per-Grade Sharing Model

```
School: American International School (AIS)
Grade: 10 — Curriculum: American Diploma
    │
    ├── Math Tutor (Kai) ──── Shared knowledge base (AIS Grade 10 Math textbook + worksheets)
    │     ├── Student A memory overlay (weak: quadratics, strong: algebra)
    │     ├── Student B memory overlay (weak: geometry, strong: trigonometry)
    │     └── Student C memory overlay (...)
    │
    ├── Science Tutor (Nova) ──── Shared knowledge base (AIS Grade 10 Science)
    │     ├── Student A memory overlay
    │     └── ...
    │
    └── ... (one per enrolled subject)
```

**Benefits of shared tutors:**
- **Document deduplication:** When multiple parents from the same school/grade upload the same worksheet, it is ingested once into the shared knowledge base (content-hashed dedup).
- **Collective intelligence:** The tutor learns which topics confuse students most, which explanations work best, and what common mistakes occur — benefiting all learners.
- **Efficient onboarding:** New students in the same school/grade immediately benefit from an already-trained tutor with rich curriculum knowledge.

### 3.3 Pedagogy Model

> **Principle:** School curriculum first. AI-generated exercises must align with the school's teaching methods — if the school teaches long division a specific way, the tutor uses that way.

#### Exercise Generation Strategy

| Strategy | Description |
|---|---|
| **School-Method Alignment** | When multiple solution approaches exist, the tutor defaults to the method taught in the learner's school materials. Alternative approaches shown only after mastery of the primary method. |
| **Daily Practice** | Minimum daily exercise quota per subject (e.g., 5 math problems/day). AI-generated, curriculum-aligned, difficulty-matched. |
| **Variation Repetition** | After a learner solves a problem correctly, the tutor generates 2–3 modified variants (different numbers, slightly different context) to confirm the concept is truly grasped — not just pattern-matched. |
| **Mastery Confirmation Loop** | A concept is not marked "mastered" until the learner answers ≥3 variations correctly on separate occasions (spaced). Prevents false-positive mastery from a single lucky answer. |
| **Spaced Repetition (Memory Subjects)** | For subjects requiring memorization (vocabulary, history dates, science terms), the tutor uses spaced-repetition scheduling — increasing intervals between review prompts as recall strengthens. |
| **Error Pattern Analysis** | When a learner consistently makes the same type of mistake, the tutor identifies the root misconception and generates targeted remediation exercises, not just more of the same. |
| **Scaffolded Hints** | When stuck, the learner receives graduated hints (not the answer). Hint 1: restate the problem differently. Hint 2: remind the relevant rule. Hint 3: show the first step. Full solution only if all hints fail. |

### 3.4 Tutor Agent Architecture

> **Principle:** Tutor agents follow the industry-standard agent architecture pattern: **Context + Skills + Hooks + Tools + Memory**. This aligns directly with the LiteAI core agent framework.

#### Agent Composition

```
┌─────────────────────────────────────────────────────┐
│              Subject Tutor Agent (e.g., Kai)         │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────┐  Agent Context                     │
│  │   Context    │  • Persona definition (name,      │
│  │              │    voice, personality, avatar)     │
│  │              │  • System instructions             │
│  │              │  • Curriculum scope & grade level  │
│  │              │  • Pedagogical rules               │
│  └─────────────┘                                    │
│                                                     │
│  ┌─────────────┐  Skills                            │
│  │   Skills     │  • explain_concept                 │
│  │              │  • generate_quiz                   │
│  │              │  • assign_homework                 │
│  │              │  • run_assessment                  │
│  │              │  • build_revision_plan             │
│  │              │  • spaced_repetition_schedule      │
│  └─────────────┘                                    │
│                                                     │
│  ┌─────────────┐  Lifecycle Hooks                   │
│  │   Hooks      │  • onSessionStart (load student    │
│  │              │    context, greet by name)         │
│  │              │  • onSessionEnd (save progress,    │
│  │              │    update memory, notify parent)   │
│  │              │  • onError (escalate to Advisor)   │
│  │              │  • onMilestone (trigger reward)    │
│  └─────────────┘                                    │
│                                                     │
│  ┌─────────────┐  Tools                             │
│  │   Tools      │  • whiteboard_draw                 │
│  │              │  • curriculum_search (RAG)         │
│  │              │  • graph_query (GraphRAG)          │
│  │              │  • score_tracker                   │
│  │              │  • calendar_schedule               │
│  │              │  • notification_send               │
│  └─────────────┘                                    │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │   Dual Memory System                         │   │
│  │                                              │   │
│  │  ┌──────────────────┐ ┌───────────────────┐  │   │
│  │  │ General Memory    │ │ Student Memory    │  │   │
│  │  │ (per-school/grade)│ │ (per-student)     │  │   │
│  │  │                  │ │                   │  │   │
│  │  │ • Difficult      │ │ • Strengths &     │  │   │
│  │  │   topics (FAQ)   │ │   weaknesses      │  │   │
│  │  │ • Best explain-  │ │ • Learning style  │  │   │
│  │  │   ation methods  │ │   preferences     │  │   │
│  │  │ • Common student │ │ • Error patterns  │  │   │
│  │  │   mistakes       │ │ • Mastery state   │  │   │
│  │  │ • Effective      │ │ • Session history │  │   │
│  │  │   exercise types │ │ • Personality     │  │   │
│  │  │ • Curriculum     │ │   notes (rapport) │  │   │
│  │  │   pain points    │ │ • Parent prefs    │  │   │
│  │  └──────────────────┘ └───────────────────┘  │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

#### Dual Memory Details

| Memory Type | Scope | Persistence | Examples |
|---|---|---|---|
| **General Memory** | Per-school, per-grade, per-subject | Shared, grows with all students | "Chapter 7 fractions: 80% of students struggle with mixed numbers → use pizza analogy first"; "Common mistake: students forget to flip the divisor in fraction division" |
| **Student Memory** | Per-individual student | Private to that student's profile | "Ahmed prefers visual explanations"; "Weak on word problems, strong on computation"; "Gets frustrated after 3rd failed attempt → switch to easier variant" |

**Memory Lifecycle:**
- General memory is seeded during curriculum ingestion and continuously enriched as more students interact.
- Student memory is initialized during onboarding (learning style quiz, parent inputs) and updated after every session.
- Both memory types are injected into the agent's context window at session start, with student memory taking priority for personalization.

---

## 4. Knowledge System (RAG + GraphRAG)

### 4.1 Document Ingestion Pipeline

| Source Type | Examples | Ingestion Method |
|---|---|---|
| Textbooks | PDF, EPUB, scanned images | OCR + chunking + embedding |
| Worksheets / Handouts | Photos, PDFs forwarded via WhatsApp/email | OCR + classification + embedding |
| Exam Papers | Past papers, graded exams | OCR + score extraction + error analysis |
| Syllabi / Curricula | Course outlines, scope & sequence docs | Structured extraction → schedule alignment |
| School Notifications | Announcements, schedule changes | NLP classification + calendar update |
| Score Reports | Report cards, grade sheets | Structured data extraction → analytics |

- **Ingestion Notification:** Parent is notified when ingestion completes, with a summary of what was processed and any items requiring manual review (e.g., illegible scans).
- **Incremental Updates:** As new materials arrive (forwarded by parent), the knowledge base updates without full re-indexing.
- **Document Deduplication:** All ingested documents are content-hashed (perceptual hash for images, content hash for text/PDF). When multiple parents from the same school/grade upload the same document, it is ingested into the shared knowledge base only once. The system notifies the parent: *"This worksheet was already in Aura's knowledge base — no action needed."*

### 4.2 RAG Architecture

- **Per-School-Per-Grade-Per-Subject Vector Store:** Each tutor agent's vector index is scoped to the school + grade + subject combination. All learners sharing that tutor query the same index.
- **Shared Reference Store:** Common knowledge (grade-level standards, educational frameworks, curriculum specifications) shared across all tutors and schools.
- **Retrieval Strategy:** Hybrid search (dense + sparse) with re-ranking for accuracy.
- **Student Context Overlay:** At query time, student-specific memory (weak areas, learning style) is injected as retrieval context to re-rank results toward the individual learner's needs.

### 4.3 GraphRAG Layer

- **Concept Graph:** Nodes = concepts/topics, Edges = prerequisite/related/builds-upon relationships.
- **Cross-Subject Links:** E.g., "fractions" (Math) ↔ "ratios in chemistry" (Science) — enables tutors to reference related mastery.
- **Prerequisite Detection:** Identifies knowledge gaps by tracing prerequisite chains ("struggling with algebra? check arithmetic foundations").
- **Study Path Optimization:** Uses the graph to determine the most efficient learning sequence.

---

## 5. Communication Channels

### 5.1 Channel Matrix

| Channel | Role | Use Cases | Priority |
|---|---|---|---|
| **Mobile App** | Complete platform | Full dashboard, all interactions, sessions, submissions. Parents on phone, kids on tablet. | P0 — Core |
| **Web App** | Optional secondary | Same features as mobile, for parents who prefer desktop. Not required for onboarding or daily use. | P2 |
| **WhatsApp** | Parent ↔ Platform, Learner ↔ Tutor | Forward school docs, receive reports, quick Q&A, homework reminders | P0 — Launch |
| **Google Meet** | Live tutoring sessions | Scheduled 1:1 tutoring, whiteboard explanations, verbal Q&A | P0 — Launch |
| **Microsoft Teams** | Live tutoring sessions (alt) | Same as Google Meet, for Teams-preferred users | P1 |
| **Snapchat** | Learner engagement | Quick quiz challenges, streak-based study motivation, study reminders | P1 |
| **Discord** | Learner community / study groups | Group study sessions, peer Q&A, tutor drop-in hours | P1 |
| **Telegram** | Parent ↔ Platform | Alternative to WhatsApp for markets where Telegram dominates | P2 |
| **SMS** | Notifications | Fallback for critical alerts (exam reminders, session starts) | P2 |
| **Gmail / Email** | Document forwarding, formal reports | Parent forwards school emails, platform sends detailed progress reports | P1 |
| **Instagram DM** | Learner engagement | Study tips, motivational content, quick interactions | P2 |
| **TikTok (API)** | Content delivery | Short-form educational clips generated by tutors | P3 — Explore |

### 5.2 Channel Capabilities

```
                    ┌─────────────────────────────────────────────────────┐
                    │              Communication Hub                      │
                    ├─────────────────────────────────────────────────────┤
                    │                                                     │
                    │  Inbound                    Outbound                │
                    │  ─────────                  ──────────              │
                    │  • Doc forwarding           • Progress reports      │
                    │  • Score submission          • Session reminders     │
                    │  • Questions (text/voice)    • Homework assignments  │
                    │  • Homework submission       • Quiz challenges       │
                    │  • Schedule updates          • Alert notifications   │
                    │                              • Study tips            │
                    │                              • Motivational nudges   │
                    └─────────────────────────────────────────────────────┘
```

### 5.3 Meeting Integration (Live Tutoring)

> **V1 Model:** AI is the sole tutor. No human tutor marketplace. Each tutor persona (Kai, Nova, Sage, etc.) has its own avatar and TTS voice.

#### Integration Technology (Tiered)

| Tier | Technology | Description | Risk |
|---|---|---|---|
| **Preferred** | [Google Meet Media API](https://developers.google.com/meet/media-api) | Official API for programmatic media injection into Google Meet. Supports audio/video stream injection, allowing the AI to push TTS audio and whiteboard video directly. | Low — first-party API, but may have usage limits or approval gates. |
| **Fallback** | [Recall.ai](https://recall.ai) (Managed Meeting APIs) | Third-party service that provides bot-as-a-participant for Google Meet, Teams, Zoom. Handles the complexity of joining meetings, injecting media, and capturing transcripts. | Medium — external dependency, per-minute pricing. |
| **Last Resort** | Playwright / Puppeteer | Headless browser automation to join Google Meet as a browser participant. Simulates a real user joining with virtual camera/mic. | High — fragile, breaks on Meet UI changes, requires significant maintenance. |

#### Session Features

- **Tutor Presence (V1):** Static tutor avatar image (per persona) displayed on camera feed. AI speaks via TTS with the persona's distinct voice.
- **Tutor Presence (Future):** Animated AI avatar on Web UI — realistic, expressive, lip-synced to speech.
- **Whiteboard Tool:** AI controls a shared whiteboard canvas as a first-class tool:
  - Write equations, draw diagrams, annotate step-by-step solutions in real-time
  - Highlight and circle key parts of a problem
  - Erase and re-draw when correcting or exploring alternative approaches
  - Learner can also draw/write on the whiteboard (collaborative mode)
- **Screen Sharing:** AI shares screen to walk through digital textbook pages, curriculum materials, interactive exercises.
- **Scheduled Sessions:** Platform creates calendar invites (Google Calendar / Outlook) with auto-generated meeting links.
- **Recording:** Sessions recorded (with parental consent) for learner review.
- **Transcript:** Live transcription for post-session notes and accessibility.
- **Session Chat:** Text chat alongside voice for learners who prefer typing questions mid-session.

---

## 6. Feature Breakdown by User Flow

### 6.1 Parent Onboarding Flow

```
Sign Up → Create Parent Account
    │
    ├── Setup Communication Channels
    │     ├── Link WhatsApp number
    │     ├── Connect Gmail (forwarding rule)
    │     ├── Link Google Meet / Teams account
    │     └── Optional: Discord, Snapchat, Telegram
    │
    ├── Create Child Profile(s)
    │     ├── Name, age, grade level
    │     ├── School name → autocomplete / search
    │     │     ├── School found in system? → Select it (tutor already trained!)
    │     │     └── School not found? → Enter school name + curriculum type (American Diploma / IGCSE)
    │     ├── Grade level → select from dropdown
    │     ├── Subjects to enroll
    │     ├── Learning preferences (visual, auditory, etc.)
    │     └── Communication channel preferences for the child
    │
    ├── Curriculum Materials (Incremental — NOT a blocker)
    │     ├── If school/grade already in system:
    │     │     └── "Aura already knows your school's curriculum! You can start immediately.
    │     │         Forward any additional worksheets or exams anytime via WhatsApp."
    │     ├── If school/grade is new:
    │     │     ├── Upload textbooks (per subject) — optional, can be done later
    │     │     ├── Upload school schedule / timetable — optional
    │     │     └── "You can forward documents anytime via WhatsApp — Aura will process them."
    │     └── Past exam papers & scores — optional, improves initial assessment
    │
    └── Immediate Start
          ├── If school exists: Tutor agents ready immediately with existing knowledge base
          ├── If new school: Advisor uses standard curriculum knowledge until materials arrive
          ├── Academic Advisor proposes initial study plan (based on available data)
          └── Parent reviews, adjusts focus areas, approves
```

> **Design Principle:** Zero-friction onboarding. A parent should be able to go from sign-up to a child's first tutoring session in under 10 minutes. Document upload is always optional and incremental — the platform gets smarter over time as the parent forwards materials via WhatsApp.

### 6.2 Ongoing Parent Interactions

| Action | Channels | Description |
|---|---|---|
| Forward school document | WhatsApp, Gmail | Parent forwards a new worksheet, exam schedule, or notification → auto-ingested |
| Submit exam scores | Web UI, WhatsApp (photo of report card) | Scores extracted, analytics updated, Advisor adjusts study plan |
| View progress dashboard | Web UI | Comprehensive view of all children, all subjects, trends, alerts |
| Receive progress report | WhatsApp, Email | Scheduled (daily/weekly) or triggered (after exam, after milestone) |
| Adjust study focus | Web UI, WhatsApp | "Focus on Math and Science this month" → Advisor re-balances plan |
| Schedule extra sessions | Web UI | Book additional 1:1 tutoring time for a specific subject |
| Chat with Advisor | Web UI, WhatsApp | Ask questions about the child's progress, get recommendations |

### 6.3 Learner Interactions

| Action | Channels | Description |
|---|---|---|
| Attend live tutoring | Google Meet, Teams | Scheduled session with Subject Tutor agent |
| Ask a question | WhatsApp, Discord, Web UI | "I don't understand chapter 5" → routed to appropriate Tutor |
| Complete homework | Web UI (submission portal) | Upload completed work, receive instant feedback |
| Take a quiz | Web UI, WhatsApp (interactive), Snapchat | Tutor sends quiz, learner answers, instant scoring + explanation |
| Review past sessions | Web UI | Watch recorded sessions, review session notes |
| Study with flashcards | WhatsApp, Snapchat, Web UI | Spaced-repetition flashcard delivery via preferred channel |
| Check study schedule | Web UI, WhatsApp | "What do I have today?" → Advisor responds with today's plan |
| Request help | Any channel | "I'm stuck on problem 7" → Tutor provides guided hints (not just answers) |

---

## 7. Dashboard & Analytics

### 7.1 Parent Dashboard

- **Overview:** All children at a glance — overall progress score, upcoming exams, pending assignments.
- **Per-Child View:**
  - Subject-by-subject performance trends (line charts over time)
  - Strengths & weaknesses map (concept mastery heat map)
  - Attendance & session history
  - Homework completion rate
  - Quiz score trends
  - Advisor recommendations
- **Alerts & Notifications:**
  - Declining performance warnings
  - Upcoming exam preparation status
  - Missed sessions / incomplete homework
  - Milestone celebrations (mastery achievements)
- **Study Plan View:**
  - Calendar view of scheduled sessions, assignments, exams
  - Drag-and-drop plan adjustments
  - Focus area toggles (per subject)
- **Billing & Subscription:** Plan management, usage metrics, session history.

### 7.2 Learner Dashboard (Age-Appropriate)

- **Today's Plan:** What's on the agenda — sessions, homework due, quizzes.
- **Progress:** Gamified progress indicators (XP, levels, streaks, badges).
- **Subjects:** Per-subject view with recent topics, upcoming lessons, practice exercises.
- **Achievements:** Milestone badges, streak counters, leaderboard (opt-in).
- **Ask a Question:** Quick-access chat to any Tutor or the Advisor.

### 7.3 Analytics Engine

- **Learning Velocity:** How quickly the learner masters new concepts vs. baseline.
- **Retention Metrics:** Spaced-repetition effectiveness — recall rates over time.
- **Engagement Score:** Session attendance, homework completion, voluntary practice.
- **Predictive Alerts:** ML-based prediction of at-risk subjects before scores actually drop.
- **Comparative Benchmarks (Anonymized):** Performance relative to same-grade cohort (opt-in, privacy-preserving).

---

## 8. Study Plan & Tutoring Schedule

### 8.1 Study Plan Generation

1. **Inputs:**
   - Curriculum syllabus (topics, chapter order)
   - School timetable & exam calendar
   - Current performance data (scores, quiz results, identified weak areas)
   - Parent focus preferences
   - Learner's available time windows
   - Learning style preferences

2. **Output:**
   - Weekly schedule with specific sessions (subject, topic, duration, type)
   - Session types: Live Tutoring | Self-Study | Homework | Quiz | Revision
   - Adaptive: re-generated weekly based on new data

3. **Advisor Orchestration:**
   - Advisor proposes → Parent approves / modifies → Schedule locked
   - Mid-week adjustments if learner is ahead/behind
   - Exam-proximity intensification (auto-increase sessions for upcoming exam subjects)

### 8.2 Session Types

| Type | Description | Delivery | Duration |
|---|---|---|---|
| **Live Explain** | Tutor explains new concepts interactively | Google Meet / Teams | 30–60 min |
| **Practice Session** | Guided problem-solving with hints | Mobile App + Chat | 20–45 min |
| **Weekly Quiz** | Timed assessment on the week's topics | Mobile App / WhatsApp | 10–30 min |
| **Monthly Assessment** | Comprehensive monthly exam covering all topics | Mobile App | 30–60 min |
| **School Homework** | School-assigned homework — tracked, assisted, submitted | Mobile App (submit) | Variable |
| **Supplementary Homework** | AI-generated when school materials are insufficient | Mobile App (submit) | Variable |
| **Revision** | Pre-exam review of weak areas | Meet + Mobile App | 45–90 min |
| **Flash Review** | Spaced-repetition micro-sessions | WhatsApp / Snapchat | 5–10 min |
| **Office Hours** | On-demand Q&A with any Tutor | Discord / WhatsApp / Mobile App | Open-ended |

### 8.3 Assessment Strategy

> **Principle:** School materials first. Supplement only when needed.

| Source | Usage |
|---|---|
| **School Weekly Sheets** | Primary homework. Tutor assists learner in completing them. Tracked for completion. |
| **School Monthly Exams** | Ingested for score tracking and error analysis. Used to adjust study plan. |
| **School Homework** | Tutor ensures completion, provides hints if stuck, explains mistakes after submission. |
| **Platform Weekly Quiz** | AI-generated, curriculum-aligned. Mandatory. Provides continuous progress signal between school assessments. |
| **Platform Monthly Assessment** | Comprehensive AI-generated exam. Simulates real exam conditions. Identifies gaps before the school exam. |
| **Daily Practice** | 5 problems/day minimum (configurable). Generated when school materials are insufficient or between school assignments. |

**Supplementary Generation Rules:**
- If the parent forwards sufficient school materials → platform tracks completion only, no extra generation.
- If materials are sparse or parent doesn't forward → platform generates curriculum-aligned exercises to fill gaps.
- Daily practice quota always active regardless — these are brief reinforcement exercises, not full homework sets.

### 8.4 Progress Reporting

- **To Parent:**
  - Daily summary (opt-in): What was completed today, scores, next day preview.
  - Weekly report: Comprehensive analytics, Advisor commentary, recommendations.
  - Exam report: Post-exam analysis, comparison to preparation, areas for improvement.
  - Alert-based: Immediate notification for concerning patterns.

- **To Learner:**
  - Session completion feedback (instant).
  - Achievement notifications (badges, streak milestones).
  - "You're ready for the exam!" confidence indicators.

### 8.5 Notification System

> **Model:** Configurable per-category notification preferences, similar to Google Calendar event reminders.

| Category | Default Channel | Default Timing | Configurable |
|---|---|---|---|
| **Session Reminder** | Mobile push + WhatsApp | 30 min before, 5 min before | Channel, timing, on/off |
| **Homework Due** | Mobile push | 1 day before, 2 hours before | Channel, timing, on/off |
| **Homework Missing** | WhatsApp (parent) | After deadline + 2 hours | Channel, timing, on/off |
| **Quiz Available** | Mobile push + WhatsApp | Immediately | Channel, on/off |
| **Score Update** | WhatsApp (parent), Mobile push (learner) | Immediately | Channel, on/off |
| **Daily Progress** | WhatsApp (parent) | 8 PM daily | Channel, timing, on/off |
| **Weekly Report** | Email + WhatsApp summary | Sunday evening | Channel, timing, on/off |
| **Declining Performance** | WhatsApp (parent) — urgent | Immediately | Channel, on/off (cannot fully disable) |
| **Exam Approaching** | Mobile push + WhatsApp | 2 weeks, 1 week, 3 days, 1 day | Channel, timing, on/off |
| **Ingestion Complete** | WhatsApp (parent) | Immediately | Channel, on/off |
| **Reward Earned** | Mobile push (learner), WhatsApp (parent) | Immediately | Channel, on/off |

Parent and learner each have independent notification preferences. Parent can override learner's settings.

---

## 9. Document Forwarding & Auto-Ingestion

### 9.1 Forwarding Workflow

```
Parent receives school communication
        │
        ▼
Forwards to platform via:
  • WhatsApp: Send photo / PDF / text to platform's WhatsApp number
  • Gmail: Forward email to platform's intake address (or auto-forward rule)
  • Web UI: Upload directly
        │
        ▼
Platform processes:
  1. Document classification (worksheet? exam? schedule? notification?)
  2. OCR if needed (photos, scanned PDFs)
  3. Content extraction & structured parsing
  4. Routing to appropriate system:
       • Worksheet → Subject Tutor's knowledge base
       • Exam schedule → Calendar + Advisor's planning engine
       • Scores → Analytics + Advisor's progress tracker
       • Notification → Classification + action routing
  5. Confirmation sent to parent: "Received and processed: Math worksheet Ch.7"
        │
        ▼
If action needed:
  • Advisor updates study plan
  • Tutor prepares relevant materials
  • Parent notified of any plan changes
```

### 9.2 Smart Classification

| Document Type | Auto-Actions |
|---|---|
| Worksheet / Handout | Ingest into subject knowledge base, generate practice exercises |
| Exam Schedule | Update calendar, trigger exam-prep mode for affected subjects |
| Graded Exam | Extract scores, update analytics, Advisor generates post-exam analysis |
| Report Card | Update all subject scores, trigger comprehensive plan review |
| School Notification | Classify (schedule change / event / policy), update relevant systems |
| Textbook Chapter | OCR + chunk + embed into subject vector store |
| Reading Assignment | Add to subject queue, track completion |

---

## 10. Gamification & Engagement

> Keeping kids engaged is as important as the content itself.

### 10.1 Core Mechanics

- **XP & Levels:** Earn experience points for session attendance, homework completion, quiz scores.
- **Streaks:** Daily study streak counter with rewards at milestones (7-day, 30-day, 100-day).
- **Badges:** Achievement badges for concept mastery, perfect quiz scores, consistency.
- **Challenges:** Weekly challenges ("Master 10 new vocabulary words," "Complete 5 practice problems in under 20 minutes").
- **Leaderboard:** Optional, anonymized, cohort-based leaderboard for competitive motivation.
- **Adaptive Difficulty Curve:** Game-like difficulty progression to maintain flow state — not too easy, not too hard.

### 10.2 AI-Proposed Reward System

The Advisor agent designs a personalized reward structure for each learner, which the parent reviews and controls.

#### Reward Lifecycle

```
Advisor Analyzes Learner Profile
  (age, interests, performance history, engagement patterns)
        │
        ▼
Advisor Proposes Reward Plan
  • Milestone definitions (what earns a reward)
  • Suggested rewards (age-appropriate, interest-matched)
  • Difficulty calibration (achievable but challenging)
        │
        ▼
Parent Reviews Proposal
  ├── Approve as-is
  ├── Modify milestones or rewards
  ├── Add custom rewards ("ice cream trip," "new book," "$5 allowance")
  └── Set budget caps / frequency limits
        │
        ▼
Reward Plan Activated
  • Learner sees progress toward next reward
  • Advisor tracks and celebrates incremental progress
  • Parent notified when reward is earned
        │
        ▼
Reward Earned → Parent Confirms Fulfillment
  • Parent marks reward as delivered
  • Advisor congratulates learner
  • Next reward tier unlocked
```

#### Reward Types

| Category | Examples | Notes |
|---|---|---|
| **Virtual** | Custom avatar items, profile themes, title unlocks | In-platform, no parent cost |
| **Screen Time** | "30 min extra gaming" tokens | Parent defines screen-time value |
| **Monetary** | Allowance increments, savings goals | Parent sets amounts; Advisor tracks toward savings targets (e.g., "saving for a bicycle") |
| **Experiences** | "Movie night," "park trip," "choose dinner" | Advisor suggests based on age; parent customizes |
| **Physical Gifts** | Books, toys, gadgets | Advisor proposes wishlist-style; parent picks what's appropriate |
| **Privilege** | "Stay up 30 min late," "pick weekend activity" | Age-appropriate suggestions |
| **Charitable** | "Donate $X to a cause you choose" | Teaches generosity as a reward option |

#### Advisor Intelligence

- **Personalized Suggestions:** Advisor learns from the learner's age, expressed interests (from conversations), and what rewards drive the most engagement.
- **Escalating Tiers:** Rewards scale with difficulty — small rewards for daily consistency, bigger rewards for major milestones (e.g., "improve Math grade by one full letter").
- **Anti-Gaming:** Advisor detects and prevents reward farming (e.g., deliberately failing quizzes to retake them for easy XP).
- **Refresh Cycle:** Advisor proposes updated reward plans monthly (or when engagement drops), always subject to parent approval.
- **Sibling Fairness:** When multiple children are enrolled, Advisor balances reward structures to avoid perceived unfairness while respecting individual performance.

---

## 11. Safety & Privacy

- **Parental Controls:** Parent has full visibility and control over child's interactions.
- **Content Filtering:** All AI-generated content filtered for age-appropriateness.
- **Data Isolation:** Each family's data is strictly isolated (multi-tenant).
- **COPPA / GDPR Compliance:** Under-13 accounts managed exclusively through parent; full data portability and deletion rights.
- **Session Monitoring:** Parent can review all chat transcripts and session recordings.
- **Channel Restrictions:** Parent configures which channels the child can use.
- **AI Guardrails:** Tutor agents strictly scoped to educational content — no off-topic conversations.
- **Emergency Escalation:** If a learner expresses distress or concerning content, the system flags and notifies the parent **immediately via instant messaging** (WhatsApp / preferred IM channel). Email is never used for urgent escalation.
- **Co-Parent Access:** Both parents can be linked to a child's account with equal visibility. Changes to settings require primary account holder approval.

---

## 12. Future Considerations (Out of Scope — V1)

> Architecture must be designed to support these from day one, even though they won't be built in V1.

| Feature | Target | Notes |
|---|---|---|
| **Institutional / School Accounts** | V2–V3 | SaaS multi-school deployment with teacher-admin dashboards, bulk student onboarding, district-level analytics. **Must also support on-premise deployment** for schools that require data sovereignty. |
| **University Self-Managed Accounts** | V2 | Students manage their own accounts, upload course materials, no parent oversight. |
| **French & German Curriculum** | V2 | Expand beyond American Diploma + IGCSE to Baccalauréat and Abitur tracks. |
| **Animated AI Avatar** | V2 | Web UI tutor with realistic, lip-synced animated avatar replacing static image. |
| **Human Tutor Marketplace** | V3 | AI escalates to human tutors for complex cases. Marketplace for certified tutors. |
| **Peer Tutoring** | V3 | Matching advanced students with those who need help (supervised by AI). |
| **Parent Community** | V2 | Forum / chat for parents to share experiences, tips. |
| **Multi-Language Tutoring** | V2 | Tutor agents conducting sessions in Arabic (or learner's native language). |
| **Accessibility** | V2 | Screen reader support, dyslexia-friendly modes. |
| **Offline Mode** | V3 | Downloaded materials and cached sessions for poor connectivity areas. |
| **AR/VR Integration** | V3+ | Immersive learning experiences for science labs, geography exploration. |
| **Marketplace** | V3 | Third-party curriculum packs, specialized tutor agent plugins. |
| **White-Label** | V3 | Schools and tutoring companies deploying their own branded instance. |

---

## 13. Success Metrics

| Metric | Target |
|---|---|
| **Study Plan Adherence** | ≥ 80% of scheduled sessions completed per week |
| **Score Improvement** | Measurable improvement in exam scores within 2 months of onboarding |
| **Engagement Rate** | ≥ 5 interactions/day per active learner across all channels |
| **Parent Satisfaction** | ≥ 4.5/5 on progress report usefulness |
| **Document Processing** | < 5 min from forwarding to ingestion confirmation |
| **Session Quality** | ≥ 4/5 post-session learner rating |
| **Retention** | ≥ 85% monthly active learner retention |
| **Channel Adoption** | ≥ 70% of parents using at least 2 communication channels |
| **Mastery Confirmation** | ≥ 90% of "mastered" concepts confirmed via spaced variation testing |
| **Daily Practice Compliance** | ≥ 75% of learners completing daily exercise quotas |

---

## 14. Monetization Model

### Subscription Tiers

| Tier | Subjects | Price Model | Notes |
|---|---|---|---|
| **Free Trial** | 1 subject | 7 days | Full feature access, single subject. Converts to paid or downgrades. |
| **Starter** | 1 subject | Monthly | Single subject focus — good for exam prep sprints (e.g., "Math only for SAT"). |
| **Standard** | 3 subjects | Monthly | Most popular for balanced study plans. |
| **Premium** | Unlimited subjects | Monthly | Full curriculum coverage. Priority session scheduling. |
| **Family** | Unlimited subjects, multiple children | Monthly | Discount per additional child. Unified family billing. |

### Included in All Paid Tiers

- Unlimited AI tutoring sessions (live + async)
- Full dashboard & analytics
- WhatsApp + Email integration
- Document forwarding & auto-ingestion
- Study plan generation & progress reporting
- Reward system

### Premium Add-Ons (Future)

- Additional meeting platform integrations (Teams, Discord)
- Extended session recording storage
- Advanced analytics & predictive insights
- Priority ingestion for uploaded documents

---

## Appendix A: User Journey Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PARENT JOURNEY                                      │
│                                                                             │
│  Sign Up ──▶ Link Channels ──▶ Add Child ──▶ Upload Materials               │
│                                                     │                       │
│                                              ┌──────┴──────┐               │
│                                              ▼              ▼               │
│                                        Ingestion     Advisor Proposes       │
│                                        Complete      Study Plan             │
│                                              │              │               │
│                                              └──────┬──────┘               │
│                                                     ▼                       │
│                                              Parent Approves Plan           │
│                                                     │                       │
│                                                     ▼                       │
│  ┌──── Ongoing Loop ────────────────────────────────────────────────┐       │
│  │                                                                  │       │
│  │  Forward Docs ──▶ Auto-Ingest ──▶ Plan Updates                   │       │
│  │  View Dashboard ──▶ Check Progress ──▶ Adjust Focus              │       │
│  │  Receive Reports ──▶ Review ──▶ Act on Recommendations           │       │
│  │                                                                  │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         LEARNER JOURNEY                                     │
│                                                                             │
│  Receive Schedule ──▶ Join Session ──▶ Learn & Practice                     │
│        │                    │                │                               │
│        ▼                    ▼                ▼                               │
│  Check Today's      Live Explain      Complete Homework                     │
│  Plan via Chat      with Tutor        & Submit                              │
│        │                    │                │                               │
│        ▼                    ▼                ▼                               │
│  Flash Review       Take Quiz         Get Feedback                          │
│  (WhatsApp/Snap)    (Web/Chat)        (Instant)                             │
│        │                    │                │                               │
│        └────────────┬───────┴────────────────┘                              │
│                     ▼                                                       │
│              Earn XP / Badges ──▶ Level Up ──▶ Stay Motivated               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix B: Agent Interaction Model

```
                          ┌─────────────────────┐
                          │   Academic Advisor   │
                          │   (Orchestrator)     │
                          └────────┬────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
              ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
              │ Math Tutor │ │ Sci Tutor │ │ Eng Tutor │  ...N subjects
              └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
                    │              │              │
              ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
              │  Math RAG  │ │  Sci RAG  │ │  Eng RAG  │
              │  + Graph   │ │  + Graph  │ │  + Graph  │
              └────────────┘ └───────────┘ └───────────┘
                    │              │              │
                    └──────────────┼──────────────┘
                                   │
                          ┌────────▼────────┐
                          │  Shared Concept  │
                          │  Knowledge Graph │
                          └─────────────────┘
```

---

## 15. Brand Name: **Aura** (أورا)

> The brand name **is** the platform's identity. The AI ecosystem is called **Aura**. Kids open Aura on their tablet. Parents check Aura for progress. But kids don't talk to "Aura" directly — they talk to their **tutor personas** by name: *"Kai, explain fractions to me."* *"Nova, quiz me on photosynthesis."*

### Why Aura

- **Gen-Z Appeal:** Sounds modern, clean, and abstract — in the same category as Gemini, Claude, and Jasper. No forced meaning, just a cool-sounding name.
- **Universal Pronunciation:** Works effortlessly in Arabic (أورا) and English. No transliteration friction.
- **Connotation:** An "aura" suggests a surrounding presence, intelligence, and energy — fitting for an AI that wraps around a student's entire educational experience.
- **Not a Person:** Unlike persona names (Kai, Nova, Sage), "Aura" is the platform umbrella — it doesn't compete with the tutor characters. *"Open Aura → talk to Kai."*
- **Brand Flexibility:** Works as app name, domain, and conversational reference: *"Did you check Aura?"*, *"Aura says you should focus on Math this week."*
- **Domain Candidates:** aura.ai, getaura.ai, aura.app, auratutor.com

### Brand Hierarchy

```
Aura (Platform / App)
  │
  ├── Academic Advisor ("Your Aura Advisor")
  │
  └── Subject Tutor Personas
        ├── Kai (Math)
        ├── Nova (Science)
        ├── Sage (English)
        ├── Atlas (Social Studies)
        └── Reem (Arabic)
```

**Parent says:** *"Check Aura for the weekly report."*  
**Kid says:** *"Kai, I don't get this problem."* / *"Nova, quiz me."*  
**Both say:** *"Open Aura."*

---

> **Next Steps:** Once this feature vision is reviewed and refined, we proceed to technical evaluation — architecture, stack selection, integration feasibility, and implementation phasing.
