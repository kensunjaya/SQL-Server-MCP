import sql from 'mssql';
import type { ProcedureParameter, SqlParameter } from './types.js';
import { AppError } from '../utils/errors.js';

export interface BindableRequest {
  input(name: string, value: unknown): unknown;
  input(name: string, type: sql.ISqlType | (() => sql.ISqlType), value: unknown): unknown;
  output(name: string, type: sql.ISqlType | (() => sql.ISqlType), value?: unknown): unknown;
}

const parameterName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const lengthTypes = new Set(['CHAR', 'NCHAR', 'VARCHAR', 'NVARCHAR', 'VARBINARY']);
const precisionTypes = new Set(['DECIMAL', 'NUMERIC']);
const scaleTypes = new Set(['TIME', 'DATETIME2', 'DATETIMEOFFSET']);

const factories = {
  BIT: sql.Bit,
  TINYINT: sql.TinyInt,
  SMALLINT: sql.SmallInt,
  INT: sql.Int,
  BIGINT: sql.BigInt,
  REAL: sql.Real,
  FLOAT: sql.Float,
  DECIMAL: sql.Decimal,
  NUMERIC: sql.Numeric,
  MONEY: sql.Money,
  SMALLMONEY: sql.SmallMoney,
  CHAR: sql.Char,
  NCHAR: sql.NChar,
  VARCHAR: sql.VarChar,
  NVARCHAR: sql.NVarChar,
  TEXT: sql.Text,
  NTEXT: sql.NText,
  BINARY: sql.Binary,
  VARBINARY: sql.VarBinary,
  DATE: sql.Date,
  TIME: sql.Time,
  SMALLDATETIME: sql.SmallDateTime,
  DATETIME: sql.DateTime,
  DATETIME2: sql.DateTime2,
  DATETIMEOFFSET: sql.DateTimeOffset,
  UNIQUEIDENTIFIER: sql.UniqueIdentifier,
  XML: sql.Xml
} as const;

function invalid(message: string): never {
  throw new AppError('VALIDATION_ERROR', message);
}

function validateName(name: string): void {
  if (!parameterName.test(name)) invalid(`Invalid SQL parameter name: ${name}`);
  if (/^p\d+$/i.test(name)) invalid(`Parameter name ${name} is reserved by the SQL driver`);
}

function validateParameters(parameters: readonly SqlParameter[]): void {
  const names = new Set<string>();
  for (const parameter of parameters) {
    validateName(parameter.name);
    const key = parameter.name.toLowerCase();
    if (names.has(key)) invalid(`Duplicate SQL parameter name: ${parameter.name}`);
    names.add(key);
  }
}

export function resolveSqlType(parameter: SqlParameter): sql.ISqlType | (() => sql.ISqlType) {
  if (parameter.type === undefined) {
    invalid(`Parameter ${parameter.name} requires an explicit SQL type`);
  }

  const name = parameter.type.toUpperCase();
  const factory = factories[name as keyof typeof factories];
  if (factory === undefined) invalid(`Unsupported SQL type: ${parameter.type}`);

  if (lengthTypes.has(name)) {
    if (parameter.precision !== undefined || parameter.scale !== undefined) {
      invalid(`SQL type ${name} does not accept precision or scale`);
    }
    const length = parameter.length === 'MAX' ? sql.MAX : parameter.length;
    if (length !== undefined && (!Number.isInteger(length) || length <= 0)) {
      invalid(`SQL type ${name} requires a positive length or MAX`);
    }
    return (factory as sql.ISqlTypeFactoryWithLength)(length);
  }

  if (precisionTypes.has(name)) {
    if (parameter.length !== undefined) invalid(`SQL type ${name} does not accept length`);
    const precision = parameter.precision ?? 18;
    const scale = parameter.scale ?? 0;
    if (!Number.isInteger(precision) || precision < 1 || precision > 38) {
      invalid(`SQL type ${name} precision must be from 1 through 38`);
    }
    if (!Number.isInteger(scale) || scale < 0 || scale > precision) {
      invalid(`SQL type ${name} scale must be from 0 through its precision`);
    }
    return (factory as sql.ISqlTypeFactoryWithPrecisionScale)(precision, scale);
  }

  if (scaleTypes.has(name)) {
    if (parameter.length !== undefined || parameter.precision !== undefined) {
      invalid(`SQL type ${name} does not accept length or precision`);
    }
    const scale = parameter.scale ?? 7;
    if (!Number.isInteger(scale) || scale < 0 || scale > 7) {
      invalid(`SQL type ${name} scale must be from 0 through 7`);
    }
    return (factory as sql.ISqlTypeFactoryWithScale)(scale);
  }

  if (
    parameter.length !== undefined ||
    parameter.precision !== undefined ||
    parameter.scale !== undefined
  ) {
    invalid(`SQL type ${name} does not accept length, precision, or scale`);
  }
  return factory;
}

export function bindInputParameters(
  request: BindableRequest,
  parameters: readonly SqlParameter[] = []
): void {
  validateParameters(parameters);
  for (const parameter of parameters) {
    if (parameter.type === undefined) {
      if (parameter.value === null || parameter.value === undefined) {
        invalid(`Null parameter ${parameter.name} requires an explicit SQL type`);
      }
      request.input(parameter.name, parameter.value);
    } else {
      request.input(parameter.name, resolveSqlType(parameter), parameter.value);
    }
  }
}

export function bindProcedureParameters(
  request: BindableRequest,
  parameters: readonly ProcedureParameter[] = []
): void {
  validateParameters(parameters);
  for (const parameter of parameters) {
    const direction = parameter.direction ?? 'input';
    if (direction === 'input') {
      if (parameter.type === undefined) {
        if (parameter.value === null || parameter.value === undefined) {
          invalid(`Null parameter ${parameter.name} requires an explicit SQL type`);
        }
        request.input(parameter.name, parameter.value);
      } else {
        request.input(parameter.name, resolveSqlType(parameter), parameter.value);
      }
      continue;
    }

    const type = resolveSqlType(parameter);
    request.output(
      parameter.name,
      type,
      direction === 'inputOutput' ? parameter.value : undefined
    );
  }
}
