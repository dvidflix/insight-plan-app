# SF-003 Steel fixing duration (12 men, 2 shifts)

## Inputs

| Input | Value | Unit |
|---|---|---|
| Rebar quantity (example) | 100 | t |
| Steel fixers | 12 | men |
| Shifts | 2 | shifts |
| Working hours per day | 9.17 | h |
| Productivity | 75 | Mh/t |

## Calculations

| # | Step | Formula | Result |
|---|---|---|---|
| 1 | Man-hours needed | Quantity × Productivity = 100 × 75 | 7,500 Mh |
| 2 | Gang hours per day | Fixers × Shifts × Hours per day = 12 × 2 × 9.17 | 220 Mh/day |
| 3 | Duration | Man-hours ÷ Gang hours per day = 7,500 ÷ 220 | 34.1 days |
| 4 | Days per tonne | Productivity ÷ Gang hours per day = 75 ÷ 220 | 0.341 days/t |

## Summary

| Duration for 100 t | Days per tonne |
|---|---|
| **34.1 days** | **0.341 days/t** |

## Programme field

Calculated column **Computed duration (days)**, unit `days`, 2 decimals, in Programmes › Columns › Calculated columns › + New:

```
[Rebar (t) (units)] * 75 / (12 * 2 * 9.17)
```

It gives each activity's duration from its rebar quantity, using this page's rate and crew. For another crew (e.g. SF-002, 7 men, 1 shift) change `12 * 2` to the men × shifts of that page and name the column to match.

A second column, **Computed duration (days, rounded up)**, rounds this up to whole days (`CEIL(x, 1)`), as programme durations are planned in whole days:

```
CEIL([Rebar (t) (units)] * 75 / (12 * 2 * 9.17), 1)
```
