# Clickable Writing Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each tag badge on a writing article a link to a page listing every article that shares that tag.

**Architecture:** Extract the homepage's article-card markup into a shared `ArticleCard` component, then add a `/writing/tags/[tag]/` dynamic route (built via `getStaticPaths` over the `writing` collection) that renders that component for every post carrying the given tag, and turn the article page's tag badges into links to it.

**Tech Stack:** Astro 7 content collections (`astro:content`), Tailwind CSS utility classes.

## Global Constraints

- Tag pages live at `/writing/tags/[tag]/` (per spec "Data & routing").
- Tags are already lowercase, hyphenated, URL-safe strings — no slugification needed (per spec "Data & routing").
- The homepage's "recent writing" section must be visually unchanged after the `ArticleCard` extraction — same classes, same DOM structure (per spec "Shared `ArticleCard` component").
- `ArticleCard` takes a pre-formatted `date` string (caller calls `formatArticleDate` first) — it has no knowledge of the `writing` collection's shape (per spec "Shared `ArticleCard` component").
- Tag badges keep their existing base classes (`w-fit rounded-md border border-gray-300 px-1 py-0.5 text-[10px] text-gray-500`) and add a hover affordance; the unrelated project-tags badge in `ProjectRow.astro` is untouched (per spec "Clickable badges").
- No `/tags/` or `/writing/tags/` index page, no tag-filtering UI (per spec "Non-goals").
- This project has no unit test runner configured; verification is `npx astro build` plus manual inspection of the built HTML, matching the spec's own "Testing" section.

---

### Task 1: Extract `ArticleCard` component and use it on the homepage

**Files:**
- Create: `src/components/ArticleCard.astro`
- Modify: `src/pages/index.astro:198-208`

**Interfaces:**
- Produces: `ArticleCard` Astro component with props `{ href: string; title: string; date: string; description: string }`, rendering one `<li>` card. Task 2 uses this component in the new tag page.

This is one task because the component and its only current caller (the homepage) must change together to stay buildable — a component with no caller, or a caller half-migrated, isn't independently testable.

- [ ] **Step 1: Create the `ArticleCard` component**

Create `src/components/ArticleCard.astro`:

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

- [ ] **Step 2: Use `ArticleCard` in the homepage's "recent writing" list**

Edit `src/pages/index.astro`. Add the import alongside the other component imports (near line 5-8):

```astro
import ArticleCard from "../components/ArticleCard.astro";
```

Then replace the inline card markup at lines 198-208:

```astro
              {recentWriting.map((post) => (
                <li>
                  <a href={`/writing/${post.id}/`} class="block rounded-md border border-gray-200 p-3 transition-colors hover:bg-gray-50">
                    <div class="flex items-center justify-between">
                      <h3 class="font-medium text-black">{post.data.title}</h3>
                      <span class="text-xs text-gray-400">{formatArticleDate(post.data.date)}</span>
                    </div>
                    <p class="mt-1 text-sm text-gray-700">{post.data.description}</p>
                  </a>
                </li>
              ))}
```

with:

```astro
              {recentWriting.map((post) => (
                <ArticleCard
                  href={`/writing/${post.id}/`}
                  title={post.data.title}
                  date={formatArticleDate(post.data.date)}
                  description={post.data.description}
                />
              ))}
```

- [ ] **Step 3: Build and verify the homepage is visually unchanged**

Run: `npx astro build`

Expected: build completes with no errors, and `/index.html` prerenders.

Then confirm the rendered card markup is byte-identical to before the refactor (same classes, same structure — only the component boundary changed):

```bash
grep -o '<li><a href="/writing/[^"]*" class="block rounded-md border border-gray-200 p-3 transition-colors hover:bg-gray-50">.*</a></li>' dist/client/index.html | head -2
```

Expected: two `<li>` cards, one per `recentWriting` post, each containing the post's title, formatted date (e.g. `aug 2019`), and description — same content as it rendered before this task.

Clean up the build output afterward: `rm -rf dist`

- [ ] **Step 4: Commit**

```bash
git add src/components/ArticleCard.astro src/pages/index.astro
git commit -m "Extract ArticleCard component from homepage writing list"
```

---

### Task 2: Add per-tag pages and make tag badges link to them

**Files:**
- Create: `src/pages/writing/tags/[tag].astro`
- Modify: `src/pages/writing/[...slug].astro`

**Interfaces:**
- Consumes: `ArticleCard` component (`{ href, title, date, description }` props) from Task 1; `formatArticleDate(date: Date): string` from `src/lib/format-date.ts`.
- Produces: static routes at `/writing/tags/<tag>/` for every distinct tag value across the `writing` collection.

This is one task because the tag page and the badge links that point to it are only meaningfully testable together — a tag page nothing links to, or a link with no destination, can't be verified end-to-end.

- [ ] **Step 1: Create the tag page**

Create `src/pages/writing/tags/[tag].astro`:

```astro
---
export const prerender = true;

import { getCollection } from "astro:content";
import Layout from "../../../layouts/Layout.astro";
import ArticleCard from "../../../components/ArticleCard.astro";
import { formatArticleDate } from "../../../lib/format-date";

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

const { tag, posts } = Astro.props;
---

<Layout title={`tagged: ${tag} - William Muli`} description={`Articles tagged "${tag}".`}>
  <div class="min-h-screen bg-[#fdfff4]">
    <main class="mx-auto max-w-3xl px-8 py-12 font-mono text-sm leading-relaxed md:px-16">
      <a href="/" class="text-xs text-gray-500 underline hover:text-black">← back</a>

      <h1 class="mt-6 text-xl font-bold text-black">tagged: {tag}</h1>
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
    </main>
  </div>
</Layout>
```

- [ ] **Step 2: Turn tag badges into links**

Edit `src/pages/writing/[...slug].astro`. Current tag-rendering block:

```astro
        {tags.length > 0 && (
          <div class="mt-2 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span class="w-fit rounded-md border border-gray-300 px-1 py-0.5 text-[10px] text-gray-500">{tag}</span>
            ))}
          </div>
        )}
```

Replace it with:

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

- [ ] **Step 3: Build and verify**

Run: `npx astro build`

Expected: build completes with no errors, and the prerender output lists one route per distinct tag across both existing articles:

```
├─ /writing/tags/browsers/index.html
├─ /writing/tags/rendering/index.html
├─ /writing/tags/networking/index.html
├─ /writing/tags/flux/index.html
├─ /writing/tags/architecture/index.html
├─ /writing/tags/state-management/index.html
```

(order may vary)

Then verify one tag page's content and one article page's updated badge markup:

```bash
grep -o '<h1[^>]*>tagged: browsers</h1>' dist/client/writing/tags/browsers/index.html
grep -o '<a href="/writing/how-a-browser-loads-a-page/"[^>]*>.*</a>' dist/client/writing/tags/browsers/index.html | head -1
grep -o '<a href="/writing/tags/browsers/"[^>]*>browsers</a>' dist/client/writing/how-a-browser-loads-a-page/index.html
```

Expected:
- First command: matches the `tagged: browsers` heading.
- Second command: an `ArticleCard` link to `/writing/how-a-browser-loads-a-page/` (the only article tagged `browsers`).
- Third command: the `browsers` badge on the article page is now an `<a>` pointing to `/writing/tags/browsers/`.

Clean up the build output afterward: `rm -rf dist`

- [ ] **Step 4: Commit**

```bash
git add "src/pages/writing/tags/[tag].astro" "src/pages/writing/[...slug].astro"
git commit -m "Make writing tags clickable, linking to per-tag article lists"
```
