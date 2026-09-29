import { z } from 'zod/v4';

const sqlType = z.string().trim().min(1).describe('SQL Server type, for example Int or NVarChar');
const parameterName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .describe('Parameter name without the leading @');

export const sqlParameterSchema = z
  .object({
    name: parameterName,
    value: z.unknown(),
    type: sqlType.optional(),
    length: z.union([z.number().int().positive(), z.literal('MAX')]).optional(),
    precision: z.number().int().min(1).max(38).optional(),
    scale: z.number().int().min(0).max(38).optional()
  })
  .strict();

export const procedureParameterSchema = sqlParameterSchema.extend({
  direction: z.enum(['input', 'output', 'inputOutput']).default('input')
});

export const paginationSchema = z
  .object({
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().positive().optional()
  })
  .strict();

export const selectSchema = z
  .object({
    sql: z
      .string()
      .trim()
      .min(1)
      .describe('One SELECT statement. Use @name placeholders for values.'),
    parameters: z.array(sqlParameterSchema).default([]),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().positive().optional()
  })
  .strict();

export const mutationSchema = z
  .object({
    sql: z.string().trim().min(1).describe('One statement with @name placeholders for values.'),
    parameters: z.array(sqlParameterSchema).default([])
  })
  .strict();

export const ddlSchema = z
  .object({
    sql: z
      .string()
      .trim()
      .min(1)
      .describe('One CREATE TABLE or ALTER TABLE statement, including identifiers and definitions.')
  })
  .strict();

export const procedureSchema = z
  .object({
    procedure: z.string().trim().min(1).describe('Procedure name such as dbo.ProcessRecords'),
    parameters: z.array(procedureParameterSchema).default([])
  })
  .strict();

export const transactionSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            operation: z.enum(['select', 'insert', 'update', 'delete']),
            sql: z.string().trim().min(1),
            parameters: z.array(sqlParameterSchema).default([])
          })
          .strict()
      )
      .min(1)
  })
  .strict();

export const searchSchema = z
  .object({
    search: z.string().trim().min(1),
    objectType: z.enum(['table', 'view', 'all']).default('all'),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().positive().optional()
  })
  .strict();

export const describeTableSchema = z
  .object({
    schema: z.string().trim().min(1).default('dbo'),
    table: z.string().trim().min(1)
  })
  .strict();

export const explainSchema = z
  .object({
    sql: z.string().trim().min(1).describe('One SELECT statement to compile without executing'),
    parameters: z.array(sqlParameterSchema).default([])
  })
  .strict();
