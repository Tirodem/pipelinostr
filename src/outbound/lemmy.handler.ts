/**
 * Lemmy Handler - Publication sur Lemmy (Reddit décentralisé, Fediverse)
 */

import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

interface LemmyHandlerConfig {
  enabled: boolean;
  instance_url: string; // ex: https://lemmy.world
  username: string;
  password: string;
  default_community?: string | undefined;
}

export interface LemmyActionConfig extends HandlerConfig {
  action?: 'post' | 'comment';
  // Pour créer un post
  community: string; // Nom de la communauté (ex: "nostr" ou "nostr@lemmy.world")
  title?: string;
  body?: string;
  url?: string; // Lien externe (optionnel)
  nsfw?: boolean;
  // Pour commenter
  post_id?: number;
  parent_id?: number; // Pour répondre à un commentaire
}

interface LemmyLoginResponse {
  jwt: string;
}

interface LemmyCommunityResponse {
  community_view: {
    community: {
      id: number;
      name: string;
    };
  };
}

interface LemmyPostResponse {
  post_view: {
    post: {
      id: number;
      name: string;
      ap_id: string;
    };
  };
}

interface LemmyCommentResponse {
  comment_view: {
    comment: {
      id: number;
      ap_id: string;
    };
  };
}

export class LemmyHandler implements Handler {
  readonly name = 'Lemmy Handler';
  readonly type = 'lemmy';

  private config: LemmyHandlerConfig;
  private jwt: string | null = null;
  private instanceUrl: string;

  constructor(config: LemmyHandlerConfig) {
    this.config = config;
    // Normaliser l'URL (enlever le trailing slash)
    this.instanceUrl = config.instance_url.replace(/\/$/, '');
  }

  async initialize(): Promise<void> {
    // Login pour obtenir le JWT
    const response = await fetch(`${this.instanceUrl}/api/v3/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username_or_email: this.config.username,
        password: this.config.password,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Lemmy login failed: ${error}`);
    }

    const data = (await response.json()) as LemmyLoginResponse;
    this.jwt = data.jwt;

    console.log(`[Lemmy] Connecté à ${this.instanceUrl} en tant que ${this.config.username}`);
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    if (!this.jwt) {
      return { success: false, error: 'Lemmy non authentifié' };
    }

    const params = config as LemmyActionConfig;
    const event = context.event as {
      id: string;
      pubkey: string;
      kind: number;
      created_at: number;
      content: string;
    };
    const transformedContent = (context.transformedContent as string) || event.content;

    const action = params.action || 'post';

    try {
      switch (action) {
        case 'post':
          return this.createPost(params, transformedContent);
        case 'comment':
          return this.createComment(params, transformedContent);
        default:
          return { success: false, error: `Action inconnue: ${action}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private async createPost(
    params: LemmyActionConfig,
    content: string
  ): Promise<HandlerResult> {
    const communityName = params.community || this.config.default_community;
    if (!communityName) {
      return { success: false, error: 'Communauté non spécifiée' };
    }

    // Résoudre la communauté
    const communityId = await this.getCommunityId(communityName);
    if (!communityId) {
      return { success: false, error: `Communauté non trouvée: ${communityName}` };
    }

    // Créer le post
    const postData: {
      community_id: number;
      name: string;
      body?: string;
      url?: string;
      nsfw?: boolean;
      auth: string;
    } = {
      community_id: communityId,
      name: params.title || content.substring(0, 200), // Titre obligatoire
      auth: this.jwt!,
    };

    if (params.body) {
      postData.body = params.body;
    } else if (params.title) {
      // Si titre fourni, utiliser le contenu comme body
      postData.body = content;
    }

    if (params.url) {
      postData.url = params.url;
    }

    if (params.nsfw) {
      postData.nsfw = params.nsfw;
    }

    const response = await fetch(`${this.instanceUrl}/api/v3/post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.jwt}`,
      },
      body: JSON.stringify(postData),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create post: ${error}`);
    }

    const data = (await response.json()) as LemmyPostResponse;
    const post = data.post_view.post;

    console.log(`[Lemmy] Post créé: ${post.ap_id}`);

    return {
      success: true,
      data: {
        action: 'post',
        post_id: post.id,
        title: post.name,
        url: post.ap_id,
        community: communityName,
      },
    };
  }

  private async createComment(
    params: LemmyActionConfig,
    content: string
  ): Promise<HandlerResult> {
    if (!params.post_id) {
      return { success: false, error: 'post_id requis pour commenter' };
    }

    const commentData: {
      post_id: number;
      content: string;
      parent_id?: number;
      auth: string;
    } = {
      post_id: params.post_id,
      content: params.body || content,
      auth: this.jwt!,
    };

    if (params.parent_id) {
      commentData.parent_id = params.parent_id;
    }

    const response = await fetch(`${this.instanceUrl}/api/v3/comment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.jwt}`,
      },
      body: JSON.stringify(commentData),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create comment: ${error}`);
    }

    const data = (await response.json()) as LemmyCommentResponse;
    const comment = data.comment_view.comment;

    console.log(`[Lemmy] Commentaire créé: ${comment.ap_id}`);

    return {
      success: true,
      data: {
        action: 'comment',
        comment_id: comment.id,
        post_id: params.post_id,
        url: comment.ap_id,
      },
    };
  }

  private async getCommunityId(communityName: string): Promise<number | null> {
    // Gérer les communautés fédérées (nom@instance)
    const [name, instance] = communityName.includes('@')
      ? communityName.split('@')
      : [communityName, undefined];

    const searchParams = new URLSearchParams({
      name: instance ? `${name}@${instance}` : name!,
    });

    const response = await fetch(
      `${this.instanceUrl}/api/v3/community?${searchParams}`,
      {
        headers: {
          Authorization: `Bearer ${this.jwt}`,
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as LemmyCommunityResponse;
    return data.community_view?.community?.id || null;
  }

  async shutdown(): Promise<void> {
    this.jwt = null;
    console.log('[Lemmy] Handler arrêté');
  }
}
