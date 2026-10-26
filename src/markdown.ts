function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderProse(source: string): string {
  const lines = escapeHtml(source).split("\n");
  const html: string[] = [];
  let list: "ul" | "ol" | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(inline).join("<br/>")}</p>`);
    paragraph = [];
  };

  const closeList = () => {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,3}) (.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length + 1;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^[-*] (.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      if (list !== "ul") {
        closeList();
        html.push("<ul>");
        list = "ul";
      }
      html.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    const numbered = /^\d+\. (.*)$/.exec(trimmed);
    if (numbered) {
      flushParagraph();
      if (list !== "ol") {
        closeList();
        html.push("<ol>");
        list = "ol";
      }
      html.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }

    closeList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  closeList();
  return html.join("");
}

export function renderMarkdown(source: string): string {
  const text = source.replace(/\r\n/g, "\n");
  const html: string[] = [];
  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(text))) {
    html.push(renderProse(text.slice(last, match.index)));
    html.push(`<pre><code>${escapeHtml(match[1].replace(/\n$/, ""))}</code></pre>`);
    last = match.index + match[0].length;
  }

  html.push(renderProse(text.slice(last)));
  return html.join("");
}
