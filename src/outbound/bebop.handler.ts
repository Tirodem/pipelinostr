import { logger } from '../persistence/logger.js';
import type { Handler, HandlerResult, HandlerConfig } from './handler.interface.js';

export interface BeBopOrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  currency: string;
  vatRate: number;
}

export interface BeBopOrderData {
  orderId: string;
  orderNumber: number;
  status: string;
  createdAt: string;
  items: BeBopOrderItem[];
  totals: {
    subtotal: number;
    vat: number;
    shipping: number;
    total: number;
    currency: string;
  };
  customer: {
    npub?: string;
    email?: string;
    login?: string;
  };
  payment: {
    method: string;
    subtype?: string;
    status: string;
    paidAt?: string;
    invoiceNumber?: number;
  };
}

export interface BeBopParserConfig extends HandlerConfig {
  html: string;
}

export class BeBopHandler implements Handler {
  readonly name = 'be-BOP Parser Handler';
  readonly type = 'bebop_parser';

  async initialize(): Promise<void> {
    logger.info('be-BOP parser handler initialized');
  }

  async execute(config: HandlerConfig, _context: Record<string, unknown>): Promise<HandlerResult> {
    const parserConfig = config as BeBopParserConfig;

    if (!parserConfig.html) {
      logger.error('be-BOP parser: Missing html field');
      return { success: false, error: 'Missing required field: html' };
    }

    const htmlContent = typeof parserConfig.html === 'string'
      ? parserConfig.html
      : JSON.stringify(parserConfig.html);

    logger.debug({ htmlLength: htmlContent.length }, 'be-BOP parser: Received HTML content');

    try {
      const orderData = this.parseOrderPage(htmlContent);

      if (!orderData) {
        logger.error({ htmlSnippet: htmlContent.substring(0, 500) }, 'be-BOP parser: Could not extract order data');
        return { success: false, error: 'Could not extract order data from HTML' };
      }

      logger.info(
        { orderId: orderData.orderId, orderNumber: orderData.orderNumber },
        'be-BOP order parsed successfully'
      );

      return {
        success: true,
        data: orderData as unknown as Record<string, unknown>,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, stack: error instanceof Error ? error.stack : undefined }, 'Failed to parse be-BOP order page');
      return { success: false, error: errorMessage };
    }
  }

  async shutdown(): Promise<void> {
    logger.info('be-BOP parser handler shut down');
  }

  private parseOrderPage(html: string): BeBopOrderData | null {
    // Try multiple patterns to extract SvelteKit data
    logger.debug({ htmlLength: html.length }, 'parseOrderPage: Starting');

    // Pattern 1: const data = [...] in SvelteKit script - extract and parse manually
    const constDataStart = html.indexOf('const data = [');
    logger.debug({ constDataStart }, 'parseOrderPage: Looking for const data pattern');

    if (constDataStart !== -1) {
      const arrayStart = html.indexOf('[', constDataStart);
      const extracted = this.extractJsonArray(html, arrayStart);
      logger.debug({ extractedLength: extracted?.length ?? 0 }, 'parseOrderPage: Extracted JSON array');

      if (extracted) {
        try {
          const dataArray = JSON.parse(extracted);
          logger.debug({ arrayLength: dataArray.length }, 'parseOrderPage: Parsed data array');
          const orderData = this.findOrderInDataArray(dataArray);
          if (orderData) {
            logger.debug({ hasOrder: true }, 'Found order data using const data pattern');
            return this.normalizeOrderData(orderData);
          } else {
            logger.debug('parseOrderPage: No order found in data array');
          }
        } catch (parseError) {
          logger.warn({ error: parseError instanceof Error ? parseError.message : String(parseError) }, 'Failed to parse const data pattern');
        }
      }
    }

    // Pattern 2: Look for data array with type:"data" structure
    const typeDataIndex = html.indexOf('"type":"data"');
    if (typeDataIndex !== -1) {
      // Find the array start before this
      const searchStart = Math.max(0, typeDataIndex - 1000);
      const beforeTypeData = html.substring(searchStart, typeDataIndex);
      const lastBracket = beforeTypeData.lastIndexOf('[');
      if (lastBracket !== -1) {
        const arrayStart = searchStart + lastBracket;
        const extracted = this.extractJsonArray(html, arrayStart);
        if (extracted) {
          try {
            const dataArray = JSON.parse(extracted);
            const orderData = this.findOrderInDataArray(dataArray);
            if (orderData) {
              logger.debug('Found order data using type:data pattern');
              return this.normalizeOrderData(orderData);
            }
          } catch (parseError) {
            logger.debug({ error: parseError }, 'Failed to parse type:data pattern');
          }
        }
      }
    }

    // Pattern 3: Try alternative formats
    return this.parseAlternativeFormat(html);
  }

  private extractJsonArray(html: string, startIndex: number): string | null {
    // Extract a JSON array by counting brackets
    if (html[startIndex] !== '[') return null;

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = startIndex; i < html.length; i++) {
      const char = html[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\' && inString) {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '[') depth++;
        else if (char === ']') {
          depth--;
          if (depth === 0) {
            return html.substring(startIndex, i + 1);
          }
        }
      }
    }

    return null;
  }

  private findOrderInDataArray(dataArray: unknown[]): Record<string, unknown> | null {
    for (const entry of dataArray) {
      if (!entry || typeof entry !== 'object') continue;

      const entryObj = entry as Record<string, unknown>;

      // Direct order property
      if (entryObj.data && typeof entryObj.data === 'object') {
        const dataObj = entryObj.data as Record<string, unknown>;
        if (dataObj.order) {
          return dataObj.order as Record<string, unknown>;
        }
      }

      // Check for order in nested structures
      if (entryObj.order) {
        return entryObj.order as Record<string, unknown>;
      }
    }
    return null;
  }

  private parseAlternativeFormat(html: string): BeBopOrderData | null {
    // Try to find JSON data in different formats
    // Pattern 1: __sveltekit_data or similar global variable
    const globalVarPattern = /(?:__sveltekit_data|__data__|window\.__DATA__)\s*=\s*(\{[\s\S]*?\});?\s*(?:<\/script>|$)/i;
    const globalMatch = html.match(globalVarPattern);

    if (globalMatch && globalMatch[1]) {
      try {
        const data = JSON.parse(globalMatch[1]);
        if (data.order) {
          return this.normalizeOrderData(data.order);
        }
      } catch {
        // Continue to next pattern
      }
    }

    // Pattern 2: Look for order object directly in any script
    const orderJsonPattern = /"order"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/;
    const orderMatch = html.match(orderJsonPattern);

    if (orderMatch && orderMatch[1]) {
      try {
        const orderData = JSON.parse(orderMatch[1]);
        return this.normalizeOrderData(orderData);
      } catch {
        // Failed to parse
      }
    }

    // Pattern 3: Parse structured data attributes
    const dataPattern = /data-order="([^"]+)"/;
    const dataMatch = html.match(dataPattern);

    if (dataMatch && dataMatch[1]) {
      try {
        const decoded = dataMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        const orderData = JSON.parse(decoded);
        return this.normalizeOrderData(orderData);
      } catch {
        // Failed to parse
      }
    }

    return null;
  }

  private normalizeOrderData(raw: Record<string, unknown>): BeBopOrderData {
    // Extract items
    const rawItems = (raw.items as Array<Record<string, unknown>>) || [];
    const items: BeBopOrderItem[] = rawItems.map((item) => {
      const product = item.product as Record<string, unknown> | undefined;
      const customPrice = item.customPrice as Record<string, unknown> | undefined;
      const productPrice = product?.price as Record<string, unknown> | undefined;

      // Get price from customPrice or product.price
      let price = 0;
      let currency = 'EUR';

      if (customPrice) {
        price = (customPrice.amount as number) || 0;
        currency = (customPrice.currency as string) || 'EUR';
      } else if (productPrice) {
        price = (productPrice.amount as number) || 0;
        currency = (productPrice.currency as string) || 'EUR';
      }

      return {
        productId: (product?._id as string) || (item.productId as string) || '',
        productName: (product?.name as string) || (item.name as string) || 'Unknown product',
        quantity: (item.quantity as number) || 1,
        price,
        currency,
        vatRate: (item.vatRate as number) || 0,
      };
    });

    // Extract totals
    const currencySnapshot = raw.currencySnapshot as Record<string, unknown> | undefined;
    const mainCurrency = currencySnapshot?.main as Record<string, unknown> | undefined;
    const vatArray = (raw.vat as Array<Record<string, unknown>>) || [];

    let subtotal = 0;
    let totalVat = 0;
    let total = 0;
    let currency = 'EUR';

    if (mainCurrency) {
      total = (mainCurrency.totalPrice as number) || 0;
      currency = (mainCurrency.currency as string) || 'EUR';
    }

    // Calculate VAT from vat array
    for (const vatEntry of vatArray) {
      const vatPrice = vatEntry.price as Record<string, unknown> | undefined;
      if (vatPrice) {
        totalVat += (vatPrice.amount as number) || 0;
      }
    }

    // Calculate subtotal
    subtotal = total - totalVat - ((raw.shippingPrice as number) || 0);

    // Extract customer info
    const notifications = raw.notifications as Record<string, unknown> | undefined;
    const paymentStatus = notifications?.paymentStatus as Record<string, unknown> | undefined;
    const user = raw.user as Record<string, unknown> | undefined;

    const customerNpub = paymentStatus?.npub as string | undefined;
    const customerEmail = (user?.email as string) || (paymentStatus?.email as string) || undefined;
    const customerLogin = user?.userLogin as string | undefined;

    const customer: BeBopOrderData['customer'] = {};
    if (customerNpub) customer.npub = customerNpub;
    if (customerEmail) customer.email = customerEmail;
    if (customerLogin) customer.login = customerLogin;

    // Extract payment info
    const payments = (raw.payments as Array<Record<string, unknown>>) || [];
    const firstPayment = payments[0] || {};

    const paymentSubtype = firstPayment.posSubtype as string | undefined;
    const paymentPaidAt = firstPayment.paidAt as string | undefined;
    const paymentInvoiceNumber = firstPayment.invoiceNumber as number | undefined;

    const payment: BeBopOrderData['payment'] = {
      method: (firstPayment.method as string) || 'unknown',
      status: (firstPayment.status as string) || (raw.status as string) || 'unknown',
    };
    if (paymentSubtype) payment.subtype = paymentSubtype;
    if (paymentPaidAt) payment.paidAt = paymentPaidAt;
    if (paymentInvoiceNumber) payment.invoiceNumber = paymentInvoiceNumber;

    return {
      orderId: (raw._id as string) || '',
      orderNumber: (raw.number as number) || 0,
      status: (raw.status as string) || 'unknown',
      createdAt: (raw.createdAt as string) || new Date().toISOString(),
      items,
      totals: {
        subtotal,
        vat: totalVat,
        shipping: (raw.shippingPrice as number) || 0,
        total,
        currency,
      },
      customer,
      payment,
    };
  }
}
