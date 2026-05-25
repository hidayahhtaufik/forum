/// Tiny RSS parser. No external dep — ECB and most macro news feeds emit
/// well-formed RSS 2.0 that's regex-extractable. Trade-offs: doesn't handle
/// HTML entities deeply, doesn't parse Atom feeds. Fine for the scout's two
/// curated feeds; swap to `rss-parser` if you add weirder sources later.

export type FeedItem = {
  /** RSS <title> with HTML entities decoded */
  title: string;
  /** RSS <link> */
  link: string;
  /** RSS <pubDate> ISO-ish string (raw) */
  pubDate: string;
  /** Parsed unix-seconds. NaN if pubDate was un-parseable. */
  pubUnix: number;
  /** RSS <description> stripped of HTML tags */
  description: string;
};

const ITEM_RE = /<item[\s>][\s\S]*?<\/item>/gi;
const TITLE_RE = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:]]>)?<\/title>/i;
const LINK_RE = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:]]>)?<\/link>/i;
const PUBDATE_RE = /<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:]]>)?<\/pubDate>/i;
const DESC_RE = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:]]>)?<\/description>/i;

const ENTITY: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => ENTITY[m] ?? m).trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/// Fetches an RSS feed and returns its items. Throws on HTTP error / parse error.
export async function fetchFeed(url: string, timeoutMs = 15_000): Promise<FeedItem[]> {
  const res = await fetch(url, {
    headers: { "user-agent": "FORUM-scout/0.1 (+https://forum.auranode.xyz)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`feed fetch ${url}: ${res.status}`);
  const xml = await res.text();
  const items: FeedItem[] = [];
  for (const block of xml.match(ITEM_RE) ?? []) {
    const titleM = block.match(TITLE_RE);
    const linkM = block.match(LINK_RE);
    const dateM = block.match(PUBDATE_RE);
    const descM = block.match(DESC_RE);
    const title = decodeEntities(titleM?.[1] ?? "");
    const link = decodeEntities(linkM?.[1] ?? "");
    const pubDate = decodeEntities(dateM?.[1] ?? "");
    const description = decodeEntities(stripTags(descM?.[1] ?? ""));
    if (!title || !link) continue; // useless item
    items.push({
      title,
      link,
      pubDate,
      pubUnix: Math.floor(new Date(pubDate).getTime() / 1000),
      description,
    });
  }
  return items;
}
