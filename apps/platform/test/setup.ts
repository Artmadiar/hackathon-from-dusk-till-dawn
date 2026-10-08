import { expect } from 'vitest';
import { matchSequence, type SequenceItem } from '@fdtd/shared';

expect.extend({
  toMatchSequence(received: Array<Record<string, unknown>>, expected: SequenceItem[]) {
    const res = matchSequence(received, expected);
    return { pass: res.pass, message: () => res.message };
  },
});

declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toMatchSequence(expected: SequenceItem[]): R;
  }
}
