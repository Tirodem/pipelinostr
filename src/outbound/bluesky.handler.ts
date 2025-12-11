/**
 * Bluesky Handler - Publication sur Bluesky (AT Protocol)
 */

import { BskyAgent, RichText } from '@atproto/api';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

interface BlueskyHandlerConfig {
  enabled: boolean;
  service: string; // https://bsky.social par défaut
  identifier: string; // Handle ou DID
  password: string; // App password recommandé
}

export interface BlueskyActionConfig extends HandlerConfig {
  text: string;
  reply_to?: {
    uri: string;
    cid: string;
  };
  quote?: {
    uri: string;
    cid: string;
  };
  langs?: string[]; // ex: ["fr", "en"]
  facets?: boolean; // Activer la détection auto des mentions/liens/hashtags
}

export class BlueskyHandler implements Handler {
  readonly name = 'Bluesky Handler';
  readonly type = 'bluesky';

  private config: BlueskyHandlerConfig;
  private agent: BskyAgent;
  private authenticated = false;

  constructor(config: BlueskyHandlerConfig) {
    this.config = config;
    this.agent = new BskyAgent({
      service: config.service || 'https://bsky.social',
    });
  }

  async initialize(): Promise<void> {
    await this.agent.login({
      identifier: this.config.identifier,
      password: this.config.password,
    });
    this.authenticated = true;

    const profile = await this.agent.getProfile({ actor: this.config.identifier });
    console.log(`[Bluesky] Connecté en tant que @${profile.data.handle}`);
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    if (!this.authenticated) {
      return { success: false, error: 'Bluesky non authentifié' };
    }

    const params = config as BlueskyActionConfig;

    try {
      // Utiliser le texte fourni, ou le contenu transformé, ou le contenu de l'événement
      let text = params.text;
      if (!text) {
        text = context.transformedContent as string;
      }
      if (!text) {
        const event = context.event as { content?: string } | undefined;
        text = event?.content ?? '';
      }

      if (!text) {
        return { success: false, error: 'Missing required field: text' };
      }

      // Créer le RichText pour détecter mentions, liens, hashtags
      const rt = new RichText({ text });

      // Détecter automatiquement les facets (mentions, liens, tags)
      if (params.facets !== false) {
        await rt.detectFacets(this.agent);
      }

      // Construire le post
      const postRecord: {
        $type: string;
        text: string;
        facets?: typeof rt.facets;
        langs?: string[];
        createdAt: string;
        reply?: {
          root: { uri: string; cid: string };
          parent: { uri: string; cid: string };
        };
        embed?: {
          $type: string;
          record: { uri: string; cid: string };
        };
      } = {
        $type: 'app.bsky.feed.post',
        text: rt.text,
        createdAt: new Date().toISOString(),
      };

      if (rt.facets && rt.facets.length > 0) {
        postRecord.facets = rt.facets;
      }

      if (params.langs && params.langs.length > 0) {
        postRecord.langs = params.langs;
      }

      // Réponse à un post
      if (params.reply_to) {
        postRecord.reply = {
          root: params.reply_to,
          parent: params.reply_to,
        };
      }

      // Quote post
      if (params.quote) {
        postRecord.embed = {
          $type: 'app.bsky.embed.record',
          record: params.quote,
        };
      }

      // Publier
      const response = await this.agent.post(postRecord);

      console.log(`[Bluesky] Post publié: ${response.uri}`);

      return {
        success: true,
        data: {
          uri: response.uri,
          cid: response.cid,
          text: rt.text,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    // La session expire naturellement, pas besoin de logout explicite
    this.authenticated = false;
    console.log('[Bluesky] Handler arrêté');
  }
}
