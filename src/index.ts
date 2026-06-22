import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  BeforeProviderRequestEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionShutdownEvent,
  SessionStartEvent,
} from '@earendil-works/pi-coding-agent';

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
  const writeLogData = (sessionId: string, data: string): void => {
    const filePath = join(logPath, `pi-http-sniff-${sessionId}.jsonl`);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, `${data}\n`, {
        flag: 'w',
        encoding: 'utf8',
      });
    } else {
      appendFileSync(filePath, `${data}\n`, {
        flag: 'a',
        encoding: 'utf8',
      });
    }
  };
  // Format event data based on prettyPrint setting
  const formatEventData = (data: unknown): string => {
    return httpSniffConfig.prettyPrint ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  };

  // Register httpsniff command
  pi.registerCommand('httpsniff', {
    description:
      'Sniff all or specific model HTTP requests, pretty print or not. Usage: httpsniff [modelName|all] [pretty]',
    handler: async (args: string, ctx: ExtensionContext): Promise<void> => {
      const argArr = args.split(' ').filter((arg) => arg.trim() !== '');
      const modelName = argArr[0] || 'all';
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
    writeLogData(ctx.sessionManager.getSessionId(), formatEventData(event));
  });

  // Log when session ends
  pi.on('session_shutdown', (event: SessionShutdownEvent, ctx: ExtensionContext): void => {
    writeLogData(ctx.sessionManager.getSessionId(), formatEventData(event));
  });

  // Append request payload to logs
  pi.on(
    'before_provider_request',
    (event: BeforeProviderRequestEvent, ctx: ExtensionContext): void => {
      if (
        httpSniffConfig.modelFilter !== 'all' &&
        (event.payload as { model: string; [key: string]: unknown }).model !==
          httpSniffConfig.modelFilter
      ) {
        return;
      }
      writeLogData(ctx.sessionManager.getSessionId(), formatEventData(event));
    },
  );

  // Append response payload to logs
  pi.on('after_provider_response', (event, ctx: ExtensionContext): void => {
    writeLogData(ctx.sessionManager.getSessionId(), formatEventData(event));
  });
}
