export function formatArticleDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" }).toLowerCase();
}
