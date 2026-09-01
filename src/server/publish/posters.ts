/**
 * Die Poster selbst. Jeder ist klein, ohne Bibliothek und mit einspeisbarem
 * `fetch`, damit er in Tests gegen eine Attrappe läuft.
 *
 * Gemeinsame Regeln: höchstens vier Bilder, harte Zeitschranke je Aufruf, und
 * bei jedem Fehler eine Meldung, die den Anbieter und den Status nennt — ein
 * fehlgeschlagener Post soll erklärbar sein, ohne ins Log zu steigen.
 */
import fs from "node:fs";
import path from "node:path";
import type { PlatformPoster, PostInput, PostOutput } from "./types.js";

const TIMEOUT = 60_000;
const need = (creds: Record<string, string>, keys: string[]): string[] => keys.filter((k) => !creds[k]?.trim());

async function call(fetchImpl: typeof fetch, url: string, init: RequestInit, who: string): Promise<Response> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`${who} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

// --- Bluesky ------------------------------------------------------------------

/** Facetten für Links: Bluesky macht URLs nur klickbar, wenn ihre Byte-Position mitgeliefert wird. */
export function linkFacets(text: string): unknown[] {
  const enc = new TextEncoder();
  const out: unknown[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s)]+/g)) {
    const start = enc.encode(text.slice(0, m.index)).length;
    out.push({ index: { byteStart: start, byteEnd: start + enc.encode(m[0]).length }, features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }] });
  }
  return out;
}

export const blueskyPoster: PlatformPoster = {
  platform: "bluesky",
  missing: (c) => need(c, ["handle", "appPassword"]),
  async post(i: PostInput): Promise<PostOutput> {
    const f = i.fetchImpl ?? fetch;
    const service = (i.creds["service"] || "https://bsky.social").replace(/\/$/, "");
    const session = await json<{ accessJwt: string; did: string; handle: string }>(await call(f, `${service}/xrpc/com.atproto.server.createSession`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: i.creds["handle"], password: i.creds["appPassword"] }),
    }, "Bluesky-Login"));
    const auth = { Authorization: `Bearer ${session.accessJwt}` };

    const images: unknown[] = [];
    for (const a of i.assets.filter((x) => x.kind === "image").slice(0, 4)) {
      const blob = await json<{ blob: unknown }>(await call(f, `${service}/xrpc/com.atproto.repo.uploadBlob`, {
        method: "POST", headers: { ...auth, "Content-Type": a.mime }, body: fs.readFileSync(a.path) as unknown as BodyInit,
      }, "Bluesky-Upload"));
      images.push({ image: blob.blob, alt: a.alt.slice(0, 300) });
    }
    // 300 Zeichen sind hart; lieber sauber kürzen als vom Server abgeschnitten werden
    const text = i.text.length > 300 ? `${i.text.slice(0, 297).replace(/\s+\S*$/, "")}…` : i.text;
    const record: Record<string, unknown> = { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString(), langs: ["de"] };
    const facets = linkFacets(text);
    if (facets.length) record["facets"] = facets;
    if (images.length) record["embed"] = { $type: "app.bsky.embed.images", images };
    const res = await json<{ uri: string }>(await call(f, `${service}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
    }, "Bluesky-Post"));
    const rkey = res.uri.split("/").pop() ?? "";
    return { ref: res.uri, externalUrl: `https://bsky.app/profile/${session.handle}/post/${rkey}` };
  },
};

// --- Telegram -----------------------------------------------------------------

export const telegramPoster: PlatformPoster = {
  platform: "telegram",
  missing: (c) => need(c, ["botToken", "chatId"]),
  async post(i: PostInput): Promise<PostOutput> {
    const f = i.fetchImpl ?? fetch;
    const api = `https://api.telegram.org/bot${i.creds["botToken"]}`;
    const chatId = i.creds["chatId"]!;
    const caption = i.text.slice(0, 1024);
    const pics = i.assets.filter((x) => x.kind === "image").slice(0, 10);
    const videos = i.assets.filter((x) => x.kind === "video");

    const form = new FormData();
    form.set("chat_id", chatId);
    let endpoint: string;
    if (videos[0]) {
      endpoint = "sendVideo";
      form.set("caption", caption);
      form.set("video", new Blob([fs.readFileSync(videos[0].path)], { type: videos[0].mime }), path.basename(videos[0].path));
    } else if (pics.length > 1) {
      // Album: die Bildunterschrift traegt nur das erste Bild, sonst zeigt Telegram sie gar nicht
      endpoint = "sendMediaGroup";
      form.set("media", JSON.stringify(pics.map((_, n) => ({ type: "photo", media: `attach://p${n}`, ...(n === 0 ? { caption } : {}) }))));
      pics.forEach((a, n) => form.set(`p${n}`, new Blob([fs.readFileSync(a.path)], { type: a.mime }), path.basename(a.path)));
    } else if (pics[0]) {
      endpoint = "sendPhoto";
      form.set("caption", caption);
      form.set("photo", new Blob([fs.readFileSync(pics[0].path)], { type: pics[0].mime }), path.basename(pics[0].path));
    } else {
      endpoint = "sendMessage";
      form.set("text", i.text.slice(0, 4096));
    }
    const out = await json<{ result: { message_id: number } | { message_id: number }[] }>(await call(f, `${api}/${endpoint}`, { method: "POST", body: form }, "Telegram"));
    const first = Array.isArray(out.result) ? out.result[0] : out.result;
    const id = first?.message_id ?? 0;
    const channel = chatId.startsWith("@") ? chatId.slice(1) : null;
    return { ref: String(id), externalUrl: channel ? `https://t.me/${channel}/${id}` : null };
  },
};

// --- Mastodon -----------------------------------------------------------------

export const mastodonPoster: PlatformPoster = {
  platform: "mastodon",
  missing: (c) => need(c, ["instance", "accessToken"]),
  async post(i: PostInput): Promise<PostOutput> {
    const f = i.fetchImpl ?? fetch;
    const base = i.creds["instance"]!.replace(/\/$/, "");
    const auth = { Authorization: `Bearer ${i.creds["accessToken"]}` };
    const ids: string[] = [];
    for (const a of i.assets.slice(0, 4)) {
      const form = new FormData();
      form.set("file", new Blob([fs.readFileSync(a.path)], { type: a.mime }), path.basename(a.path));
      if (a.alt) form.set("description", a.alt.slice(0, 1000));
      const m = await json<{ id: string }>(await call(f, `${base}/api/v2/media`, { method: "POST", headers: auth, body: form }, "Mastodon-Upload"));
      ids.push(m.id);
    }
    const body = new URLSearchParams({ status: i.text.slice(0, 500) });
    for (const id of ids) body.append("media_ids[]", id);
    const st = await json<{ id: string; url: string }>(await call(f, `${base}/api/v1/statuses`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" }, body,
    }, "Mastodon-Post"));
    return { ref: st.id, externalUrl: st.url };
  },
};

// --- Meta (Instagram / Facebook-Seite) ----------------------------------------

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Instagram nimmt keine Dateien entgegen, sondern **öffentliche URLs**. Deshalb
 * bekommt jedes Asset eine signierte, ablaufende Adresse (`/go/a/<token>`) —
 * siehe `assetTokens.ts`. Ein Carousel entsteht in drei Schritten: Kind-Container,
 * Sammel-Container, veröffentlichen.
 */
export const instagramPoster: PlatformPoster = {
  platform: "instagram",
  missing: (c) => need(c, ["igUserId", "accessToken"]),
  async post(i: PostInput): Promise<PostOutput> {
    const f = i.fetchImpl ?? fetch;
    const user = i.creds["igUserId"]!;
    const token = i.creds["accessToken"]!;
    const caption = i.text.slice(0, 2200);
    const media = i.assets.filter((a) => a.url).slice(0, 10);
    if (!media.length) throw new Error("Instagram braucht mindestens ein Bild oder Video.");

    const container = async (params: Record<string, string>): Promise<string> => {
      const body = new URLSearchParams({ ...params, access_token: token });
      const out = await json<{ id: string }>(await call(f, `${GRAPH}/${user}/media`, { method: "POST", body }, "Instagram"));
      return out.id;
    };

    let creationId: string;
    const video = media.find((a) => a.kind === "video");
    if (video) {
      creationId = await container({ media_type: "REELS", video_url: video.url, caption });
    } else if (media.length === 1) {
      creationId = await container({ image_url: media[0]!.url, caption });
    } else {
      const children: string[] = [];
      for (const a of media) children.push(await container({ image_url: a.url, is_carousel_item: "true" }));
      creationId = await container({ media_type: "CAROUSEL", children: children.join(","), caption });
    }
    const pub = await json<{ id: string }>(await call(f, `${GRAPH}/${user}/media_publish`, {
      method: "POST", body: new URLSearchParams({ creation_id: creationId, access_token: token }),
    }, "Instagram-Publish"));
    return { ref: pub.id, externalUrl: null };
  },
};

export const facebookPoster: PlatformPoster = {
  platform: "facebook",
  missing: (c) => need(c, ["pageId", "accessToken"]),
  async post(i: PostInput): Promise<PostOutput> {
    const f = i.fetchImpl ?? fetch;
    const page = i.creds["pageId"]!;
    const token = i.creds["accessToken"]!;
    const pic = i.assets.find((a) => a.kind === "image" && a.url);
    if (pic) {
      const out = await json<{ post_id?: string; id: string }>(await call(f, `${GRAPH}/${page}/photos`, {
        method: "POST", body: new URLSearchParams({ url: pic.url, caption: i.text.slice(0, 2000), access_token: token }),
      }, "Facebook"));
      const id = out.post_id ?? out.id;
      return { ref: id, externalUrl: `https://www.facebook.com/${id}` };
    }
    const out = await json<{ id: string }>(await call(f, `${GRAPH}/${page}/feed`, {
      method: "POST", body: new URLSearchParams({ message: i.text.slice(0, 2000), ...(i.link ? { link: i.link } : {}), access_token: token }),
    }, "Facebook"));
    return { ref: out.id, externalUrl: `https://www.facebook.com/${out.id}` };
  },
};

// --- Pinterest ----------------------------------------------------------------

export const pinterestPoster: PlatformPoster = {
  platform: "pinterest",
  missing: (c) => need(c, ["boardId", "accessToken"]),
  async post(i: PostInput): Promise<PostOutput> {
    const f = i.fetchImpl ?? fetch;
    const pic = i.assets.find((a) => a.kind === "image" && a.url);
    if (!pic) throw new Error("Ein Pin braucht ein Bild.");
    const out = await json<{ id: string }>(await call(f, "https://api.pinterest.com/v5/pins", {
      method: "POST", headers: { Authorization: `Bearer ${i.creds["accessToken"]}`, "Content-Type": "application/json" },
      body: JSON.stringify({ board_id: i.creds["boardId"], title: i.title.slice(0, 100), description: i.text.slice(0, 800), ...(i.link ? { link: i.link } : {}), media_source: { source_type: "image_url", url: pic.url } }),
    }, "Pinterest"));
    return { ref: out.id, externalUrl: `https://www.pinterest.com/pin/${out.id}/` };
  },
};

// --- Threads ------------------------------------------------------------------

const THREADS = "https://graph.threads.net/v1.0";

/**
 * Threads laeuft wie Instagram in zwei Schritten (Container, dann
 * veroeffentlichen), aber auf einem eigenen Host und mit eigenem Token. Fuer das
 * **eigene** Konto genuegt die Tester-Rolle in der Meta-App — kein App Review.
 * Textlaenge 500 Zeichen, bis zu 20 Bilder als Carousel.
 */
export const threadsPoster: PlatformPoster = {
  platform: "threads",
  missing: (c) => need(c, ["userId", "accessToken"]),
  async post(i: PostInput): Promise<PostOutput> {
    const f = i.fetchImpl ?? fetch;
    const user = i.creds["userId"]!;
    const token = i.creds["accessToken"]!;
    const text = i.text.length > 500 ? `${i.text.slice(0, 497).replace(/\s+\S*$/, "")}…` : i.text;
    const media = i.assets.filter((a) => a.url).slice(0, 20);

    const container = async (params: Record<string, string>): Promise<string> => {
      const out = await json<{ id: string }>(await call(f, `${THREADS}/${user}/threads`, {
        method: "POST", body: new URLSearchParams({ ...params, access_token: token }),
      }, "Threads"));
      return out.id;
    };

    let creationId: string;
    const video = media.find((a) => a.kind === "video");
    if (video) creationId = await container({ media_type: "VIDEO", video_url: video.url, text });
    else if (media.length === 1) creationId = await container({ media_type: "IMAGE", image_url: media[0]!.url, text });
    else if (media.length > 1) {
      const children: string[] = [];
      for (const a of media) children.push(await container({ media_type: "IMAGE", image_url: a.url, is_carousel_item: "true" }));
      creationId = await container({ media_type: "CAROUSEL", children: children.join(","), text });
    } else creationId = await container({ media_type: "TEXT", text });

    const pub = await json<{ id: string }>(await call(f, `${THREADS}/${user}/threads_publish`, {
      method: "POST", body: new URLSearchParams({ creation_id: creationId, access_token: token }),
    }, "Threads-Publish"));
    // Der Permalink kostet einen zusaetzlichen Aufruf, macht den Eintrag aber anklickbar.
    let permalink: string | null = null;
    try {
      const info = await json<{ permalink?: string }>(await call(f, `${THREADS}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(token)}`, {}, "Threads-Permalink"));
      permalink = info.permalink ?? null;
    } catch { /* der Post steht, der Link ist Kuer */ }
    return { ref: pub.id, externalUrl: permalink };
  },
};

export const POSTERS: Record<string, PlatformPoster> = {
  threads: threadsPoster,
  bluesky: blueskyPoster, telegram: telegramPoster, mastodon: mastodonPoster,
  instagram: instagramPoster, facebook: facebookPoster, pinterest: pinterestPoster,
};
