import { describe, expect, it, vi } from 'vitest';
import sql from 'mssql';
import {
  bindInputParameters,
  bindProcedureParameters,
  resolveSqlType,
  type BindableRequest
} from '../../src/database/parameters.js';

function request(): {
  target: BindableRequest;
  input: ReturnType<typeof vi.fn>;
  output: ReturnType<typeof vi.fn>;
} {
  const input = vi.fn();
  const output = vi.fn();
  return { target: { input, output } as unknown as BindableRequest, input, output };
}

describe('SQL parameters', () => {
  it('uses driver inference for an ordinary non-null input', () => {
    const target = request();
    bindInputParameters(target.target, [{ name: 'storeId', value: 12 }]);
    expect(target.input).toHaveBeenCalledWith('storeId', 12);
  });

  it('resolves length and precision types', () => {
    expect(
      resolveSqlType({ name: 'name', value: 'x', type: 'NVarChar', length: 100 })
    ).toMatchObject({
      length: 100
    });
    expect(
      resolveSqlType({ name: 'price', value: 12.5, type: 'Decimal', precision: 19, scale: 4 })
    ).toMatchObject({ precision: 19, scale: 4 });
    expect(
      resolveSqlType({ name: 'data', value: '', type: 'VarBinary', length: 'MAX' })
    ).toMatchObject({
      length: sql.MAX
    });
  });

  it('requires an explicit type for null', () => {
    expect(() => bindInputParameters(request().target, [{ name: 'value', value: null }])).toThrow(
      'explicit SQL type'
    );
  });

  it('binds output and input-output procedure parameters', () => {
    const target = request();
    bindProcedureParameters(target.target, [
      { name: 'count', value: null, type: 'Int', direction: 'output' },
      { name: 'status', value: 'open', type: 'NVarChar', length: 20, direction: 'inputOutput' }
    ]);
    expect(target.output).toHaveBeenCalledTimes(2);
    expect(target.output.mock.calls[1]?.[2]).toBe('open');
  });

  it('converts JSON date and binary values for the SQL driver', () => {
    const target = request();
    bindInputParameters(target.target, [
      { name: 'at', value: '2026-08-06T00:00:00Z', type: 'DateTime2', scale: 0 },
      { name: 'bytes', value: { $binary: 'UE9T' }, type: 'VarBinary', length: 'MAX' }
    ]);
    expect(target.input.mock.calls[0]?.[2]).toBeInstanceOf(Date);
    expect(target.input.mock.calls[1]?.[2]).toEqual(Buffer.from('POS'));
  });

  it.each(['bad-name', '@withAt', 'p1'])('rejects invalid or reserved name %s', (name) => {
    expect(() => bindInputParameters(request().target, [{ name, value: 1 }])).toThrow();
  });

  it('rejects duplicate names case-insensitively', () => {
    expect(() =>
      bindInputParameters(request().target, [
        { name: 'Store', value: 1 },
        { name: 'store', value: 2 }
      ])
    ).toThrow('Duplicate');
  });

  it('rejects unsupported types and invalid metadata', () => {
    expect(() => resolveSqlType({ name: 'x', value: 1, type: 'SqlVariant' })).toThrow(
      'Unsupported'
    );
    expect(() =>
      resolveSqlType({ name: 'x', value: 1, type: 'Decimal', precision: 4, scale: 5 })
    ).toThrow('scale');
    expect(() => resolveSqlType({ name: 'x', value: 1, type: 'Int', length: 5 })).toThrow(
      'does not accept'
    );
  });
});
