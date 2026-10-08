/**
 * Проверка последовательности событий — главная поверхность тестов (plan 1.2):
 * expected — упорядоченная подпоследовательность actual (промежуточные события допустимы).
 * Элемент: строка (type) или объект с полями для сопоставления ({ type, dealId, payload: {...} }).
 */
export type SequenceItem = string | Record<string, unknown>;

function deepMatches(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length
      && expected.every((e, i) => deepMatches(actual[i], e));
  }
  if (actual === null || typeof actual !== 'object') return false;
  return Object.entries(expected as Record<string, unknown>).every(([k, v]) =>
    deepMatches((actual as Record<string, unknown>)[k], v));
}

export function matchSequence(
  actual: Array<Record<string, unknown>>,
  expected: SequenceItem[],
): { pass: boolean; message: string } {
  let pos = 0;
  for (const [i, exp] of expected.entries()) {
    const want = typeof exp === 'string' ? { type: exp } : exp;
    let found = -1;
    for (let j = pos; j < actual.length; j++) {
      if (deepMatches(actual[j], want)) { found = j; break; }
    }
    if (found === -1) {
      const types = actual.map((e) => String(e.type)).join(', ');
      return {
        pass: false,
        message: `expected[${i}] ${JSON.stringify(want)} not found after position ${pos}.\nactual types: [${types}]`,
      };
    }
    pos = found + 1;
  }
  return { pass: true, message: `sequence of ${expected.length} matched` };
}
