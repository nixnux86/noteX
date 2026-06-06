import { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bold, CheckSquare, Code2, Copy, Heading1, Highlighter, Image as ImageIcon, IndentDecrease, IndentIncrease, Italic, Link, List, ListOrdered, MoreVertical, Palette, Redo2, Table2, Trash2, Underline, Undo2, WrapText } from 'lucide-react';
import { db, uid, now, type Block } from '../db/schema';

type Props = {
  pageId: string;
  workspaceId?: string;
  onChanged?: () => void;
  onPageLoaded?: (ms: number) => void;
};

function escapeHtml(value: string) {
  return (value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch] || ch));
}


function isSafeHttpUrl(value: string) {
  try {
    const url = new URL(value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizePlainUrl(value: string) {
  const raw = (value || '').trim().replace(/[),.;!?]+$/g, '');
  if (!raw) return '';
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
}

function titleFromUrl(value: string) {
  try {
    const url = new URL(normalizePlainUrl(value));
    const parts = url.pathname.split('/').filter(Boolean);
    const last = decodeURIComponent(parts[parts.length - 1] || url.hostname.replace(/^www\./, ''));
    const cleaned = last
      .replace(/[-_]+/g, ' ')
      .replace(/\.[a-z0-9]{2,6}$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return url.hostname.replace(/^www\./, '');
    return cleaned.replace(/\b\w/g, ch => ch.toUpperCase());
  } catch {
    return value;
  }
}

function linkifyPlainUrlText(text: string) {
  const pattern = /((?:https?:\/\/|www\.)[^\s<]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<]*)?)/gi;
  return escapeHtml(text || '').replace(pattern, match => {
    const href = normalizePlainUrl(match);
    if (!isSafeHttpUrl(href)) return escapeHtml(match);
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(titleFromUrl(href))}</a>`;
  });
}

function autoLinkEditorUrls(editor: HTMLDivElement | null) {
  if (!editor) return false;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('a, pre, code, script, style')) return NodeFilter.FILTER_REJECT;
      return /(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+[a-z]{2,})/i.test(node.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach(node => {
    const html = linkifyPlainUrlText(node.nodeValue || '');
    const span = document.createElement('span');
    span.innerHTML = html;
    node.replaceWith(...Array.from(span.childNodes));
  });
  return nodes.length > 0;
}

function sanitizeRichHtml(html: string) {
  const raw = html || '';
  const parser = new DOMParser();
  let doc = parser.parseFromString(raw, 'text/html');
  // Some Chromium/WebKit builds can return a document with a null body for
  // malformed external clipboard HTML. Build a safe body fallback so paste never crashes.
  if (!doc.body) {
    doc = document.implementation.createHTMLDocument('paste');
    doc.body.innerHTML = raw;
  }
  const body = doc.body || doc.createElement('body');
  body.querySelectorAll('script, style, meta, link, iframe, object, embed').forEach(el => el.remove());
  const allowed = new Set(['A','B','STRONG','I','EM','U','S','STRIKE','BR','P','DIV','SPAN','UL','OL','LI','H1','H2','H3','H4','BLOCKQUOTE','PRE','CODE','TABLE','THEAD','TBODY','TFOOT','TR','TH','TD','IMG','VIDEO','AUDIO','SOURCE','FIGURE','FIGCAPTION','INPUT']);
  body.querySelectorAll('*').forEach(el => {
    if (!allowed.has(el.tagName)) {
      const span = doc.createElement('span');
      span.innerHTML = el.innerHTML;
      el.replaceWith(span);
      return;
    }
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value || '';
      let keep = false;
      if (el.tagName === 'A' && name === 'href' && !value.toLowerCase().startsWith('javascript:')) keep = true;
      if ((el.tagName === 'IMG' || el.tagName === 'VIDEO' || el.tagName === 'AUDIO' || el.tagName === 'SOURCE') && ['src','alt','title','controls'].includes(name)) keep = !value.toLowerCase().startsWith('javascript:');
      if ((el.tagName === 'IMG' || el.tagName === 'VIDEO') && name === 'style') keep = /(^|;)\s*(width|max-width|height)\s*:/i.test(value) && !/url\s*\(/i.test(value);
      if ((el.tagName === 'IMG' || el.tagName === 'VIDEO') && name === 'data-caption') keep = true;
      if ((el.tagName === 'TD' || el.tagName === 'TH') && ['colspan','rowspan'].includes(name)) keep = true;
      if ((el.tagName === 'TD' || el.tagName === 'TH') && name === 'style') keep = /(^|;)\s*(width|height|min-width|text-align)\s*:/i.test(value) && !/url\s*\(/i.test(value);
      if ((el.tagName === 'FIGURE' || el.tagName === 'DIV' || el.tagName === 'SPAN' || el.tagName === 'TABLE' || el.tagName === 'TD') && name === 'class') keep = /plain-media-(figure|grid|resize-wrap|align-left|align-center|align-right)|wrap-(inline|square|tight|through|top-bottom|behind|front)|plain-checklist-(card|table|check|status)/.test(value);
      if ((el.tagName === 'FIGURE' || el.tagName === 'DIV' || el.tagName === 'SPAN') && name === 'data-wrap') keep = true;
      if (el.tagName === 'INPUT' && name === 'type' && value === 'checkbox') keep = true;
      if (el.tagName === 'INPUT' && name === 'checked') keep = true;
      if ((el.tagName === 'FIGURE' || el.tagName === 'DIV' || el.tagName === 'SPAN') && name === 'style') keep = /(^|;)\s*(width|max-width|height|float|margin|display|text-align|position|z-index)\s*:/i.test(value) && !/url\s*\(/i.test(value);
      if (el.tagName === 'SPAN' && name === 'style') keep = /(^|;)\s*(color|background-color)\s*:/i.test(value) && !/url\s*\(/i.test(value);
      if (!keep) el.removeAttribute(attr.name);
    });
    if (el.tagName === 'A') {
      (el as HTMLAnchorElement).target = '_blank';
      (el as HTMLAnchorElement).rel = 'noreferrer';
    }
    if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') el.setAttribute('controls', 'true');
  });
  return body.innerHTML || '<p><br></p>';
}

function plainTextToRichHtml(text: string) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let code: string[] | null = null;
  const listStack: { type: 'ul' | 'ol'; level: number }[] = [];
  const indentLevel = (raw: string) => Math.max(0, Math.min(4, Math.floor(((raw.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length) / 2)));
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${linkifyPlainUrlText(paragraph.join(' ').replace(/\s+/g, ' ').trim())}</p>`);
    paragraph = [];
  };
  const closeListsTo = (level = -1) => {
    while (listStack.length && listStack[listStack.length - 1].level > level) {
      out.push(`</${listStack.pop()!.type}>`);
    }
  };
  const flushList = () => closeListsTo(-1);
  const ensureList = (type: 'ul' | 'ol', level: number) => {
    const current = listStack[listStack.length - 1];
    if (!current || current.level < level || current.type !== type) {
      if (current && current.level >= level && current.type !== type) closeListsTo(level - 1);
      out.push(`<${type}>`);
      listStack.push({ type, level });
      return;
    }
    closeListsTo(level);
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      if (code) {
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      } else {
        flushParagraph(); flushList(); code = [];
      }
      continue;
    }
    if (code) { code.push(line); continue; }
    if (!trimmed) { flushParagraph(); flushList(); continue; }
    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList();
      const level = Math.min(4, heading[1].length);
      out.push(`<h${level}>${linkifyPlainUrlText(heading[2].trim())}</h${level}>`);
      continue;
    }
    const quote = trimmed.match(/^>\s+(.+)$/);
    if (quote) { flushParagraph(); flushList(); out.push(`<blockquote>${linkifyPlainUrlText(quote[1].trim())}</blockquote>`); continue; }
    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      const level = indentLevel(raw);
      ensureList('ul', level);
      out.push(`<li>${linkifyPlainUrlText(bullet[1].trim())}</li>`);
      continue;
    }
    const numbered = trimmed.match(/^(\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      const level = indentLevel(raw);
      ensureList('ol', level);
      out.push(`<li>${linkifyPlainUrlText(numbered[2].trim())}</li>`);
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  if (code) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  flushParagraph(); flushList();
  return out.join('') || '<p><br></p>';
}


function selectionBelongsToEditor(editor: HTMLDivElement | null, selection: Selection | null) {
  if (!editor || !selection || selection.rangeCount === 0) return false;
  const node = selection.anchorNode;
  return !!node && editor.contains(node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement);
}

function placeCaretAtEnd(editor: HTMLDivElement) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function insertHtmlAtSelection(editor: HTMLDivElement | null, html: string) {
  if (!editor) return false;
  editor.focus();
  const selection = window.getSelection();
  if (!selectionBelongsToEditor(editor, selection)) placeCaretAtEnd(editor);
  const activeSelection = window.getSelection();
  if (!activeSelection || activeSelection.rangeCount === 0) return false;
  const range = activeSelection.getRangeAt(0);
  range.deleteContents();
  const template = document.createElement('template');
  template.innerHTML = html;
  const fragment = template.content;
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);
  if (lastNode) {
    const nextRange = document.createRange();
    nextRange.setStartAfter(lastNode);
    nextRange.collapse(true);
    activeSelection.removeAllRanges();
    activeSelection.addRange(nextRange);
  }
  return true;
}

function normalizeExternalHtml(html: string) {
  const raw = html || '';
  let doc = new DOMParser().parseFromString(raw, 'text/html');
  if (!doc.body) {
    doc = document.implementation.createHTMLDocument('paste');
    doc.body.innerHTML = raw;
  }
  const body = doc.body || doc.createElement('body');
  body.querySelectorAll('[class], [id], [data-testid], [data-start], [data-end], [role]').forEach(el => {
    el.removeAttribute('class'); el.removeAttribute('id'); el.removeAttribute('data-testid'); el.removeAttribute('data-start'); el.removeAttribute('data-end'); el.removeAttribute('role');
  });
  body.querySelectorAll('div').forEach(div => {
    const hasBlock = div.querySelector('p,h1,h2,h3,h4,ul,ol,table,blockquote,pre');
    if (!hasBlock && div.textContent?.trim()) {
      const p = doc.createElement('p');
      p.innerHTML = div.innerHTML;
      div.replaceWith(p);
    }
  });
  return body.innerHTML;
}


function getSelectionText() {
  const selection = window.getSelection();
  return selection && selection.rangeCount > 0 ? selection.toString() : '';
}

function guessCodeLanguage(code: string) {
  const text = code || '';
  if (/^\s*(import|export|const|let|function|interface|type)\b/m.test(text)) return 'javascript';
  if (/^\s*(def|class|import\s+\w+|from\s+\w+\s+import)\b/m.test(text)) return 'python';
  if (/<\/?[a-z][\s\S]*>/i.test(text)) return 'html';
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/im.test(text)) return 'sql';
  return 'text';
}

function simpleHighlightCode(code: string, language = 'text') {
  const safe = escapeHtml(code || '');
  if (language === 'text') return safe;
  let highlighted = safe;
  highlighted = highlighted.replace(/(&quot;.*?&quot;|&#039;.*?&#039;|`.*?`)/g, '<span class="code-token-string">$1</span>');
  highlighted = highlighted.replace(/\b(const|let|var|function|return|if|else|for|while|class|import|from|export|interface|type|def|async|await|try|catch|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/g, '<span class="code-token-keyword">$1</span>');
  highlighted = highlighted.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="code-token-number">$1</span>');
  highlighted = highlighted.replace(/(\/\/.*$|#.*$)/gm, '<span class="code-token-comment">$1</span>');
  return highlighted;
}

function applyInlineStyle(style: Partial<CSSStyleDeclaration>) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (range.collapsed) {
    const span = document.createElement('span');
    Object.assign(span.style, style);
    span.appendChild(document.createTextNode('\u200b'));
    range.insertNode(span);
    const nextRange = document.createRange();
    nextRange.setStart(span.firstChild || span, 1);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    return;
  }
  const span = document.createElement('span');
  Object.assign(span.style, style);
  try {
    span.appendChild(range.extractContents());
    range.insertNode(span);
    selection.removeAllRanges();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    nextRange.collapse(false);
    selection.addRange(nextRange);
  } catch {
    document.execCommand('fontSize', false, '3');
  }
}

function isEmptyHtml(html: string) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const text = doc.body?.textContent || '';
  return !text.trim() && !/<(img|video|audio|table|ul|ol|li|h[1-4]|blockquote|pre)\b/i.test(html || '');
}


function cloneEditorHtmlForSave(editor: HTMLDivElement) {
  const clone = editor.cloneNode(true) as HTMLDivElement;
  clone.querySelectorAll('.plain-media-resize-handle').forEach(el => el.remove());
  clone.querySelectorAll('.plain-media-resize-wrap').forEach(wrap => {
    const media = wrap.querySelector('img, video') as HTMLElement | null;
    if (media) wrap.replaceWith(media);
  });
  clone.querySelectorAll('.plain-media-selected').forEach(el => el.classList.remove('plain-media-selected'));
  clone.querySelectorAll('.plain-table-cell-selected').forEach(el => el.classList.remove('plain-table-cell-selected'));
  clone.querySelectorAll('table.plain-table-row-selected, table.plain-table-col-selected').forEach(el => {
    el.classList.remove('plain-table-row-selected');
    el.classList.remove('plain-table-col-selected');
  });
  return clone.innerHTML;
}

function selectedTableCell() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  let node: Node | null = selection.anchorNode;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  return node instanceof HTMLElement ? node.closest('td,th') as HTMLTableCellElement | null : null;
}

function insertTableRow() {
  const cell = selectedTableCell();
  const row = cell?.parentElement as HTMLTableRowElement | null;
  if (!row) { window.alert('Click inside a table cell first.'); return false; }
  const cols = row.children.length || 1;
  const newRow = document.createElement('tr');
  for (let i = 0; i < cols; i++) {
    const td = document.createElement('td');
    td.innerHTML = '<br>';
    newRow.appendChild(td);
  }
  row.after(newRow);
  return true;
}

function insertTableColumn() {
  const cell = selectedTableCell();
  const row = cell?.parentElement as HTMLTableRowElement | null;
  const table = cell?.closest('table');
  if (!cell || !row || !table) { window.alert('Click inside a table cell first.'); return false; }
  const index = Array.from(row.children).indexOf(cell);
  table.classList.remove('plain-table-row-selected');
  table.classList.add('plain-table-col-selected');
  table.querySelectorAll('tr').forEach(tr => {
    const td = document.createElement(tr.querySelector('th') ? 'th' : 'td');
    td.innerHTML = '<br>';
    const children = Array.from(tr.children);
    const ref = children[index + 1] || null;
    tr.insertBefore(td, ref);
  });
  return true;
}

function insertTableColumnAtEnd(table: HTMLTableElement | null) {
  if (!table) return false;
  table.querySelectorAll('tr').forEach(tr => {
    const td = document.createElement(tr.querySelector('th') ? 'th' : 'td');
    td.innerHTML = '<br>';
    tr.appendChild(td);
  });
  return true;
}

function insertTableRowAtEnd(table: HTMLTableElement | null) {
  if (!table) return false;
  const rows = Array.from(table.querySelectorAll('tr')) as HTMLTableRowElement[];
  const referenceRow = rows[rows.length - 1];
  const cols = referenceRow?.children.length || 1;
  const tbody = table.tBodies?.[0] || table;
  const newRow = document.createElement('tr');
  for (let i = 0; i < cols; i++) {
    const td = document.createElement('td');
    td.innerHTML = '<br>';
    newRow.appendChild(td);
  }
  tbody.appendChild(newRow);
  return newRow;
}


function getSelectedMedia(editor: HTMLDivElement | null) {
  return editor?.querySelector('img.plain-media-selected, video.plain-media-selected') as HTMLElement | null;
}

function closestMediaElement(target: HTMLElement | null) {
  return target?.closest('img, video') as HTMLElement | null;
}

function getMediaWrapper(media: HTMLElement | null) {
  return media?.closest('.plain-media-resize-wrap, figure.plain-media-figure') as HTMLElement | null;
}

function getMediaAlignmentWrapper(media: HTMLElement | null) {
  if (!media) return null;
  return media.closest('figure.plain-media-figure') as HTMLElement | null ||
    media.closest('.plain-media-resize-wrap') as HTMLElement | null ||
    media;
}

function setMediaWrapMode(media: HTMLElement | null, mode: string) {
  if (!media) return false;
  const wrap = getMediaWrapper(media) || media;
  wrap.classList.remove('wrap-inline','wrap-square','wrap-tight','wrap-through','wrap-top-bottom','wrap-behind','wrap-front');
  wrap.classList.add(`wrap-${mode}`);
  wrap.setAttribute('data-wrap', mode);
  return true;
}

function addCaptionToMedia(media: HTMLElement | null) {
  if (!media) return false;
  const caption = window.prompt('Image caption', media.getAttribute('data-caption') || '');
  if (caption === null) return false;
  let figure = media.closest('figure.plain-media-figure') as HTMLElement | null;
  if (!figure) {
    figure = document.createElement('figure');
    figure.className = 'plain-media-figure';
    const parent = media.parentNode;
    parent?.insertBefore(figure, media);
    figure.appendChild(media);
  }
  let figcaption = figure.querySelector('figcaption');
  if (!figcaption) {
    figcaption = document.createElement('figcaption');
    figure.appendChild(figcaption);
  }
  figcaption.textContent = caption.trim();
  media.setAttribute('data-caption', caption.trim());
  if (!caption.trim()) figcaption.remove();
  return true;
}


function setMediaAlignment(media: HTMLElement | null, alignment: 'left' | 'center' | 'right') {
  if (!media) return false;
  const wrap = getMediaAlignmentWrapper(media) || media;
  wrap.classList.remove('plain-media-align-left', 'plain-media-align-center', 'plain-media-align-right');
  wrap.classList.add(`plain-media-align-${alignment}`);
  wrap.setAttribute('data-align', alignment);
  wrap.style.display = 'block';
  wrap.style.float = 'none';
  wrap.style.clear = 'both';
  wrap.style.maxWidth = '100%';
  if (alignment === 'left') {
    wrap.style.marginLeft = '0';
    wrap.style.marginRight = 'auto';
    wrap.style.textAlign = 'left';
  } else if (alignment === 'center') {
    wrap.style.marginLeft = 'auto';
    wrap.style.marginRight = 'auto';
    wrap.style.textAlign = 'center';
  } else {
    wrap.style.marginLeft = 'auto';
    wrap.style.marginRight = '0';
    wrap.style.textAlign = 'right';
  }
  return true;
}

function selectedTableCells(editor?: HTMLDivElement | null) {
  const selected = Array.from(editor?.querySelectorAll('td.plain-table-cell-selected, th.plain-table-cell-selected') || []) as HTMLTableCellElement[];
  if (selected.length) return selected;
  const cell = selectedTableCell();
  return cell ? [cell] : [];
}

function clearTableCellSelection(editor?: HTMLDivElement | null) {
  editor?.querySelectorAll('td.plain-table-cell-selected, th.plain-table-cell-selected').forEach(el => el.classList.remove('plain-table-cell-selected'));
  editor?.querySelectorAll('table.plain-table-row-selected, table.plain-table-col-selected').forEach(el => {
    el.classList.remove('plain-table-row-selected');
    el.classList.remove('plain-table-col-selected');
  });
}

function selectTableColumn(cell: HTMLTableCellElement, editor?: HTMLDivElement | null) {
  clearTableCellSelection(editor);
  const row = cell.parentElement as HTMLTableRowElement | null;
  const table = cell.closest('table');
  if (!row || !table) return false;
  const index = Array.from(row.children).indexOf(cell);
  table.classList.remove('plain-table-row-selected');
  table.classList.add('plain-table-col-selected');
  table.querySelectorAll('tr').forEach(tr => {
    const target = tr.children[index] as HTMLTableCellElement | undefined;
    target?.classList.add('plain-table-cell-selected');
  });
  return true;
}

function selectTableRow(cell: HTMLTableCellElement, editor?: HTMLDivElement | null) {
  clearTableCellSelection(editor);
  const row = cell.parentElement as HTMLTableRowElement | null;
  const table = cell.closest('table');
  if (!row) return false;
  table?.classList.remove('plain-table-col-selected');
  table?.classList.add('plain-table-row-selected');
  Array.from(row.children).forEach(target => target.classList.add('plain-table-cell-selected'));
  return true;
}

function getCellPosition(cell: HTMLTableCellElement | null) {
  const row = cell?.parentElement as HTMLTableRowElement | null;
  const table = cell?.closest('table') as HTMLTableElement | null;
  if (!cell || !row || !table) return null;
  const rows = Array.from(table.querySelectorAll('tr')) as HTMLTableRowElement[];
  return { table, row, rowIndex: rows.indexOf(row), colIndex: Array.from(row.children).indexOf(cell) };
}

function selectTableRectangle(start: HTMLTableCellElement, end: HTMLTableCellElement, editor?: HTMLDivElement | null) {
  const a = getCellPosition(start);
  const b = getCellPosition(end);
  if (!a || !b || a.table !== b.table) return false;
  clearTableCellSelection(editor);
  const r1 = Math.min(a.rowIndex, b.rowIndex);
  const r2 = Math.max(a.rowIndex, b.rowIndex);
  const c1 = Math.min(a.colIndex, b.colIndex);
  const c2 = Math.max(a.colIndex, b.colIndex);
  const rows = Array.from(a.table.querySelectorAll('tr')) as HTMLTableRowElement[];
  for (let r = r1; r <= r2; r++) {
    const cells = Array.from(rows[r]?.children || []) as HTMLTableCellElement[];
    for (let c = c1; c <= c2; c++) cells[c]?.classList.add('plain-table-cell-selected');
  }
  a.table.classList.remove('plain-table-row-selected', 'plain-table-col-selected');
  return true;
}

function primaryTableCell(editor?: HTMLDivElement | null) {
  const selected = selectedTableCells(editor);
  return selected[0] || selectedTableCell();
}

function tableCellRange(editor?: HTMLDivElement | null) {
  const cells = selectedTableCells(editor);
  const base = cells.length ? cells : selectedTableCell() ? [selectedTableCell() as HTMLTableCellElement] : [];
  if (!base.length) return null;
  const pos = base.map(getCellPosition).filter(Boolean) as NonNullable<ReturnType<typeof getCellPosition>>[];
  if (!pos.length) return null;
  const table = pos[0].table;
  const rows = pos.map(p => p.rowIndex);
  const cols = pos.map(p => p.colIndex);
  return { table, minRow: Math.min(...rows), maxRow: Math.max(...rows), minCol: Math.min(...cols), maxCol: Math.max(...cols) };
}

function insertPlainTableColumn(editor: HTMLDivElement | null, side: 'left' | 'right') {
  const range = tableCellRange(editor);
  if (!range) return false;
  const at = side === 'left' ? range.minCol : range.maxCol + 1;
  range.table.querySelectorAll('tr').forEach(tr => {
    const cells = Array.from(tr.children);
    const tag = cells.some(cell => cell.tagName === 'TH') ? 'th' : 'td';
    const cell = document.createElement(tag);
    cell.innerHTML = '<br>';
    tr.insertBefore(cell, cells[at] || null);
  });
  return true;
}

function insertPlainTableRow(editor: HTMLDivElement | null, side: 'above' | 'below') {
  const range = tableCellRange(editor);
  if (!range) return false;
  const rows = Array.from(range.table.querySelectorAll('tr')) as HTMLTableRowElement[];
  const refRow = rows[side === 'above' ? range.minRow : range.maxRow];
  const cols = Math.max(1, ...rows.map(row => row.children.length));
  const newRow = document.createElement('tr');
  for (let i = 0; i < cols; i++) {
    const td = document.createElement('td');
    td.innerHTML = '<br>';
    newRow.appendChild(td);
  }
  if (side === 'above') refRow?.before(newRow);
  else refRow?.after(newRow);
  return true;
}

function duplicatePlainTableColumn(editor: HTMLDivElement | null) {
  const range = tableCellRange(editor);
  if (!range) return false;
  const sourceCol = range.maxCol;
  range.table.querySelectorAll('tr').forEach(tr => {
    const cells = Array.from(tr.children) as HTMLTableCellElement[];
    const source = cells[sourceCol] || cells[cells.length - 1];
    const clone = source?.cloneNode(true) as HTMLTableCellElement | null;
    if (clone) tr.insertBefore(clone, cells[sourceCol + 1] || null);
  });
  return true;
}

function duplicatePlainTableRow(editor: HTMLDivElement | null) {
  const range = tableCellRange(editor);
  if (!range) return false;
  const rows = Array.from(range.table.querySelectorAll('tr')) as HTMLTableRowElement[];
  const source = rows[range.maxRow];
  if (!source) return false;
  source.after(source.cloneNode(true));
  return true;
}

function deletePlainTableColumn(editor: HTMLDivElement | null) {
  const range = tableCellRange(editor);
  if (!range) return false;
  range.table.querySelectorAll('tr').forEach(tr => {
    const cells = Array.from(tr.children);
    for (let c = range.maxCol; c >= range.minCol; c--) {
      if (cells.length > 1) cells[c]?.remove();
      else if (cells[c]) (cells[c] as HTMLElement).innerHTML = '<br>';
    }
  });
  return true;
}

function deletePlainTableRow(editor: HTMLDivElement | null) {
  const range = tableCellRange(editor);
  if (!range) return false;
  const rows = Array.from(range.table.querySelectorAll('tr')) as HTMLTableRowElement[];
  for (let r = range.maxRow; r >= range.minRow; r--) {
    if (rows.length > 1) rows[r]?.remove();
    else rows[r]?.querySelectorAll('td,th').forEach(cell => { cell.innerHTML = '<br>'; });
  }
  return true;
}

function makePlainTableHeader(editor: HTMLDivElement | null) {
  const range = tableCellRange(editor);
  const table = range?.table || primaryTableCell(editor)?.closest('table');
  const firstRow = table?.querySelector('tr') as HTMLTableRowElement | null;
  if (!firstRow) return false;
  Array.from(firstRow.children).forEach(cell => {
    if (cell.tagName === 'TH') return;
    const th = document.createElement('th');
    th.innerHTML = (cell as HTMLElement).innerHTML || '<br>';
    th.setAttribute('style', (cell as HTMLElement).getAttribute('style') || '');
    cell.replaceWith(th);
  });
  return true;
}

function alignSelectedTableCell(alignment: 'left' | 'center' | 'right' | 'justify') {
  const cells = selectedTableCells(document.querySelector('.plain-rich-editor') as HTMLDivElement | null);
  if (!cells.length) { window.alert('Click inside a table cell first.'); return false; }
  cells.forEach(cell => { cell.style.textAlign = alignment; });
  return true;
}

function applyToSelectedTableCells(editor: HTMLDivElement | null, mutate: (cell: HTMLTableCellElement) => void) {
  const cells = selectedTableCells(editor);
  if (!cells.length || (cells.length === 1 && !cells[0].classList.contains('plain-table-cell-selected'))) return false;
  cells.forEach(mutate);
  return true;
}

function wrapCellContents(cell: HTMLTableCellElement, tag: 'strong' | 'em' | 'u' | 'code') {
  const wrapper = document.createElement(tag);
  while (cell.firstChild) wrapper.appendChild(cell.firstChild);
  cell.appendChild(wrapper);
}

function toggleCellTextFormat(editor: HTMLDivElement | null, format: 'bold' | 'italic' | 'underline' | 'code') {
  const tag = format === 'bold' ? 'strong' : format === 'italic' ? 'em' : format === 'underline' ? 'u' : 'code';
  return applyToSelectedTableCells(editor, cell => wrapCellContents(cell, tag));
}

function applyCellInlineStyle(editor: HTMLDivElement | null, style: Partial<CSSStyleDeclaration>) {
  return applyToSelectedTableCells(editor, cell => {
    const span = document.createElement('span');
    Object.assign(span.style, style);
    while (cell.firstChild) span.appendChild(cell.firstChild);
    cell.appendChild(span);
  });
}

function isLastTableCell(cell: HTMLTableCellElement | null) {
  const row = cell?.parentElement as HTMLTableRowElement | null;
  const table = cell?.closest('table');
  if (!cell || !row || !table) return false;
  const rows = Array.from(table.querySelectorAll('tr'));
  const cells = Array.from(row.children);
  return rows[rows.length - 1] === row && cells[cells.length - 1] === cell;
}

function focusTableCell(cell: HTMLTableCellElement | null) {
  if (!cell) return;
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function nextTableCell(cell: HTMLTableCellElement | null) {
  if (!cell) return null;
  const row = cell.parentElement as HTMLTableRowElement | null;
  if (!row) return null;
  const cells = Array.from(row.children) as HTMLTableCellElement[];
  const index = cells.indexOf(cell);
  if (index >= 0 && cells[index + 1]) return cells[index + 1];
  const nextRow = row.nextElementSibling as HTMLTableRowElement | null;
  return nextRow?.children?.[0] as HTMLTableCellElement | null;
}

export function PlainEditor({ pageId, workspaceId, onChanged, onPageLoaded }: Props) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const blockRef = useRef<Block | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [toolbarCompactLevel, setToolbarCompactLevel] = useState(0);
  const [wrapMenuOpen, setWrapMenuOpen] = useState(false);
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [codeDraft, setCodeDraft] = useState('');
  const [codeLanguage, setCodeLanguage] = useState('text');
  const [checklistModalOpen, setChecklistModalOpen] = useState(false);
  const [checklistTitle, setChecklistTitle] = useState('Progress checklist');
  const [checklistItems, setChecklistItems] = useState('First task\nSecond task\nThird task');
  const [tableContextMenu, setTableContextMenu] = useState<{ left: number; top: number; row: number; col: number; isFirstRow: boolean } | null>(null);
  const [turnMenu, setTurnMenu] = useState<{ left: number; top: number } | null>(null);
  const [activeTableOverlay, setActiveTableOverlay] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [activeMediaTools, setActiveMediaTools] = useState<{ left: number; top: number } | null>(null);
  const activeTableRef = useRef<HTMLTableElement | null>(null);
  const saveTimer = useRef<number | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const resizeRef = useRef<{ media: HTMLElement; startX: number; startY: number; startWidth: number; startHeight: number; aspectRatio: number; dir: string } | null>(null);
  const tableResizeRef = useRef<{ cell: HTMLTableCellElement; startX: number; startY: number; startWidth: number; startHeight: number; mode: 'col' | 'row' | 'both' } | null>(null);
  const tableAnchorCellRef = useRef<HTMLTableCellElement | null>(null);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const updateToolbarLevel = () => {
      const width = el.getBoundingClientRect().width;
      const nextLevel = width < 560 ? 3 : width < 680 ? 2 : width < 820 ? 1 : 0;
      setToolbarCompactLevel(prev => prev === nextLevel ? prev : nextLevel);
    };
    updateToolbarLevel();
    const observer = new ResizeObserver(updateToolbarLevel);
    observer.observe(el);
    window.addEventListener('resize', updateToolbarLevel);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateToolbarLevel);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const started = performance.now();
    async function loadPlainDocument() {
      setLoaded(false);
      const existing = await db.blocks.where('pageId').equals(pageId).sortBy('sort');
      let block = existing.find(b => b.type === 'richDocument') || existing[0];
      if (!block) {
        const t = now();
        block = { id: uid(), workspaceId, pageId, type: 'richDocument', text: '<p><br></p>', sort: 1, createdAt: t, updatedAt: t } as Block;
        await db.blocks.add(block);
      } else if (block.type !== 'richDocument') {
        await db.blocks.update(block.id, { type: 'richDocument', text: block.text || '<p><br></p>', updatedAt: now() } as Partial<Block>);
        block = { ...block, type: 'richDocument', text: block.text || '<p><br></p>' } as Block;
      }
      if (cancelled) return;
      blockRef.current = block;
      if (editorRef.current) editorRef.current.innerHTML = block.text || '<p><br></p>';
      setLoaded(true);
      onPageLoaded?.(Math.max(1, Math.round(performance.now() - started)));
    }
    void loadPlainDocument();
    return () => { cancelled = true; if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [pageId, workspaceId, onPageLoaded]);


  function updateActiveTableOverlay(table?: HTMLTableElement | null) {
    const nextTable = table === undefined ? activeTableRef.current : table;
    const shell = shellRef.current;
    const editor = editorRef.current;
    if (!nextTable || !shell || !editor || !editor.contains(nextTable)) {
      activeTableRef.current = null;
      setActiveTableOverlay(null);
      return;
    }
    activeTableRef.current = nextTable;
    const tableRect = nextTable.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    setActiveTableOverlay({
      left: Math.round(tableRect.left - shellRect.left),
      top: Math.round(tableRect.top - shellRect.top),
      width: Math.round(tableRect.width),
      height: Math.round(tableRect.height),
    });
  }


  function updateActiveMediaTools(media?: HTMLElement | null) {
    const selected = media === undefined ? getSelectedMedia(editorRef.current) : media;
    const shell = shellRef.current;
    const editor = editorRef.current;
    if (!selected || !shell || !editor || !editor.contains(selected)) {
      setActiveMediaTools(null);
      return;
    }
    const rect = selected.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    setActiveMediaTools({
      left: Math.round(rect.left - shellRect.left + rect.width - 86),
      top: Math.round(rect.top - shellRect.top - 38),
    });
  }

  function rememberSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (selectionBelongsToEditor(editor, selection) && selection && selection.rangeCount > 0) {
      savedRangeRef.current = selection.getRangeAt(0).cloneRange();
      const node = selection.anchorNode;
      const element = node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement;
      const table = element?.closest?.('table') as HTMLTableElement | null;
      if (table) updateActiveTableOverlay(table);
    }
  }

  function restoreSelection() {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    if (savedRangeRef.current) selection?.addRange(savedRangeRef.current.cloneRange());
  }

  useEffect(() => {
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (selectionBelongsToEditor(editorRef.current, selection) && selection && selection.rangeCount > 0) {
        savedRangeRef.current = selection.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  function applyColorStyle(kind: 'color' | 'backgroundColor', value: string) {
    restoreSelection();
    const selectedCells = selectedTableCells(editorRef.current);
    if (selectedCells.length && selectedCells.some(cell => cell.classList.contains('plain-table-cell-selected'))) {
      applyCellInlineStyle(editorRef.current, { [kind]: value } as Partial<CSSStyleDeclaration>);
    } else {
      const command = kind === 'color' ? 'foreColor' : 'hiliteColor';
      const worked = document.queryCommandSupported?.(command) ? document.execCommand(command, false, value) : false;
      if (!worked) applyInlineStyle({ [kind]: value } as Partial<CSSStyleDeclaration>);
    }
    rememberSelection();
    scheduleSave();
  }

  useEffect(() => {
    if (!moreOpen && !wrapMenuOpen && !turnMenu && !tableContextMenu) return;
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.plain-toolbar-more-wrap')) setMoreOpen(false);
      if (!target?.closest('.plain-media-wrap-menu') && !target?.closest('.plain-media-tools')) setWrapMenuOpen(false);
      if (!target?.closest('.plain-turn-menu')) setTurnMenu(null);
      if (!target?.closest('.plain-table-context-menu')) setTableContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMoreOpen(false); setWrapMenuOpen(false); setTurnMenu(null); setTableContextMenu(null); }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen, wrapMenuOpen, turnMenu, tableContextMenu]);

  useEffect(() => {
    const onUndoRedoShortcut = (event: KeyboardEvent) => {
      const editor = editorRef.current;
      const target = event.target as HTMLElement | null;
      if (!editor || !target || !editor.contains(target)) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        runCommand(event.shiftKey ? 'redo' : 'undo');
        scheduleSave();
        return;
      }
      if (key === 'y') {
        event.preventDefault();
        runCommand('redo');
        scheduleSave();
      }
    };
    document.addEventListener('keydown', onUndoRedoShortcut, true);
    return () => document.removeEventListener('keydown', onUndoRedoShortcut, true);
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    const onRefresh = () => { updateActiveTableOverlay(); updateActiveMediaTools(); };
    window.addEventListener('resize', onRefresh);
    editor?.addEventListener('scroll', onRefresh, { passive: true });
    return () => {
      window.removeEventListener('resize', onRefresh);
      editor?.removeEventListener('scroll', onRefresh);
    };
  }, [loaded]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const active = resizeRef.current;
      if (active) {
        event.preventDefault();
        const dx = event.clientX - active.startX;
        const dy = event.clientY - active.startY;
        const fromLeft = active.dir.includes('w');
        const horizontalDelta = fromLeft ? -dx : dx;
        const verticalDelta = active.dir.includes('n') ? -dy : dy;
        const dominantDelta = Math.abs(horizontalDelta) >= Math.abs(verticalDelta) ? horizontalDelta : verticalDelta * active.aspectRatio;
        const nextWidth = Math.max(90, Math.min(980, active.startWidth + dominantDelta));
        const nextHeight = Math.max(60, Math.round(nextWidth / Math.max(0.1, active.aspectRatio)));
        active.media.style.width = `${Math.round(nextWidth)}px`;
        active.media.style.height = `${nextHeight}px`;
        active.media.style.maxWidth = '100%';
        return;
      }
      const tableActive = tableResizeRef.current;
      if (tableActive) {
        event.preventDefault();
        if (tableActive.mode === 'col' || tableActive.mode === 'both') {
          tableActive.cell.style.width = `${Math.max(48, tableActive.startWidth + (event.clientX - tableActive.startX))}px`;
        }
        if (tableActive.mode === 'row' || tableActive.mode === 'both') {
          tableActive.cell.style.height = `${Math.max(28, tableActive.startHeight + (event.clientY - tableActive.startY))}px`;
        }
      }
    };
    const onUp = () => {
      if (!resizeRef.current && !tableResizeRef.current) return;
      resizeRef.current = null;
      tableResizeRef.current = null;
      scheduleSave();
      window.setTimeout(() => { updateActiveTableOverlay(); updateActiveMediaTools(); }, 0);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  async function saveNow() {
    const block = blockRef.current;
    const el = editorRef.current;
    if (!block || !el) return;
    const cleaned = sanitizeRichHtml(cloneEditorHtmlForSave(el));
    const t = now();
    setSaving(true);
    await db.blocks.update(block.id, { text: cleaned, updatedAt: t } as Partial<Block>);
    await db.pages.update(pageId, { updatedAt: t });
    blockRef.current = { ...block, text: cleaned, updatedAt: t };
    setSaving(false);
    onChanged?.();
  }

  function scheduleSave() {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void saveNow(); }, 450);
  }

  function runCommand(command: string, value?: string) {
    restoreSelection();
    const selectedCells = selectedTableCells(editorRef.current);
    const hasExplicitCellSelection = selectedCells.length && selectedCells.some(cell => cell.classList.contains('plain-table-cell-selected'));
    if (hasExplicitCellSelection) {
      if (command === 'bold') toggleCellTextFormat(editorRef.current, 'bold');
      else if (command === 'italic') toggleCellTextFormat(editorRef.current, 'italic');
      else if (command === 'underline') toggleCellTextFormat(editorRef.current, 'underline');
      else if (command === 'justifyLeft') alignSelectedTableCell('left');
      else if (command === 'justifyCenter') alignSelectedTableCell('center');
      else if (command === 'justifyRight') alignSelectedTableCell('right');
      else if (command === 'justifyFull') alignSelectedTableCell('justify');
      else document.execCommand(command, false, value);
    } else {
      document.execCommand(command, false, value);
    }
    rememberSelection();
    scheduleSave();
  }

  function setFormat(tag: 'p' | 'h1' | 'h2' | 'h3' | 'blockquote') {
    runCommand('formatBlock', tag);
  }

  function turnSelectionTo(kind: 'p' | 'h1' | 'h2' | 'h3' | 'blockquote' | 'ul' | 'ol' | 'code') {
    restoreSelection();
    if (kind === 'ul') document.execCommand('insertUnorderedList');
    else if (kind === 'ol') document.execCommand('insertOrderedList');
    else if (kind === 'code') {
      const selected = getSelectionText();
      if (selected.trim()) {
        const lang = guessCodeLanguage(selected);
        const html = `<pre class="plain-code-block" data-language="${lang}"><code>${simpleHighlightCode(selected, lang)}</code></pre><p><br></p>`;
        insertHtmlAtSelection(editorRef.current, html);
      } else document.execCommand('formatBlock', false, 'pre');
    } else document.execCommand('formatBlock', false, kind);
    rememberSelection();
    setTurnMenu(null);
    scheduleSave();
  }

  function insertLink() {
    const current = window.getSelection()?.toString() || '';
    const raw = window.prompt('Paste a link URL', current.startsWith('http') ? current : 'https://');
    if (!raw) return;
    const href = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
    runCommand('createLink', href);
  }

  function insertTable() {
    editorRef.current?.focus();
    const rows = Math.max(1, Math.min(12, Number(window.prompt('Rows', '3') || 3)));
    const cols = Math.max(1, Math.min(8, Number(window.prompt('Columns', '3') || 3)));
    const body = Array.from({ length: rows }, () => `<tr>${Array.from({ length: cols }, () => '<td><br></td>').join('')}</tr>`).join('');
    insertHtmlAtSelection(editorRef.current, `<table><tbody>${body}</tbody></table><p><br></p>`);
    scheduleSave();
  }


  function openChecklistModal() {
    restoreSelection();
    setChecklistTitle('Progress checklist');
    setChecklistItems('First task\nSecond task\nThird task');
    setChecklistModalOpen(true);
  }

  function confirmChecklistModal() {
    const items = checklistItems.split(/\n+/).map(x => x.trim()).filter(Boolean).slice(0, 30);
    if (!items.length) { setChecklistModalOpen(false); return; }
    const title = checklistTitle.trim() || 'Checklist';
    const rows = items.map((item, index) => `<tr><td class="plain-checklist-check"><input type="checkbox" contenteditable="false"></td><td>${escapeHtml(item)}</td><td class="plain-checklist-status">Pending</td></tr>`).join('');
    const html = `<figure class="plain-checklist-card" contenteditable="false"><figcaption>${escapeHtml(title)}</figcaption><table class="plain-checklist-table"><tbody>${rows}</tbody></table></figure><p><br></p>`;
    insertHtmlAtSelection(editorRef.current, html);
    setChecklistModalOpen(false);
    scheduleSave();
  }

  function openCodeModal() {
    restoreSelection();
    const selected = getSelectionText();
    setCodeDraft(selected || '');
    setCodeLanguage(selected ? guessCodeLanguage(selected) : 'text');
    setCodeModalOpen(true);
  }

  function confirmCodeModal() {
    const raw = codeDraft || '';
    if (!raw.trim()) { setCodeModalOpen(false); return; }
    const language = codeLanguage === 'auto' ? guessCodeLanguage(raw) : codeLanguage;
    const highlighted = simpleHighlightCode(raw, language);
    insertHtmlAtSelection(editorRef.current, `<pre class="plain-code-block" data-language="${language}"><code>${highlighted}</code></pre><p><br></p>`);
    setCodeModalOpen(false);
    setCodeDraft('');
    scheduleSave();
  }


  function ensureMediaResizeHandle(media: HTMLElement) {
    let wrap = media.closest('.plain-media-resize-wrap') as HTMLElement | null;
    if (!wrap) {
      wrap = document.createElement('span');
      wrap.className = 'plain-media-resize-wrap wrap-inline';
      wrap.setAttribute('data-wrap', 'inline');
      wrap.setAttribute('contenteditable', 'false');
      media.parentNode?.insertBefore(wrap, media);
      wrap.appendChild(media);
    }
    const dirs = ['nw','ne','se','sw'];
    dirs.forEach(dir => {
      if (wrap?.querySelector(`.plain-media-resize-handle[data-dir="${dir}"]`)) return;
      const handle = document.createElement('span');
      handle.className = `plain-media-resize-handle plain-media-resize-${dir}`;
      handle.dataset.dir = dir;
      handle.setAttribute('contenteditable', 'false');
      handle.title = 'Drag to resize';
      wrap?.appendChild(handle);
    });
    return wrap;
  }

  function handleEditorClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const checkbox = target.closest('.plain-checklist-table input[type=\"checkbox\"]') as HTMLInputElement | null;
    if (checkbox) {
      const row = checkbox.closest('tr');
      const status = row?.querySelector('.plain-checklist-status');
      if (status) status.textContent = checkbox.checked ? 'Done' : 'Pending';
      if (checkbox.checked) checkbox.setAttribute('checked', 'checked'); else checkbox.removeAttribute('checked');
      scheduleSave();
      return;
    }
    const link = target.closest('a') as HTMLAnchorElement | null;
    if (link?.href) { e.preventDefault(); window.open(link.href, '_blank', 'noopener,noreferrer'); return; }
    if (target.closest('.plain-media-resize-handle')) return;
    const table = target.closest('table') as HTMLTableElement | null;
    if (table && editorRef.current?.contains(table)) updateActiveTableOverlay(table);
    else updateActiveTableOverlay(null);
    editorRef.current?.querySelectorAll('img.plain-media-selected, video.plain-media-selected').forEach(el => el.classList.remove('plain-media-selected'));
    setActiveMediaTools(null);
    if (!table) clearTableCellSelection(editorRef.current);
    const media = target.closest('img, video') as HTMLElement | null;
    if (media && editorRef.current?.contains(media)) {
      media.classList.add('plain-media-selected');
      media.setAttribute('contenteditable', 'false');
      ensureMediaResizeHandle(media);
      updateActiveMediaTools(media);
      scheduleSave();
      return;
    }
    rememberSelection();
  }


  function handleEditorPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const handle = target.closest('.plain-media-resize-handle') as HTMLElement | null;
    if (handle) {
      const wrap = handle.closest('.plain-media-resize-wrap') as HTMLElement | null;
      const media = wrap?.querySelector('img, video') as HTMLElement | null;
      if (!media) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = media.getBoundingClientRect();
      resizeRef.current = { media, startX: e.clientX, startY: e.clientY, startWidth: rect.width, startHeight: rect.height, aspectRatio: rect.width / Math.max(1, rect.height), dir: handle.dataset.dir || 'se' };
      media.classList.add('plain-media-selected');
      return;
    }
    const cell = target.closest('td,th') as HTMLTableCellElement | null;
    if (cell) {
      const table = cell.closest('table') as HTMLTableElement | null;
      if (table) updateActiveTableOverlay(table);
      const rect = cell.getBoundingClientRect();
      const nearTop = Math.abs(e.clientY - rect.top) <= 7;
      const nearLeft = Math.abs(e.clientX - rect.left) <= 7;
      if (nearTop) {
        e.preventDefault();
        e.stopPropagation();
        selectTableColumn(cell, editorRef.current);
        rememberSelection();
        return;
      }
      if (nearLeft) {
        e.preventDefault();
        e.stopPropagation();
        selectTableRow(cell, editorRef.current);
        rememberSelection();
        return;
      }
      const nearRight = Math.abs(e.clientX - rect.right) <= 7;
      const nearBottom = Math.abs(e.clientY - rect.bottom) <= 7;
      if (nearRight || nearBottom) {
        e.preventDefault();
        e.stopPropagation();
        tableResizeRef.current = { cell, startX: e.clientX, startY: e.clientY, startWidth: rect.width, startHeight: rect.height, mode: nearRight && nearBottom ? 'both' : nearRight ? 'col' : 'row' };
        return;
      }
      if (e.shiftKey && tableAnchorCellRef.current) {
        e.preventDefault();
        e.stopPropagation();
        selectTableRectangle(tableAnchorCellRef.current, cell, editorRef.current);
        rememberSelection();
        return;
      }
      tableAnchorCellRef.current = cell;
      clearTableCellSelection(editorRef.current);
    }
  }

  function insertMediaFiles(files: File[]) {
    const accepted = files.filter(file => file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/'));
    if (!accepted.length) {
      window.alert('Plain Document media insert currently supports image, video, and audio files. Use Block Page for document attachments.');
      return;
    }
    const heavy = accepted.find(file => file.size > 8 * 1024 * 1024);
    if (heavy && !window.confirm('One or more media files are larger than 8 MB and may make the page heavier. Insert them anyway?')) return;
    Promise.all(accepted.map(file => new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result || '');
        const alt = escapeHtml(file.name || 'media');
        if (file.type.startsWith('image/')) resolve(`<figure class="plain-media-figure"><img src="${src}" alt="${alt}" title="${alt}"></figure>`);
        else if (file.type.startsWith('video/')) resolve(`<figure class="plain-media-figure"><video controls src="${src}" title="${alt}"></video></figure>`);
        else resolve(`<p><audio controls src="${src}" title="${alt}"></audio></p>`);
      };
      reader.readAsDataURL(file);
    }))).then(items => {
      const allImages = accepted.length > 1 && accepted.every(file => file.type.startsWith('image/'));
      const html = allImages ? `<div class="plain-media-grid">${items.join('')}</div><p><br></p>` : `${items.join('')}<p><br></p>`;
      insertHtmlAtSelection(editorRef.current, html);
      scheduleSave();
    });
  }

  function insertMediaFile(file: File) {
    if (!file) return;
    insertMediaFiles([file]);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const files = Array.from(e.clipboardData.files || []);
    if (files.length) {
      e.preventDefault();
      insertMediaFiles(files);
      return;
    }
    if (!html && !text) return;
    e.preventDefault();
    const source = html && /<(h[1-4]|ul|ol|li|table|blockquote|pre|strong|em|b|i|u|a|span|div)\b/i.test(html)
      ? normalizeExternalHtml(html)
      : plainTextToRichHtml(text || '');
    const cleaned = sanitizeRichHtml(source);
    const ok = insertHtmlAtSelection(editorRef.current, cleaned);
    if (!ok && editorRef.current) editorRef.current.innerHTML += cleaned;
    autoLinkEditorUrls(editorRef.current);
    scheduleSave();
  }

  function applyLineHeight(value: string) {
    editorRef.current?.focus();
    applyInlineStyle({ lineHeight: value });
    scheduleSave();
  }

  function applyFontSize(value: string) {
    editorRef.current?.focus();
    applyInlineStyle({ fontSize: value });
    scheduleSave();
  }

  function applyFontFamily(value: string) {
    editorRef.current?.focus();
    applyInlineStyle({ fontFamily: value });
    scheduleSave();
  }

  function runToolbarAction(action: () => void) {
    action();
    setMoreOpen(false);
  }

  function addGhostTableColumn() {
    const table = activeTableRef.current;
    if (!table) return;
    const currentCell = selectedTableCell();
    insertTableColumnAtEnd(table);
    scheduleSave();
    window.setTimeout(() => {
      updateActiveTableOverlay(table);
      const row = currentCell?.parentElement as HTMLTableRowElement | null;
      const focusRow = row && table.contains(row) ? row : table.querySelector('tr');
      focusTableCell(focusRow?.lastElementChild as HTMLTableCellElement | null);
    }, 0);
  }

  function addGhostTableRow() {
    const table = activeTableRef.current;
    if (!table) return;
    const newRow = insertTableRowAtEnd(table);
    scheduleSave();
    window.setTimeout(() => {
      updateActiveTableOverlay(table);
      focusTableCell(newRow instanceof HTMLTableRowElement ? newRow.children?.[0] as HTMLTableCellElement : null);
    }, 0);
  }


  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const media = getSelectedMedia(editorRef.current);
    if (media && (e.metaKey || e.ctrlKey) && ['c','x'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const wrap = getMediaWrapper(media) || media;
      const html = wrap.outerHTML;
      void navigator.clipboard?.write?.([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([media.getAttribute('alt') || media.getAttribute('title') || 'image'], { type: 'text/plain' }) })]).catch(() => navigator.clipboard?.writeText(html));
      if (e.key.toLowerCase() === 'x') {
        wrap.remove();
        scheduleSave();
      }
      return;
    }
    if (e.key === 'Tab') {
      const cell = selectedTableCell();
      if (cell) {
        e.preventDefault();
        if (isLastTableCell(cell)) {
          insertTableRow();
          const row = cell.parentElement as HTMLTableRowElement;
          const nextRow = row.nextElementSibling as HTMLTableRowElement | null;
          focusTableCell(nextRow?.children?.[0] as HTMLTableCellElement | null);
        } else {
          focusTableCell(nextTableCell(cell));
        }
        scheduleSave();
        window.setTimeout(() => updateActiveTableOverlay(cell.closest('table') as HTMLTableElement | null), 0);
        return;
      }
      const sel = window.getSelection();
      const li = sel?.anchorNode ? (sel.anchorNode.nodeType === Node.ELEMENT_NODE ? sel.anchorNode as Element : sel.anchorNode.parentElement)?.closest('li') : null;
      if (li && editorRef.current?.contains(li)) {
        e.preventDefault();
        document.execCommand(e.shiftKey ? 'outdent' : 'indent');
        scheduleSave();
        return;
      }
    }
  }

  const showAlignTools = toolbarCompactLevel < 1;
  const showLineHeightSelect = toolbarCompactLevel < 2;
  const showListTools = toolbarCompactLevel < 2;
  const showQuickCode = toolbarCompactLevel < 2;
  const showQuickTable = toolbarCompactLevel < 2;
  const showQuickLink = toolbarCompactLevel < 3;
  const hasListGroup = showListTools || showLineHeightSelect;
  const hasQuickGroup = showQuickLink || showQuickCode || showQuickTable;

  return <div className="plain-editor-shell" ref={shellRef}>
    <div ref={toolbarRef} className={`plain-editor-toolbar toolbar-compact-${toolbarCompactLevel}`} aria-label="Plain document toolbar">
      <div className="plain-toolbar-row">
        <div className="plain-toolbar-group plain-toolbar-main-group" aria-label="Document style">
          <select className="plain-toolbar-select heading-select" title="Text style" defaultValue="p" onMouseDown={e => e.stopPropagation()} onChange={e => setFormat(e.currentTarget.value as 'p' | 'h1' | 'h2' | 'h3' | 'blockquote')}>
            <option value="p">Text normal</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="blockquote">Quote</option>
          </select>
          <select className="plain-toolbar-select font-select" title="Font" defaultValue="Poppins, Roboto, Calibri" onChange={e => applyFontFamily(e.currentTarget.value)}>
            <option value="Poppins, Roboto, Calibri">Poppins</option>
            <option value="Arial, Helvetica, sans-serif">Arial</option>
            <option value="Calibri, Arial, sans-serif">Calibri</option>
            <option value="Georgia, serif">Georgia</option>
            <option value="'Times New Roman', serif">Times</option>
            <option value="'Courier New', monospace">Courier</option>
          </select>
          <select className="plain-toolbar-select size-select" title="Font size" defaultValue="16px" onChange={e => applyFontSize(e.currentTarget.value)}>
            <option value="11px">11</option><option value="12px">12</option><option value="14px">14</option><option value="16px">16</option><option value="18px">18</option><option value="24px">24</option><option value="32px">32</option>
          </select>
        </div>
        <div className="plain-toolbar-group plain-toolbar-main-group" aria-label="Inline formatting">
          <button title="Bold" onMouseDown={e => { e.preventDefault(); runCommand('bold'); }}><Bold size={15}/></button>
          <button title="Italic" onMouseDown={e => { e.preventDefault(); runCommand('italic'); }}><Italic size={15}/></button>
          <button title="Underline" onMouseDown={e => { e.preventDefault(); runCommand('underline'); }}><Underline size={15}/></button>
          <label className="plain-color-button" title="Text color" onMouseDown={rememberSelection} onClick={rememberSelection}><Palette size={15}/><input type="color" onFocus={rememberSelection} onInput={e => applyColorStyle('color', (e.target as HTMLInputElement).value)} onChange={e => applyColorStyle('color', (e.target as HTMLInputElement).value)} /></label>
          <label className="plain-color-button" title="Highlight" onMouseDown={rememberSelection} onClick={rememberSelection}><Highlighter size={15}/><input type="color" defaultValue="#fff3a3" onFocus={rememberSelection} onInput={e => applyColorStyle('backgroundColor', (e.target as HTMLInputElement).value)} onChange={e => applyColorStyle('backgroundColor', (e.target as HTMLInputElement).value)} /></label>
        </div>
        {hasListGroup && <div className="plain-toolbar-group plain-toolbar-main-group" aria-label="Lists and paragraph">
          {showListTools && <button title="Bullet list" onMouseDown={e => { e.preventDefault(); runCommand('insertUnorderedList'); }}><List size={15}/></button>}
          {showListTools && <button title="Numbered list" onMouseDown={e => { e.preventDefault(); runCommand('insertOrderedList'); }}><ListOrdered size={15}/></button>}
          {showLineHeightSelect && <select className="plain-toolbar-select line-select" title="Line height" defaultValue="1.5" onChange={e => applyLineHeight(e.currentTarget.value)}>
            <option value="1.15">1.15</option><option value="1.5">1.5</option><option value="1.75">1.75</option><option value="2">2.0</option>
          </select>}
        </div>}
        {showAlignTools && <div className="plain-toolbar-group plain-toolbar-main-group plain-toolbar-align-group" aria-label="Paragraph alignment">
          <button title="Align left" onMouseDown={e => { e.preventDefault(); runCommand('justifyLeft'); }}><AlignLeft size={15}/></button>
          <button title="Align center" onMouseDown={e => { e.preventDefault(); runCommand('justifyCenter'); }}><AlignCenter size={15}/></button>
          <button title="Align right" onMouseDown={e => { e.preventDefault(); runCommand('justifyRight'); }}><AlignRight size={15}/></button>
          <button title="Justify" onMouseDown={e => { e.preventDefault(); runCommand('justifyFull'); }}><AlignJustify size={15}/></button>
        </div>}
        {hasQuickGroup && <div className="plain-toolbar-group plain-toolbar-main-group" aria-label="Quick insert">
          {showQuickLink && <button title="Link" onMouseDown={e => { e.preventDefault(); insertLink(); }}><Link size={15}/></button>}
          {showQuickCode && <button title="Code block" onMouseDown={e => { e.preventDefault(); openCodeModal(); }}><Code2 size={15}/></button>}
          {showQuickTable && <button title="Insert table" onMouseDown={e => { e.preventDefault(); insertTable(); }}><Table2 size={15}/></button>}
        </div>}
        <div className="plain-toolbar-more-wrap">
          <button className="plain-toolbar-more-button" title="More formatting" aria-expanded={moreOpen} onMouseDown={e => { e.preventDefault(); setMoreOpen(v => !v); }}><MoreVertical size={17}/></button>
          {moreOpen && <div className="plain-toolbar-more-menu" onMouseDown={e => e.preventDefault()}>
            <div className="plain-toolbar-more-section" aria-label="More formatting tools">
              {!showListTools && <button title="Bullet list" aria-label="Bullet list" onClick={() => runToolbarAction(() => runCommand('insertUnorderedList'))}><List size={16}/></button>}
              {!showListTools && <button title="Numbered list" aria-label="Numbered list" onClick={() => runToolbarAction(() => runCommand('insertOrderedList'))}><ListOrdered size={16}/></button>}
              {!showAlignTools && <button title="Align left" aria-label="Align left" onClick={() => runToolbarAction(() => runCommand('justifyLeft'))}><AlignLeft size={16}/></button>}
              {!showAlignTools && <button title="Align center" aria-label="Align center" onClick={() => runToolbarAction(() => runCommand('justifyCenter'))}><AlignCenter size={16}/></button>}
              {!showAlignTools && <button title="Align right" aria-label="Align right" onClick={() => runToolbarAction(() => runCommand('justifyRight'))}><AlignRight size={16}/></button>}
              {!showAlignTools && <button title="Justify" aria-label="Justify" onClick={() => runToolbarAction(() => runCommand('justifyFull'))}><AlignJustify size={16}/></button>}
              {!showQuickLink && <button title="Link" aria-label="Link" onClick={() => runToolbarAction(insertLink)}><Link size={16}/></button>}
              {!showQuickCode && <button title="Code block" aria-label="Code block" onClick={() => runToolbarAction(openCodeModal)}><Code2 size={16}/></button>}
              {!showQuickTable && <button title="Insert table" aria-label="Insert table" onClick={() => runToolbarAction(insertTable)}><Table2 size={16}/></button>}
              <button title="Checklist table" aria-label="Checklist table" onClick={() => runToolbarAction(openChecklistModal)}><CheckSquare size={16}/></button>
              <button title="Decrease indent" aria-label="Decrease indent" onClick={() => runToolbarAction(() => runCommand('outdent'))}><IndentDecrease size={16}/></button>
              <button title="Increase indent" aria-label="Increase indent" onClick={() => runToolbarAction(() => runCommand('indent'))}><IndentIncrease size={16}/></button>
              <button title="Insert media" aria-label="Insert media" onClick={() => runToolbarAction(() => mediaInputRef.current?.click())}><ImageIcon size={16}/></button>
              <button title="Undo" aria-label="Undo" onClick={() => runToolbarAction(() => runCommand('undo'))}><Undo2 size={16}/></button>
              <button title="Redo" aria-label="Redo" onClick={() => runToolbarAction(() => runCommand('redo'))}><Redo2 size={16}/></button>
            </div>
          </div>}
        </div>
      </div>
      <input ref={mediaInputRef} className="plain-media-input" type="file" multiple accept="image/*,video/*,audio/*" onChange={e => { const files = Array.from(e.target.files || []); if (files.length) insertMediaFiles(files); e.currentTarget.value = ''; }} />
    </div>
    <div className="plain-doc-ruler" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <span key={index} data-label={index + 1} />)}</div>
    <div
      ref={editorRef}
      className="plain-rich-editor"
      contentEditable
      suppressContentEditableWarning
      data-placeholder="Start writing your plain document..."
      onInput={() => { rememberSelection(); scheduleSave(); }}
      onBlur={() => { autoLinkEditorUrls(editorRef.current); void saveNow(); }}
      onPaste={handlePaste}
      onDrop={e => {
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length) { e.preventDefault(); insertMediaFiles(files); }
      }}
      onClick={handleEditorClick}
      onKeyDown={handleEditorKeyDown}
      onKeyUp={rememberSelection}
      onMouseUp={rememberSelection}
      onPointerDown={handleEditorPointerDown}
      onContextMenu={e => {
        const target = e.target as HTMLElement;
        const cell = target.closest('td,th') as HTMLTableCellElement | null;
        if (cell) {
          e.preventDefault();
          updateActiveTableOverlay(cell.closest('table') as HTMLTableElement | null);
          if (!cell.classList.contains('plain-table-cell-selected')) clearTableCellSelection(editorRef.current);
          cell.closest('table')?.classList.remove('plain-table-row-selected', 'plain-table-col-selected');
          cell.classList.add('plain-table-cell-selected');
          rememberSelection();
          const shellRect = shellRef.current?.getBoundingClientRect();
          const row = cell.parentElement as HTMLTableRowElement | null;
          const table = cell.closest('table');
          const rowIndex = row && table ? Array.from(table.querySelectorAll('tr')).indexOf(row) : 0;
          const colIndex = row ? Array.from(row.children).indexOf(cell) : 0;
          setTableContextMenu(shellRect ? { left: e.clientX - shellRect.left, top: e.clientY - shellRect.top, row: rowIndex, col: colIndex, isFirstRow: rowIndex === 0 } : { left: e.clientX, top: e.clientY, row: rowIndex, col: colIndex, isFirstRow: rowIndex === 0 });
          setTurnMenu(null);
          return;
        }
        const selection = window.getSelection();
        if (selectionBelongsToEditor(editorRef.current, selection) && selection && !selection.isCollapsed && selection.toString().trim()) {
          e.preventDefault();
          rememberSelection();
          const shellRect = shellRef.current?.getBoundingClientRect();
          setTurnMenu(shellRect ? { left: e.clientX - shellRect.left, top: e.clientY - shellRect.top } : { left: e.clientX, top: e.clientY });
          setTableContextMenu(null);
        } else {
          setTurnMenu(null);
        }
      }}
    />
    {activeTableOverlay && <div className="plain-table-ghost-layer" aria-hidden="false">
      <button
        type="button"
        className="plain-table-ghost plain-table-ghost-col"
        title="Add column"
        aria-label="Add table column"
        style={{ left: activeTableOverlay.left + activeTableOverlay.width + 6, top: activeTableOverlay.top, height: activeTableOverlay.height }}
        onMouseDown={e => e.preventDefault()}
        onClick={addGhostTableColumn}
      >+</button>
      <button
        type="button"
        className="plain-table-ghost plain-table-ghost-row"
        title="Add row"
        aria-label="Add table row"
        style={{ left: activeTableOverlay.left, top: activeTableOverlay.top + activeTableOverlay.height + 6, width: activeTableOverlay.width }}
        onMouseDown={e => e.preventDefault()}
        onClick={addGhostTableRow}
      >+</button>
    </div>}
    {activeMediaTools && <div className="plain-media-tools" style={{ left: activeMediaTools.left, top: activeMediaTools.top }} onMouseDown={e => e.preventDefault()}>
      <button title="Align image left" aria-label="Align image left" onClick={() => { if (setMediaAlignment(getSelectedMedia(editorRef.current), 'left')) scheduleSave(); updateActiveMediaTools(); }}><AlignLeft size={14}/></button>
      <button title="Align image center" aria-label="Align image center" onClick={() => { if (setMediaAlignment(getSelectedMedia(editorRef.current), 'center')) scheduleSave(); updateActiveMediaTools(); }}><AlignCenter size={14}/></button>
      <button title="Align image right" aria-label="Align image right" onClick={() => { if (setMediaAlignment(getSelectedMedia(editorRef.current), 'right')) scheduleSave(); updateActiveMediaTools(); }}><AlignRight size={14}/></button>
      <button title="Wrap text" aria-label="Wrap text" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setWrapMenuOpen(v => !v); }}><WrapText size={15}/></button>
      <button title="Add caption" aria-label="Add caption" onClick={() => { if (addCaptionToMedia(getSelectedMedia(editorRef.current))) scheduleSave(); updateActiveMediaTools(); }}>Cap</button>
      {wrapMenuOpen && <div className="plain-wrap-menu plain-media-wrap-menu" onClick={e => e.stopPropagation()}>
        <button onClick={() => { if (setMediaWrapMode(getSelectedMedia(editorRef.current), 'inline')) scheduleSave(); setWrapMenuOpen(false); }}>Inline</button>
        <button onClick={() => { if (setMediaWrapMode(getSelectedMedia(editorRef.current), 'square')) scheduleSave(); setWrapMenuOpen(false); }}>Square</button>
        <button onClick={() => { if (setMediaWrapMode(getSelectedMedia(editorRef.current), 'tight')) scheduleSave(); setWrapMenuOpen(false); }}>Tight</button>
        <button onClick={() => { if (setMediaWrapMode(getSelectedMedia(editorRef.current), 'through')) scheduleSave(); setWrapMenuOpen(false); }}>Through</button>
        <button onClick={() => { if (setMediaWrapMode(getSelectedMedia(editorRef.current), 'top-bottom')) scheduleSave(); setWrapMenuOpen(false); }}>Top & bottom</button>
        <button onClick={() => { if (setMediaWrapMode(getSelectedMedia(editorRef.current), 'behind')) scheduleSave(); setWrapMenuOpen(false); }}>Behind</button>
        <button onClick={() => { if (setMediaWrapMode(getSelectedMedia(editorRef.current), 'front')) scheduleSave(); setWrapMenuOpen(false); }}>Front</button>
      </div>}
    </div>}
    {turnMenu && <div className="plain-turn-menu" style={{ left: turnMenu.left, top: turnMenu.top }} onMouseDown={e => e.preventDefault()}>
      <button title="Turn into normal text" aria-label="Turn into normal text" onClick={() => turnSelectionTo('p')}>T</button>
      <button title="Turn into heading 1" aria-label="Turn into heading 1" onClick={() => turnSelectionTo('h1')}>H1</button>
      <button title="Turn into heading 2" aria-label="Turn into heading 2" onClick={() => turnSelectionTo('h2')}>H2</button>
      <button title="Turn into heading 3" aria-label="Turn into heading 3" onClick={() => turnSelectionTo('h3')}>H3</button>
      <button title="Turn into quote" aria-label="Turn into quote" onClick={() => turnSelectionTo('blockquote')}>“</button>
      <button title="Turn into bullet list" aria-label="Turn into bullet list" onClick={() => turnSelectionTo('ul')}><List size={14}/></button>
      <button title="Turn into numbered list" aria-label="Turn into numbered list" onClick={() => turnSelectionTo('ol')}><ListOrdered size={14}/></button>
      <button title="Turn into code block" aria-label="Turn into code block" onClick={() => turnSelectionTo('code')}><Code2 size={14}/></button>
    </div>}
    {tableContextMenu && <div className="plain-table-context-menu plain-table-context-menu-grid" style={{ left: tableContextMenu.left, top: tableContextMenu.top }} onMouseDown={e => e.preventDefault()}>
      <button title="Align cells left" aria-label="Align cells left" onClick={() => { if (alignSelectedTableCell('left')) scheduleSave(); setTableContextMenu(null); }}><AlignLeft size={15}/></button>
      <button title="Align cells center" aria-label="Align cells center" onClick={() => { if (alignSelectedTableCell('center')) scheduleSave(); setTableContextMenu(null); }}><AlignCenter size={15}/></button>
      <button title="Align cells right" aria-label="Align cells right" onClick={() => { if (alignSelectedTableCell('right')) scheduleSave(); setTableContextMenu(null); }}><AlignRight size={15}/></button>
      <button title="Insert row above" aria-label="Insert row above" onClick={() => { if (insertPlainTableRow(editorRef.current, 'above')) scheduleSave(); setTableContextMenu(null); }}><ArrowUp size={15}/></button>
      <button title="Insert row below" aria-label="Insert row below" onClick={() => { if (insertPlainTableRow(editorRef.current, 'below')) scheduleSave(); setTableContextMenu(null); }}><ArrowDown size={15}/></button>
      <button title="Insert column left" aria-label="Insert column left" onClick={() => { if (insertPlainTableColumn(editorRef.current, 'left')) scheduleSave(); setTableContextMenu(null); }}><ArrowLeft size={15}/></button>
      <button title="Insert column right" aria-label="Insert column right" onClick={() => { if (insertPlainTableColumn(editorRef.current, 'right')) scheduleSave(); setTableContextMenu(null); }}><ArrowRight size={15}/></button>
      <button title="Duplicate row" aria-label="Duplicate row" onClick={() => { if (duplicatePlainTableRow(editorRef.current)) scheduleSave(); setTableContextMenu(null); }}><Copy size={15}/></button>
      <button title="Duplicate column" aria-label="Duplicate column" onClick={() => { if (duplicatePlainTableColumn(editorRef.current)) scheduleSave(); setTableContextMenu(null); }}><Copy size={15}/></button>
      {tableContextMenu.isFirstRow && <button title="Make first row table header" aria-label="Make first row table header" onClick={() => { if (makePlainTableHeader(editorRef.current)) scheduleSave(); setTableContextMenu(null); }}><Heading1 size={15}/></button>}
      <button className="danger" title="Delete row" aria-label="Delete row" onClick={() => { if (deletePlainTableRow(editorRef.current)) scheduleSave(); setTableContextMenu(null); }}><Trash2 size={15}/></button>
      <button className="danger" title="Delete column" aria-label="Delete column" onClick={() => { if (deletePlainTableColumn(editorRef.current)) scheduleSave(); setTableContextMenu(null); }}><Trash2 size={15}/></button>
    </div>}

    {checklistModalOpen && <div className="plain-code-modal-backdrop" onMouseDown={() => setChecklistModalOpen(false)}>
      <div className="plain-code-modal plain-checklist-modal" role="dialog" aria-modal="true" aria-label="Insert checklist" onMouseDown={e => e.stopPropagation()}>
        <div className="plain-code-modal-head">
          <div>
            <strong>Insert checklist</strong>
            <span>Create a progress checklist table.</span>
          </div>
          <button type="button" className="plain-code-modal-close" onClick={() => setChecklistModalOpen(false)}>×</button>
        </div>
        <label className="plain-checklist-label">Title<input value={checklistTitle} onChange={e => setChecklistTitle(e.currentTarget.value)} /></label>
        <label className="plain-checklist-label">Items<textarea value={checklistItems} onChange={e => setChecklistItems(e.currentTarget.value)} placeholder="One checklist item per line" /></label>
        <div className="plain-code-modal-actions">
          <button type="button" className="ghost" onClick={() => setChecklistModalOpen(false)}>Cancel</button>
          <button type="button" className="primary" onClick={confirmChecklistModal}>Insert checklist</button>
        </div>
      </div>
    </div>}
    {codeModalOpen && <div className="plain-code-modal-backdrop" onMouseDown={() => setCodeModalOpen(false)}>
      <div className="plain-code-modal" role="dialog" aria-modal="true" aria-label="Insert code block" onMouseDown={e => e.stopPropagation()}>
        <div className="plain-code-modal-head">
          <div>
            <strong>Insert code block</strong>
            <span>Paste full code below.</span>
          </div>
          <button type="button" className="plain-code-modal-close" onClick={() => setCodeModalOpen(false)}>×</button>
        </div>
        <div className="plain-code-modal-tools">
          <label>Language</label>
          <select value={codeLanguage} onChange={e => setCodeLanguage(e.currentTarget.value)}>
            <option value="auto">Auto detect</option>
            <option value="text">Plain text</option>
            <option value="javascript">JavaScript / TypeScript</option>
            <option value="python">Python</option>
            <option value="html">HTML / XML</option>
            <option value="sql">SQL</option>
          </select>
        </div>
        <textarea className="plain-code-modal-textarea" value={codeDraft} onChange={e => setCodeDraft(e.currentTarget.value)} placeholder="Paste code here..." autoFocus />
        <div className="plain-code-modal-actions">
          <button type="button" className="ghost" onClick={() => setCodeModalOpen(false)}>Cancel</button>
          <button type="button" className="primary" onClick={confirmCodeModal}>Insert code</button>
        </div>
      </div>
    </div>}
    {loaded && editorRef.current && isEmptyHtml(editorRef.current.innerHTML) && <div className="plain-editor-hint">Use the toolbar above for headings, lists, color, tables, media, and links.</div>}
  </div>;
}
