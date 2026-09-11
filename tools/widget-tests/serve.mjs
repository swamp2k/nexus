import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Real application/assets, no Worker bindings or production data. Tests stub every API.
const server = await createServer({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  configFile: false,
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
});
await server.listen();
