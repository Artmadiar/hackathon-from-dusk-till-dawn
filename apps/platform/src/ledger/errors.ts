export class LedgerError extends Error {
  constructor(
    readonly code: 'insufficient_funds' | 'wallet_not_found' | 'hold_not_found',
    message: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}
