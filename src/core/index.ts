/**
 * Framework-agnostic core.
 *
 * Import from `@arvist/react/core` when you want the client, the realtime feed,
 * or the exception derivation without pulling in React — a Node service or a
 * non-React frontend can use all of it.
 */

export * from './types';
export * from './errors';
export * from './client';
export * from './realtime';
export * from './exceptions';
export * from './reconcile';
export * from './media';
export * from './barcode';
