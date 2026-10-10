import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from '../src/db/core';

/** Shared by the dev-server bridges (scenarios.ts, projectDb.ts). */

export { HttpError };

export function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

export function sendError(res: ServerResponse, e: unknown) {
  send(res, e instanceof HttpError ? e.status : 500, { error: e instanceof Error ? e.message : String(e) });
}
