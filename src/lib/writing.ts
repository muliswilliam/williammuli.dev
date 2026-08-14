import { getCollection, type CollectionEntry } from "astro:content";

export async function getPublishedArticles(): Promise<CollectionEntry<"writing">[]> {
  const entries = await getCollection("writing", ({ data }) => {
    return !data.draft && data.publishDate <= new Date();
  });

  return entries.sort((a, b) => b.data.publishDate.valueOf() - a.data.publishDate.valueOf());
}
