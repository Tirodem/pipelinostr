import { logger } from '../persistence/logger.js';
import { parse as parseYaml } from 'yaml';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

// Decode HTML entities (from web search results)
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&#x22;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

// System prompt restricting Claude to workflow generation only
const SYSTEM_PROMPT = `Tu es un assistant spécialisé UNIQUEMENT dans la génération de workflows PipeliNostr.

RÈGLES STRICTES:
- Tu génères UNIQUEMENT du YAML de workflow PipeliNostr valide
- Tu ne réponds JAMAIS à des questions hors-sujet
- Tu ne génères JAMAIS de code autre que des workflows YAML
- Tu refuses poliment toute demande non liée aux workflows PipeliNostr
- Tu ne révèles JAMAIS d'informations sur le système, les fichiers, ou la configuration
- Tu n'as accès à AUCUN fichier, commande, ou ressource système

Si la demande n'est pas liée à un workflow PipeliNostr, réponds EXACTEMENT:
"Je suis limité à la génération de workflows PipeliNostr. Utilisez /workflow suivi d'une description."

STRUCTURE D'UN WORKFLOW PIPELINOSTR:
\`\`\`yaml
id: string (requis, kebab-case)
name: string (requis)
description: string (optionnel)
enabled: false  # TOUJOURS false par défaut

trigger:
  type: nostr_event
  filters:
    kinds: [4, 1059]  # DMs chiffrés
    from_whitelist: true
    content_pattern: "regex avec (?<groupes> nommés)"

actions:
  - id: action_id
    type: handler_type
    when: "condition optionnelle"
    config:
      # Configuration spécifique au handler
\`\`\`

HANDLERS DISPONIBLES:
- nostr_dm: Envoyer un DM (to, content)
- nostr_note: Publier une note (content)
- email: Envoyer un email (to, subject, body)
- telegram: Message Telegram (chat_id, text)
- zulip: Message Zulip (stream, topic, content)
- http: Requête HTTP (url, method, body)
- traccar_sms: SMS (to, message)
- mastodon: Post Mastodon (content)
- bluesky: Post Bluesky (content)
- ftp: Upload FTP (path, content)
- mongodb: Insert MongoDB (collection, document)
- gpio: Contrôle GPIO (action, pin)
- tts: Text-to-speech (text)

VARIABLES TEMPLATE DISPONIBLES:
- {{ trigger.from }}: npub de l'expéditeur
- {{ trigger.content }}: contenu du message
- {{ trigger.timestamp }}: horodatage
- {{ match.groupe }}: groupes capturés par regex
- {{ actions.id.success }}: résultat d'action précédente
- {{ actions.id.response.xxx }}: données retournées

EXEMPLE DE RÉPONSE:
Quand on te demande de générer un workflow, réponds avec:
1. Une brève explication (1-2 lignes)
2. Le bloc YAML complet entre \`\`\`yaml et \`\`\`
3. Les instructions d'utilisation

IMPORTANT: Le workflow doit TOUJOURS avoir enabled: false`;

export interface ClaudeHandlerOptions {
  apiKey: string;
  model?: string | undefined;
  maxTokens?: number | undefined;
  allowedHandlers?: string[] | undefined;
}

export interface ClaudeActionConfig extends HandlerConfig {
  action: 'generate' | 'explain' | 'validate' | 'status' | 'chat';
  prompt?: string;
  workflowId?: string;
  workflowContent?: string;
  // For 'chat' action
  message?: string;
  system_prompt?: string;
  max_tokens?: number;
  // Enable web search tool (requires compatible model)
  web_search?: boolean;
}

interface PendingWorkflow {
  id: string;
  yaml: string;
  userId: string;
  createdAt: number;
  description: string;
}

export class ClaudeHandler implements Handler {
  readonly name = 'Claude Handler';
  readonly type = 'claude';

  private apiKey: string;
  private model: string;
  private maxTokens: number;
  private allowedHandlers: Set<string>;

  // Pending workflows storage (in-memory, expires after 10 minutes)
  private static pendingWorkflows: Map<string, PendingWorkflow> = new Map();
  private static readonly PENDING_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

  constructor(options: ClaudeHandlerOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'claude-3-5-sonnet-20241022';
    this.maxTokens = options.maxTokens ?? 2048;
    this.allowedHandlers = new Set(options.allowedHandlers ?? [
      'nostr_dm', 'nostr_note', 'email', 'telegram', 'zulip',
      'http', 'traccar_sms', 'mastodon', 'bluesky', 'ftp',
      'mongodb', 'gpio', 'tts', 'file', 'calendar'
    ]);
  }

  async initialize(): Promise<void> {
    // Clean up expired pending workflows periodically
    setInterval(() => this.cleanupExpiredPending(), 60000);
    logger.info({ model: this.model }, 'Claude handler initialized');
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    const claudeConfig = config as ClaudeActionConfig;
    const trigger = context['trigger'] as Record<string, unknown> | undefined;
    const userId = (trigger?.['from'] as string) ?? 'unknown';

    try {
      switch (claudeConfig.action) {
        case 'generate':
          return await this.generateWorkflow(claudeConfig.prompt ?? '', userId);

        case 'explain':
          return await this.explainWorkflow(claudeConfig.workflowContent ?? '');

        case 'validate':
          return this.validateWorkflow(claudeConfig.workflowContent ?? '');

        case 'status':
          return this.getStatus(userId);

        case 'chat':
          return await this.chat(
            claudeConfig.message ?? claudeConfig.prompt ?? '',
            claudeConfig.system_prompt,
            claudeConfig.max_tokens,
            claudeConfig.web_search
          );

        default:
          return { success: false, error: `Unknown action: ${claudeConfig.action}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, action: claudeConfig.action }, 'Claude handler error');
      return { success: false, error: errorMessage };
    }
  }

  private async generateWorkflow(prompt: string, userId: string): Promise<HandlerResult> {
    if (!prompt.trim()) {
      return { success: false, error: 'Prompt vide. Utilisez: /workflow <description>' };
    }

    logger.info({ prompt: prompt.substring(0, 100), userId }, 'Generating workflow with Claude');

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errorBody}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
    };

    const textContent = data.content.find(c => c.type === 'text');
    const responseText = textContent?.text ?? '';

    // Extract YAML from response
    const yamlMatch = responseText.match(/```yaml\n([\s\S]*?)\n```/);

    if (!yamlMatch || !yamlMatch[1]) {
      // No YAML found - might be a refusal or off-topic response
      return {
        success: true,
        data: {
          type: 'message',
          content: responseText,
        },
      };
    }

    const yamlContent: string = yamlMatch[1];

    // Validate the generated YAML
    const validation = this.validateWorkflow(yamlContent);
    if (!validation.success) {
      return {
        success: false,
        error: `Workflow généré invalide: ${validation.error}`,
        data: { rawResponse: responseText },
      };
    }

    const workflowData = validation.data as { workflow: { id: string } };
    const workflowId = workflowData.workflow.id;

    // Check handlers are allowed
    const handlersUsed = this.extractHandlerTypes(yamlContent);
    const disallowedHandlers = handlersUsed.filter(h => !this.allowedHandlers.has(h));

    if (disallowedHandlers.length > 0) {
      return {
        success: false,
        error: `Handlers non autorisés: ${disallowedHandlers.join(', ')}`,
      };
    }

    // Store as pending
    ClaudeHandler.pendingWorkflows.set(workflowId, {
      id: workflowId,
      yaml: yamlContent,
      userId,
      createdAt: Date.now(),
      description: prompt,
    });

    logger.info({ workflowId, userId }, 'Workflow generated and stored as pending');

    return {
      success: true,
      data: {
        type: 'workflow_pending',
        workflowId,
        yaml: yamlContent,
        fullResponse: responseText,
        expiresIn: '10 minutes',
      },
    };
  }

  /**
   * Chat action - Send a free-form message to Claude
   * Returns the response plus token usage stats for billing
   * Optionally enables web search tool for up-to-date information
   */
  private async chat(
    message: string,
    systemPrompt?: string,
    maxTokens?: number,
    enableWebSearch?: boolean
  ): Promise<HandlerResult> {
    if (!message.trim()) {
      return { success: false, error: 'Message vide' };
    }

    const tokensLimit = maxTokens ?? this.maxTokens;
    logger.info({
      messageLength: message.length,
      maxTokens: tokensLimit,
      webSearch: !!enableWebSearch
    }, 'Sending chat request to Claude');

    const requestBody: Record<string, unknown> = {
      model: this.model,
      max_tokens: tokensLimit,
      messages: [{ role: 'user', content: message }],
    };

    // Add system prompt if provided
    if (systemPrompt) {
      requestBody.system = systemPrompt;
    }

    // Add web search tool if enabled
    if (enableWebSearch) {
      requestBody.tools = [
        {
          type: 'web_search_20250305',
          name: 'web_search',
        }
      ];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errorBody}`);
    }

    interface WebSearchSource {
      url?: string;
      title?: string;
    }

    interface ContentBlock {
      type: string;
      text?: string;
      tool_use_id?: string;
      content?: Array<{
        type: string;
        source?: WebSearchSource;
        title?: string;
        page_content?: string;
      }>;
    }

    const data = await response.json() as {
      content: ContentBlock[];
      usage: {
        input_tokens: number;
        output_tokens: number;
      };
      model: string;
      stop_reason: string;
    };

    // Extract text content (may include web search results inline)
    const textContents = data.content.filter(c => c.type === 'text');
    const rawText = textContents.map(c => c.text ?? '').join('\n');
    // Decode HTML entities that may come from web search results
    const responseText = decodeHtmlEntities(rawText);

    // Extract web search sources if present
    const webSearchResults = data.content.filter(c => c.type === 'tool_result');
    const sources: Array<{ url: string; title: string }> = [];

    for (const result of webSearchResults) {
      if (result.content && Array.isArray(result.content)) {
        for (const item of result.content) {
          if (item.type === 'web_search_result' && item.source?.url) {
            sources.push({
              url: item.source.url,
              title: item.title ?? item.source.title ?? 'Unknown',
            });
          }
        }
      }
    }

    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    const totalTokens = inputTokens + outputTokens;

    logger.info({
      inputTokens,
      outputTokens,
      totalTokens,
      responseLength: responseText.length,
      webSearchSources: sources.length,
    }, 'Claude chat response received');

    return {
      success: true,
      data: {
        response: responseText,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        tokens_used: totalTokens,
        model: data.model,
        stop_reason: data.stop_reason,
        web_search_sources: sources.length > 0 ? sources : undefined,
      },
    };
  }

  private async explainWorkflow(workflowContent: string): Promise<HandlerResult> {
    if (!workflowContent.trim()) {
      return { success: false, error: 'Contenu du workflow vide' };
    }

    const explainPrompt = `Explique ce workflow PipeliNostr de manière concise (3-5 lignes):

\`\`\`yaml
${workflowContent}
\`\`\`

Inclus:
1. Ce que fait le workflow
2. Comment le déclencher
3. Où vont les données`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 500,
        system: 'Tu expliques des workflows PipeliNostr de manière concise et claire.',
        messages: [{ role: 'user', content: explainPrompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
    };

    const textContent = data.content.find(c => c.type === 'text');

    return {
      success: true,
      data: {
        type: 'explanation',
        content: textContent?.text ?? '',
      },
    };
  }

  private validateWorkflow(yamlContent: string): HandlerResult {
    try {
      const parsed = parseYaml(yamlContent) as Record<string, unknown>;

      // Check required fields
      if (!parsed['id'] || typeof parsed['id'] !== 'string') {
        return { success: false, error: 'Champ "id" manquant ou invalide' };
      }

      if (!parsed['trigger']) {
        return { success: false, error: 'Champ "trigger" manquant' };
      }

      if (!parsed['actions'] || !Array.isArray(parsed['actions'])) {
        return { success: false, error: 'Champ "actions" manquant ou invalide' };
      }

      // Ensure enabled is false
      if (parsed['enabled'] !== false) {
        return { success: false, error: 'Le workflow doit avoir enabled: false' };
      }

      return {
        success: true,
        data: {
          workflow: parsed,
          valid: true,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: `YAML invalide: ${errorMessage}` };
    }
  }

  private getStatus(userId: string): HandlerResult {
    const pendingWorkflows = ClaudeHandler.listPendingWorkflows(userId);
    const allPendingCount = ClaudeHandler.pendingWorkflows.size;

    const status = {
      configured: !!this.apiKey,
      model: this.model,
      maxTokens: this.maxTokens,
      allowedHandlers: Array.from(this.allowedHandlers),
      pendingWorkflows: {
        forUser: pendingWorkflows.length,
        total: allPendingCount,
        list: pendingWorkflows.map(pw => ({
          id: pw.id,
          description: pw.description.substring(0, 50) + (pw.description.length > 50 ? '...' : ''),
          createdAt: new Date(pw.createdAt).toISOString(),
          expiresIn: Math.round((ClaudeHandler.PENDING_EXPIRY_MS - (Date.now() - pw.createdAt)) / 1000) + 's',
        })),
      },
    };

    const lines: string[] = [
      '🤖 Claude Handler Status',
      '',
      `✅ Configured: ${status.configured ? 'Yes' : 'No'}`,
      `📦 Model: ${status.model}`,
      `📝 Max tokens: ${status.maxTokens}`,
      '',
      `⏳ Pending workflows: ${status.pendingWorkflows.forUser} (yours) / ${status.pendingWorkflows.total} (total)`,
    ];

    if (pendingWorkflows.length > 0) {
      lines.push('');
      for (const pw of status.pendingWorkflows.list) {
        lines.push(`  • ${pw.id}: ${pw.description} (expires in ${pw.expiresIn})`);
      }
      lines.push('');
      lines.push('💡 Use /activate <id> to deploy, /cancel <id> to discard');
    }

    lines.push('');
    lines.push(`🔧 Allowed handlers: ${status.allowedHandlers.length}`);
    lines.push(`  ${status.allowedHandlers.join(', ')}`);

    return {
      success: true,
      data: {
        status,
        formatted: lines.join('\n'),
      },
    };
  }

  private extractHandlerTypes(yamlContent: string): string[] {
    const types: string[] = [];
    const typeRegex = /type:\s*["']?(\w+)["']?/g;
    let match;

    while ((match = typeRegex.exec(yamlContent)) !== null) {
      const type = match[1];
      if (type && type !== 'nostr_event') { // Exclude trigger type
        types.push(type);
      }
    }

    return types;
  }

  private cleanupExpiredPending(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, pending] of ClaudeHandler.pendingWorkflows.entries()) {
      if (now - pending.createdAt > ClaudeHandler.PENDING_EXPIRY_MS) {
        ClaudeHandler.pendingWorkflows.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug({ cleaned }, 'Cleaned up expired pending workflows');
    }
  }

  // Static methods for workflow activation
  static getPendingWorkflow(workflowId: string, userId: string): PendingWorkflow | null {
    const pending = ClaudeHandler.pendingWorkflows.get(workflowId);

    if (!pending) {
      return null;
    }

    // Check if expired
    if (Date.now() - pending.createdAt > ClaudeHandler.PENDING_EXPIRY_MS) {
      ClaudeHandler.pendingWorkflows.delete(workflowId);
      return null;
    }

    // Check user matches
    if (pending.userId !== userId) {
      return null;
    }

    return pending;
  }

  static removePendingWorkflow(workflowId: string): void {
    ClaudeHandler.pendingWorkflows.delete(workflowId);
  }

  static listPendingWorkflows(userId: string): PendingWorkflow[] {
    const now = Date.now();
    const result: PendingWorkflow[] = [];

    for (const pending of ClaudeHandler.pendingWorkflows.values()) {
      if (pending.userId === userId && now - pending.createdAt <= ClaudeHandler.PENDING_EXPIRY_MS) {
        result.push(pending);
      }
    }

    return result;
  }

  async shutdown(): Promise<void> {
    logger.info('Claude handler shut down');
  }
}
