#!/usr/bin/env node
// Statusline: keeps the existing statusline output, then adds a context bar.
// The bar fills toward the autocompact threshold, not the raw window size, and
// shows used tokens over that threshold, e.g. "ctx [██████░░░░] 98.2k / 167.0k tokens".
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const BAR_WIDTH = 10;
// Tokens Claude Code keeps in reserve before autocompaction triggers.
const AUTOCOMPACT_BUFFER = Number(process.env.AUTOCOMPACT_BUFFER) || 33000;

const raw = fs.readFileSync(0, 'utf8');
let input = {};
try { input = JSON.parse(raw); } catch { /* no usable JSON: render without context */ }

// Existing statusline output, produced by the original command, passed the same stdin.
const original = path.join(__dirname, 'graft-statusline.cjs');
let base = '';
try {
  const r = spawnSync(process.execPath, [original], { input: raw, encoding: 'utf8', timeout: 5000 });
  base = (r.stdout || '').replace(/\n+$/, '');
} catch { /* original unavailable */ }

function contextLine() {
  const cw = input.context_window || {};
  const size = Number(cw.context_window_size) || 200000;
  const u = cw.current_usage;
  let used = null;
  if (u && typeof u === 'object') {
    used = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0);
  } else if (Number.isFinite(Number(cw.total_input_tokens))) {
    used = Number(cw.total_input_tokens);
  }
  if (used === null) return null;

  const max = Math.max(1, size - AUTOCOMPACT_BUFFER);
  const ratio = Math.min(1, used / max);
  const filled = Math.round(ratio * BAR_WIDTH);
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  const pct = Math.round(ratio * 100);
  const k = (n) => (n / 1000).toFixed(1) + 'k';
  return `ctx [${bar}] ${pct}%  ${k(used)} / ${k(max)}`;
}

// Session usage, priced from the transcript, e.g. "↑323k ↓19k R4.2M CH99.8% $0.101 (sub)".
//   ↑  uncached input tokens      ↓  output tokens
//   R  cache-read tokens          CH cache hit = R / (R + ↑ + cache writes)
//   $  API-equivalent cost estimate (prices from the cost skill's prices.json)
// Transcripts are parsed incrementally; per-message totals are cached so each refresh only reads new lines.
const USAGE_LABEL = process.env.USAGE_PLAN_LABEL || '(sub)';
const USAGE_CACHE = path.join(__dirname, '.usage-cache.json');
const PRICES_FILE = path.join(os.homedir(), '.claude', 'skills', 'cost', 'prices.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Adds the complete lines appended to a transcript since the last scan into the cache entry.
function scanTranscript(file) {
  const st = fs.statSync(file);
  const cache = readJson(USAGE_CACHE, {});
  let c = cache[file];
  if (!c || c.offset > st.size) c = { offset: 0, seen: [], totals: {} };
  if (c.offset < st.size) {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(st.size - c.offset);
    fs.readSync(fd, buf, 0, buf.length, c.offset);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl >= 0) {
      const complete = text.slice(0, lastNl);
      c.offset += Buffer.byteLength(text.slice(0, lastNl + 1), 'utf8');
      const seen = new Set(c.seen);
      for (const line of complete.split('\n')) {
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        const m = o && o.message;
        // Streamed messages repeat the same id and usage on several lines; count each id once.
        if (!m || !m.usage || !m.id || !m.model || seen.has(m.id)) continue;
        seen.add(m.id);
        const u = m.usage;
        const t = (c.totals[m.model] = c.totals[m.model] || { input: 0, output: 0, cr: 0, cw5: 0, cw1: 0 });
        const cc = u.cache_creation || {};
        const cw5 = cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null
          ? Number(cc.ephemeral_5m_input_tokens) || 0
          : Number(u.cache_creation_input_tokens) || 0;
        t.input += Number(u.input_tokens) || 0;
        t.output += Number(u.output_tokens) || 0;
        t.cr += Number(u.cache_read_input_tokens) || 0;
        t.cw5 += cw5;
        t.cw1 += Number(cc.ephemeral_1h_input_tokens) || 0;
      }
      c.seen = [...seen];
    }
    cache[file] = c;
    try { fs.writeFileSync(USAGE_CACHE, JSON.stringify(cache)); } catch { /* cache is optional */ }
  }
  return c.totals;
}

// Price for a model id, trying the dated-suffix-stripped name when the exact id is missing.
function priceFor(prices, model) {
  return prices[model] || prices[model.replace(/-\d{8}$/, '')] || null;
}

function usageLine(input) {
  const tp = input.transcript_path;
  if (!tp) return null;
  let totals;
  try { totals = scanTranscript(tp); } catch { return null; }
  const models = Object.keys(totals);
  if (!models.length) return null;

  const prices = readJson(PRICES_FILE, {});
  let inp = 0, out = 0, cr = 0, cw = 0, cost = 0, unpriced = false;
  for (const model of models) {
    const t = totals[model];
    inp += t.input; out += t.output; cr += t.cr; cw += t.cw5 + t.cw1;
    const p = priceFor(prices, model);
    if (!p) { unpriced = true; continue; }
    cost += t.input * (p.input || 0) + t.output * (p.output || 0) + t.cr * (p.cache_read || 0)
      + t.cw5 * (p.cache_write || 0) + t.cw1 * (p.cache_write_1h || p.cache_write || 0);
  }

  const k = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
  const denom = cr + inp + cw;
  const ch = denom > 0 ? (cr / denom * 100).toFixed(1) + '%' : '–';
  const usd = '$' + (cost < 10 ? cost.toFixed(3) : cost.toFixed(2)) + (unpriced ? '?' : '');
  return `↑${k(inp)} ↓${k(out)} R${k(cr)} CH${ch} ${usd} ${USAGE_LABEL}`;
}

// Right-aligned row: model · effort, e.g. "Haiku 5.5 · medium". The effort is colored by level.
const EFFORT_COLORS = {
  low: '32',              // green: cheapest, fastest
  medium: '33',           // yellow
  high: '38;5;208',       // orange
  xhigh: '31',            // red
  max: '1;35',            // bold magenta: most effort
};

function modelLabel(model) {
  if (!model) return null;
  if (model.display_name) return model.display_name;
  // "claude-haiku-5-5" -> "Haiku 5.5"
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(model.id || '');
  if (!m) return model.id || null;
  const family = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return `${family} ${m[2]}${m[3] ? '.' + m[3] : ''}`;
}

function rightSegment(settings) {
  const id = input.model && input.model.id;
  const modelSettings = settings.modelSettings || {};
  const effortRaw = (input.effort && (input.effort.level || input.effort)) ||
    (id && modelSettings[id] && modelSettings[id].effortLevel) || settings.effortLevel || null;
  const effort = typeof effortRaw === 'string' ? effortRaw : null;
  const model = modelLabel(input.model);
  if (!model && !effort) return null;
  const sep = '\x1b[38;5;244m · \x1b[0m';
  const effortText = effort
    ? (EFFORT_COLORS[effort] ? `\x1b[${EFFORT_COLORS[effort]}m${effort}\x1b[0m` : effort)
    : null;
  return [model, effortText].filter(Boolean).join(sep);
}

// Terminal width. The statusline's stdout is a pipe, so ask the terminal of the
// Claude process (an ancestor of this script) with `stty -f /dev/ttysNNN size`.
function ttyOf(pid) {
  try {
    const r = spawnSync('ps', ['-o', 'tty=', '-p', String(pid)], { encoding: 'utf8', timeout: 1000 });
    const tty = (r.stdout || '').trim();
    return tty && tty !== '??' ? tty : null;
  } catch { return null; }
}

function colsOfTty(tty) {
  try {
    const r = spawnSync('stty', ['-f', `/dev/${tty}`, 'size'], { encoding: 'utf8', timeout: 1000 });
    const cols = Number((r.stdout || '').trim().split(/\s+/)[1]);
    return cols > 0 ? cols : null;
  } catch { return null; }
}

function termWidth() {
  if (process.stdout.columns) return process.stdout.columns;
  let pid = process.ppid;
  for (let i = 0; i < 5 && pid > 1; i++) {
    const tty = ttyOf(pid);
    const cols = tty && colsOfTty(tty);
    if (cols) return cols;
    try {
      pid = Number(spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8', timeout: 1000 }).stdout.trim());
    } catch { break; }
  }
  const cols = Number(process.env.COLUMNS);
  return cols > 0 ? cols : 120;
}

const visibleLen = (s) => [...s.replace(/\x1b\[[0-9;]*m/g, '')].length;

// Top row: the right segment alone. The graft status and the rest follow below it.
function rightAligned(right) {
  // One column short of the edge, so the text never wraps onto a second row.
  const pad = termWidth() - 1 - visibleLen(right);
  return ' '.repeat(Math.max(0, pad)) + right;
}

const settings = readJson(path.join(os.homedir(), '.claude', 'settings.json'), {});
const right = rightSegment(settings);
const line = contextLine();
const usage = usageLine(input);
const rows = [base, line, usage].filter(Boolean).join('\n');
const out = (right ? rightAligned(right) + '\n' : '') + rows;
process.stdout.write(out + '\n');
