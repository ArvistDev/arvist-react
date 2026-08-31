/**
 * `@arvist/react` — React SDK for the Arvist API.
 *
 * Three layers, each usable on its own:
 *
 * - `@arvist/react/core` — client, realtime feed, and the exception/
 *   reconciliation logic. No React.
 * - `@arvist/react` — provider and headless hooks. Bring your own markup.
 * - `@arvist/react/ui` — Tailwind components built on those hooks.
 */

export * from './core/index';
export * from './react/index';
