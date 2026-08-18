# Clickable writing tags

## Purpose

Writing articles carry `tags` (added in [[2026-08-18-writing-tags-design]])
but they render as plain, non-interactive badges. Make each tag a link to a
page listing every article that shares it, so tags become a real way to
browse the writing section by topic.

## Scope

- In scope: a `/writing/tags/[tag]/` page per distinct tag, tag badges on
  the article page becoming links to that page, and extracting the
  homepage's article-card markup into a shared component so both the
  homepage and the new tag page render cards identically.
- Out of scope: a combined `/tags/` index of all tags, tag filtering UI
  (multi-select, search), tags on projects, changing what tags exist on the
  two current articles.

## Data & routing

New file: `src/pages/writing/tags/[tag].astro`.

`getStaticPaths()` reads `getCollection("writing")`, builds the set of
distinct tag strings across all posts (`new Set(posts.flatMap(p =>
p.data.tags))`), and returns one path per tag:

```ts
export async function getStaticPaths() {
  const posts = await getCollection("writing");
  const tags = [...new Set(posts.flatMap((post) => post.data.tags))];

  return tags.map((tag) => {
    const taggedPosts = posts
      .filter((post) => post.data.tags.includes(tag))
      .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

    return { params: { tag }, props: { tag, posts: taggedPosts } };
  });
}
```

Tags are already lowercase, hyphenated, URL-safe strings (`browsers`,
`state-management`, etc.) — no slugification step needed. A tag that later
contains characters unsafe for a URL segment is out of scope; today's tags
don't.

## Shared `ArticleCard` component

New file: `src/components/ArticleCard.astro`. Extracts the card markup
currently inline in `src/pages/index.astro:198-208`:

```astro
---
interface Props {
  href: string;
  title: string;
  date: string;
  description: string;
}

const { href, title, date, description } = Astro.props;
---

<li>
  <a href={href} class="block rounded-md border border-gray-200 p-3 transition-colors hover:bg-gray-50">
    <div class="flex items-center justify-between">
      <h3 class="font-medium text-black">{title}</h3>
      <span class="text-xs text-gray-400">{date}</span>
    </div>
    <p class="mt-1 text-sm text-gray-700">{description}</p>
  </a>
</li>
```

`date` is a pre-formatted string (the caller calls `formatArticleDate`
before passing it in) so the component stays a pure presentation unit with
no knowledge of the `writing` collection's shape.

`src/pages/index.astro`'s "recent writing" list becomes:

```astro
<ul class="space-y-3">
  {recentWriting.map((post) => (
    <ArticleCard
      href={`/writing/${post.id}/`}
      title={post.data.title}
      date={formatArticleDate(post.data.date)}
      description={post.data.description}
    />
  ))}
</ul>
```

No visual change on the homepage — same classes, same DOM structure, just
sourced from one component instead of inline markup.

## Tag page layout

`src/pages/writing/tags/[tag].astro` reuses the same page shell as an
article (`min-h-screen bg-[#fdfff4]`, `max-w-3xl` centered column, mono
font, `← back` link to `/`), with:

```astro
<h1 class="text-xl font-bold text-black">tagged: {tag}</h1>
<ul class="mt-6 space-y-3">
  {posts.map((post) => (
    <ArticleCard
      href={`/writing/${post.id}/`}
      title={post.data.title}
      date={formatArticleDate(post.data.date)}
      description={post.data.description}
    />
  ))}
</ul>
```

Page `<title>`/meta description: `tagged: {tag} - William Muli` /
`Articles tagged "{tag}".`

## Clickable badges

In `src/pages/writing/[...slug].astro`, each tag badge changes from a
`<span>` to an `<a>`:

```astro
{tags.length > 0 && (
  <div class="mt-2 flex flex-wrap gap-1">
    {tags.map((tag) => (
      <a
        href={`/writing/tags/${tag}/`}
        class="w-fit rounded-md border border-gray-300 px-1 py-0.5 text-[10px] text-gray-500 transition-colors hover:border-gray-400 hover:text-black"
      >
        {tag}
      </a>
    ))}
  </div>
)}
```

Same visual footprint as today (identical base classes), plus a hover
affordance so the badge reads as clickable. The unrelated project-tags
badge in `ProjectRow.astro` is untouched.

## Testing

- `npx astro build` — confirm one static route prerenders per distinct tag
  (with today's two articles: `browsers`, `rendering`, `networking`,
  `flux`, `architecture`, `state-management` — six tag pages).
- Inspect generated HTML for one tag page to confirm it lists the correct
  article(s) via `ArticleCard` output matching the homepage's card markup.
- Inspect generated HTML for an article page to confirm tag badges are now
  `<a href="/writing/tags/{tag}/">` elements with the updated classes.
- Confirm the homepage's "recent writing" section is visually unchanged
  (same classes/structure, now via `ArticleCard`).

## Non-goals / explicitly deferred

- A `/tags/` or `/writing/tags/` index listing all tags — deferred until
  there are enough tags that browsing "all tags" (rather than jumping from
  an article) is useful.
- Any tag-filtering UI (checkboxes, search) — a plain per-tag page is
  enough for the current two articles.
