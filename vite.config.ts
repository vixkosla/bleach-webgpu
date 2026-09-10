import { defineConfig } from 'vite';
import typegpuPlugin from 'unplugin-typegpu/vite';

export default defineConfig({
  plugins: [typegpuPlugin()],
  server: {
    host: '0.0.0.0',
    port: 4321,
    // Phone WebGPU requires HTTPS. Temporary Cloudflare quick tunnels provide
    // the secure origin during visual review without allowing arbitrary hosts.
    allowedHosts: ['.trycloudflare.com'],
  },
  preview: {
    host: '0.0.0.0',
    port: 4321,
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    target: 'es2022',
  },
});
