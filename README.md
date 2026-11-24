# Claude Config — mbtiongson1 (v1.0.0)

My Claude Code terminal setup: a context-aware status line, global instructions, and default settings. Portable and reproducible, so a new machine is one command away.

**Repo:** `https://github.com/mbtiongson1/claude-config`

---

## Claude Code Prompt

```
You are helping manage a Claude Code config
from https://github.com/mbtiongson1/claude-config.

Ask if the user wants to:
- Update (pull latest and merge into existing ~/.claude/)
- Reinstall (back up ~/.claude/settings.json, then copy fresh from the repo)
- Sync (push current ~/.claude/ state back to the repo)
- Diff (show differences between ~/.claude/ and the repo)

Then carry out whichever they choose.

For Update or Reinstall, run `bash bin/install-claude-config.sh` from this checkout.
It backs up settings.json, merges the template, and only installs CLAUDE.md if none exists.
Restart Claude Code afterwards.
```

---

## Quick One-Liners

**Install / Update** (additive, keeps your own settings keys):

```
git clone https://github.com/mbtiongson1/claude-config ~/Documents/claude-config
bash ~/Documents/claude-config/bin/install-claude-config.sh
```

**Diff** against your live config:

```
diff -r ~/Documents/claude-config/helpers ~/.claude/helpers
diff ~/Documents/claude-config/settings.json.template ~/.claude/settings.json
```

---

## What's in the Repo

| Path | Purpose |
|------|---------|
| `helpers/context-statusline.cjs` | Status line. Top row: model name and effort level, right-aligned, with effort colored by level. Then the graft status, a 10-cell context bar (`used / max` tokens against the autocompact threshold, window minus a 33k reserve), and a session usage line: `↑` uncached input, `↓` output, `R` cache reads, `CH` cache hit rate, `$` API-equivalent cost estimate from the transcript. |
| `settings.json.template` | Default settings: model, per-model effort levels, theme, 12-hour time, cache TTLs, notifications, and the status line command. |
| `CLAUDE.md.template` | Global instructions loaded into every session. |
| `bin/install-claude-config.sh` | Installer: copies helpers, merges settings (with backup), installs CLAUDE.md if missing. |

## What's NOT Committed (stays local)

`~/.claude/settings.json` (your live copy, which holds permissions and project-specific rules) · `settings.local.json` · `.claude.json` · `history.jsonl` · `projects/` · `sessions/` · `plugins/` · `skills/` (third-party and work-specific) · any API keys, tokens, or credentials.

---

## Status Line

```
ctx [█████░░░░░] 49%  81.0k / 167.0k
```

- The bar and percentage are measured against the autocompact threshold, not the raw window size.
- Tokens are input + cache creation + cache read from the latest turn.
- Set `AUTOCOMPACT_BUFFER` in the environment if your compaction reserve differs from 33,000.
- Works standalone. Without other status line output, it prints just the context line.

---

## Customizing

- Edit `settings.json.template` and rerun the installer to change defaults.
- Keep permissions, project rules, and anything containing hostnames or credentials out of the template.
- Add new helpers under `helpers/` and reference them from the template as `node "$HOME/.claude/helpers/<name>.cjs"`.
