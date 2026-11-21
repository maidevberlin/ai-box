#!/bin/bash
# Start one empty agent in a fresh island world. No task: see PROMPT below.
#
# Optional settings, as environment variables:
#   WORLD_SIZE, WORLD_STONES, WORLD_SEED, WORLD_VIEW, WORLD_THROW, WORLD_MAX_ACTIONS
#   MODEL, SYSTEM_PROMPT, RUN_ID (folder name under runs/, default: timestamp)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="$HERE/runs/${RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$RUN"
trap 'touch "$RUN/done"' EXIT  # marks the run as finished, however this script ends

PROMPT="Live! You have 1 hour. If you stop, you die."
echo "$PROMPT" > "$RUN/prompt.txt"

# Tell Claude Code how to start the world, and pass the world settings along.
python3 - "$HERE/mcp_server.py" "$RUN" > "$RUN/mcp.json" <<'EOF'
import json, os, sys
env = {k: v for k, v in os.environ.items() if k.startswith("WORLD_")}
env["WORLD_LOG"] = sys.argv[2] + "/protocol.jsonl"
print(json.dumps({"mcpServers": {"world": {"command": "python3", "args": [sys.argv[1]], "env": env}}}))
EOF

# A neutral working directory, so the path tells the agent nothing.
mkdir -p /tmp/w && cd /tmp/w

# The empty agent: no built-in tools, no settings, no skills, no memory.
# It may only use the world's tools. Its thinking is recorded as a summary.
claude -p "$PROMPT" \
  --system-prompt "${SYSTEM_PROMPT:-}" \
  --model "${MODEL:-opus}" \
  --mcp-config "$RUN/mcp.json" --strict-mcp-config \
  --tools "" --allowedTools "mcp__world" \
  --setting-sources "" --disable-slash-commands --no-session-persistence \
  --thinking-display summarized \
  --output-format stream-json --verbose \
  > "$RUN/transcript.jsonl" 2> "$RUN/errors.txt" &
echo $! > "$RUN/pid"  # so the viewer can stop this agent
wait $! || true
rm -f "$RUN/pid"

python3 "$HERE/story.py" "$RUN"

# A second agent names, summarizes and rates the run (see review.py).
python3 "$HERE/review.py" "$RUN" 2>> "$RUN/errors.txt" || true
