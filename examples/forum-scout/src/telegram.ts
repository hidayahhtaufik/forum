/// Telegram public-channel scraper. No Bot API key needed — just hits the
/// public preview page `t.me/s/<channel>` and regex-extracts message blocks.
/// Trade-off: only works for PUBLIC channels, can't read DMs / private groups.
///
/// For FORUM scout this is ideal — most macro/FX analyst channels are public:
///   forexlive, dailyFXteam, ECB-watch communities, crypto-macro feeds, etc.
///
/// Rate limit: t.me serves ~50 messages per page; we cap items per tick at the
/// outer caller's SCOUT_MAX_ITEMS_PER_TICK. Channel scrape itself is one HTTP
/// fetch per poll — very cheap, very legal (public read).

import type { FeedItem } from "./rss.js";

/// Match: <div class="tgme_widget_message" ... data-post="channel/123" ...>
///        <div class="tgme_widget_message_text"> ... </div>
///        <a class="tgme_widget_message_date" href="..."><time datetime="..." /></a>
const MSG_BLOCK_RE = /<div class="tgme_widget_message[^"]*"[^>]*data-post="([^"]+)"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;
const TEXT_RE = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/;
const TIME_RE = /datetime="([^"]+)"/;

const TG_BASE = "https://t.me";

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/// Fetch the latest posts from a public Telegram channel. `channelName` is
/// the channel handle without @ (e.g. "forexlive", "TheBlock__").
export async function fetchTelegramChannel(channelName: string, timeoutMs = 15_000): Promise<FeedItem[]> {
  const url = `${TG_BASE}/s/${channelName.replace(/^@/, "")}`;
  const res = await fetch(url, {
    headers: {
      "user-agent": "FORUM-scout/0.1 (+https://forum.auranode.xyz)",
      accept: "text/html",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`tg fetch ${channelName}: ${res.status}`);
  const html = await res.text();

  const items: FeedItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = MSG_BLOCK_RE.exec(html)) !== null) {
    const block = m[0]!;
    const dataPost = m[1]!;
    const textM = block.match(TEXT_RE);
    const timeM = block.match(TIME_RE);
    if (!textM) continue;
    const text = stripHtml(textM[1] ?? "");
    if (!text || text.length < 16) continue; // skip tiny posts (reactions, single emoji)
    const pubDate = timeM?.[1] ?? "";
    const pubUnix = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : 0;
    items.push({
      title: text.length > 200 ? text.slice(0, 197) + "…" : text,
      link: `${TG_BASE}/${dataPost}`,
      pubDate,
      pubUnix,
      description: text,
    });
  }
  return items;
}
