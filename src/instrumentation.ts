import type NodeCache from 'node-cache';
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const NodeCache = (await import('node-cache')).default;
    const config: NodeCache.Options = {
      stdTTL: process.env.NODE_ENV === 'production' ? 0 : 60,
    };

    global.cacheConfigs = new NodeCache(config);
    global.cacheUser = new NodeCache(config);
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('registering sentry server config');
    await import('../sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    console.log('registering sentry edge config');
    await import('../sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;