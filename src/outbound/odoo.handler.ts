import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';
import type { BeBopOrderData } from './bebop.handler.js';

export interface OdooConfig {
  url: string;
  database: string;
  username: string;
  api_key: string;
  default_partner_id?: number;
  default_partner_name?: string;
}

export interface OdooActionConfig extends HandlerConfig {
  action: 'create_sale_order' | 'search_partner' | 'create_partner' | 'search_product';
  data?: BeBopOrderData | Record<string, unknown>;
  partner_id?: number;
  domain?: Array<unknown>;
  fields?: string[];
}

interface OdooSession {
  uid: number;
  sessionId: string;
  expiresAt: number;
}

interface OdooAuthResponse {
  uid: number | false;
  session_id?: string;
}

interface OdooSearchResult {
  id: number;
  [key: string]: unknown;
}

export class OdooHandler implements Handler {
  readonly name = 'Odoo Handler';
  readonly type = 'odoo';

  private config: OdooConfig;
  private session: OdooSession | null = null;
  private defaultPartnerId: number | null = null;

  constructor(config: OdooConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (!this.config.url || !this.config.database || !this.config.username || !this.config.api_key) {
      logger.warn('Odoo handler not fully configured, skipping initialization');
      return;
    }

    try {
      await this.authenticate();
      await this.ensureDefaultPartner();
      logger.info({ url: this.config.url, database: this.config.database }, 'Odoo handler initialized');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, stack: error instanceof Error ? error.stack : undefined }, 'Failed to initialize Odoo handler');
    }
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const actionConfig = config as OdooActionConfig;

    if (!actionConfig.action) {
      return { success: false, error: 'Missing required field: action' };
    }

    try {
      // Ensure we have a valid session
      await this.ensureAuthenticated();

      switch (actionConfig.action) {
        case 'create_sale_order':
          return await this.createSaleOrder(actionConfig.data as BeBopOrderData, actionConfig.partner_id);

        case 'search_partner':
          return await this.searchPartner(actionConfig.domain || [], actionConfig.fields);

        case 'create_partner':
          return await this.createPartner(actionConfig.data as Record<string, unknown>);

        case 'search_product':
          return await this.searchProduct(actionConfig.domain || [], actionConfig.fields);

        default:
          return { success: false, error: `Unknown action: ${actionConfig.action}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, action: actionConfig.action }, 'Odoo action failed');
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    this.session = null;
    logger.info('Odoo handler shut down');
  }

  private async authenticate(): Promise<void> {
    const url = `${this.config.url}/web/session/authenticate`;

    const body = {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        db: this.config.database,
        login: this.config.username,
        password: this.config.api_key,
      },
      id: Date.now(),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PipeliNostr/0.1.0',
      },
      body: JSON.stringify(body),
    });

    // Extract session_id from Set-Cookie header
    const setCookie = response.headers.get('set-cookie') || '';
    const sessionMatch = setCookie.match(/session_id=([^;]+)/);
    const sessionId = sessionMatch && sessionMatch[1] ? sessionMatch[1] : '';

    const result = await response.json() as { result?: OdooAuthResponse; error?: { message?: string; data?: { message?: string } } };

    if (result.error) {
      const errorMsg = result.error.data?.message || result.error.message || 'Unknown Odoo error';
      throw new Error(errorMsg);
    }

    const authResult = result.result;
    if (!authResult || authResult.uid === false || !authResult.uid) {
      throw new Error('Odoo authentication failed: invalid credentials');
    }

    this.session = {
      uid: authResult.uid as number,
      sessionId: sessionId,
      expiresAt: Date.now() + 3600000, // 1 hour
    };

    logger.info({ uid: authResult.uid, hasSession: !!sessionId }, 'Odoo authentication successful');
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.session || Date.now() >= this.session.expiresAt) {
      await this.authenticate();
    }
  }

  private async ensureDefaultPartner(): Promise<void> {
    if (this.config.default_partner_id) {
      this.defaultPartnerId = this.config.default_partner_id;
      return;
    }

    const partnerName = this.config.default_partner_name || 'Ventes be-BOP';

    // Search for existing partner
    const searchResult = await this.executeKw('res.partner', 'search_read', [
      [['name', '=', partnerName]],
    ], { fields: ['id'], limit: 1 }) as OdooSearchResult[] | null;

    if (searchResult && searchResult.length > 0 && searchResult[0]) {
      this.defaultPartnerId = searchResult[0].id;
      logger.debug({ partnerId: this.defaultPartnerId }, 'Found default partner');
      return;
    }

    // Create new partner
    const partnerId = await this.executeKw('res.partner', 'create', [
      {
        name: partnerName,
        is_company: true,
        comment: 'Client automatique pour les commandes be-BOP via Nostr',
      },
    ]) as number;

    this.defaultPartnerId = partnerId;
    logger.info({ partnerId, name: partnerName }, 'Created default partner for be-BOP orders');
  }

  private async createSaleOrder(orderData: BeBopOrderData, partnerId?: number): Promise<HandlerResult> {
    if (!orderData) {
      return { success: false, error: 'Missing order data' };
    }

    const effectivePartnerId = partnerId || this.defaultPartnerId;
    if (!effectivePartnerId) {
      return { success: false, error: 'No partner ID available' };
    }

    // Build order note with customer info
    const noteLines: string[] = [];
    noteLines.push(`Commande be-BOP #${orderData.orderNumber}`);
    noteLines.push(`ID: ${orderData.orderId}`);
    if (orderData.customer?.npub) {
      noteLines.push(`Npub: ${orderData.customer.npub}`);
    }
    if (orderData.customer?.email) {
      noteLines.push(`Email: ${orderData.customer.email}`);
    }
    if (orderData.customer?.login) {
      noteLines.push(`Login: ${orderData.customer.login}`);
    }
    if (orderData.payment) {
      noteLines.push(`Paiement: ${orderData.payment.method} (${orderData.payment.status})`);
      if (orderData.payment.paidAt) {
        noteLines.push(`Payé le: ${orderData.payment.paidAt}`);
      }
    }

    // Create sale order
    const orderValues = {
      partner_id: effectivePartnerId,
      client_order_ref: `BEBOP-${orderData.orderNumber}`,
      note: noteLines.join('\n'),
      state: 'draft',
    };

    const odooOrderId = await this.executeKw('sale.order', 'create', [orderValues]) as number | null;

    if (!odooOrderId) {
      return { success: false, error: 'Failed to create sale order' };
    }

    logger.info({ odooOrderId, bebopOrder: orderData.orderNumber }, 'Created Odoo sale order');

    // Create order lines
    if (orderData.items && Array.isArray(orderData.items)) {
      for (const item of orderData.items) {
        await this.createOrderLine(odooOrderId, item, orderData.totals?.currency || 'EUR');
      }
    }

    // Add shipping if present
    if (orderData.totals?.shipping && orderData.totals.shipping > 0) {
      await this.createShippingLine(odooOrderId, orderData.totals.shipping, orderData.totals.currency || 'EUR');
    }

    // Confirm the order (move to 'sale' state)
    try {
      await this.executeKw('sale.order', 'action_confirm', [[odooOrderId]]);
      logger.debug({ odooOrderId }, 'Sale order confirmed');
    } catch (confirmError) {
      logger.warn({ odooOrderId, error: confirmError }, 'Could not confirm sale order, left in draft');
    }

    return {
      success: true,
      data: {
        odoo_order_id: odooOrderId,
        bebop_order_number: orderData.orderNumber,
        bebop_order_id: orderData.orderId,
        partner_id: effectivePartnerId,
        items_count: orderData.items?.length || 0,
      },
    };
  }

  private async createOrderLine(
    orderId: number,
    item: { productId: string; productName: string; quantity: number; price: number; currency: string; vatRate: number },
    _currency: string
  ): Promise<number | null> {
    // Try to find product by reference or create a generic line
    let productId: number | null = null;

    // Search for product by default_code (ref)
    const productSearch = await this.executeKw('product.product', 'search_read', [
      [['default_code', '=', item.productId]],
    ], { fields: ['id'], limit: 1 }) as OdooSearchResult[] | null;

    if (productSearch && productSearch.length > 0 && productSearch[0]) {
      productId = productSearch[0].id;
    }

    const lineValues: Record<string, unknown> = {
      order_id: orderId,
      name: item.productName,
      product_uom_qty: item.quantity,
      price_unit: item.price,
    };

    if (productId) {
      lineValues.product_id = productId;
    }

    // Note: Tax handling would require mapping be-BOP VAT rates to Odoo tax IDs
    // For now, we set the price including tax info in the description
    if (item.vatRate > 0) {
      lineValues.name = `${item.productName} (TVA ${item.vatRate}%)`;
    }

    try {
      const lineId = await this.executeKw('sale.order.line', 'create', [lineValues]) as number;
      return lineId;
    } catch (error) {
      logger.warn({ error, item: item.productName }, 'Failed to create order line');
      return null;
    }
  }

  private async createShippingLine(orderId: number, amount: number, _currency: string): Promise<number | null> {
    const lineValues = {
      order_id: orderId,
      name: 'Frais de livraison',
      product_uom_qty: 1,
      price_unit: amount,
    };

    try {
      const lineId = await this.executeKw('sale.order.line', 'create', [lineValues]) as number;
      return lineId;
    } catch (error) {
      logger.warn({ error }, 'Failed to create shipping line');
      return null;
    }
  }

  private async searchPartner(
    domain: Array<unknown>,
    fields?: string[]
  ): Promise<HandlerResult> {
    const result = await this.executeKw('res.partner', 'search_read', [
      domain,
    ], { fields: fields || ['id', 'name', 'email', 'ref'] });

    return {
      success: true,
      data: { partners: result },
    };
  }

  private async createPartner(data: Record<string, unknown>): Promise<HandlerResult> {
    const partnerId = await this.executeKw('res.partner', 'create', [data]);

    return {
      success: true,
      data: { partner_id: partnerId },
    };
  }

  private async searchProduct(
    domain: Array<unknown>,
    fields?: string[]
  ): Promise<HandlerResult> {
    const result = await this.executeKw('product.product', 'search_read', [
      domain,
    ], { fields: fields || ['id', 'name', 'default_code', 'list_price'] });

    return {
      success: true,
      data: { products: result },
    };
  }

  private async executeKw(
    model: string,
    method: string,
    args: Array<unknown>,
    kwargs?: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.session) {
      throw new Error('Not authenticated');
    }

    const params = {
      model,
      method,
      args,
      kwargs: kwargs || {},
    };

    return await this.jsonRpcCall('/web/dataset/call_kw', params);
  }

  private async jsonRpcCall(endpoint: string, params: Record<string, unknown>): Promise<unknown> {
    const url = `${this.config.url}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'PipeliNostr/0.1.0',
    };

    if (this.session?.sessionId) {
      headers['Cookie'] = `session_id=${this.session.sessionId}`;
    }

    const body = {
      jsonrpc: '2.0',
      method: 'call',
      params,
      id: Date.now(),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json() as { result?: unknown; error?: { message?: string; data?: { message?: string } } };

    if (result.error) {
      const errorMsg = result.error.data?.message || result.error.message || 'Unknown Odoo error';
      throw new Error(errorMsg);
    }

    return result.result;
  }
}
