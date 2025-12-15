import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { logger } from '../persistence/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

// Mapping des variables techniques vers des labels génériques français
const DATA_LABELS: Record<string, string> = {
  // Trigger data
  'trigger.from': 'Identifiant utilisateur',
  'trigger.pubkey': 'Identifiant utilisateur',
  'trigger.content': 'Contenu du message',
  'trigger.timestamp': 'Horodatage',
  'trigger.kind': 'Type d\'événement',
  'trigger.relayUrl': 'Source du message',
  'trigger.event': 'Événement complet',
  'trigger.event.id': 'Identifiant du message',
  'trigger.zap': 'Données de paiement',
  'trigger.zap.amount': 'Montant du paiement',
  'trigger.zap.sender': 'Identifiant payeur',
  'trigger.zap.message': 'Message de paiement',

  // Common match patterns
  'match.message': 'Contenu du message',
  'match.content': 'Contenu du message',
  'match.email': 'Adresse email',
  'match.to': 'Destinataire',
  'match.phone': 'Numéro de téléphone',
  'match.recipient': 'Destinataire',
  'match.subject': 'Sujet',
  'match.body': 'Corps du message',
  'match.title': 'Titre',
  'match.description': 'Description',
  'match.url': 'Adresse URL',
  'match.txid': 'Identifiant de transaction',
  'match.amount': 'Montant',
  'match.data': 'Données',
  'match.category': 'Catégorie',
  'match.action': 'Action demandée',
  'match.pin': 'Configuration matérielle',
  'match.args': 'Paramètres',
  'match.command': 'Commande',

  // Actions results
  'actions': 'Résultats d\'actions précédentes',
};

// Catégories de données personnelles
const DATA_CATEGORIES: Record<string, string[]> = {
  'Identifiants utilisateur': ['trigger.from', 'trigger.pubkey', 'trigger.zap.sender'],
  'Contenu des communications': ['trigger.content', 'match.message', 'match.content', 'match.body'],
  'Coordonnées': ['match.email', 'match.phone', 'match.to', 'match.recipient'],
  'Données de paiement': ['trigger.zap', 'trigger.zap.amount', 'match.amount', 'match.txid'],
  'Métadonnées': ['trigger.timestamp', 'trigger.kind', 'trigger.relayUrl', 'trigger.event.id'],
};

// Types de handlers et leurs descriptions
const HANDLER_TYPES: Record<string, { description: string; dataFields: string[] }> = {
  email: { description: 'Envoi d\'emails', dataFields: ['destinataire', 'sujet', 'corps'] },
  telegram: { description: 'Messages Telegram', dataFields: ['identifiant chat', 'message'] },
  zulip: { description: 'Messages Zulip', dataFields: ['stream', 'topic', 'contenu'] },
  nostr_dm: { description: 'Messages privés Nostr', dataFields: ['destinataire', 'contenu'] },
  nostr_note: { description: 'Publications Nostr', dataFields: ['contenu', 'tags'] },
  http: { description: 'Requêtes HTTP', dataFields: ['URL', 'corps de requête'] },
  ftp: { description: 'Transfert FTP', dataFields: ['chemin', 'contenu'] },
  mongodb: { description: 'Stockage MongoDB', dataFields: ['collection', 'document'] },
  gpio: { description: 'Contrôle matériel GPIO', dataFields: ['pin', 'état'] },
  tts: { description: 'Synthèse vocale', dataFields: ['texte'] },
  traccar_sms: { description: 'Envoi SMS', dataFields: ['numéro', 'message'] },
  mastodon: { description: 'Publications Mastodon', dataFields: ['contenu'] },
  bluesky: { description: 'Publications Bluesky', dataFields: ['contenu'] },
  calendar: { description: 'Invitations calendrier', dataFields: ['destinataire', 'titre', 'date'] },
  odoo: { description: 'Intégration Odoo ERP', dataFields: ['données commande'] },
  bebop: { description: 'Intégration be-BOP', dataFields: ['données commande'] },
};

interface WorkflowInfo {
  id: string;
  name: string;
  description: string | undefined;
  enabled: boolean;
  dataUsed: string[];
  handlerTypes: string[];
  destinations: string[];
}

interface HandlerInfo {
  type: string;
  enabled: boolean;
  destination: string | undefined;
  description: string;
}

export class DPOReporter {
  private workflowsDir: string;
  private handlersDir: string;

  constructor(workflowsDir?: string, handlersDir?: string) {
    this.workflowsDir = workflowsDir ?? join(PROJECT_ROOT, 'config', 'workflows');
    this.handlersDir = handlersDir ?? join(PROJECT_ROOT, 'config', 'handlers');
  }

  async generateReport(): Promise<string> {
    const workflows = await this.loadWorkflows();
    const handlers = await this.loadHandlers();

    const activeWorkflows = workflows.filter(w => w.enabled);
    const inactiveWorkflows = workflows.filter(w => !w.enabled);
    const activeHandlers = handlers.filter(h => h.enabled);
    const inactiveHandlers = handlers.filter(h => !h.enabled);

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    let report = `# Rapport de traitement des données - PipeliNostr

Généré le : ${now}

---

## Résumé

| Élément | Actifs | Inactifs | Total |
|---------|--------|----------|-------|
| Workflows | ${activeWorkflows.length} | ${inactiveWorkflows.length} | ${workflows.length} |
| Handlers | ${activeHandlers.length} | ${inactiveHandlers.length} | ${handlers.length} |

---

## Workflows

### Workflows actifs (${activeWorkflows.length})

`;

    if (activeWorkflows.length > 0) {
      report += `| Workflow | Description | Données traitées | Destinations |\n`;
      report += `|----------|-------------|------------------|---------------|\n`;
      for (const w of activeWorkflows) {
        const dataLabels = this.getUniqueDataLabels(w.dataUsed);
        const destinations = w.destinations.length > 0 ? w.destinations.join(', ') : '-';
        report += `| ${w.name} | ${w.description || '-'} | ${dataLabels.join(', ') || '-'} | ${destinations} |\n`;
      }
    } else {
      report += `*Aucun workflow actif*\n`;
    }

    report += `\n### Workflows inactifs (${inactiveWorkflows.length})\n\n`;

    if (inactiveWorkflows.length > 0) {
      report += `| Workflow | Description | Données traitées (si activé) |\n`;
      report += `|----------|-------------|------------------------------|\n`;
      for (const w of inactiveWorkflows) {
        const dataLabels = this.getUniqueDataLabels(w.dataUsed);
        report += `| ${w.name} | ${w.description || '-'} | ${dataLabels.join(', ') || '-'} |\n`;
      }
    } else {
      report += `*Aucun workflow inactif*\n`;
    }

    report += `\n---\n\n## Handlers\n\n### Handlers actifs (${activeHandlers.length})\n\n`;

    if (activeHandlers.length > 0) {
      report += `| Handler | Type | Destination | Données envoyées |\n`;
      report += `|---------|------|-------------|------------------|\n`;
      for (const h of activeHandlers) {
        const handlerInfo = HANDLER_TYPES[h.type] || { description: h.type, dataFields: [] };
        report += `| ${h.type} | ${handlerInfo.description} | ${h.destination || '-'} | ${handlerInfo.dataFields.join(', ') || '-'} |\n`;
      }
    } else {
      report += `*Aucun handler actif*\n`;
    }

    report += `\n### Handlers inactifs (${inactiveHandlers.length})\n\n`;

    if (inactiveHandlers.length > 0) {
      report += `| Handler | Type | Destination (si activé) |\n`;
      report += `|---------|------|-------------------------|\n`;
      for (const h of inactiveHandlers) {
        const handlerInfo = HANDLER_TYPES[h.type] || { description: h.type, dataFields: [] };
        report += `| ${h.type} | ${handlerInfo.description} | ${h.destination || '-'} |\n`;
      }
    } else {
      report += `*Aucun handler inactif*\n`;
    }

    // Data categories summary
    report += `\n---\n\n## Catégories de données personnelles traitées\n\n`;

    const usedCategories = this.getUsedDataCategories(workflows.filter(w => w.enabled));

    if (usedCategories.length > 0) {
      report += `| Catégorie | Utilisé par |\n`;
      report += `|-----------|-------------|\n`;
      for (const cat of usedCategories) {
        report += `| ${cat.category} | ${cat.workflows.join(', ')} |\n`;
      }
    } else {
      report += `*Aucune donnée personnelle traitée par les workflows actifs*\n`;
    }

    report += `\n---\n\n*Ce rapport est généré automatiquement par PipeliNostr.*\n`;

    return report;
  }

  private async loadWorkflows(): Promise<WorkflowInfo[]> {
    const workflows: WorkflowInfo[] = [];

    if (!existsSync(this.workflowsDir)) {
      logger.warn({ path: this.workflowsDir }, 'Workflows directory not found');
      return workflows;
    }

    const files = await readdir(this.workflowsDir);
    const yamlFiles = files.filter(f =>
      (f.endsWith('.yml') || f.endsWith('.yaml')) &&
      !f.endsWith('.example')
    );

    for (const file of yamlFiles) {
      try {
        const content = await readFile(join(this.workflowsDir, file), 'utf-8');
        const raw = parseYaml(content) as Record<string, unknown>;

        if (!raw['id']) continue;

        const actions = (raw['actions'] as unknown[]) || [];
        const dataUsed = this.extractDataUsage(raw);
        const handlerTypes = this.extractHandlerTypes(actions);
        const destinations = this.extractDestinations(actions);

        workflows.push({
          id: raw['id'] as string,
          name: (raw['name'] as string) || (raw['id'] as string),
          description: raw['description'] as string | undefined,
          enabled: raw['enabled'] !== false,
          dataUsed,
          handlerTypes,
          destinations,
        });
      } catch (error) {
        logger.debug({ file, error }, 'Failed to parse workflow for DPO report');
      }
    }

    return workflows.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async loadHandlers(): Promise<HandlerInfo[]> {
    const handlers: HandlerInfo[] = [];

    if (!existsSync(this.handlersDir)) {
      logger.warn({ path: this.handlersDir }, 'Handlers directory not found');
      return handlers;
    }

    const files = await readdir(this.handlersDir);
    const yamlFiles = files.filter(f => f.endsWith('.yml') && !f.endsWith('.example'));

    for (const file of yamlFiles) {
      try {
        const content = await readFile(join(this.handlersDir, file), 'utf-8');
        const raw = parseYaml(content) as Record<string, unknown>;

        // Handler configs have the handler type as root key
        const handlerType = Object.keys(raw)[0];
        if (!handlerType) continue;

        const config = raw[handlerType] as Record<string, unknown>;
        if (!config || typeof config !== 'object') continue;

        const destination = this.extractHandlerDestination(handlerType, config);

        handlers.push({
          type: handlerType,
          enabled: config['enabled'] !== false,
          destination,
          description: HANDLER_TYPES[handlerType]?.description || handlerType,
        });
      } catch (error) {
        logger.debug({ file, error }, 'Failed to parse handler for DPO report');
      }
    }

    return handlers.sort((a, b) => a.type.localeCompare(b.type));
  }

  private extractDataUsage(workflow: Record<string, unknown>): string[] {
    const dataUsed: Set<string> = new Set();
    const content = JSON.stringify(workflow);

    // Find all {{ xxx }} template variables
    const templateRegex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;
    let match;

    while ((match = templateRegex.exec(content)) !== null) {
      const variable = match[1];
      if (!variable) continue;
      // Normalize: take first two parts (e.g., trigger.from, match.email)
      const parts = variable.split('.');
      if (parts.length >= 2) {
        const key = `${parts[0]}.${parts[1]}`;
        dataUsed.add(key);
      } else {
        dataUsed.add(variable);
      }
    }

    return Array.from(dataUsed);
  }

  private extractHandlerTypes(actions: unknown[]): string[] {
    const types: Set<string> = new Set();

    for (const action of actions) {
      const a = action as Record<string, unknown>;
      if (a['type']) {
        types.add(a['type'] as string);
      }
    }

    return Array.from(types);
  }

  private extractDestinations(actions: unknown[]): string[] {
    const destinations: Set<string> = new Set();

    for (const action of actions) {
      const a = action as Record<string, unknown>;
      const config = a['config'] as Record<string, unknown> | undefined;
      const type = a['type'] as string;

      if (!config) continue;

      // Extract destination based on handler type
      switch (type) {
        case 'email':
          if (config['to']) destinations.add(`Email`);
          break;
        case 'telegram':
          destinations.add('Telegram');
          break;
        case 'zulip':
          destinations.add('Zulip');
          break;
        case 'nostr_dm':
          destinations.add('Nostr (DM)');
          break;
        case 'nostr_note':
          destinations.add('Nostr (public)');
          break;
        case 'http':
          destinations.add('HTTP externe');
          break;
        case 'ftp':
          destinations.add('FTP');
          break;
        case 'mongodb':
          destinations.add('MongoDB');
          break;
        case 'gpio':
          destinations.add('GPIO local');
          break;
        case 'tts':
          destinations.add('Audio local');
          break;
        case 'traccar_sms':
          destinations.add('SMS');
          break;
        case 'mastodon':
          destinations.add('Mastodon');
          break;
        case 'bluesky':
          destinations.add('Bluesky');
          break;
        case 'calendar':
          destinations.add('Email (calendrier)');
          break;
        case 'odoo':
          destinations.add('Odoo ERP');
          break;
        case 'bebop':
          destinations.add('be-BOP');
          break;
        default:
          if (type) destinations.add(type);
      }
    }

    return Array.from(destinations);
  }

  private extractHandlerDestination(type: string, config: Record<string, unknown>): string | undefined {
    // Mask sensitive data, only show host/service
    switch (type) {
      case 'email':
        const smtp = config['smtp'] as Record<string, unknown> | undefined;
        return smtp?.['host'] ? `SMTP (${smtp['host']})` : undefined;
      case 'telegram':
        return 'api.telegram.org';
      case 'zulip':
        const siteUrl = config['site_url'] as string | undefined;
        return siteUrl ? new URL(siteUrl).hostname : undefined;
      case 'mongodb':
        return 'MongoDB';
      case 'ftp':
        return config['host'] as string | undefined;
      case 'traccar_sms':
        return 'Traccar SMS Gateway';
      case 'mastodon':
        const instance = config['instance'] as string | undefined;
        return instance ? new URL(instance).hostname : undefined;
      case 'bluesky':
        return 'bsky.social';
      case 'odoo':
        const odooUrl = config['url'] as string | undefined;
        return odooUrl ? new URL(odooUrl).hostname : undefined;
      case 'gpio':
        return 'Local (GPIO)';
      case 'tts':
        return 'Local (TTS)';
      case 'webhook':
        return `Port ${config['port'] || 3000}`;
      default:
        return undefined;
    }
  }

  private getUniqueDataLabels(dataUsed: string[]): string[] {
    const labels: Set<string> = new Set();

    for (const data of dataUsed) {
      const label = DATA_LABELS[data];
      if (label) {
        labels.add(label);
      } else if (data.startsWith('actions.')) {
        labels.add('Résultats d\'actions');
      } else if (data.startsWith('trigger.')) {
        labels.add('Données d\'événement');
      } else if (data.startsWith('match.')) {
        labels.add('Données extraites du message');
      }
    }

    return Array.from(labels);
  }

  private getUsedDataCategories(workflows: WorkflowInfo[]): { category: string; workflows: string[] }[] {
    const categoryUsage: Map<string, Set<string>> = new Map();

    for (const workflow of workflows) {
      for (const data of workflow.dataUsed) {
        for (const [category, fields] of Object.entries(DATA_CATEGORIES)) {
          if (fields.includes(data)) {
            if (!categoryUsage.has(category)) {
              categoryUsage.set(category, new Set());
            }
            categoryUsage.get(category)!.add(workflow.name);
          }
        }
      }
    }

    return Array.from(categoryUsage.entries())
      .map(([category, workflowSet]) => ({
        category,
        workflows: Array.from(workflowSet).sort(),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }
}

// Export singleton for CLI usage
export async function generateDPOReport(): Promise<string> {
  const reporter = new DPOReporter();
  return reporter.generateReport();
}
