# Writing Article Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each writing article carry a small set of lowercase topic tags, shown as badges on the article page.

**Architecture:** Add an optional `tags` array field to the existing `writing` content collection schema, populate it on the two existing articles' frontmatter, and render one badge per tag in the shared `[...slug].astro` article template.

**Tech Stack:** Astro 7 content collections (`astro:content`, `zod`), Tailwind CSS utility classes.

## Global Constraints

- Tags are free-form lowercase strings, no central enum/taxonomy (per spec "Data model").
- `tags` defaults to `[]` so existing/future posts without the field render unchanged (per spec "Data model").
- Badges are plain, unstyled-interaction `<span>` elements — not links, not buttons, no hover state (per spec "Rendering").
- Badge visual style must match the existing project-tag badge classes: `rounded-md border border-gray-300 px-1 py-0.5 text-[10px] text-gray-500` (per spec "Rendering").
- No changes to the homepage "recent writing" list, and no changes to the unrelated project `tags` field on `ProjectRow.astro` (per spec "Scope").
- No new pages, no clickable/filterable tags, no per-tag routes (per spec "Scope" / "Non-goals").
- This project has no unit test runner configured; verification is `npx astro build` plus manual inspection of the built HTML, matching the spec's own "Testing" section.

---

### Task 1: Add `tags` to the writing schema, tag existing articles, and render badges

**Files:**
- Modify: `src/content.config.ts`
- Modify: `src/content/writing/how-a-browser-loads-a-page.md` (frontmatter only)
- Modify: `src/content/writing/understanding-flux-architecture.md` (frontmatter only)
- Modify: `src/pages/writing/[...slug].astro`

**Interfaces:**
- Consumes: the `writing` collection's existing schema (`title`, `description`, `date`, `heroImage`, `heroAlt`) defined in `src/content.config.ts`; the existing `post.data` destructure in `src/pages/writing/[...slug].astro`.
- Produces: `post.data.tags: string[]` (always present, defaults to `[]`), available to any future page that reads the `writing` collection.

This is a single task because the schema field, the frontmatter data, and the rendering are only meaningfully testable together — a schema field with no data or a template with nothing to render can't be verified in isolation.

- [ ] **Step 1: Add the `tags` field to the collection schema**

Edit `src/content.config.ts`. Current contents:

```ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const writing = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/writing" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    heroImage: z.string(),
    heroAlt: z.string().default("Heading image"),
  }),
});

export const collections = { writing };
```

Add `tags` right after `heroAlt`:

```ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const writing = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/writing" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    heroImage: z.string(),
    heroAlt: z.string().default("Heading image"),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { writing };
```

- [ ] **Step 2: Tag the "how a browser loads a page" article**

Edit `src/content/writing/how-a-browser-loads-a-page.md`. Current frontmatter:

```md
---
title: how a browser loads a page
description: What happens between typing a URL and the page showing up on screen.
date: 2019-08-01
heroImage: /writing/browser-hero.jpg
---
```

Add a `tags` line:

```md
---
title: how a browser loads a page
description: What happens between typing a URL and the page showing up on screen.
date: 2019-08-01
heroImage: /writing/browser-hero.jpg
tags: [browsers, rendering, networking]
---
```

- [ ] **Step 3: Tag the "understanding flux architecture" article**

Edit `src/content/writing/understanding-flux-architecture.md`. Current frontmatter:

```md
---
title: understanding flux architecture
description: Unidirectional data flow, and why it makes application state easier to reason about.
date: 2019-07-01
heroImage: /writing/flux-hero.jpg
---
```

Add a `tags` line:

```md
---
title: understanding flux architecture
description: Unidirectional data flow, and why it makes application state easier to reason about.
date: 2019-07-01
heroImage: /writing/flux-hero.jpg
tags: [flux, architecture, state-management]
---
```

- [ ] **Step 4: Render tag badges in the article template**

Edit `src/pages/writing/[...slug].astro`. Current contents:

```astro
---
export const prerender = true;

import { getCollection, render } from "astro:content";
import Layout from "../../layouts/Layout.astro";
import { formatArticleDate } from "../../lib/format-date";

export async function getStaticPaths() {
  const posts = await getCollection("writing");
  return posts.map((post) => ({
    params: { slug: post.id },
    props: { post },
  }));
}

const { post } = Astro.props;
const { title, description, date, heroImage, heroAlt } = post.data;
const { Content } = await render(post);
const pageTitle = title.charAt(0).toUpperCase() + title.slice(1);
---

<Layout title={`${pageTitle} - William Muli`} description={description}>
  <div class="min-h-screen bg-[#fdfff4]">
    <main class="mx-auto max-w-3xl px-8 py-12 font-mono text-sm leading-relaxed md:px-16">
      <a href="/" class="text-xs text-gray-500 underline hover:text-black">← back</a>

      <article class="mt-6">
        <h1 class="text-xl font-bold text-black">{title}</h1>
        <p class="mt-1 text-xs text-gray-400">{formatArticleDate(date)}</p>

        <img src={heroImage} alt={heroAlt} class="mt-6 w-full rounded-md border border-gray-200 object-cover" />

        <div class="article-content mt-6 text-gray-800">
          <Content />
        </div>
      </article>
    </main>
  </div>
</Layout>
```

Replace it with (destructure `tags`, add a badge row after the date paragraph):

```astro
---
export const prerender = true;

import { getCollection, render } from "astro:content";
import Layout from "../../layouts/Layout.astro";
import { formatArticleDate } from "../../lib/format-date";

export async function getStaticPaths() {
  const posts = await getCollection("writing");
  return posts.map((post) => ({
    params: { slug: post.id },
    props: { post },
  }));
}

const { post } = Astro.props;
const { title, description, date, heroImage, heroAlt, tags } = post.data;
const { Content } = await render(post);
const pageTitle = title.charAt(0).toUpperCase() + title.slice(1);
---

<Layout title={`${pageTitle} - William Muli`} description={description}>
  <div class="min-h-screen bg-[#fdfff4]">
    <main class="mx-auto max-w-3xl px-8 py-12 font-mono text-sm leading-relaxed md:px-16">
      <a href="/" class="text-xs text-gray-500 underline hover:text-black">← back</a>

      <article class="mt-6">
        <h1 class="text-xl font-bold text-black">{title}</h1>
        <p class="mt-1 text-xs text-gray-400">{formatArticleDate(date)}</p>

        {tags.length > 0 && (
          <div class="mt-2 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span class="w-fit rounded-md border border-gray-300 px-1 py-0.5 text-[10px] text-gray-500">{tag}</span>
            ))}
          </div>
        )}

        <img src={heroImage} alt={heroAlt} class="mt-6 w-full rounded-md border border-gray-200 object-cover" />

        <div class="article-content mt-6 text-gray-800">
          <Content />
        </div>
      </article>
    </main>
  </div>
</Layout>
```

- [ ] **Step 5: Build and verify**

Run: `npx astro build`

Expected: build completes with no schema/type errors, and prerender output lists both:
```
├─ /writing/how-a-browser-loads-a-page/index.html
├─ /writing/understanding-flux-architecture/index.html
```

Then inspect the generated HTML for both pages to confirm the badges are present with the right text and classes:

```bash
grep -A5 'text-xs text-gray-400' dist/client/writing/how-a-browser-loads-a-page/index.html | head -10
grep -A5 'text-xs text-gray-400' dist/client/writing/understanding-flux-architecture/index.html | head -10
```

Expected: each shows a `<div class="mt-2 flex flex-wrap gap-1">` containing three `<span class="w-fit rounded-md border border-gray-300 px-1 py-0.5 text-[10px] text-gray-500">` elements with the tag text from Steps 2/3 (`browsers`, `rendering`, `networking` and `flux`, `architecture`, `state-management` respectively).

Clean up the build output afterward: `rm -rf dist`

- [ ] **Step 6: Commit**

```bash
git add src/content.config.ts src/content/writing/how-a-browser-loads-a-page.md src/content/writing/understanding-flux-architecture.md "src/pages/writing/[...slug].astro"
git commit -m "Add tags to writing articles"
```
