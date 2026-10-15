import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * adapter-node: the portal runs as one long-lived Node process on the VPS
 * (deploy/), next to its Postgres and PostgREST. Configured at runtime by
 * env — ORIGIN, ADDRESS_HEADER, BODY_SIZE_LIMIT — see deploy/docker-compose.yml.
 *
 * @type {import('@sveltejs/kit').Config}
 */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ precompress: true })
  }
};
