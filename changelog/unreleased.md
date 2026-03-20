# [Unreleased]

## Added

- Added `/governor` slash command for operator to switch the governor session at runtime; shows all active sessions as inline buttons with current governor marked ✓; notifies all sessions on change; auto-registers/unregisters based on session count
- Added debug log lines in `cascade()` and `updateDisplay()` to make cascade events visible in stderr output

## Changed

- Session approval dialog highlights the agent's preferred color with `primary` button style

## Fixed

- Regression-tested cascade-after-text-promotion: buried animation resumes correctly after higher-priority animation is consumed by `beforeTextSend`
- Added 3 new unit tests for cascade-after-text-promotion behavior
