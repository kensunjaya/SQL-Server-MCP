import { AppError } from '../utils/errors.js';

export type DdlStatementKind = 'createTable' | 'alterTable';
export type StatementKind = 'select' | 'insert' | 'update' | 'delete' | DdlStatementKind;

export interface ValidatedSql {
  sql: string;
  kind: StatementKind;
  parameterNames: string[];
}

type TokenKind = 'word' | 'parameter' | 'string' | 'identifier' | 'symbol' | 'semicolon';

interface Token {
  kind: TokenKind;
  value: string;
  depth: number;
}

const operations = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE']);
const globallyForbidden = new Set([
  'ALTER',
  'BACKUP',
  'CREATE',
  'DBCC',
  'DENY',
  'DROP',
  'EXEC',
  'EXECUTE',
  'GRANT',
  'MERGE',
  'RECONFIGURE',
  'RESTORE',
  'REVOKE',
  'TRUNCATE',
  'USE'
]);
const crossOperation: Partial<Record<StatementKind, ReadonlySet<string>>> = {
  select: new Set(['INSERT', 'UPDATE', 'DELETE']),
  insert: new Set(['UPDATE', 'DELETE']),
  update: new Set(['INSERT', 'DELETE']),
  delete: new Set(['INSERT', 'UPDATE'])
};

function statementLabel(kind: StatementKind): string {
  if (kind === 'createTable') return 'CREATE TABLE';
  if (kind === 'alterTable') return 'ALTER TABLE';
  return kind.toUpperCase();
}

function isAllowedDdlKeyword(token: Token, index: number, expectedKind: StatementKind): boolean {
  if (index === 0 && expectedKind === 'createTable' && token.value === 'CREATE') return true;
  if (index === 0 && expectedKind === 'alterTable' && token.value === 'ALTER') return true;
  return expectedKind === 'alterTable' && token.value === 'DROP';
}

function validationError(message: string): never {
  throw new AppError('VALIDATION_ERROR', message);
}

function consumeQuoted(
  input: string,
  start: number,
  opening: string,
  closing: string,
  doubledClosing: string
): number {
  let index = start + 1;
  while (index < input.length) {
    if (input.startsWith(doubledClosing, index)) {
      index += doubledClosing.length;
      continue;
    }
    if (input[index] === closing) return index + 1;
    index += 1;
  }
  validationError(`Unterminated ${opening === "'" ? 'string literal' : 'quoted identifier'}`);
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let depth = 0;

  while (index < input.length) {
    const character = input[index];
    if (character === undefined) break;
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (input.startsWith('--', index)) {
      const newline = input.indexOf('\n', index + 2);
      index = newline === -1 ? input.length : newline + 1;
      continue;
    }
    if (input.startsWith('/*', index)) {
      let commentDepth = 1;
      index += 2;
      while (index < input.length && commentDepth > 0) {
        if (input.startsWith('/*', index)) {
          commentDepth += 1;
          index += 2;
        } else if (input.startsWith('*/', index)) {
          commentDepth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (commentDepth !== 0) validationError('Unterminated block comment');
      continue;
    }
    if ((character === 'N' || character === 'n') && input[index + 1] === "'") {
      const end = consumeQuoted(input, index + 1, "'", "'", "''");
      tokens.push({ kind: 'string', value: input.slice(index, end), depth });
      index = end;
      continue;
    }
    if (character === "'") {
      const end = consumeQuoted(input, index, "'", "'", "''");
      tokens.push({ kind: 'string', value: input.slice(index, end), depth });
      index = end;
      continue;
    }
    if (character === '[') {
      const end = consumeQuoted(input, index, '[', ']', ']]');
      tokens.push({ kind: 'identifier', value: input.slice(index, end), depth });
      index = end;
      continue;
    }
    if (character === '"') {
      const end = consumeQuoted(input, index, '"', '"', '""');
      tokens.push({ kind: 'identifier', value: input.slice(index, end), depth });
      index = end;
      continue;
    }
    if (character === '(') {
      tokens.push({ kind: 'symbol', value: character, depth });
      depth += 1;
      index += 1;
      continue;
    }
    if (character === ')') {
      if (depth === 0) validationError('Unbalanced closing parenthesis');
      depth -= 1;
      tokens.push({ kind: 'symbol', value: character, depth });
      index += 1;
      continue;
    }
    if (character === ';') {
      tokens.push({ kind: 'semicolon', value: character, depth });
      index += 1;
      continue;
    }
    if (character === '@') {
      const match = /^@[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(index));
      if (match === null) validationError('Invalid SQL parameter name');
      tokens.push({ kind: 'parameter', value: match[0].slice(1), depth });
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_#$]/.test(character)) {
      const match = /^[A-Za-z_#$][A-Za-z0-9_#$]*/.exec(input.slice(index));
      if (match === null) validationError('Could not tokenize SQL word');
      tokens.push({ kind: 'word', value: match[0].toUpperCase(), depth });
      index += match[0].length;
      continue;
    }

    tokens.push({ kind: 'symbol', value: character, depth });
    index += 1;
  }

  if (depth !== 0) validationError('Unbalanced opening parenthesis');
  return tokens;
}

function operationFromTokens(tokens: readonly Token[]): StatementKind {
  const first = tokens[0];
  if (first?.kind !== 'word') validationError('SQL must begin with an operation keyword');

  if (first.value === 'CREATE' || first.value === 'ALTER') {
    const second = tokens[1];
    if (second?.kind !== 'word' || second.value !== 'TABLE') {
      validationError(`Only ${first.value} TABLE statements are supported`);
    }
    return first.value === 'CREATE' ? 'createTable' : 'alterTable';
  }

  if (first.value !== 'WITH') {
    const kind = first.value.toLowerCase();
    if (!['select', 'insert', 'update', 'delete'].includes(kind)) {
      validationError(`Unsupported SQL operation: ${first.value}`);
    }
    return kind as StatementKind;
  }

  for (const token of tokens.slice(1)) {
    if (token.depth === 0 && token.kind === 'word' && operations.has(token.value)) {
      if (token.value !== 'SELECT') {
        validationError('A common table expression must end in SELECT for this tool');
      }
      return 'select';
    }
  }
  validationError('A common table expression must be followed by SELECT');
}

export function validateSql(
  sql: string,
  expectedKind: StatementKind,
  maxLength: number
): ValidatedSql {
  const trimmed = sql.trim();
  if (trimmed === '') validationError('SQL statement cannot be empty');
  if (trimmed.length > maxLength) {
    validationError(`SQL statement exceeds the configured maximum of ${maxLength} characters`);
  }

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) validationError('SQL statement cannot contain only comments');

  let start = 0;
  while (tokens[start]?.kind === 'semicolon') start += 1;
  if (start > 0 && tokens[start]?.value !== 'WITH') {
    validationError('Leading semicolons are supported only before a common table expression');
  }

  let end = tokens.length;
  if (tokens[end - 1]?.kind === 'semicolon') end -= 1;
  const significant = tokens.slice(start, end);
  if (significant.length === 0) validationError('SQL statement cannot be empty');
  if (significant.some((token) => token.kind === 'semicolon')) {
    validationError('Only one SQL statement is allowed');
  }
  if (tokens.slice(end).length > 1) validationError('Only one trailing semicolon is allowed');

  const actualKind = operationFromTokens(significant);
  if (actualKind !== expectedKind) {
    validationError(
      `Expected a ${statementLabel(expectedKind)} statement but received ${statementLabel(actualKind)}`
    );
  }

  for (const [index, token] of significant.entries()) {
    if (token.kind !== 'word') continue;
    if (globallyForbidden.has(token.value) && !isAllowedDdlKeyword(token, index, expectedKind)) {
      validationError(`SQL keyword ${token.value} is not allowed`);
    }
    if (crossOperation[expectedKind]?.has(token.value)) {
      validationError(
        `SQL keyword ${token.value} is not allowed in a ${statementLabel(expectedKind)} statement`
      );
    }
    if (expectedKind === 'select' && token.value === 'INTO') {
      validationError('SELECT INTO is not allowed');
    }
  }

  const parameterNames = [
    ...new Set(
      significant.filter((token) => token.kind === 'parameter').map((token) => token.value)
    )
  ];
  const normalizedSql = trimmed.replace(/;\s*$/, '').trim();
  return { sql: normalizedSql, kind: actualKind, parameterNames };
}
