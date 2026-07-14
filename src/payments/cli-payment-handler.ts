import { z } from 'zod';
import type { PaymentRequiredNotification } from '@contextvm/sdk/payments';
import { BOLD, CYAN, DIM, RESET, TEXT } from '../constants/ui.ts';

/**
 * zod schema for the CEP-8 `notifications/payment_required` notification, used
 * to register an MCP client notification handler. Kept here next to its only
 * consumer (the renderer below).
 */
export const paymentRequiredNotificationSchema = z.object({
  method: z.literal('notifications/payment_required'),
  params: z.object({
    amount: z.number(),
    pay_req: z.string(),
    pmi: z.string(),
    description: z.string().optional(),
    ttl: z.number().optional(),
  }),
});

/**
 * Render a CEP-8 transparent-mode payment request to stderr.
 *
 * cvmi is a PMI-agnostic, display-only client: it advertises no payment
 * methods, so per CEP-8 the server sends `payment_required` for whatever rail
 * it supports. This renders that invoice for a human to pay out-of-band; it
 * never executes a payment.
 */
export function renderPaymentRequired(params: PaymentRequiredNotification['params']): void {
  console.error();
  console.error(`${BOLD}⚡ Payment Required${RESET}`);
  console.error(`${DIM}${'─'.repeat(50)}${RESET}`);
  console.error(`  ${CYAN}Amount:${RESET}      ${params.amount}`);
  if (params.description) {
    console.error(`  ${CYAN}Description:${RESET} ${params.description}`);
  }
  console.error(`  ${CYAN}PMI:${RESET}         ${params.pmi}`);
  if (params.ttl) {
    console.error(`  ${CYAN}Expires in:${RESET}  ${params.ttl}s`);
  }
  console.error(`${DIM}${'─'.repeat(50)}${RESET}`);
  console.error(`  ${CYAN}Invoice:${RESET}`);
  console.error(`  ${TEXT}${params.pay_req}${RESET}`);
  console.error(`${DIM}${'─'.repeat(50)}${RESET}`);
  console.error();
  console.error(`${DIM}Pay the invoice above. The CLI is waiting for confirmation...${RESET}`);
}
