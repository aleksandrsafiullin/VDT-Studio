"use client";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inlineMarkdown(value: string) {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function renderMarkdown(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let listItems: string[] = [];

  function flushList() {
    if (listItems.length === 0) {
      return;
    }
    blocks.push(`<ul class="list-disc space-y-1 pl-5">${listItems.join("")}</ul>`);
    listItems = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      flushList();
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushList();
      blocks.push(`<h3 class="text-sm font-semibold text-ink">${inlineMarkdown(trimmed.slice(3))}</h3>`);
      continue;
    }

    if (trimmed.startsWith("# ")) {
      flushList();
      blocks.push(`<h2 class="text-base font-semibold text-ink">${inlineMarkdown(trimmed.slice(2))}</h2>`);
      continue;
    }

    if (trimmed.startsWith("- ")) {
      listItems.push(`<li>${inlineMarkdown(trimmed.slice(2))}</li>`);
      continue;
    }

    flushList();
    blocks.push(`<p class="text-sm leading-6 text-muted">${inlineMarkdown(trimmed)}</p>`);
  }

  flushList();
  return blocks.join("");
}

interface MarkdownTextProps {
  text: string;
  className?: string;
}

export function MarkdownText({ text, className }: MarkdownTextProps) {
  return (
    <div
      className={["space-y-2", className].filter(Boolean).join(" ")}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}
