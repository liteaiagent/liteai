# Thinking Loop Detection: Analysis & Design Alternatives

## Root Cause: Two Completely Different Problems

The trace from `trace.json:L264` reveals **two independent issues** masquerading as one:

---

### Problem 1: The 40K Character Cap Is Irrelevant Here

The thinking content in the trace is only **~6,000 characters**. The model thinks in a loop for ~19 paragraphs, then stops and emits tool calls. On the next turn, it loops again.

- **Current runaway cap**: 400 chunks × 100 chars = **40,000 characters**
- **Actual loop content per turn**: ~6,000 characters
- **The cap never fires** because each turn's thinking is individually short

### Problem 2: Hash-Based Detection Fails on Semantic Loops

The model paraphrases the same idea each paragraph:

```
"Fixating on `Edit`" → "Recursing into the Details" → "Fixating, then looping"
→ "Forever Editting HTML" → "Stuck in an Infinite Loop" → "Trapped in `Edit`"
```

Every 100-character chunk is lexically unique — different word choices, different sentence structure. **SHA-256 hashes never collide**. The hash-based detector sees pure novelty where a human sees obvious repetition.

---

## Addressing the Original Question: Is 40K Right for Big Models?

| Model | Typical thinking output | 40K chars equivalent |
|-------|------------------------|---------------------|
| Claude Opus 4 | 8K–60K tokens → 32K–240K chars | ❌ Way too short |
| Gemini 2.5 Pro | 8K–32K tokens → 32K–128K chars | ❌ Too short |
| Claude Sonnet 4 | 4K–16K tokens → 16K–64K chars | ⚠️ Marginal |
| Gemini 3 Flash | 2K–8K tokens → 8K–32K chars | ✅ Probably fine |

> [!IMPORTANT]
> **The 40K cap will kill legitimate deep reasoning from Opus and Gemini Pro.** Those models regularly produce 20K-50K tokens of thinking on complex coding tasks (80K-200K characters).

**Recommendation**: Raise the runaway cap to **200,000 characters (2000 chunks)**. This is ~50K tokens — generous enough for all models, while still catching truly pathological runaway cases. Make it configurable via `LITEAI_THINKING_CAP` env flag.

---

## Design Alternatives for Semantic Loop Detection

The real fix needs a new detection layer that catches **paraphrased repetition**. Three alternatives evaluated:

---

### Alternative A: Vocabulary Saturation Detector

**Pattern**: Information Theory / Entropy Analysis

**How it works**:
1. Tokenize the thinking stream into words (split on whitespace + punctuation)
2. Track the set of **unique words** seen so far
3. Compute the **new word rate**: `(new unique words in window) / (total words in window)`
4. If the new word rate drops below a threshold (e.g., < 3% new words over the last 500 words), flag it

**Why it works for this trace**: The ~6K chars of loop content use roughly the same 20 core words: `Edit`, `HTML`, `loop`, `fix`, `focus`, `tool`, `file`, `task`, `stuck`, `infinite`, `cycle`, `using`, `priority`, etc. A genuine thinking process would introduce new concepts, function names, file paths, and technical terms continuously.

| Dimension | Rating |
|-----------|--------|
| **Complexity** | 🟢 Very low — just a `Set<string>` + counter |
| **Memory** | 🟢 O(unique words) ≈ negligible |
| **CPU** | 🟢 String split + Set lookup |
| **False positive risk** | 🟡 Medium — some legitimate detailed reasoning can have low vocabulary diversity (e.g., deep math reasoning) |
| **False negative risk** | 🟢 Low — paraphrased loops inherently reuse vocabulary |

---

### Alternative B: Compression Ratio Detector

**Pattern**: Kolmogorov Complexity Approximation

**How it works**:
1. Buffer the last N characters of thinking (e.g., 2000 chars)
2. Periodically compress the buffer using `zlib.deflateSync(buffer)`
3. Compute `ratio = compressed.length / original.length`
4. If ratio < threshold (e.g., < 0.35), the content is highly repetitive → flag it

**Why it works**: Repetitive content — even paraphrased — compresses dramatically better than diverse content. The recurring vocabulary, sentence patterns, and phrases create highly compressible patterns.

| Dimension | Rating |
|-----------|--------|
| **Complexity** | 🟢 Low — single zlib call |
| **Memory** | 🟢 Fixed 2KB buffer |
| **CPU** | 🟡 Moderate — zlib compression every N chunks |
| **False positive risk** | 🟢 Low — diverse thinking compresses poorly |
| **False negative risk** | 🟡 Medium — if the model uses very diverse paraphrasing, compression ratio stays high |

---

### Alternative C: Sliding Window Cosine Similarity (Bag of Words)

**Pattern**: NLP Similarity / Vector Space Model

**How it works**:
1. Divide thinking stream into paragraph-sized windows (~500 chars each)
2. Convert each window into a word frequency vector (bag of words)
3. Compute cosine similarity between the current window and the previous N windows
4. If average cosine similarity exceeds threshold (e.g., > 0.85 for ≥ 4 consecutive windows), flag it

| Dimension | Rating |
|-----------|--------|
| **Complexity** | 🟡 Moderate — vector math |
| **Memory** | 🟡 Moderate — store N frequency vectors |
| **CPU** | 🟡 Moderate — vector operations per window |
| **False positive risk** | 🟢 Low — similarity threshold is tunable |
| **False negative risk** | 🟢 Low — captures semantic similarity well |

---

## Comparative Summary

| Criterion | A: Vocab Saturation | B: Compression | C: Cosine Similarity |
|-----------|:-------------------:|:--------------:|:--------------------:|
| Implementation effort | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| Runtime overhead | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ |
| Detection accuracy | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| False positive safety | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |

## Recommended Approach: Hybrid A + B

Use **Vocabulary Saturation (A)** as the primary fast-path detector with **Compression Ratio (B)** as a confirmation step:

1. Track new word rate continuously (near-zero cost)
2. When vocabulary saturates (< 3% new words over 500-word window), trigger a compression check
3. If compression ratio also < 0.35, confirm as semantic loop
4. This two-stage approach minimizes false positives while keeping overhead negligible

---

## Proposed Changes

1. **`thinking-loop-detector.ts`**: 
   - Increase runaway cap from 400 to 2000 chunks (40K → 200K characters)
   - Make configurable via `Flag.LITEAI_THINKING_CAP`
   - Add vocabulary saturation tracking (inline with existing `addReasoningDelta`)
   - Add zlib compression confirmation step

2. **`loop-detection.ts`**: Wire the new semantic detection result through existing `LoopType.THINKING_LOOP`

> [!WARNING]
> **Decision required**: The hybrid approach (A+B) has zero architectural downside over any single alternative. However, the specific thresholds (3% new word rate, 0.35 compression ratio, 500-word window) will need empirical tuning against real traces. Should I proceed with the hybrid, or do you prefer a different combination?
