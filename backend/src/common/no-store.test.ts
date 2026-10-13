import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { noStoreByDefault } from './no-store';

test('every API answer starts as no-store, then goes on to its handler', () => {
  const headers = new Map<string, string>();
  const response = { setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value) } as unknown as Response;
  let called = false;
  noStoreByDefault({} as Request, response, (() => (called = true)) as NextFunction);
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(called, true);
});
