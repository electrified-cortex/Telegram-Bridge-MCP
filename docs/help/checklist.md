Checklist Step Statuses

Valid status values for send(type: 'checklist') and action(type: 'checklist/update') steps:

| Status | Meaning |
| --- | --- |
| pending | Not yet started (default — shows ⬜) |
| running | In progress (shows 🔄) |
| done | Completed successfully (shows ✅) |
| failed | Completed with error (shows ⛔) |
| skipped | Intentionally skipped (shows ⏭️) |

Common mistake: using 'in-progress' — not valid. Use 'running'.

Example:
```js
action(type: 'checklist/update', message_id: 123, steps: [
  { label: 'Fetch data', status: 'done' },
  { label: 'Process', status: 'running' },
  { label: 'Save', status: 'pending' }
])
```
