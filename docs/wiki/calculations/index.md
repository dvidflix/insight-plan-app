<!-- order: 0 -->
# Calculations

Every calculation has a reference (**SF-nnn** steel fixing, **FWK-nnn** formwork) and the same three blocks: **Inputs**, numbered **Calculations**, **Summary**. The crew size and shifts are in the title, so variations sit side by side.

| Ref | Calculation | Result |
|---|---|---|
| [SF-001](sf-001-steel-fixing.md) | Steel fixing (12 men, 2 shifts) | 17.6 t/week |
| [SF-002](sf-002-steel-fixing.md) | Steel fixing (7 men, 1 shift) | 5.13 t/week |
| [SF-003](sf-003-steel-fixing-duration.md) | Steel fixing duration (12 men, 2 shifts) | 34.1 days per 100 t |
| [FWK-001](fwk-001-formwork.md) | Formwork (14 men, 1 shift) | 23.4 days for 500 m² |

**To add one:** **+ New page**, title `SF-nnn Name (n men, n shifts)` (new activity type: choose a short prefix and add it above), paste the template, add a row above.

````markdown
# SF-nnn Name (n men, n shifts)

## Inputs

| Input | Value | Unit |
|---|---|---|
| ... | ... | ... |

## Calculations

| # | Step | Formula | Result |
|---|---|---|---|
| 1 | ... | A × B = 12 × 55 | 660 unit |

## Summary

| Output 1 | Output 2 |
|---|---|
| **value unit** | **value unit** |
````

Rules: every formula written in words, then with the numbers; one final result per summary column; a variation (other crew size or shifts) is a new page with the next number and the variation in its title.
