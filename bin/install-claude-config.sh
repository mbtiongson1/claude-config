#!/usr/bin/env bash
# Installs this Claude Code config into ~/.claude.
# - Copies helpers/ into ~/.claude/helpers/
# - Merges settings.json.template into ~/.claude/settings.json (template keys win,
#   every other key you already have is kept). Backs up the old file first.
# - Copies CLAUDE.md.template to ~/.claude/CLAUDE.md only if you don't have one yet.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

mkdir -p "$CLAUDE_DIR/helpers"
cp "$REPO"/helpers/*.cjs "$CLAUDE_DIR/helpers/"
echo "copied helpers -> $CLAUDE_DIR/helpers"

if [ -f "$CLAUDE_DIR/settings.json" ]; then
  cp "$CLAUDE_DIR/settings.json" "$CLAUDE_DIR/settings.json.bak"
  echo "backed up existing settings -> $CLAUDE_DIR/settings.json.bak"
fi
node -e '
const fs = require("fs");
const [target, template] = process.argv.slice(1);
const current = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : {};
const tpl = JSON.parse(fs.readFileSync(template, "utf8"));
fs.writeFileSync(target, JSON.stringify({ ...current, ...tpl }, null, 2) + "\n");
' "$CLAUDE_DIR/settings.json" "$REPO/settings.json.template"
echo "merged settings template -> $CLAUDE_DIR/settings.json"

if [ ! -f "$CLAUDE_DIR/CLAUDE.md" ]; then
  cp "$REPO/CLAUDE.md.template" "$CLAUDE_DIR/CLAUDE.md"
  echo "installed CLAUDE.md"
else
  echo "kept existing $CLAUDE_DIR/CLAUDE.md (template is at CLAUDE.md.template)"
fi

echo "done. Restart Claude Code to pick up the status line."
