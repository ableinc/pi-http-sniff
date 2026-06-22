# pi-http-sniff

> **By Jaylen Douglas** ([jaylendouglas.com](https://jaylendouglas.com))

A [Pi Coding Agent](https://github.com/earendil-works/pi) extension that **sniffs and logs HTTP traffic** to/from LLM providers during chat sessions, with configurable model filtering and output formatting.

## Features

- Logs full **request and response payloads** for LLM API calls
- **Filters by model** — log all models or only specific ones
- **Pretty-print** or compact JSONL output
- **Session lifecycle tracking** — start, shutdown, requests, and responses
- **Persistent config** stored in `~/.pi/pi-http-sniff.json`
- **UI notifications** for config changes and errors

## What it logs

| Event | Description |
|---|---|
| `session_start` | Session initialization with metadata |
| `session_shutdown` | Session termination event |
| `before_provider_request` | Full request payload sent to the LLM provider |
| `after_provider_response` | Response payload received from the provider |

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
httpsniff [modelName|all] [pretty]
```

| Argument | Description | Example |
|---|---|---|
| `modelName` | Specific model ID/name to filter, or `all` | `httpsniff gpt-4o` |
| `pretty` | Enable pretty-printed JSON output (default: compact) | `httpsniff all pretty` |

### Examples

```
httpsniff all                      # Log all models, compact JSON
httpsniff gpt-4o                   # Log only gpt-4o, compact JSON
httpsniff all pretty               # Log all models, pretty-printed
httpsniff claude-sonnet-4-20250514 pretty  # Log specific model, pretty-printed
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

Logs are written to `~/.pi/logs/pi-http-sniff-{sessionId}.jsonl`, one JSON event per line.

## Use cases

- Debugging provider issues (what's actually being sent/received)
- Understanding prompt construction and token usage
- Auditing API traffic
- Monitoring multi-model sessions

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
