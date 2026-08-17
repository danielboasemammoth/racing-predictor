# AI Model Benchmark Results — Statistics/Probability + Racing Reasoning

Benchmark file: `AI_MODEL_BENCHMARK.md`
Total possible: 25 points (Part A: 10, Part B: 12)

## Results

| Model | Part A (10) | Part B (12) | Total (25) | Notes |
|-------|-------------|-------------|------------|-------|
| meituan/longcat-2.0:free | 10 | 11 | **21** | All math correct, strong structured reasoning |
| tencent/hy3:free | 10 | 11 | **21** | Identical score; deterministic math, similar structure |
| _your next model_ | | | | |

## Detail

### meituan/longcat-2.0:free — 21/25
- A1-A5: 10/10 (all correct, showed work)
- B1: 3/3 — jockey-track form, condition-segmented form, pace simulation
- B2: 2/2 — evidence-based ranking, jockey > barrier > distance > trainer > odds > condition
- B3: 2/2 — correct Z-test, concluded NOT significant, ~400 races needed
- B4: 2/2 — identified overconfidence, Platt/isotonic + temperature fix
- B5: 2/2 — missing-data problems + imputation/flagging solutions

### tencent/hy3:free — 21/25
- A1-A5: 10/10 (all correct, showed work)
- B1: 3/3 — same three improvements as longcat
- B2: 2/2 — identical ranking logic
- B3: 2/2 — same Z-test, same conclusion
- B4: 2/2 — same calibration diagnosis + fix
- B5: 2/2 — same data-quality approach

## Observation
Both free models scored identically on this benchmark. The Part A math is deterministic (no variation possible). Part B reasoning was structurally near-identical — these well-defined problems don't differentiate model quality well. To separate models, we'd need:
- Ambiguous/under-specified problems
- Creative feature ideation with no "textbook" answer
- Trade-off analysis where there's no clear best choice
- Long-context synthesis across the racing-predictor codebase

## How to add a model
1. Switch to the model in Hermes
2. Message "Im on the next model" with the model name
3. I run Part A + Part B, self-score, append to table above
