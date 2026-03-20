# [Unreleased]

## Added

- Added debug log lines in `cascade()` and `updateDisplay()` to make cascade events visible in stderr output

## Changed

- Session approval dialog highlights the agent's preferred color with `primary` button style

## Fixed

- Regression-tested cascade-after-text-promotion: buried animation resumes correctly after higher-priority animation is consumed by `beforeTextSend`; added 3 new unit tests
