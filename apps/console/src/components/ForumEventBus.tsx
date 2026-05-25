"use client";

import { useForumEvents } from "@/lib/useForumEvents";

/// App-wide SSE mount. Renders nothing — purely calls useForumEvents() once so a
/// single EventSource fires `window.dispatchEvent("forum-event")` on every market
/// event. Mount in the root layout so realtime works on every page, not just the
/// landing where LiveTicker happened to live.
///
/// Components that need realtime data add `window.addEventListener("forum-event")`
/// — no prop-drilling, no per-page mount.
export function ForumEventBus() {
  useForumEvents();
  return null;
}
