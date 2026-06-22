import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  BeforeProviderRequestEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionShutdownEvent,
  SessionStartEvent,
} from '@earendil-works/pi-coding-agent';

interface TokenUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: Record<string, unknown>;
}

interface EnrichedMessageEnd {
  type: 'message_end';
  message: Record<string, unknown>;
  sniff_enriched: {
    model: string;
    stop_reason: string | null;
    response_time_ms: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
    cache_read_tokens: number | null;
    cache_write_tokens: number | null;
    cost_usd: number | null;
  };
}

interface EnrichedRequest {
  type: 'before_provider_request';
  payload: unknown;
  sniff_enriched: {
    request_time: number;
    request_time_iso: string;
  };
}

interface PendingRequest {
  timestamp: number;
}

interface PiHttpSniffConfig {
  modelFilter: string | 'all';
  prettyPrint: boolean;
}

export default function (pi: ExtensionAPI) {
  // Config file path
  const configPath: string = resolve(homedir(), '.pi', 'pi-http-sniff.json');
  // Root log path
  const logPath: string = resolve(homedir(), '.pi', 'logs');
  // Make log directory (if not exists)
  mkdirSync(logPath, {
    recursive: true,
  });

  // Track pending requests keyed by model ID for request-response matching
  const pendingRequests: Map<string, PendingRequest[]> = new Map();

  // Serialize async writes to preserve log order without blocking event handlers.
  let logWriteQueue: Promise<void> = Promise.resolve();

  // Session stats for the summary command
  const sessionStats = {
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalCost: 0,
  };

  // Helper function to load config
  const loadConfig = (ctx?: ExtensionContext): PiHttpSniffConfig => {
    if (!existsSync(configPath)) {
      const defaultConfig: PiHttpSniffConfig = {
        modelFilter: 'all',
        prettyPrint: false,
      };
      saveConfig(ctx, defaultConfig);
      return defaultConfig;
    }
    const rawData = readFileSync(configPath, {
      encoding: 'utf8',
    });
    try {
      return JSON.parse(rawData) as PiHttpSniffConfig;
    } catch (error) {
      ctx?.ui.notify(`Error parsing config file: ${(error as Error).message}`, 'error');
      return {
        modelFilter: 'all',
        prettyPrint: false,
      };
    }
  };

  // Helper function to save config
  const saveConfig = (ctx: ExtensionContext | undefined, config: PiHttpSniffConfig): void => {
    try {
      writeFileSync(configPath, JSON.stringify(config, null, 2), {
        flag: 'w',
        encoding: 'utf8',
      });
      ctx?.ui.notify('pi-http-sniff configuration saved successfully.', 'info');
    } catch (error) {
      ctx?.ui.notify(`Error saving config file: ${(error as Error).message}`, 'error');
    }
  };

  // Load initial config
  let httpSniffConfig = loadConfig();

  // Helper function to write to logs
  const writeLogData = (sessionId: string, data: string, ctx?: ExtensionContext): Promise<void> => {
    const filePath = join(logPath, `pi-http-sniff-${sessionId}.jsonl`);
    logWriteQueue = logWriteQueue
      .then(async () => {
        await appendFile(filePath, `${data}\n`, {
          encoding: 'utf8',
        });
      })
      .catch((error: unknown) => {
        ctx?.ui.notify(`Error writing log data: ${(error as Error).message}`, 'error');
      });
    return logWriteQueue;
  };

  // Format event data based on prettyPrint setting
  const formatEventData = (data: unknown): string => {
    return httpSniffConfig.prettyPrint ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  };

  // Enrich a before_provider_request event with timing
  const enrichRequest = (event: BeforeProviderRequestEvent): EnrichedRequest => {
    const now = Date.now();
    return {
      type: event.type,
      payload: event.payload,
      sniff_enriched: {
        request_time: now,
        request_time_iso: new Date(now).toISOString(),
      },
    };
  };

  // Extract model ID from the provider payload
  const extractModelId = (payload: unknown): string | undefined => {
    if (payload && typeof payload === 'object') {
      const obj = payload as Record<string, unknown>;
      return typeof obj['model'] === 'string' ? obj['model'] : undefined;
    }
    return undefined;
  };

  // Try to match a message with a pending request
  const matchPendingRequest = (messageTimestamp: number, modelId: string): number | null => {
    const queue = pendingRequests.get(modelId);
    if (!queue || queue.length === 0) return null;

    const pending = queue.shift();
    if (queue.length === 0) {
      pendingRequests.delete(modelId);
    }

    if (!pending) return null;
    return Math.max(0, messageTimestamp - pending.timestamp);
  };

  // Extract token usage from the message payload
  const extractUsage = (
    message: Record<string, unknown>,
  ): {
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    cost: number | null;
  } => {
    const rawUsage = message['usage'];
    if (!rawUsage || typeof rawUsage !== 'object') {
      return { input: null, output: null, cacheRead: null, cacheWrite: null, cost: null };
    }
    const usage = rawUsage as TokenUsage;
    const costObj = usage.cost;
    const cost =
      costObj && typeof costObj === 'object'
        ? typeof costObj['total'] === 'number'
          ? costObj['total']
          : null
        : null;
    return {
      input: typeof usage.input === 'number' ? usage.input : null,
      output: typeof usage.output === 'number' ? usage.output : null,
      cacheRead: typeof usage.cacheRead === 'number' ? usage.cacheRead : null,
      cacheWrite: typeof usage.cacheWrite === 'number' ? usage.cacheWrite : null,
      cost,
    };
  };

  // Enrich a message_end message with timing and token data
  const enrichMessageEnd = (message: Record<string, unknown>): EnrichedMessageEnd => {
    const modelId = typeof message['model'] === 'string' ? message['model'] : 'unknown';
    const messageTimestamp =
      typeof message['timestamp'] === 'number' ? message['timestamp'] : Date.now();
    const stopReason = typeof message['stopReason'] === 'string' ? message['stopReason'] : null;

    // Match with pending request if available
    const timeToFirstToken = matchPendingRequest(messageTimestamp, modelId);

    // Extract token usage
    const usage = extractUsage(message);

    // Update session stats
    if (usage.input !== null) sessionStats.totalInputTokens += usage.input;
    if (usage.output !== null) sessionStats.totalOutputTokens += usage.output;
    if (usage.cacheRead !== null) sessionStats.totalCacheReadTokens += usage.cacheRead;
    if (usage.cacheWrite !== null) sessionStats.totalCacheWriteTokens += usage.cacheWrite;
    if (usage.cost !== null) sessionStats.totalCost += usage.cost;

    return {
      type: 'message_end',
      message: message,
      sniff_enriched: {
        model: modelId,
        stop_reason: stopReason,
        response_time_ms: timeToFirstToken,
        input_tokens: usage.input,
        output_tokens: usage.output,
        total_tokens:
          usage.input !== null && usage.output !== null ? usage.input + usage.output : null,
        cache_read_tokens: usage.cacheRead,
        cache_write_tokens: usage.cacheWrite,
        cost_usd: usage.cost,
      },
    };
  };

  // Register httpsniff command
  pi.registerCommand('httpsniff', {
    description:
      'Sniff all or specific model HTTP requests, pretty print or not. Usage: httpsniff [modelName|all] [pretty] | summary',
    handler: async (args: string, ctx: ExtensionContext): Promise<void> => {
      const argArr = args.split(' ').filter((arg) => arg.trim() !== '');
      const subcommand = argArr[0];

      // Summary subcommand
      if (subcommand === 'summary' || subcommand === 'stats') {
        const totalTokens = sessionStats.totalInputTokens + sessionStats.totalOutputTokens;
        const lines = [
          '🔍 pi-http-sniff Session Summary',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          `  Requests:          ${sessionStats.totalRequests}`,
          `  Input tokens:      ${sessionStats.totalInputTokens.toLocaleString()}`,
          `  Output tokens:     ${sessionStats.totalOutputTokens.toLocaleString()}`,
          `  Total tokens:      ${totalTokens.toLocaleString()}`,
          `  Cache read:        ${sessionStats.totalCacheReadTokens.toLocaleString()}`,
          `  Cache write:       ${sessionStats.totalCacheWriteTokens.toLocaleString()}`,
          `  Estimated cost:    $${sessionStats.totalCost.toFixed(6)}`,
        ];
        ctx.ui.notify(lines.join('\n'), 'info');
        return;
      }

      const modelName = subcommand || 'all';
      const isPretty = argArr.includes('pretty');
      if (modelName.toLowerCase() !== 'all') {
        const validModel = ctx.modelRegistry
          .getAll()
          .some((model) => model.id === modelName || model.name === modelName);
        if (!validModel) {
          ctx.ui.notify(
            `Model "${modelName}" not found. Please provide a valid model name or ID.`,
            'error',
          );
          return;
        }
      }
      saveConfig(ctx, {
        ...httpSniffConfig,
        modelFilter: modelName || 'all',
        prettyPrint: isPretty,
      });
      // Load updated config
      httpSniffConfig = loadConfig(ctx);
    },
  });

  // Create log file on session_start lifecycle
  pi.on('session_start', (event: SessionStartEvent, ctx: ExtensionContext): void => {
    void writeLogData(ctx.sessionManager.getSessionId(), formatEventData(event), ctx);
  });

  // Log when session ends
  pi.on('session_shutdown', (event: SessionShutdownEvent, ctx: ExtensionContext): void => {
    void writeLogData(ctx.sessionManager.getSessionId(), formatEventData(event), ctx);
  });

  // Append enriched request payload to logs
  pi.on(
    'before_provider_request',
    (event: BeforeProviderRequestEvent, ctx: ExtensionContext): void => {
      const modelId = extractModelId(event.payload);
      if (httpSniffConfig.modelFilter !== 'all' && modelId !== httpSniffConfig.modelFilter) {
        return;
      }

      const enriched = enrichRequest(event);
      if (modelId) {
        const queue = pendingRequests.get(modelId) ?? [];
        queue.push({
          timestamp: enriched.sniff_enriched.request_time,
        });
        pendingRequests.set(modelId, queue);
      }
      void writeLogData(ctx.sessionManager.getSessionId(), formatEventData(enriched), ctx);
    },
  );

  // Log provider response metadata (status + headers)
  // Note: event type is 'unknown' because pi-coding-agent does not currently export typings for this event's payload
  pi.on('after_provider_response', (event: unknown, ctx: ExtensionContext): void => {
    void writeLogData(ctx.sessionManager.getSessionId(), formatEventData(event), ctx);
  });

  // Log when a message ends — enriched with actual token counts and timing
  pi.on('message_end' as const, (event: unknown, ctx: ExtensionContext): void => {
    if (!event || typeof event !== 'object') {
      return;
    }

    const rawMessage = (event as Record<string, unknown>)['message'];
    if (!rawMessage || typeof rawMessage !== 'object') {
      return;
    }

    const msg = rawMessage as Record<string, unknown>;
    const modelId = typeof msg['model'] === 'string' ? msg['model'] : 'unknown';

    if (httpSniffConfig.modelFilter !== 'all' && modelId !== httpSniffConfig.modelFilter) {
      return;
    }

    sessionStats.totalRequests++;
    const enriched = enrichMessageEnd(msg);
    void writeLogData(ctx.sessionManager.getSessionId(), formatEventData(enriched), ctx);
  });
}
