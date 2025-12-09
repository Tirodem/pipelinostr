import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface MatrixHandlerOptions {
  // Homeserver URL (e.g., https://matrix.org)
  homeserverUrl: string;
  // Access token for the bot user
  accessToken: string;
  // Default room ID (optional)
  defaultRoomId?: string | undefined;
}

export interface MatrixActionConfig extends HandlerConfig {
  // Room ID to send to (e.g., !roomid:matrix.org)
  room_id?: string | undefined;
  // Message body (plain text)
  body: string;
  // Formatted body (HTML, optional)
  formatted_body?: string | undefined;
  // Message type: m.text, m.notice, m.emote
  msgtype?: 'm.text' | 'm.notice' | 'm.emote' | undefined;
}

export class MatrixHandler implements Handler {
  readonly name = 'Matrix Handler';
  readonly type = 'matrix';

  private homeserverUrl: string;
  private accessToken: string;
  private defaultRoomId?: string | undefined;
  private txnId = 0;

  constructor(options: MatrixHandlerOptions) {
    this.homeserverUrl = options.homeserverUrl.replace(/\/$/, '');
    this.accessToken = options.accessToken;
    this.defaultRoomId = options.defaultRoomId;
  }

  async initialize(): Promise<void> {
    // Verify credentials by fetching user info
    try {
      const response = await fetch(
        `${this.homeserverUrl}/_matrix/client/v3/account/whoami`,
        {
          headers: { Authorization: `Bearer ${this.accessToken}` },
        }
      );

      if (!response.ok) {
        throw new Error('Invalid Matrix access token');
      }

      const data = await response.json() as { user_id?: string };
      logger.info({ userId: data.user_id, homeserver: this.homeserverUrl }, 'Matrix handler initialized');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to initialize Matrix handler');
      throw error;
    }
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const matrixConfig = config as MatrixActionConfig;

    const roomId = matrixConfig.room_id ?? this.defaultRoomId;
    if (!roomId) {
      return { success: false, error: 'Missing required field: room_id' };
    }

    if (!matrixConfig.body) {
      return { success: false, error: 'Missing required field: body' };
    }

    try {
      const txnId = `pipelinostr_${Date.now()}_${++this.txnId}`;
      const msgtype = matrixConfig.msgtype ?? 'm.text';

      const payload: Record<string, unknown> = {
        msgtype,
        body: matrixConfig.body,
      };

      // Add formatted body if provided (HTML)
      if (matrixConfig.formatted_body) {
        payload.format = 'org.matrix.custom.html';
        payload.formatted_body = matrixConfig.formatted_body;
      }

      const encodedRoomId = encodeURIComponent(roomId);
      const response = await fetch(
        `${this.homeserverUrl}/_matrix/client/v3/rooms/${encodedRoomId}/send/m.room.message/${txnId}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorData = await response.json() as { error?: string; errcode?: string };
        const errorMsg = errorData.error ?? errorData.errcode ?? 'Unknown error';
        logger.error({ roomId, error: errorMsg }, 'Failed to send Matrix message');
        return { success: false, error: errorMsg };
      }

      const result = await response.json() as { event_id?: string };

      logger.info({ roomId, eventId: result.event_id }, 'Matrix message sent successfully');

      return {
        success: true,
        data: {
          event_id: result.event_id,
          room_id: roomId,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to send Matrix message');
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Matrix handler shut down');
  }
}
