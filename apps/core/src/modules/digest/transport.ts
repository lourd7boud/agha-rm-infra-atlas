import { Logger } from '@nestjs/common';

/**
 * Pluggable delivery transport. The console transport is always available
 * and proves the pipeline end-to-end; real channels (SMTP, WhatsApp
 * Business) implement the same interface and activate via env without
 * touching the dispatch flow.
 */

export interface OutboundMessage {
  recipient: string;
  subject: string;
  body: string;
}

export const DELIVERY_TRANSPORT = Symbol('DELIVERY_TRANSPORT');

export interface DeliveryTransport {
  readonly channel: string;
  send(message: OutboundMessage): Promise<void>;
}

export class ConsoleTransport implements DeliveryTransport {
  readonly channel = 'console';
  private readonly logger = new Logger('Delivery');

  async send(message: OutboundMessage): Promise<void> {
    this.logger.log(
      `delivery.console → ${message.recipient} | ${message.subject} | ${message.body.length} caractères`,
    );
  }
}

/**
 * Selects the transport from the environment. SMTP/WhatsApp transports
 * plug in here when credentials are provided (SMTP_URL / WHATSAPP_TOKEN);
 * until then the console transport keeps the chain functional and audited
 * through the outbox.
 */
export function createTransportFromEnv(): DeliveryTransport {
  if (process.env.SMTP_URL || process.env.WHATSAPP_TOKEN) {
    new Logger('DigestModule').warn(
      'SMTP_URL/WHATSAPP_TOKEN détecté mais le transport correspondant ' +
        "n'est pas encore implémenté — fallback console",
    );
  }
  return new ConsoleTransport();
}
