"use client";

/**
 * HtmlBody — safe HTML render for ticket replies + mail bodies.
 *
 * isomorphic-dompurify works in both server and browser contexts.
 * Sanitiser config kept narrow: the markup we *emit* (RichEditor) only
 * uses headings, lists, links, basic inline marks. Inbound mail can
 * contain richer markup; the default DOMPurify policy already strips
 * script/style/iframe/event handlers, which is the bar that matters.
 *
 * Plain-text fallback: if the body looks like plain text (no tags),
 * wrap it in <pre> so newlines preserve. Avoids the awkward case where
 * a tenant-typed plain reply renders as one long run-on line.
 */

import DOMPurify from "isomorphic-dompurify";

export function HtmlBody({ html, className }: { html: string; className?: string }) {
  const looksLikeHtml = /<\w+[\s>]/.test(html);
  if (!looksLikeHtml) {
    return (
      <pre
        className={`whitespace-pre-wrap break-words font-sans text-sm ${className ?? ""}`}
      >
        {html}
      </pre>
    );
  }
  const clean = DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "rel"],
    // Strip anything that loads remote content / executes — DOMPurify
    // does this by default but being explicit makes the intent
    // obvious to a future reader.
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
    FORBID_ATTR: ["onerror", "onload", "onclick"],
  });
  // Containment rules so an email body can NEVER push the page wider:
  //  - max-w-full + break-words + overflow-wrap:anywhere → long unbroken
  //    strings (URLs, tokens) wrap instead of stretching the column.
  //  - images clamp to the column width.
  //  - <pre> wraps; wide <table> scrolls WITHIN the card, not the page.
  return (
    <div
      className={`prose prose-sm w-full max-w-full break-words [overflow-wrap:anywhere] [&_a]:text-primary [&_a]:underline [&_a]:break-words [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_img]:max-w-full [&_img]:h-auto [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
