checklist/update — Update existing live task checklist message in-place.

Edits checklist message with latest step statuses. Auto-unpins and sends "✅ Complete" reply when all steps reach terminal status.
Use send(type: "checklist") (standalone tool) to create the initial checklist and get message_id.

## Params
token: session token (required)
title: bold heading for checklist (required; must match original heading)
steps: ordered step list (required; min 1 step)
  Each step: { label: string, status: StepStatus, detail?: string }
  Status values: pending | running | done | failed | skipped
message_id: ID of checklist message to update (required; from send(type: "checklist"))

## Step icons
pending ⬜ · running 🔄 · done ✅ · failed ⛔ · skipped ⏭️

## Example
action(type: "checklist/update", token: 3165424,
  title: "Deploy: api-service",
  message_id: 42,
  steps: [
    { label: "Build", status: "done" },
    { label: "Tests", status: "running", detail: "3/12 passed" },
    { label: "Deploy", status: "pending" }
  ])
→ { message_id: 42, updated: true }

## Pattern
1. send(type: "checklist")(title: "...", steps: [...], token: ...) → { message_id: 42 }
2. action(type: "checklist/update", ..., message_id: 42, steps: [...updated...])
3. Repeat step 2 as task progresses

Full guide: help(topic: 'checklist')

Related: progress/update, message/edit, message/pin