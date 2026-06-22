# pi-http-sniff

> **By Jaylen Douglas** ([jaylendouglas.com](https://jaylendouglas.com))

A [Pi Coding Agent](https://github.com/earendil-works/pi) extension that **sniffs and logs HTTP traffic** to/from LLM providers during chat sessions, with configurable model filtering and output formatting.

## Features

- Logs full **request and response payloads** for LLM API calls
- **Filters by model** — log all models or only specific ones
- **Pretty-print** or compact JSON output
- **Session lifecycle tracking** — start, shutdown, requests, and responses
- **Queue-based request/response correlation** per model for better latency tracking under concurrent requests
- **Non-blocking async log writes** that preserve event order
- **Session summary** includes token totals, cache totals, estimated cost, pretty mode, and model filter
- **Persistent config** stored in `~/.pi/pi-http-sniff.json`
- **UI notifications** for config changes and errors

## What it logs

| Event | Description |
|---|---|
| `session_start` | Session initialization with metadata |
| `session_shutdown` | Session termination event |
| `before_provider_request` | Full request payload sent to the LLM provider |
| `after_provider_response` | Provider response metadata (`status` and `headers`) captured before stream consumption |
| `message_end` | Assistant message with actual token counts, timing, and costs |

## Installation

```bash
# Clone and build
git clone <repo-url>
cd pi-http-sniff
pnpm install
pnpm build
```

## Usage

### Command

Register a session command via `httpsniff`:

```
httpsniff [modelName|all] [pretty] | pretty|summary|stats|help
```

| Argument | Description | Example |
|---|---|---|
| `modelName` | Specific model ID/name to filter, or `all` | `httpsniff gpt-4o` |
| `pretty` | When used with a model, enable pretty output; when used alone, toggle pretty mode | `httpsniff pretty` |
| `summary` / `stats` | Show current session token, cache, cost, pretty mode, and filter summary | `httpsniff summary` |
| `help` | Show the built-in usage text | `httpsniff help` |

### Examples

```
httpsniff all                      # Log all models, compact JSON
httpsniff gpt-4o                   # Log only gpt-4o, compact JSON
httpsniff pretty                   # Toggle pretty mode on/off
httpsniff all pretty               # Log all models, pretty-printed
httpsniff claude-sonnet-4-20250514 pretty  # Log specific model, pretty-printed
httpsniff summary                  # Show session summary
httpsniff stats                    # Show session summary
httpsniff help                     # Show usage text
```

### Config file

Configuration is saved to `~/.pi/pi-http-sniff.json` and managed via the `httpsniff` command:

```json
{
  "modelFilter": "all",
  "prettyPrint": false
}
```

### Log output

Logs are written to `~/.pi/logs/pi-http-sniff-{sessionId}.jsonl`.

- Compact mode (`prettyPrint: false`) writes one JSON object per line (JSONL-compatible).
- Pretty mode (`prettyPrint: true`) writes human-readable multiline JSON blocks.
- `after_provider_response` events are always logged. The hook payload currently includes `status` and `headers` but no model identifier, so strict per-model filtering is not available for that specific event.
- When `pretty` is used on its own, it toggles the persisted `prettyPrint` setting and displays a warning that pretty logs increase file size.

## Use cases

- Debugging provider issues (what's actually being sent/received)
- Understanding prompt construction and token usage
- Auditing API traffic
- Monitoring multi-model sessions
- **Latency debugging** — `response_time_ms` in enriched logs
- **Cost tracking** — actual `input_tokens`, `output_tokens`, and `cost_usd` per request

## Session Summary

View a real-time summary of the current session's token usage and costs:

```
httpsniff summary
```

```
🔍 pi-http-sniff Session Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Requests:          5
  Input tokens:      12,450
  Output tokens:     3,210
  Total tokens:      15,660
  Cache read:        8,192
  Cache write:       512
  Estimated cost:    $0.003240
```

The summary is also available via the `stats` alias: `httpsniff stats`.

## Log Enrichment

All logged events include a `sniff_enriched` field with additional metadata:

### `before_provider_request` enrichment

| Field | Description |
|---|---|
| `request_time` | Epoch milliseconds when the request was sent |
| `request_time_iso` | ISO 8601 timestamp of the request |

### `message_end` enrichment

| Field | Description |
|---|---|
| `model` | Model ID (e.g. `gpt-4o`, `claude-sonnet-4-20250514`) |
| `stop_reason` | Why generation stopped (`stop`, `length`, `toolUse`, `error`, `aborted`) |
| `response_time_ms` | Time from request send to first token received |
| `input_tokens` | Actual input tokens consumed |
| `output_tokens` | Actual output tokens generated |
| `total_tokens` | Sum of input + output tokens |
| `cache_read_tokens` | Tokens read from prompt cache |
| `cache_write_tokens` | Tokens written to prompt cache |
| `cost_usd` | Estimated cost in USD for this request |

## Development

```bash
# Build
pnpm build

# Lint
pnpm lint

# Format
pnpm format

# Auto-fix lint issues
pnpm fix
```
