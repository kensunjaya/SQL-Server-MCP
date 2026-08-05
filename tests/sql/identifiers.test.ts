import { describe, expect, it } from 'vitest';
import {
  parseMultipartIdentifier,
  quoteIdentifier,
  quoteIdentifierParts
} from '../../src/sql/identifiers.js';

describe('SQL identifiers', () => {
  it('quotes a two-part identifier', () => {
    expect(quoteIdentifierParts(parseMultipartIdentifier('sales.CloseDay', 2))).toBe(
      '[sales].[CloseDay]'
    );
  });

  it('normalizes and safely requotes brackets', () => {
    expect(quoteIdentifierParts(parseMultipartIdentifier('[odd]]schema].[Close Day]', 2))).toBe(
      '[odd]]schema].[Close Day]'
    );
    expect(quoteIdentifier('a]b')).toBe('[a]]b]');
  });

  it.each(['', 'dbo..Run', 'server.db.dbo.Run', 'dbo.Run;DROP TABLE X', '[missing']) (
    'rejects invalid identifier %s',
    value => {
      expect(() => parseMultipartIdentifier(value, 2)).toThrow('Invalid SQL identifier');
    }
  );
});
