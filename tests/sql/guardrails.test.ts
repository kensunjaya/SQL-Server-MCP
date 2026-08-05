import { describe, expect, it } from 'vitest';
import { validateSql, type StatementKind } from '../../src/sql/guardrails.js';
import { AppError } from '../../src/utils/errors.js';

describe('validateSql', () => {
  it.each<[string, StatementKind]>([
    ['SELECT 1', 'select'],
    [';WITH sales AS (SELECT 1 AS id) SELECT id FROM sales;', 'select'],
    ["SELECT '; DROP TABLE Sales' AS sample", 'select'],
    ["SELECT N'it''s safe; DELETE X' AS sample", 'select'],
    ['SELECT [DROP], "DELETE" FROM dbo.Safe', 'select'],
    ['UPDATE dbo.Items SET Price = @price WHERE Id = @id;', 'update'],
    ['INSERT dbo.Items(Name) VALUES (@name)', 'insert'],
    ['DELETE dbo.Items WHERE Id = @id', 'delete']
  ])('accepts %s as %s', (sql, kind) => {
    expect(validateSql(sql, kind, 10_000).kind).toBe(kind);
  });

  it('collects unique named parameters', () => {
    expect(validateSql('SELECT @store, @store, @date', 'select', 1000).parameterNames).toEqual([
      'store',
      'date'
    ]);
  });

  it.each([
    'SELECT 1; DROP TABLE Sales',
    'SELECT * INTO dbo.Copy FROM dbo.Sales',
    'WITH x AS (DELETE FROM dbo.Sales OUTPUT deleted.Id) SELECT * FROM x',
    'EXEC dbo.RebuildEverything',
    'SELECT 1 /* unterminated',
    'SELECT (1',
    'SELECT 1;;'
  ])('rejects unsafe select input: %s', (sql) => {
    expect(() => validateSql(sql, 'select', 10_000)).toThrow(AppError);
  });

  it.each(['CREATE TABLE X(Id int)', 'DBCC CHECKDB', 'USE master', 'MERGE dbo.T USING dbo.S'])(
    'rejects unsupported operation %s',
    (sql) => {
      expect(() => validateSql(sql, 'select', 10_000)).toThrow(AppError);
    }
  );

  it('rejects a different operation than the tool expects', () => {
    expect(() => validateSql('UPDATE dbo.T SET x = 1', 'select', 1000)).toThrow(
      'Expected a SELECT'
    );
  });

  it('enforces maximum SQL length', () => {
    expect(() => validateSql('SELECT 123456789', 'select', 10)).toThrow('maximum');
  });

  it('allows nested block comments without classifying their contents', () => {
    expect(validateSql('/* outer /* DROP */ still */ SELECT 1', 'select', 1000).kind).toBe(
      'select'
    );
  });
});
