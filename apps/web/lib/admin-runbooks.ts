/**
 * The runbooks Admin settings points an operator at, as doc and heading pairs. Until M129 the line named
 * three docs that were never written; kept as data so tests/unit/doc-refs.test.ts can check that every
 * doc exists and holds the heading named here.
 */
export const ADMIN_RUNBOOKS = [
  { doc: "docs/deployment.md", heading: "Safe Upgrade Flow" },
  { doc: "docs/deployment.md", heading: "Release Channels And Tags" },
  { doc: "docs/operations.md", heading: "Backup And Restore" }
] as const;

/**
 * The Runbooks sentence, grouped by doc in the order above: See "Safe Upgrade Flow" and "Release Channels And
 * Tags" in docs/deployment.md, and "Backup And Restore" in docs/operations.md. The page renders plain text, so
 * headings are quoted and paths left bare (no Markdown marks on screen).
 */
export function describeAdminRunbooks(runbooks: ReadonlyArray<{ doc: string; heading: string }> = ADMIN_RUNBOOKS): string {
  const docs: Array<{ doc: string; headings: string[] }> = [];
  for (const { doc, heading } of runbooks) {
    const group = docs.find((entry) => entry.doc === doc);
    if (group) {
      group.headings.push(heading);
    } else {
      docs.push({ doc, headings: [heading] });
    }
  }
  const parts = docs.map(({ doc, headings }) => `${joinWords(headings.map((heading) => `"${heading}"`))} in ${doc}`);
  return `See ${joinWords(parts, ", and ")}.`;
}

function joinWords(words: string[], lastSeparator = " and "): string {
  if (words.length <= 1) {
    return words.join("");
  }
  return `${words.slice(0, -1).join(", ")}${lastSeparator}${words[words.length - 1]}`;
}
