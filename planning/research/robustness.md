# Research R3 — self-healing and adversarial bug review

Status: draft in progress (sections are filled as the checks finish).
Base: `m75-source-breaker` at `ab42e11` (the 2.2.0 candidate). Branch: `claude/r3-robustness-e26toj`.

## Schedule maths across midnight and daylight saving time (draft)

Probe tests live outside the repo history (see the appendix); they run against the real exported functions.

- P1/P2 conflict check across midnight: misses a real overlap, flags a non-overlap (U21 of the 2026-09-02 audit, still present).
- P3 Twitch schedule sync posts a carry-over occurrence as a second segment one day late.
- P10 cuepoints of a block that runs past midnight fire again after midnight.
- P9 an unusable `CHANNEL_TIMEZONE` from the environment throws inside every schedule read.
- P4-P8 daylight saving behaviour.
