import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Lets the frontend call the API via a same-origin relative path
    // (see game/api.ts) instead of a hardcoded `localhost:3001` — this proxy
    // hop happens in Vite's own Node process, on the same machine as the
    // backend, so it works whether the browser reached this dev server as
    // "localhost" or through something like a Cloudflare tunnel that only
    // exposes this one port. The tunneled machine's own `localhost:3001` is
    // reachable here even though it isn't reachable from a remote browser.
    proxy: {
      '/api': 'http://localhost:3001',
    },
    // Vite rejects requests whose Host header it doesn't recognize (an
    // anti DNS-rebinding protection) — a Cloudflare quick tunnel forwards
    // the tunnel's own random *.trycloudflare.com hostname as the Host
    // header, which otherwise gets a hard "Blocked request" page. The
    // leading "." allow-lists the whole subdomain, since a quick tunnel's
    // specific hostname is different every time cloudflared restarts.
    allowedHosts: ['.trycloudflare.com'],
  },
})
