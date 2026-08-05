import { AppError } from '../utils/errors.js';

const ordinaryIdentifier = /^[A-Za-z_][A-Za-z0-9_$#@]*$/;

function invalidIdentifier(value: string): never {
  throw new AppError('VALIDATION_ERROR', `Invalid SQL identifier: ${value}`);
}

export function parseMultipartIdentifier(value: string, maxParts: number): string[] {
  const input = value.trim();
  if (input === '' || maxParts < 1) invalidIdentifier(value);

  const parts: string[] = [];
  let index = 0;

  while (index < input.length) {
    let part = '';
    if (input[index] === '[') {
      index += 1;
      let closed = false;
      while (index < input.length) {
        if (input[index] === ']') {
          if (input[index + 1] === ']') {
            part += ']';
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        part += input[index];
        index += 1;
      }
      if (!closed || part === '') invalidIdentifier(value);
    } else {
      const start = index;
      while (index < input.length && input[index] !== '.') index += 1;
      part = input.slice(start, index).trim();
      if (!ordinaryIdentifier.test(part)) invalidIdentifier(value);
    }

    parts.push(part);
    if (parts.length > maxParts) invalidIdentifier(value);
    if (index === input.length) break;
    if (input[index] !== '.') invalidIdentifier(value);
    index += 1;
    if (index === input.length) invalidIdentifier(value);
  }

  return parts;
}

export function quoteIdentifier(identifier: string): string {
  if (identifier === '') invalidIdentifier(identifier);
  return `[${identifier.replaceAll(']', ']]')}]`;
}

export function quoteIdentifierParts(parts: readonly string[]): string {
  if (parts.length === 0) invalidIdentifier('');
  return parts.map(quoteIdentifier).join('.');
}
