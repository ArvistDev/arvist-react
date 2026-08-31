import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    core: 'src/core/index.ts',
    ui: 'src/ui/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  splitting: true,
  sourcemap: true,
  external: ['react', 'react-dom', 'socket.io-client'],
  // BUSL-1.1 requires the license be conspicuously displayed on every copy of
  // the work, so each built bundle carries the notice.
  banner: {
    js: [
      '/**',
      ' * @arvist/react',
      ' * Copyright (c) 2026 Arvist, Inc.',
      ' *',
      ' * Licensed under the Business Source License 1.1 (the "License").',
      ' * Production use is granted solely to develop, test, and operate',
      ' * applications that interface with Arvist Services. Converts to the',
      ' * Apache License 2.0 on 2030-03-01.',
      ' *',
      ' * SPDX-License-Identifier: BUSL-1.1',
      ' * See the LICENSE file distributed with this package.',
      ' */',
    ].join('\n'),
  },
});
