Log — Local session log management (governor-only routes).

Routes:
- log/debug — read server debug trace log; toggle debug mode
- log/get — read log file by filename
- log/list — list all archived log files
- log/roll — rotate/archive current log
- log/delete — delete archived log file

action(type: "log") — lists sub-paths in live API.

All log routes are governor-only. Log content never transits Telegram.
See also: logging/toggle — enable/disable session logging (available to all sessions).

Related: logging/toggle, log/debug
