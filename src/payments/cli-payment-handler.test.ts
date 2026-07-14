import { describe, expect, it, vi } from 'vitest';
import { renderPaymentRequired } from './cli-payment-handler.ts';

describe('renderPaymentRequired', () => {
  it('should render invoice to stderr', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderPaymentRequired({
      amount: 50,
      description: 'Test payment',
      pmi: 'test-pmi',
      ttl: 300,
      pay_req: 'lnbc1...',
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
    const calls = consoleErrorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(calls).toContain('Payment Required');
    expect(calls).toContain('Amount:');
    expect(calls).toContain('50');
    expect(calls).toContain('Description:');
    expect(calls).toContain('Test payment');
    expect(calls).toContain('Invoice:');
    expect(calls).toContain('lnbc1...');

    consoleErrorSpy.mockRestore();
  });
});
