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
    series: z
      .object({
        name: z.string(),
        part: z.number().int().positive(),
      })
      .optional(),
  }),
});

export const collections = { writing };
