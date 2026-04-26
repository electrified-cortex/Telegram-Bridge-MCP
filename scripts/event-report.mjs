#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function parseArgs(argv) {
  const opts = { window: 24, agent: null, kind: null, format: 'text' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else if (a === '--window' && argv[i + 1] != null) {
      const v = Number(argv[++i]);
      if (!isNaN(v) && v > 0) {
        opts.window = v;
      } else {
        process.stderr.write('[event-report] warning: invalid --window value, using default 24 hours\n');
      }
    } else if (a === '--agent' && argv[i + 1] != null) {
      opts.agent = argv[++i];
    } else if (a === '--kind' && argv[i + 1] != null) {
      opts.kind = argv[++i];
    } else if (a === '--format' && argv[i + 1] != null) {
      const v = argv[++i];
      if (v === 'json' || v === 'text') {
        opts.format = v;
      } else {
        process.stderr.write("[event-report] warning: unrecognised format value, using 'text'\n");
      }
    }
    // unknown flags: silently ignored (forward-compatible)
  }
  return opts;
}

function printUsage() {
  console.log(
    'Usage: event-report.mjs [--window <hours>] [--agent <name>] [--kind <name>] [--format json|text]\n' +
    '\n' +
    '  --window <hours>   Filter events to last N hours (default: 24)\n' +
    '  --agent  <name>    Filter to events from this actor_name\n' +
    '  --kind   <name>    Filter to this event kind only\n' +
    '  --format json|text Output format (default: text)\n'
  );
}

// ---------------------------------------------------------------------------
// Log path resolution
// ---------------------------------------------------------------------------

function resolveLogPath() {
  if (process.env.TMCP_DATA_DIR) {
    const p = resolve(process.env.TMCP_DATA_DIR, 'events.ndjson');
    if (!existsSync(p)) {
      process.stderr.write(`[event-report] warning: TMCP_DATA_DIR is set but events.ndjson not found at ${p}\n`);
    }
    return p;
  }
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  return resolve(scriptDir, '..', 'data', 'events.ndjson');
}

// ---------------------------------------------------------------------------
// NDJSON parsing
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB
const TAIL_LINES = 10_000;

function readEvents(logPath) {
  if (!existsSync(logPath)) return [];

  // File size guard
  const stat = statSync(logPath);
  let raw;
  if (stat.size > MAX_FILE_BYTES) {
    process.stderr.write(
      `[event-report] warning: events.ndjson exceeds 100 MB (${(stat.size / 1024 / 1024).toFixed(1)} MB) — reading last ${TAIL_LINES} lines only\n`
    );
    const fullRaw = readFileSync(logPath, 'utf8');
    const allLines = fullRaw.split(/\r?\n/);
    raw = allLines.slice(-TAIL_LINES).join('\n').trim();
  } else {
    raw = readFileSync(logPath, 'utf8').trim();
  }

  if (!raw) return [];
  const events = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines silently
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function filterEvents(events, opts, now) {
  const cutoff = now - opts.window * 60 * 60 * 1000;
  return events.filter(ev => {
    const ts = new Date(ev.timestamp).getTime();
    if (isNaN(ts) || ts < cutoff) return false;
    if (opts.agent && ev.actor_name !== opts.agent) return false;
    if (opts.kind && ev.kind !== opts.kind) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Pairing logic
// ---------------------------------------------------------------------------

// Maps start-side kind -> complete-side kind
const PAIRED_KINDS = {
  compacting: 'compacted',
  shutdown_warn: 'shutdown_complete',
};

// Reverse map: complete-side kind -> start-side kind
const COMPLETE_TO_START = Object.fromEntries(
  Object.entries(PAIRED_KINDS).map(([start, complete]) => [complete, start])
);

// Label used in output for each start kind
const PAIR_LABEL = {
  compacting: 'compactions',
  shutdown_warn: 'shutdowns',
};

// Returns { agentStats, otherKinds }
// agentStats: Map<actor_name, { pairStats: Map<label, { count, durations[], unpaired, clock_skew, lastTs }> }>
// otherKinds: Map<kind, count>
function analyzeEvents(filtered, allEvents) {
  // Build lookups for complete-side events (across all events, not just window)
  // key: `${actor_sid}:${run_id}` => event
  const completeLookups = {}; // startKind -> Map
  for (const startKind of Object.keys(PAIRED_KINDS)) {
    completeLookups[startKind] = new Map();
  }

  // Build lookups for start-side events (across all events) for backward-pairing
  const startLookups = {}; // startKind -> Map
  for (const startKind of Object.keys(PAIRED_KINDS)) {
    startLookups[startKind] = new Map();
  }

  for (const ev of allEvents) {
    const completeKind = ev.kind;
    const startKind = COMPLETE_TO_START[completeKind];
    if (startKind) {
      const runId = ev.details?.run_id;
      if (runId != null) {
        const key = `${ev.actor_sid}:${runId}`;
        if (!completeLookups[startKind].has(key)) {
          completeLookups[startKind].set(key, ev);
        }
      }
    }
    if (PAIRED_KINDS[ev.kind]) {
      const runId = ev.details?.run_id;
      if (runId != null) {
        const key = `${ev.actor_sid}:${runId}`;
        if (!startLookups[ev.kind].has(key)) {
          startLookups[ev.kind].set(key, ev);
        }
      }
    }
  }

  const agentStats = new Map(); // actor_name => { pairStats: Map<label, stats> }
  const otherKinds = new Map(); // kind => count

  function getAgentPairStat(name, label) {
    if (!agentStats.has(name)) {
      agentStats.set(name, { pairStats: new Map() });
    }
    const agent = agentStats.get(name);
    if (!agent.pairStats.has(label)) {
      agent.pairStats.set(label, { count: 0, durations: [], unpaired: 0, clock_skew: 0, lastTs: -Infinity });
    }
    return agent.pairStats.get(label);
  }

  for (const ev of filtered) {
    const kind = ev.kind;
    const startKind = kind; // if this is a start-side kind
    const completeSideStart = COMPLETE_TO_START[kind]; // set if this is a complete-side kind

    if (PAIRED_KINDS[startKind]) {
      // Forward-paired: ev is the start event
      const label = PAIR_LABEL[startKind];
      const name = ev.actor_name;
      const stat = getAgentPairStat(name, label);
      stat.count++;

      const ts = new Date(ev.timestamp).getTime();
      if (!isNaN(ts) && ts > stat.lastTs) stat.lastTs = ts;

      const runId = ev.details?.run_id;
      if (runId != null) {
        const key = `${ev.actor_sid}:${runId}`;
        const completeKind = PAIRED_KINDS[startKind];
        const paired = completeLookups[startKind].get(key);
        if (paired) {
          const startMs = new Date(ev.timestamp).getTime();
          const endMs = new Date(paired.timestamp).getTime();
          if (!isNaN(startMs) && !isNaN(endMs)) {
            if (endMs >= startMs) {
              stat.durations.push(endMs - startMs);
            } else {
              // Clock skew — inverted timestamps
              stat.clock_skew++;
            }
          } else {
            stat.unpaired++;
          }
        } else {
          stat.unpaired++;
        }
      } else {
        // No run_id — no pairing possible
        stat.unpaired++;
      }
      continue;
    }

    if (completeSideStart) {
      // Backward-paired: ev is the complete event — look up the matching start
      const label = PAIR_LABEL[completeSideStart];
      const name = ev.actor_name;
      const stat = getAgentPairStat(name, label);
      stat.count++;

      const runId = ev.details?.run_id;
      if (runId != null) {
        const key = `${ev.actor_sid}:${runId}`;
        const startEv = startLookups[completeSideStart].get(key);
        if (startEv) {
          const startMs = new Date(startEv.timestamp).getTime();
          const endMs = new Date(ev.timestamp).getTime();
          if (!isNaN(startMs) && !isNaN(endMs)) {
            if (endMs >= startMs) {
              stat.durations.push(endMs - startMs);
              if (startMs > stat.lastTs) stat.lastTs = startMs;
            } else {
              stat.clock_skew++;
            }
          } else {
            stat.unpaired++;
          }
        } else {
          stat.unpaired++;
        }
      } else {
        stat.unpaired++;
      }
      continue;
    }

    // All other kinds
    otherKinds.set(kind, (otherKinds.get(kind) ?? 0) + 1);
  }

  return { agentStats, otherKinds };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtDuration(ms) {
  return (ms / 1000).toFixed(1) + 's';
}

function fmtAgo(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function max(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => (a > b ? a : b));
}

// ---------------------------------------------------------------------------
// Text output
// ---------------------------------------------------------------------------

function renderText(opts, agentStats, otherKinds, now) {
  const lines = [];
  lines.push(`Window: last ${opts.window} hour${opts.window === 1 ? '' : 's'}`);

  const hasAgents = agentStats.size > 0;
  const hasOther = otherKinds.size > 0;

  if (!hasAgents && !hasOther) {
    lines.push('');
    lines.push('No events in window.');
    console.log(lines.join('\n'));
    return;
  }

  if (hasAgents) {
    lines.push('');
    lines.push('Per agent:');

    // Sort agents alphabetically for stable output
    const sortedAgents = [...agentStats.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    // Determine label width for alignment
    const maxNameLen = sortedAgents.reduce((a, [name]) => (name.length > a ? name.length : a), 0);

    for (const [name, agent] of sortedAgents) {
      const label = (name + ':').padEnd(maxNameLen + 1);

      // Emit compactions line (always if present)
      const compStat = agent.pairStats.get('compactions');
      if (compStat) {
        let parts = [`compactions=${compStat.count}`];
        const avgMs = avg(compStat.durations);
        const maxMs = max(compStat.durations);
        if (avgMs !== null) {
          parts.push(`avg_duration=${fmtDuration(avgMs)}`);
          parts.push(`longest=${fmtDuration(maxMs)}`);
        }
        if (compStat.lastTs > -Infinity) {
          parts.push(`last=${fmtAgo(now - compStat.lastTs)}`);
        }
        let line = `  ${label}  ${parts.join('  ')}`;
        if (compStat.unpaired > 0) {
          line += `  (${compStat.unpaired} unpaired — duration N/A for those)`;
        }
        if (compStat.clock_skew > 0) {
          line += `  (${compStat.clock_skew} clock-skew pairs — duration N/A)`;
        }
        lines.push(line);
      }

      // Emit shutdowns line (only if N > 0)
      const shutStat = agent.pairStats.get('shutdowns');
      if (shutStat && shutStat.count > 0) {
        let parts = [`shutdowns=${shutStat.count}`];
        const avgMs = avg(shutStat.durations);
        const maxMs = max(shutStat.durations);
        if (avgMs !== null) {
          parts.push(`avg_duration=${fmtDuration(avgMs)}`);
          parts.push(`longest=${fmtDuration(maxMs)}`);
        }
        if (shutStat.lastTs > -Infinity) {
          parts.push(`last=${fmtAgo(now - shutStat.lastTs)}`);
        }
        let line = `  ${label}  ${parts.join('  ')}`;
        if (shutStat.unpaired > 0) {
          line += `  (${shutStat.unpaired} unpaired — duration N/A for those)`;
        }
        if (shutStat.clock_skew > 0) {
          line += `  (${shutStat.clock_skew} clock-skew pairs — duration N/A)`;
        }
        lines.push(line);
      }
    }
  }

  if (hasOther) {
    lines.push('');
    lines.push('Other event kinds (counts only):');
    const sortedKinds = [...otherKinds.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const kindStrs = sortedKinds.map(([k, v]) => `${k}: ${v}`);
    lines.push('  ' + kindStrs.join('   '));
  }

  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

function renderJson(opts, agentStats, otherKinds, now) {
  const agents = {};
  for (const [name, agent] of agentStats.entries()) {
    const compStat = agent.pairStats.get('compactions');
    const shutStat = agent.pairStats.get('shutdowns');

    const entry = {};

    if (compStat) {
      const avgMs = avg(compStat.durations);
      const maxMs = max(compStat.durations);
      entry.compactions = compStat.count;
      entry.compactions_paired_count = compStat.durations.length;
      entry.compactions_unpaired_count = compStat.unpaired;
      entry.compactions_clock_skew_count = compStat.clock_skew;
      entry.compactions_avg_duration_ms = avgMs !== null ? Math.round(avgMs) : null;
      entry.compactions_longest_ms = maxMs !== null ? maxMs : null;
      entry.last_compaction_ms_ago = compStat.lastTs > -Infinity ? now - compStat.lastTs : null;
    }

    if (shutStat) {
      const avgMs = avg(shutStat.durations);
      const maxMs = max(shutStat.durations);
      entry.shutdowns = shutStat.count;
      entry.shutdowns_paired_count = shutStat.durations.length;
      entry.shutdowns_unpaired_count = shutStat.unpaired;
      entry.shutdowns_clock_skew_count = shutStat.clock_skew;
      entry.shutdowns_avg_duration_ms = avgMs !== null ? Math.round(avgMs) : null;
      entry.shutdowns_longest_ms = maxMs !== null ? maxMs : null;
      entry.last_shutdown_ms_ago = shutStat.lastTs > -Infinity ? now - shutStat.lastTs : null;
    }

    agents[name] = entry;
  }

  const other_kinds = {};
  for (const [k, v] of otherKinds.entries()) {
    other_kinds[k] = v;
  }

  const result = {
    window_hours: opts.window,
    generated_at: new Date(now).toISOString(),
    agents,
    other_kinds,
  };

  console.log(JSON.stringify(result, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const opts = parseArgs(args);
const now = Date.now();
const logPath = resolveLogPath();
const allEvents = readEvents(logPath);

if (allEvents.length === 0) {
  if (opts.format === 'json') {
    renderJson(opts, new Map(), new Map(), now);
  } else {
    renderText(opts, new Map(), new Map(), now);
  }
  process.exit(0);
}

const filtered = filterEvents(allEvents, opts, now);

const { agentStats, otherKinds } = analyzeEvents(filtered, allEvents);

if (opts.format === 'json') {
  renderJson(opts, agentStats, otherKinds, now);
} else {
  renderText(opts, agentStats, otherKinds, now);
}
