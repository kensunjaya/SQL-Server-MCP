import { describe, expect, it } from 'vitest';
import { normalizeError } from '../../src/utils/errors.js';

describe('normalizeError', () => {
  it('preserves safe SQL Server location details', () => {
    expect(
      normalizeError({
        code: 'EREQUEST',
        message: "Incorrect syntax near the keyword 'AS'.",
        number: 156,
        state: 1,
        class: 15,
        lineNumber: 17
      })
    ).toMatchObject({
      code: 'DATABASE_QUERY_ERROR',
      details: {
        driverCode: 'EREQUEST',
        number: 156,
        state: 1,
        severity: 15,
        lineNumber: 17
      }
    });
  });
});
