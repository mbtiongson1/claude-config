#!/usr/bin/env node
// Statusline: keeps the existing statusline output, then adds a context bar.
// The bar fills toward the autocompact threshold, not the raw window size, and
// shows used tokens over that threshold, e.g. "ctx [██████░░░░] 98.2k / 167.0k tokens".
const fs = require('fs');
const path = require('path');
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

const line = contextLine();
const out = [base, line].filter(Boolean).join('\n');
process.stdout.write(out + '\n');
