# Writing article tags

## Purpose

Writing articles (`src/content/writing/*.md`) currently have no way to signal
topic at a glance. Add a `tags` field so each article can carry a small set
of topic labels, displayed as badges on the article page.

Projects already have an unrelated `tags` field (a free-text string rendered
as a single badge in `ProjectRow.astro`, e.g. `"Construction, SaaS, Radi
Digital"`). This spec does not touch that - it is out of scope and left
exactly as-is.

## Scope

- In scope: a `tags` field on the `writing` content collection, populated on
  the two existing articles, rendered as badges on the article page
  (`src/pages/writing/[...slug].astro`).
- Out of scope: tags on projects, clickable/linked tags, per-tag browse
  pages, tag filtering UI, tags in the homepage "recent writing" list.

## Data model

`src/content.config.ts`: add one field to the `writing` collection schema.

```ts
tags: z.array(z.string()).default([]),
```

Free-form array of strings, no central enum/taxonomy - matches the site's
existing pattern of hand-authored frontmatter with no build-time tag
registry. `default([])` keeps the field optional so it never breaks
existing or future posts that omit it.

Tags are written lowercase, matching the site's overall lowercase style
(page titles, h1s, project tags).

## Content changes

Add a `tags:` list to each article's frontmatter, based on actual content:

- `how-a-browser-loads-a-page.md`: `[browsers, rendering, networking]`
- `understanding-flux-architecture.md`: `[flux, architecture, state-management]`

## Rendering

`src/pages/writing/[...slug].astro`: render one small badge per tag,
directly under the existing date line, only when `post.data.tags.length > 0`
(so a post with no tags renders identically to today).

Visual style reuses the existing project-tag badge look from
`ProjectRow.astro` (`rounded-md border border-gray-300 px-1 py-0.5
text-[10px] text-gray-500`), applied per-tag instead of to one
comma-joined string:

```astro
{tags.length > 0 && (
  <div class="mt-2 flex flex-wrap gap-1">
    {tags.map((tag) => (
      <span class="w-fit rounded-md border border-gray-300 px-1 py-0.5 text-[10px] text-gray-500">{tag}</span>
    ))}
  </div>
)}
```

Badges are plain `<span>`s - not links, not buttons. No hover state, no
click handler.

## Testing

- `npx astro build` after the schema and content changes, to confirm the
  content collection validates and both articles still prerender.
- Manual check of the built HTML (or dev server) for both articles to
  confirm badges render with the expected tags and styling, and that
  removing `tags` from an article's frontmatter (hypothetically) would fall
  back to no badges without error, given the `default([])`.

## Non-goals / explicitly deferred

- Per-tag pages or a `/writing` index with filtering - deferred until there
  are enough articles for browsing by tag to matter.
- Sharing a tag concept with projects - the two `tags` fields are unrelated
  today and this spec keeps them that way.
