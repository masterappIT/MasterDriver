import type { NextFunction, Request, Response } from 'express';

/**
 * Every API answer is `no-store` unless its handler says otherwise. Order states change every few
 * seconds (a claim page polls for 已被接走), and WeChat's in-app browser must never show a stale one.
 * Handlers that serve pictures (logo, 名片頁 photos, group QR codes, 客服 files) set their own
 * Cache-Control with `response.set`, which replaces this default.
 */
export function noStoreByDefault(_request: Request, response: Response, next: NextFunction) {
  response.setHeader('Cache-Control', 'no-store');
  next();
}
