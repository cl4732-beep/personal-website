import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const writings = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/data/writings' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { writings };
