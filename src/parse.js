/*
 * IG Exporter - parsing helpers.
 * Works both as a content-script classic script (attaches to globalThis.IGX)
 * and as a CommonJS module for offline tests (module.exports).
 *
 * Design: this file NEVER performs network requests. It only turns HTML/JSON
 * text that is already in the page (or fetched as a normal HTML page) into
 * normalized records.
 */
(function (root) {
  'use strict';

  function decodeEntities(s) {
    if (typeof s !== 'string' || s.indexOf('&') === -1) return s;
    return s
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  // Extract every <script type="application/json"> blob as parsed JSON.
  function extractJsonBlobs(html) {
    const blobs = [];
    if (typeof html !== 'string' || !html) return blobs;
    const re = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const raw = m[1];
      if (!raw || !raw.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        try {
          parsed = JSON.parse(decodeEntities(raw));
        } catch (e2) {
          parsed = undefined;
        }
      }
      if (parsed !== undefined) blobs.push(parsed);
    }
    return blobs;
  }

  // Balanced-brace JSON extractor that respects strings and escapes.
  function readBalanced(text, start) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) { esc = false; }
        else if (c === '\\') { esc = true; }
        else if (c === '"') { inStr = false; }
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') {
        depth--;
        if (depth === 0) {
          const slice = text.slice(start, i + 1);
          try { return JSON.parse(slice); } catch (e) { return undefined; }
        }
      }
    }
    return undefined;
  }

  // window.__additionalDataLoaded('extra', {...})
  function extractAdditionalData(html) {
    const out = [];
    if (typeof html !== 'string' || !html) return out;
    const re = /window\.__additionalDataLoaded\s*\(\s*['"][^'"]*['"]\s*,\s*/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const start = m.index + m[0].length;
      const obj = readBalanced(html, start);
      if (obj !== undefined) out.push(obj);
    }
    return out;
  }

  function walk(value, visit, depth, stop) {
    depth = depth || 0;
    if (value == null || depth > 60) return;
    if (visit(value) === false) return;
    if (stop && stop(value)) return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) walk(value[i], visit, depth + 1, stop);
    } else if (typeof value === 'object') {
      for (const k in value) {
        if (Object.prototype.hasOwnProperty.call(value, k)) walk(value[k], visit, depth + 1, stop);
      }
    }
  }

  function isMediaObject(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    const hasImg = !!(o.image_versions2 && Array.isArray(o.image_versions2.candidates));
    const hasVid = Array.isArray(o.video_versions) && o.video_versions.length > 0;
    return (hasImg || hasVid) && (o.code || o.pk != null || o.id != null);
  }

  function bestVariant(list) {
    if (!Array.isArray(list) || !list.length) return null;
    let best = null;
    for (const it of list) {
      if (!it || !it.url) continue;
      const area = (it.width || 0) * (it.height || 0);
      if (!best || area > best._area) {
        best = { url: it.url, width: it.width || null, height: it.height || null, _area: area };
      }
    }
    if (best) delete best._area;
    return best;
  }

  function biggestImage(o) {
    return o && o.image_versions2 ? bestVariant(o.image_versions2.candidates) : null;
  }

  function biggestVideo(o) {
    return o && o.video_versions ? bestVariant(o.video_versions) : null;
  }

  function captionText(o) {
    const c = o && o.caption;
    if (!c) return null;
    if (typeof c === 'string') return c;
    if (typeof c.text === 'string') return c.text;
    return null;
  }

  function toIso(ts) {
    if (!ts) return null;
    const n = typeof ts === 'number' ? ts : parseInt(ts, 10);
    if (!n || isNaN(n)) return null;
    return new Date(n * 1000).toISOString();
  }

  function ownerOf(o) {
    const u = o && (o.user || o.owner);
    if (!u) return null;
    return {
      id: u.pk != null ? String(u.pk) : (u.id != null ? String(u.id) : null),
      username: u.username || null,
      full_name: u.full_name || null
    };
  }

  function mediaUrlForCode(code) {
    return code ? 'https://www.instagram.com/p/' + code + '/' : null;
  }

  function normChild(child) {
    const v = biggestVideo(child);
    if (v && v.url) return { kind: 'video', url: v.url, width: v.width, height: v.height };
    const i = biggestImage(child);
    if (i && i.url) return { kind: 'image', url: i.url, width: i.width, height: i.height };
    return null;
  }

  function normalizePost(m, ctx) {
    ctx = ctx || {};
    const code = m.code || ctx.code || null;
    const children = Array.isArray(m.carousel_media) ? m.carousel_media : null;
    const media = [];
    if (children && children.length) {
      for (const ch of children) { const n = normChild(ch); if (n) media.push(n); }
    } else {
      const n = normChild(m); if (n) media.push(n);
    }
    let mediaType = m.media_type;
    if (mediaType == null) {
      mediaType = media.length > 1 ? 8 : (media[0] && media[0].kind === 'video' ? 2 : 1);
    }
    return {
      source: 'instagram',
      shortcode: code,
      id: m.pk != null ? String(m.pk) : (m.id != null ? String(m.id) : null),
      url: ctx.url || mediaUrlForCode(code),
      taken_at: m.taken_at || null,
      taken_at_iso: toIso(m.taken_at),
      media_type: mediaType,
      product_type: m.product_type || null,
      caption: captionText(m),
      owner: ownerOf(m),
      like_count: m.like_count != null ? m.like_count : null,
      comment_count: m.comment_count != null ? m.comment_count : null,
      play_count: m.play_count != null ? m.play_count : (m.view_count != null ? m.view_count : null),
      location: m.location && m.location.name ? m.location.name : null,
      is_carousel: !!(children && children.length),
      media: media,
      extracted_at: new Date().toISOString()
    };
  }

  function dedupeAndNormalize(list, ctx) {
    const seen = new Set();
    const out = [];
    for (const m of list) {
      const key = (m.code || '') + '|' + (m.pk != null ? m.pk : (m.id != null ? m.id : ''));
      if (seen.has(key)) continue;
      seen.add(key);
      try { out.push(normalizePost(m, ctx)); } catch (e) { /* skip malformed */ }
    }
    return out;
  }

  // Layer 1: the precise SSR payload used by Instagram post pages.
  var WEB_INFO_RE = /media__shortcode__web_info$|clips__media__web_info$|xdt_api__v1__media__info$/;

  function findWebInfoItems(blobs) {
    const items = [];
    for (const b of blobs) {
      walk(b, function (node) {
        if (node && typeof node === 'object' && !Array.isArray(node)) {
          for (const k in node) {
            if (WEB_INFO_RE.test(k)) {
              const v = node[k];
              if (v && Array.isArray(v.items)) {
                for (const it of v.items) items.push(it);
              } else if (v && (v.image_versions2 || v.video_versions)) {
                items.push(v);
              }
            }
          }
        }
      }, 0);
    }
    return items;
  }

  // Layers 2/3: generic scan, pruning descent into a media object so that
  // carousel children are not promoted to standalone posts.
  function findMediaObjects(blobs) {
    const found = [];
    const seen = new Set();
    for (const b of blobs) {
      walk(b, function (node) {
        if (isMediaObject(node)) {
          const key = (node.code || '') + '|' + (node.pk != null ? node.pk : (node.id != null ? node.id : ''));
          if (!seen.has(key)) { seen.add(key); found.push(node); }
        }
      }, 0, isMediaObject);
    }
    return found;
  }

  // Same logic, but over already-parsed blobs (page payloads captured live).
  function findPostsInBlobs(blobs, ctx) {
    const list = Array.isArray(blobs) ? blobs : [];
    const precise = findWebInfoItems(list);
    if (precise.length) return dedupeAndNormalize(precise, ctx);
    return dedupeAndNormalize(findMediaObjects(list), ctx);
  }

  function findPosts(html, ctx) {
    const blobs = extractJsonBlobs(html).concat(extractAdditionalData(html));
    return findPostsInBlobs(blobs, ctx);
  }

  // Diagnostics: how many blobs and how many candidate posts were seen.
  function diagnose(html) {
    const blobs = extractJsonBlobs(html);
    const extra = extractAdditionalData(html);
    const precise = findWebInfoItems(blobs);
    const generic = findMediaObjects(blobs);
    return {
      jsonBlobs: blobs.length,
      additionalData: extra.length,
      webInfoItems: precise.length,
      mediaObjects: generic.length
    };
  }

  const api = {
    decodeEntities,
    extractJsonBlobs,
    extractAdditionalData,
    walk,
    isMediaObject,
    normalizePost,
    findPosts,
    findPostsInBlobs,
    diagnose
  };

  root.IGX = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
