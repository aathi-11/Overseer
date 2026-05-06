const cheerio = require("cheerio");
const { JSDOM } = require("jsdom");
const createDOMPurify = require("dompurify");

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

const SANITIZE_OPTIONS = {
  WHOLE_DOCUMENT: true,
  ADD_TAGS: ["script", "style"],
  ADD_ATTR: ["onclick", "oninput", "onchange", "onkeyup", "onkeydown"],
};

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
  return DOMPurify.sanitize(html, SANITIZE_OPTIONS);
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
