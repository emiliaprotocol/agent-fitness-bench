// SPDX-License-Identifier: Apache-2.0
import crypto from 'node:crypto';

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalize(object[key])}`
  )).join(',')}}`;
}

export function sha256(value: unknown): string {
  return `sha256:${crypto.createHash('sha256').update(canonicalize(value), 'utf8').digest('hex')}`;
}
