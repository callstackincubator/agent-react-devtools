import path from 'node:path';
import type { ComponentSourceLocation } from './types.js';

export function normalizeSourceLocation(source: unknown): ComponentSourceLocation | undefined {
  if (!source || typeof source !== 'object') return undefined;

  const raw = source as {
    fileName?: unknown;
    lineNumber?: unknown;
    columnNumber?: unknown;
  };

  if (typeof raw.fileName !== 'string' || raw.fileName.length === 0) return undefined;

  return {
    fileName: raw.fileName,
    lineNumber: typeof raw.lineNumber === 'number' ? raw.lineNumber : null,
    columnNumber: typeof raw.columnNumber === 'number' ? raw.columnNumber : null,
  };
}

export function getSourceIdentity(source: ComponentSourceLocation | undefined): string | undefined {
  if (!source) return undefined;

  let key = source.fileName;
  if (source.lineNumber !== null) key += `:${source.lineNumber}`;
  if (source.columnNumber !== null) key += `:${source.columnNumber}`;
  return key;
}

export function formatSourceLocation(source: ComponentSourceLocation | undefined): string | undefined {
  if (!source) return undefined;

  const base = path.basename(source.fileName);
  let location = base;
  if (source.lineNumber !== null) location += `:${source.lineNumber}`;
  if (source.columnNumber !== null) location += `:${source.columnNumber}`;
  return location;
}
