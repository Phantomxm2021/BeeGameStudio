const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pageId = crypto.randomUUID();
let memoryVisitor = crypto.randomUUID();
let memorySession = {
  id: crypto.randomUUID(),
  updated: Date.now(),
  started: Date.now(),
};
const sent = new Set();
function identifiers() {
  const now = Date.now();
  try {
    const stored = localStorage.getItem("beeplay-visitor");
    if (stored && uuid.test(stored)) memoryVisitor = stored;
    else localStorage.setItem("beeplay-visitor", memoryVisitor);
    const saved = JSON.parse(
      sessionStorage.getItem("beeplay-session") || "null",
    );
    if (
      saved &&
      uuid.test(saved.id) &&
      Number.isFinite(saved.updated) &&
      Number.isFinite(saved.started)
    )
      memorySession = saved;
  } catch {
    /* Storage-disabled browsers use this page's in-memory identifiers. */
  }
  if (
    now - memorySession.updated > 30 * 60_000 ||
    now - memorySession.started > 24 * 60 * 60_000
  )
    memorySession = { id: crypto.randomUUID(), updated: now, started: now };
  memorySession.updated = now;
  try {
    sessionStorage.setItem("beeplay-session", JSON.stringify(memorySession));
  } catch {
    /* Optional storage. */
  }
  return { visitorId: memoryVisitor, sessionId: memorySession.id };
}
export async function trackPortalEvent(kind, projectId) {
  if (document.visibilityState !== "visible") {
    if (kind === "visit") {
      const visible = () => {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", visible);
        void trackPortalEvent(kind, projectId);
      };
      document.addEventListener("visibilitychange", visible);
    }
    return;
  }
  const { visitorId, sessionId } = identifiers();
  const dedupId = kind === "play" ? sessionId : pageId;
  const key = `${kind}:${projectId}:${dedupId}`;
  if (sent.has(key)) return;
  sent.add(key);
  try {
    const response = await fetch("/api/events", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, projectId, visitorId, dedupId }),
    });
    if (response.ok) return await response.json();
  } catch {
    /* Analytics failure must not block playing or navigation; no retry loop. */
  }
}
export function observeBanner(slide, projectId) {
  const visible = () => {
    if (document.visibilityState === "visible") {
      observer.unobserve(slide);
      observer.observe(slide);
    }
  };
  const observer = new IntersectionObserver(
    (entries) => {
      if (
        document.visibilityState === "visible" &&
        entries.some((entry) => entry.intersectionRatio >= 0.5)
      ) {
        void trackPortalEvent("banner_impression", projectId);
        observer.disconnect();
        document.removeEventListener("visibilitychange", visible);
      }
    },
    { threshold: 0.5 },
  );
  observer.observe(slide);
  document.addEventListener("visibilitychange", visible);
}
