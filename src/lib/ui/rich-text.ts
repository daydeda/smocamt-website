/**
 * Simple Rich Text parser for ActiveCAMT
 * Supports:
 * **bold** -> <b>
 * [text](url) -> <a href="url" target="_blank">
 * {{color:HEX|text}} -> <span style="color:HEX">
 */
export function parseRichText(text: string): string {
  if (!text) return "";

  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Colors: {{color:#FF0000|text}}
  // Use a loop to handle nested tags correctly (inner-out).
  // [\s\S] (vs. the `s` flag) lets the content span line breaks while staying
  // compatible with the project's pre-es2018 tsconfig target. Newlines become
  // <br /> later, so multi-line bold/colored text still renders correctly.
  while (html.includes("{{color:") && html.includes("|") && html.includes("}}")) {
    const nextHtml = html.replace(/\{\{color:([^|]*?)\|((?:(?!\{\{color:)[\s\S])*?)\}\}/g, (match, color, content) => {
      // Only allow a hex value (#fff / #ffffff / #ffffffff) or a plain CSS color
      // name. Anything else — e.g. `red" onmouseover="alert(1)` — would break out
      // of the style attribute and inject an event handler, so it falls back to
      // the visible text. (The link branch below escapes quotes for the same reason.)
      if (!/^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$/.test(color.trim())) return content;
      return `<span style="color:${color.trim()}">${content}</span>`;
    });
    if (nextHtml === html) break; // Prevent infinite loop if syntax is broken
    html = nextHtml;
  }

  // Bold: **text** (may span line breaks)
  html = html.replace(/\*\*([\s\S]*?)\*\*/g, "<b>$1</b>");

  // Links: [text](url) — only http/https/mailto survive. Anything else
  // (javascript:, data:, vbscript:, …) would execute in the reader's browser
  // when clicked, so the markup is left as plain text instead.
  html = html.replace(/\[([\s\S]*?)\]\(([\s\S]*?)\)/g, (match, label, url) => {
    let protocol: string;
    try {
      protocol = new URL(url, "https://placeholder.invalid").protocol;
    } catch {
      return match;
    }
    if (!["http:", "https:", "mailto:"].includes(protocol)) return match;
    // The earlier &/</> escaping can't catch a quote inside the URL breaking
    // out of the href attribute; neutralize it here.
    const safeUrl = url.replace(/"/g, "%22");
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-primary); text-decoration: underline;">${label}</a>`;
  });

  // Newlines
  html = html.replace(/\n/g, "<br />");

  return html;
}

/**
 * Plain-text version of rich text, for previews/snippets (e.g. product cards).
 * Strips the markup tokens, keeping the visible text, and collapses whitespace.
 */
export function stripRichText(text: string): string {
  if (!text) return "";

  let out = text;
  // Colors: {{color:#hex|text}} -> text (loop to unwrap nested tags inner-out).
  while (out.includes("{{color:") && out.includes("|") && out.includes("}}")) {
    const next = out.replace(/\{\{color:([^|]*?)\|((?:(?!\{\{color:)[\s\S])*?)\}\}/g, "$2");
    if (next === out) break;
    out = next;
  }
  out = out.replace(/\*\*([\s\S]*?)\*\*/g, "$1"); // bold
  out = out.replace(/\[([\s\S]*?)\]\(([\s\S]*?)\)/g, "$1"); // links -> label only

  return out.replace(/\s+/g, " ").trim();
}
