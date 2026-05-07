const cheerio = require("cheerio");

// DOMPurify is intentionally NOT used for preview HTML because it strips
// inline <script> content even when ADD_TAGS includes 'script', which
// breaks all JS in the generated app preview. The preview iframe on the
// frontend is already sandboxed, so server-side script stripping is
// unnecessary and harmful here.

function extractHTML(raw) {
  const text = String(raw || "");
  const fencedMatch = text.match(/```html\s*([\s\S]*?)```/i);
  if (fencedMatch && fencedMatch[1]) {
    return fencedMatch[1].trim();
  }

  const lower = text.toLowerCase();
  const doctypeIndex = lower.indexOf("<!doctype html");
  if (doctypeIndex !== -1) {
    return text.slice(doctypeIndex).trim();
  }

  const htmlIndex = lower.indexOf("<html");
  if (htmlIndex !== -1) {
    return text.slice(htmlIndex).trim();
  }

  const bodyIndex = lower.indexOf("<body");
  if (bodyIndex !== -1) {
    return `<!DOCTYPE html>\n<html>\n${text.slice(bodyIndex).trim()}\n</html>`;
  }

  return null;
}

function repairHTML(html) {
  if (!html) return html;

  const $ = cheerio.load(html, { decodeEntities: false });
  const hasHtml = $("html").length > 0;

  if (!hasHtml) {
    const wrapper = cheerio.load("<!DOCTYPE html><html><head></head><body></body></html>", {
      decodeEntities: false,
    });
    wrapper("body").append($.root().html());
    return wrapper.html();
  }

  if (!$("head").length) {
    $("html").prepend("<head></head>");
  }
  if (!$("body").length) {
    $("html").append("<body></body>");
  }

  return $.html();
}

function sanitizeHTML(html) {
  if (!html) return html;
  // Strip only genuinely dangerous patterns (external resource injection,
  // data: URIs in src/href) while leaving <script> and event handlers intact
  // so that the generated app's JS works correctly in the preview iframe.
  return String(html)
    .replace(/(<[^>]+\s(?:src|href|action)\s*=\s*["']?)data:[^"'>]*/gi, "")
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "");
}

function stripHtmlToText(html) {
  if (!html) return "";
  const $ = cheerio.load(html, { decodeEntities: false });
  return $.text().replace(/\s+/g, " ").trim();
}

module.exports = {
  extractHTML,
  repairHTML,
  sanitizeHTML,
  stripHtmlToText,
};
