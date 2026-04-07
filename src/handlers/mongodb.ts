/**
 * MongoDB handler (v2)
 *
 * CRUD operations on MongoDB collections.
 * Optional dependency: mongodb
 */

import { z } from 'zod';
import { BaseHandler, type HandlerResult, type ActionContext } from './base.js';
import { Secret } from '../config/secrets.js';

export class MongodbHandler extends BaseHandler {
  static type = 'mongodb';
  static configSchema = z.object({
    connection_string: z.union([z.string(), z.instanceof(Secret)]),
    database: z.string(),
    default_collection: z.string().optional(),
    enabled: z.boolean().optional(),
  });

  readonly name = 'MongoDB';
  readonly type = 'mongodb';

  private client: unknown = null;
  private db: unknown = null;
  private defaultCollection?: string | undefined;

  async initialize(config: Record<string, unknown>): Promise<void> {
    const { MongoClient } = await import('mongodb');
    const connStr = config.connection_string instanceof Secret
      ? (config.connection_string as Secret).unwrap()
      : config.connection_string as string;

    this.client = new MongoClient(connStr);
    await (this.client as { connect: () => Promise<void> }).connect();
    this.db = (this.client as { db: (name: string) => unknown }).db(config.database as string);
    this.defaultCollection = config.default_collection as string | undefined;
  }

  async execute(action: Record<string, unknown>, context: ActionContext): Promise<HandlerResult> {
    if (!this.db) return { success: false, error: 'MongoDB not connected' };

    const collectionName = (action.collection as string) ?? this.defaultCollection;
    if (!collectionName) return { success: false, error: 'Missing collection' };

    const operation = (action.operation as string) ?? 'insert';
    const collection = (this.db as { collection: (name: string) => unknown }).collection(collectionName) as {
      insertOne: (doc: unknown) => Promise<{ insertedId: unknown }>;
      updateOne: (filter: unknown, update: unknown, opts?: unknown) => Promise<{ modifiedCount: number; upsertedId?: unknown }>;
      deleteOne: (filter: unknown) => Promise<{ deletedCount: number }>;
    };

    try {
      switch (operation) {
        case 'insert': {
          const doc = (action.document as Record<string, unknown>) ?? {
            source: context.trigger.source,
            sender: context.trigger.sender,
            content: context.trigger.content,
            timestamp: new Date().toISOString(),
          };
          const result = await collection.insertOne(doc);
          return { success: true, data: { insertedId: result.insertedId, collection: collectionName } };
        }
        case 'upsert': {
          const filter = action.filter as Record<string, unknown> ?? {};
          const doc = action.document as Record<string, unknown> ?? {};
          const result = await collection.updateOne(filter, { $set: doc }, { upsert: true });
          return { success: true, data: { modifiedCount: result.modifiedCount, upsertedId: result.upsertedId } };
        }
        case 'delete': {
          const filter = action.filter as Record<string, unknown> ?? {};
          const result = await collection.deleteOne(filter);
          return { success: true, data: { deletedCount: result.deletedCount } };
        }
        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      await (this.client as { close: () => Promise<void> }).close();
      this.client = null;
      this.db = null;
    }
  }
}
