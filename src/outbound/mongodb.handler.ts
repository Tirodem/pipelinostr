/**
 * MongoDB Handler - Stockage d'événements dans MongoDB
 */

import { MongoClient, Db, Collection, Document } from 'mongodb';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

interface MongoDbHandlerConfig {
  enabled: boolean;
  connection_string: string;
  database: string;
  default_collection: string;
}

export interface MongoDbActionConfig extends HandlerConfig {
  operation?: 'insert' | 'upsert' | 'update' | 'delete';
  collection?: string;
  document?: Record<string, unknown>;
  filter?: Record<string, unknown>;
  update_fields?: Record<string, unknown>;
  upsert_key?: string;
}

export class MongoDbHandler implements Handler {
  readonly name = 'MongoDB Handler';
  readonly type = 'mongodb';

  private config: MongoDbHandlerConfig;
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(config: MongoDbHandlerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    this.client = new MongoClient(this.config.connection_string);
    await this.client.connect();
    this.db = this.client.db(this.config.database);
    console.log(`[MongoDB] Connecté à ${this.config.database}`);
  }

  async execute(config: HandlerConfig, context: Record<string, unknown>): Promise<HandlerResult> {
    if (!this.db) {
      return { success: false, error: 'MongoDB non initialisé' };
    }

    const params = config as MongoDbActionConfig;
    const event = context.event as { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][]; sig: string } | undefined;
    const transformedContent = (context.transformedContent as string) || event?.content || '';

    const collectionName = params.collection || this.config.default_collection;
    const collection = this.db.collection(collectionName);
    const operation = params.operation || 'insert';

    try {
      switch (operation) {
        case 'insert':
          return this.insertDocument(collection, collectionName, event, transformedContent, params);
        case 'upsert':
          return this.upsertDocument(collection, collectionName, event, transformedContent, params);
        case 'update':
          return this.updateDocument(collection, collectionName, event, params);
        case 'delete':
          return this.deleteDocument(collection, collectionName, event, params);
        default:
          return { success: false, error: `Opération inconnue: ${operation}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private async insertDocument(
    collection: Collection<Document>,
    collectionName: string,
    event: { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][]; sig: string } | undefined,
    content: string,
    params: MongoDbActionConfig
  ): Promise<HandlerResult> {
    const document = params.document || (event ? this.buildDefaultDocument(event, content) : { content, received_at: new Date() });
    const result = await collection.insertOne(document as Document);

    console.log(`[MongoDB] Document inséré dans ${collectionName}: ${result.insertedId}`);

    return {
      success: true,
      data: {
        operation: 'insert',
        collection: collectionName,
        inserted_id: result.insertedId.toString(),
      },
    };
  }

  private async upsertDocument(
    collection: Collection<Document>,
    collectionName: string,
    event: { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][]; sig: string } | undefined,
    content: string,
    params: MongoDbActionConfig
  ): Promise<HandlerResult> {
    const document = params.document || (event ? this.buildDefaultDocument(event, content) : { content, received_at: new Date() });
    const upsertKey = params.upsert_key || 'event_id';
    const filter = { [upsertKey]: (document as Record<string, unknown>)[upsertKey] || event?.id || 'unknown' };

    const result = await collection.updateOne(
      filter,
      { $set: document },
      { upsert: true }
    );

    console.log(`[MongoDB] Document upsert dans ${collectionName}: modified=${result.modifiedCount}, upserted=${result.upsertedCount}`);

    return {
      success: true,
      data: {
        operation: 'upsert',
        collection: collectionName,
        modified_count: result.modifiedCount + result.upsertedCount,
      },
    };
  }

  private async updateDocument(
    collection: Collection<Document>,
    collectionName: string,
    event: { id: string } | undefined,
    params: MongoDbActionConfig
  ): Promise<HandlerResult> {
    const filter = params.filter || { event_id: event?.id || 'unknown' };
    const update = params.update_fields || {};

    const result = await collection.updateMany(filter, { $set: update });

    console.log(`[MongoDB] Documents mis à jour dans ${collectionName}: ${result.modifiedCount}`);

    return {
      success: true,
      data: {
        operation: 'update',
        collection: collectionName,
        modified_count: result.modifiedCount,
      },
    };
  }

  private async deleteDocument(
    collection: Collection<Document>,
    collectionName: string,
    event: { id: string } | undefined,
    params: MongoDbActionConfig
  ): Promise<HandlerResult> {
    const filter = params.filter || { event_id: event?.id || 'unknown' };
    const result = await collection.deleteMany(filter);

    console.log(`[MongoDB] Documents supprimés dans ${collectionName}: ${result.deletedCount}`);

    return {
      success: true,
      data: {
        operation: 'delete',
        collection: collectionName,
        deleted_count: result.deletedCount,
      },
    };
  }

  private buildDefaultDocument(
    event: { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][]; sig: string },
    content: string
  ): Record<string, unknown> {
    return {
      event_id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      created_at: new Date(event.created_at * 1000),
      content: event.content,
      transformed_content: content,
      tags: event.tags,
      sig: event.sig,
      received_at: new Date(),
    };
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      console.log('[MongoDB] Connexion fermée');
    }
  }
}
