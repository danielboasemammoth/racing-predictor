# Racing Predictor — AI Model Benchmark

## Purpose
Compare free Nous models on statistics/probability + racing-predictor reasoning.

## Part A: Core Probability & Statistics

### A1: Independent Events
A fair coin is flipped 5 times. What is the probability of getting exactly 3 heads?
Show your work.

### A2: Conditional Probability
In a group of 100 students:
- 60 study Mathematics, 50 study Physics, 30 study both
A student is chosen at random. Given that they study Physics, what is the probability they also study Mathematics?

### A3: Expected Value
A game costs $5 to play. You roll a fair 6-sided die:
- Roll 1-2: win $0
- Roll 3-4: win $10
- Roll 5: win $20
- Roll 6: win $50
Is this game profitable? Show expected value calculation.

### A4: Bayes' Theorem
A disease affects 1% of the population. A test is:
- 95% sensitive (detects disease when present)
- 90% specific (negative when no disease)
If someone tests positive, what is the probability they actually have the disease?

### A5: Combinatorics
How many different 3-horse exacta bets are possible in a race with 12 horses?

---

## Part B: Racing-Predictor Reasoning

### B1: Diagnose Accuracy Plateau
Our horse racing predictor has plateaued at ~43% winner accuracy and ~10% podium accuracy across 113 races. The model uses:
- Form scores with exponential recency decay
- Barrier draw bias by racecourse
- Distance suitability bands (±200m)
- Field size adjustment
- Market odds stacking
- Ensemble consensus mode

Propose 3 specific, testable improvements to break past 43% winner accuracy. For each, explain:
1. What you'd change
2. Why it should help
3. How you'd measure whether it worked

### B2: Feature Selection
We have these potential new data sources:
- Jockey win rate at this track
- Trainer last-14-days strike rate
- Horse's performance on similar track conditions (wet/dry)
- Horse's distance preference vs actual distance
- Barrier position historical win rate by track
- Market odds movement (drifting/steaming)

Rank them by likely impact on prediction accuracy. Justify your ranking with statistical reasoning.

### B3: Statistical Significance
After implementing a new feature, winner accuracy went from 42.5% to 44.2% over 50 races. Is this improvement statistically significant? Show your reasoning using a simple statistical test.

### B4: Calibration
Our model outputs probabilities for each horse. If we predict Horse A at 60% win probability, but Horse A only wins 45% of the time in our predictions, what does this tell us? How would you fix it?

### B5: Data Quality
We notice that 40% of our race entries have missing barrier numbers, and 25% have missing track condition data. What problems could this cause in our model, and how would you handle it?

---

## Scoring Rubric

| Criterion | Points |
|-----------|--------|
| Correct answer (A1-A5) | 2 each |
| Shows work/steps | 1 each |
| B1: Specific, testable improvements | 3 |
| B2: Evidence-based ranking | 2 |
| B3: Correct statistical reasoning | 2 |
| B4: Identifies calibration issue + fix | 2 |
| B5: Identifies data quality problems + solutions | 2 |

**Total: 25 points**

## How to Use
1. Switch to a free Nous model
2. Paste Part A or both parts
3. Record the model's answers
4. Repeat for each model you want to compare
5. Score using rubric above
6. Share results with me for comparison
