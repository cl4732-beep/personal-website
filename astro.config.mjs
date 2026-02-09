// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://lacerda.cl',
  output: 'static',
  adapter: vercel(),
  integrations: [mdx()],
  markdown: {
    shikiConfig: {
      theme: 'css-variables',
    },
  },
});
