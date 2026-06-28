# Task 10-3057 — Child SSE Isolation (corrected direction)

**Status: ACTIVE**

Fix: suppress `notifySession` and `notifyChannelSubscriber` calls in `deliverChildNotifyEvent`
so parent SSE/channel is NOT fired when child calls child/notify tool.
