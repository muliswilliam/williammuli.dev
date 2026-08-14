import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { site } from "../data/site";
import { getPublishedArticles } from "../lib/writing";

export async function GET(context: APIContext) {
  const articles = await getPublishedArticles();

  return rss({
    title: site.name,
    description: site.description,
    site: context.site ?? site.url,
    items: articles.map((article) => ({
      title: article.data.title,
      description: article.data.description,
      pubDate: article.data.publishDate,
      link: `/writing/${article.id}/`,
    })),
  });
}
