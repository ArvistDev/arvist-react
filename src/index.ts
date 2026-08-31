/**
 * `@arvist/react` — React SDK for the Arvist API.
 *
 * Copyright (c) 2026 Arvist, Inc.
 * Licensed under the Business Source License 1.1. Production use is granted
 * solely to build applications that interface with Arvist Services; see the
 * LICENSE file. SPDX-License-Identifier: BUSL-1.1
 *
 * ---
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
