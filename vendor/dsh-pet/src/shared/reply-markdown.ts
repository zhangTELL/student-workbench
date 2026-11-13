import DOMPurify from 'dompurify';
import { Marked } from 'marked';

function escapeText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => escapeText(text),
    image: ({ text }) => escapeText(text),
    checkbox: ({ checked }) => checked ? '☑ ' : '☐ ',
  },
});

export function renderReplyMarkdown(text: string): string {
  if (!DOMPurify.isSupported) return escapeText(text);
  const content = DOMPurify.sanitize(markdown.parse(text, { async: false }), {
    ALLOWED_TAGS: ['a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'],
    ALLOWED_ATTR: ['href', 'start', 'title'],
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  for (const link of content.querySelectorAll('a[href]')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
  const container = document.createElement('div');
  container.append(content);
  return container.innerHTML;
}

export const REPLY_BUBBLE_DURATION_MS = 30_000;

type Bounds = { x: number; y: number; width: number; height: number };

export function fitPetReply(bubble: HTMLElement, anchor: Bounds, bounds: Bounds, overlap: number): void {
  const inset = 6;
  const aboveEdge = Math.min(anchor.y + overlap, bounds.y + bounds.height - inset);
  const belowEdge = Math.max(anchor.y + anchor.height - overlap, bounds.y + inset);
  const above = aboveEdge - bounds.y - inset;
  const below = bounds.y + bounds.height - inset - belowEdge;
  bubble.style.setProperty('--reply-max-width', `${Math.max(0, bounds.width - inset * 2)}px`);
  const content = bubble.firstElementChild as HTMLElement;
  const padding = bubble.offsetHeight - content.offsetHeight;
  const desiredHeight = Math.min(content.scrollHeight, parseFloat(getComputedStyle(content).fontSize) * 16);
  const flip = below > above && desiredHeight + padding > above;
  const height = Math.max(0, flip ? below : above);
  bubble.classList.toggle('is-below', flip);
  bubble.style.setProperty('--reply-max-height', `${Math.max(0, height - padding)}px`);
  bubble.style.top = flip ? `${belowEdge - anchor.y}px` : 'auto';
  bubble.style.bottom = flip ? 'auto' : `${anchor.y + anchor.height - aboveEdge}px`;
  const width = bubble.offsetWidth;
  const center = anchor.x + anchor.width / 2;
  const left = Math.max(bounds.x + inset, Math.min(center - width / 2, bounds.x + bounds.width - inset - width));
  bubble.style.left = `${left - anchor.x}px`;
}

const replyCss = `
.reply-markdown { overflow-wrap: anywhere; line-height: 1.6; }
.reply-markdown :where(p, pre, blockquote, ul, ol, table, hr, h1, h2, h3, h4, h5, h6) { margin: .55em 0; }
.reply-markdown > :first-child { margin-top: 0; }
.reply-markdown > :last-child { margin-bottom: 0; }
.reply-markdown :where(h1, h2, h3, h4, h5, h6) { color: inherit; font-weight: 650; line-height: 1.35; }
.reply-markdown h1 { font-size: 1.36em; }
.reply-markdown h2 { font-size: 1.22em; }
.reply-markdown :where(h3, h4, h5, h6) { font-size: 1.08em; }
.reply-markdown :where(ul, ol) { padding-inline-start: 1.45em; }
.reply-markdown ul { list-style-type: disc; }
.reply-markdown ol { list-style-type: decimal; }
.reply-markdown li + li { margin-top: .2em; }
.reply-markdown a[href] { color: var(--reply-link, #24588e); text-decoration: underline; text-underline-offset: .12em; }
.reply-markdown pre, .reply-markdown :not(pre) > code { background: var(--reply-fill, rgba(100,114,140,.13)); border-radius: .35em; }
.reply-markdown pre { padding: .65em; overflow: auto; }
.reply-markdown :not(pre) > code { padding: .1em .25em; }
.reply-markdown code { font-family: ui-monospace, Consolas, monospace; font-size: .9em; }
.reply-markdown pre code { white-space: pre; }
.reply-markdown blockquote { border-inline-start: .18em solid var(--reply-border, rgba(100,114,140,.38)); padding-inline-start: .7em; }
.reply-markdown table { display: block; max-width: 100%; overflow: auto; border-collapse: collapse; overflow-wrap: normal; }
.reply-markdown :where(th, td) { border: 1px solid var(--reply-border, rgba(100,114,140,.38)); padding: .35em .6em; }
.reply-markdown th { background: var(--reply-fill, rgba(100,114,140,.13)); text-align: start; }
.reply-markdown hr { border: 0; border-top: 1px solid var(--reply-border, rgba(100,114,140,.38)); }
.pet-reply-bubble.pet-reply-bubble { box-sizing: border-box; min-width: 0; max-width: min(30em, var(--reply-max-width, 100%)); transform: none; }
.pet-reply-bubble.is-on { pointer-events: auto; user-select: text; }
.pet-reply-scroll { min-width: 0; max-height: min(16em, var(--reply-max-height, 16em)); overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.pet-reply-bubble.is-below::after { top: calc(var(--f)*-.3736); bottom: auto; transform: translateX(-50%) rotate(180deg); }
`;

export function injectReplyMarkdownCss(): void {
  if (document.querySelector('style[data-reply-markdown]')) return;
  const style = document.createElement('style');
  style.dataset.replyMarkdown = '';
  style.textContent = replyCss;
  document.head.appendChild(style);
}
