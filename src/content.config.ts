import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const writing = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/writing" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    heroImage: z.string().optional(),
    heroAlt: z.string().default("Heading image"),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { writing };
