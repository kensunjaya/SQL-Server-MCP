import { describe, expect, it } from 'vitest';
import { boundRecordsets, sumRowsAffected, toJsonValue } from '../../src/utils/json.js';

describe('JSON-safe SQL values', () => {
  it('converts dates, buffers, and bigint values', () => {
    expect(
      toJsonValue({
        at: new Date('2026-08-06T00:00:00.000Z'),
        bytes: Buffer.from('POS'),
        amount: 9_007_199_254_740_993n
      })
    ).toEqual({
      at: '2026-08-06T00:00:00.000Z',
      bytes: { $binary: 'UE9T' },
      amount: '9007199254740993'
    });
  });

  it('rejects circular values', () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(() => toJsonValue(value)).toThrow('circular');
  });

  it('applies offset and one global row budget', () => {
    expect(boundRecordsets([[{ id: 1 }, { id: 2 }, { id: 3 }], [{ extra: 1 }]], 2, 1)).toEqual({
      recordsets: [[{ id: 2 }, { id: 3 }], []],
      returnedRows: 2,
      truncated: true
    });
  });

  it('sums affected row arrays', () => {
    expect(sumRowsAffected([2, 3, 0])).toBe(5);
  });
});
