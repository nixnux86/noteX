import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type DragEvent as ReactDragEvent, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { TextareaHTMLAttributes } from 'react';
import { AudioLines, Bookmark, Bold, Check, CheckSquare, ChevronRight, Code2, File, GripVertical, Heading1, Heading2, Heading3, Heading4, Image, Italic, Link, List, ListOrdered, Minus, MoreHorizontal, Palette, Plus, Quote, Strikethrough, Table2, TerminalSquare, ToggleLeft, Type, Underline, Video, Trash2, Copy, ArrowLeft, ArrowRight, Paintbrush, XCircle, X } from 'lucide-react';
import { db, Block, BlockType, uid, now } from '../db/schema';

type SlashGroup = 'Suggested' | 'Basic blocks' | 'Media' | 'Custom blocks';
type CustomBlockTemplate = { id: string; name: string; blocks: Partial<Block>[]; createdAt: number; updatedAt: number };
type SlashItem = { type: BlockType; label: string; desc: string; group: SlashGroup; shortcut?: string; Icon: any; customTemplate?: CustomBlockTemplate };

const slashItems: SlashItem[] = [
  { group: 'Suggested', type: 'paragraph', label: 'Page', desc: 'Start a clean page', Icon: Type },
  { group: 'Suggested', type: 'paragraph', label: 'Text', desc: 'Start writing with plain text', Icon: Type },
  { group: 'Suggested', type: 'code', label: 'Code', desc: 'Capture a code snippet', shortcut: '</>', Icon: Code2 },
  { group: 'Suggested', type: 'command', label: 'Command', desc: 'Runbook-style one-line command', shortcut: '$', Icon: TerminalSquare },
  { group: 'Suggested', type: 'paragraph', label: 'HPE Technical Case Summary', desc: 'Pre-formatted HPE case page', shortcut: '/hpe', Icon: File },
  { group: 'Basic blocks', type: 'paragraph', label: 'Text', desc: 'Just start writing', Icon: Type },
  { group: 'Basic blocks', type: 'h1', label: 'Heading 1', desc: 'Large section heading', shortcut: '#', Icon: Heading1 },
  { group: 'Basic blocks', type: 'h2', label: 'Heading 2', desc: 'Medium section heading', shortcut: '##', Icon: Heading2 },
  { group: 'Basic blocks', type: 'h3', label: 'Heading 3', desc: 'Small section heading', shortcut: '###', Icon: Heading3 },
  { group: 'Basic blocks', type: 'h4', label: 'Heading 4', desc: 'Tiny section heading', shortcut: '####', Icon: Heading4 },
  { group: 'Basic blocks', type: 'bullet', label: 'Bullet list', desc: 'Create a simple list', shortcut: '•', Icon: List },
  { group: 'Basic blocks', type: 'numbered', label: 'Numbered list', desc: 'Create an ordered list', shortcut: '1.', Icon: ListOrdered },
  { group: 'Basic blocks', type: 'toggle', label: 'Toggle list', desc: 'Hide and show content', shortcut: '▸', Icon: ToggleLeft },
  { group: 'Basic blocks', type: 'todo', label: 'To-do', desc: 'Track a task', shortcut: '[]', Icon: CheckSquare },
  { group: 'Basic blocks', type: 'table', label: 'Table', desc: 'Add a simple table', Icon: Table2 },
  { group: 'Basic blocks', type: 'math', label: 'Equation', desc: 'Write LaTeX-style math', shortcut: '∑', Icon: Type },
  { group: 'Basic blocks', type: 'quote', label: 'Quote', desc: 'Highlight a quote', shortcut: '“”', Icon: Quote },
  { group: 'Basic blocks', type: 'command', label: 'Command', desc: 'One-line command format', shortcut: '$', Icon: TerminalSquare },
  { group: 'Basic blocks', type: 'divider', label: 'Divider', desc: 'Separate content', shortcut: '---', Icon: Minus },
  { group: 'Media', type: 'image', label: 'Image', desc: 'Upload an image with caption', Icon: Image },
  { group: 'Media', type: 'video', label: 'Video', desc: 'Embed a video placeholder', Icon: Video },
  { group: 'Media', type: 'audio', label: 'Audio', desc: 'Embed an audio placeholder', Icon: AudioLines },
  { group: 'Media', type: 'code', label: 'Code', desc: 'Capture a code snippet', shortcut: '</>', Icon: Code2 },
  { group: 'Media', type: 'file', label: 'File', desc: 'Attach a file placeholder', Icon: File },
  { group: 'Media', type: 'bookmark', label: 'Web bookmark', desc: 'Save a link preview placeholder', Icon: Bookmark }
];


const codeLanguages = [
  'Plain text', 'Bash', 'Shell', 'Zsh', 'Fish', 'PowerShell', 'Batch',
  'JavaScript', 'TypeScript', 'JSX', 'TSX', 'HTML', 'CSS', 'SCSS', 'Sass', 'Less',
  'JSON', 'JSONC', 'YAML', 'YML', 'Markdown', 'MDX', 'XML', 'SVG',
  'Python', 'Java', 'C', 'C++', 'C#', 'Objective-C', 'Go', 'Rust', 'PHP', 'Perl', 'Ruby', 'Swift', 'Kotlin', 'Dart', 'R', 'Lua', 'Scala', 'Haskell', 'Elixir', 'Erlang',
  'SQL', 'GraphQL', 'Dockerfile', 'Nginx', 'Apache', 'Terraform', 'HCL', 'Ansible', 'INI', 'TOML', 'Properties',
  'Diff', 'Log', 'Regular Expression', 'Makefile', 'CMake', 'Gradle', 'Groovy'
];

function codeLanguageClass(language?: string) {
  return `code-language-${(language || 'plain-text').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function filteredCodeLanguages(query: string) {
  const q = query.trim().toLowerCase();
  return codeLanguages.filter(lang => !q || lang.toLowerCase().includes(q));
}

function getSlashMatches(query: string, customTemplates: CustomBlockTemplate[] = []) {
  const q = query.replace(/^\//, '').trim().toLowerCase();
  const customItems: SlashItem[] = customTemplates.map(template => ({
    group: 'Custom blocks',
    type: (template.blocks?.[0]?.type as BlockType) || 'paragraph',
    label: template.name,
    desc: `${Math.max(1, template.blocks?.length || 1)} saved block${(template.blocks?.length || 1) > 1 ? 's' : ''}`,
    Icon: Bookmark,
    customTemplate: template
  }));
  return [...slashItems, ...customItems].filter(item => !q || item.label.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q) || item.type.toLowerCase().includes(q) || (q === 'cmd' && item.type === 'command')); 
}

const SlashMenu = memo(function SlashMenu({ query, selectedIndex, onPick, style, customTemplates = [] }: { query: string; selectedIndex: number; onPick: (item: SlashItem) => void; style?: CSSProperties; customTemplates?: CustomBlockTemplate[] }) {
  const visibleItems = useMemo(() => getSlashMatches(query, customTemplates), [query, customTemplates]);
  const groups: SlashGroup[] = ['Suggested', 'Basic blocks', 'Media', ...(customTemplates.length ? ['Custom blocks' as SlashGroup] : [])];
  const selectedItem = visibleItems[Math.max(0, Math.min(selectedIndex, visibleItems.length - 1))];
  const selectedKey = selectedItem ? `${selectedItem.group}-${selectedItem.type}-${selectedItem.label}` : '';
  return <div className="slash-menu compact-command-menu" style={style}>
    {groups.map((group, index) => {
      const groupItems = visibleItems.filter(item => item.group === group);
      if (!groupItems.length) return null;
      return <div className="slash-section" key={group}>
        {index > 0 && <div className="slash-separator" />}
        <div className="slash-heading">{group}</div>
        {groupItems.map(item => {
          const Icon = item.Icon;
          const key = `${group}-${item.type}-${item.label}`;
          return <button className={`slash-item slash-${item.type} ${key === selectedKey ? 'slash-selected' : ''}`} key={key} onMouseDown={(e) => { e.preventDefault(); onPick(item); }}>
            <span className="slash-icon"><Icon size={15} /></span>
            <span className="slash-copy"><span className="slash-label">{item.label}</span><span className="slash-desc">{item.desc}</span></span>
            {item.shortcut && <span className="slash-shortcut">{item.shortcut}</span>}
          </button>;
        })}
      </div>;
    })}
    {!visibleItems.length && <div className="slash-empty">No command found</div>}
    <div className="slash-footer sticky-footer"><span>Close menu</span><kbd>esc</kbd></div>
  </div>;
});

function AutoResizeTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(30, el.scrollHeight)}px`;
  }, [props.value, props.placeholder]);
  return <textarea {...props} ref={ref} rows={props.rows ?? 1} onInput={(e) => {
    const el = e.currentTarget;
    el.style.height = 'auto';
    el.style.height = `${Math.max(30, el.scrollHeight)}px`;
    props.onInput?.(e);
  }} />;
}



function CommandTextarea({ value, blockId, onCommit, onEnter, onBackspaceEmpty, onEscape, onSlashShortcut, onSlashQuery }: {
  value: string;
  blockId: string;
  onCommit: (value: string) => void;
  onEnter: () => void;
  onBackspaceEmpty: () => void;
  onEscape: () => void;
  onSlashShortcut: (value: string) => boolean;
  onSlashQuery: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [localValue, setLocalValue] = useState(value || '');
  useEffect(() => { if (document.activeElement !== ref.current) setLocalValue(value || ''); }, [value, blockId]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(30, el.scrollHeight)}px`;
  }, [localValue]);
  useEffect(() => {
    const t = window.setTimeout(() => onCommit(localValue), 220);
    return () => window.clearTimeout(t);
  }, [localValue, onCommit]);
  return <textarea
    ref={ref}
    value={localValue}
    data-block-id={blockId}
    placeholder="Type command..."
    rows={1}
    onKeyDown={e => {
      if (e.key === 'Escape') { onEscape(); return; }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !localValue) { e.preventDefault(); onBackspaceEmpty(); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onCommit(localValue); onEnter(); }
    }}
    onChange={e => {
      const v = e.target.value;
      if (onSlashShortcut(v)) {
        setLocalValue('');
        onSlashQuery('');
        return;
      }
      setLocalValue(v);
      onSlashQuery(v);
    }}
    onInput={(e) => {
      const el = e.currentTarget;
      el.style.height = 'auto';
      el.style.height = `${Math.max(30, el.scrollHeight)}px`;
    }}
  />;
}

function escapeCodeHtml(text: string) {
  return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
}


function linkifyPlainUrlsInHtml(html: string) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const urlRe = /((https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?\)\]\}])/gi;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  textNodes.forEach(node => {
    const parent = node.parentElement;
    if (!parent || parent.closest('a, code, pre')) return;
    const text = node.nodeValue || '';
    if (!urlRe.test(text)) return;
    urlRe.lastIndex = 0;
    const frag = doc.createDocumentFragment();
    let last = 0;
    text.replace(urlRe, (match, _full, _proto, offset) => {
      frag.appendChild(doc.createTextNode(text.slice(last, offset)));
      const a = doc.createElement('a');
      const href = match.startsWith('http') ? match : `https://${match}`;
      a.setAttribute('href', href);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noreferrer');
      a.textContent = match;
      frag.appendChild(a);
      last = offset + match.length;
      return match;
    });
    frag.appendChild(doc.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  });
  return doc.body.innerHTML;
}


function sanitizeExternalHtml(input: string, options: { inlineOnly?: boolean } = {}) {
  const doc = new DOMParser().parseFromString(input || '', 'text/html');
  doc.querySelectorAll('script, style, meta, link, iframe, object, embed').forEach(el => el.remove());
  const allowedTags = new Set(['A','B','STRONG','I','EM','U','S','STRIKE','CODE','PRE','BR','P','DIV','SPAN','UL','OL','LI','H1','H2','H3','H4','BLOCKQUOTE','TABLE','THEAD','TBODY','TR','TH','TD','IMG']);
  doc.querySelectorAll('*').forEach(el => {
    if (!allowedTags.has(el.tagName)) {
      const span = doc.createElement('span');
      span.innerHTML = el.innerHTML;
      el.replaceWith(span);
      return;
    }
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value || '';
      const keep = (el.tagName === 'A' && name === 'href') ||
        (el.tagName === 'IMG' && name === 'src') ||
        (['TD','TH'].includes(el.tagName) && ['colspan','rowspan'].includes(name));
      if (!keep || name.startsWith('on') || value.toLowerCase().startsWith('javascript:')) el.removeAttribute(attr.name);
    });
    if (el.tagName === 'A') {
      (el as HTMLAnchorElement).target = '_blank';
      (el as HTMLAnchorElement).rel = 'noreferrer';
    }
  });
  if (options.inlineOnly) {
    doc.querySelectorAll('p, div, h1, h2, h3, h4, blockquote, li').forEach(el => {
      const span = doc.createElement('span');
      span.innerHTML = el.innerHTML;
      el.replaceWith(span);
    });
  }
  return doc.body.innerHTML;
}

function htmlHasBlockStructure(html: string) {
  return /<(table|ul|ol|li|pre|blockquote|h[1-4]|section|article)\b/i.test(html || '') || /<p\b[\s\S]*<\/p>\s*<p\b/i.test(html || '');
}

function escapePlainTextHtml(value: string) {
  return (value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

function plainTextHasStructuredBlocks(text: string) {
  const lines = (text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2 && !/^#{1,4}\s+/.test(lines[0] || '')) return false;
  return lines.some(line => /^(#{1,4}\s+|[-*•]\s+|\d+[.)]\s+|>[\s]+|```)/.test(line));
}

function detectListLevelFromIndent(raw: string) {
  const indent = (raw.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
  return Math.max(0, Math.min(3, Math.floor(indent / 2)));
}

function normalizeAiPlainTextToBlocks(text: string): { type: BlockType; text: string; listLevel?: number; listStyle?: string }[] {
  const result: { type: BlockType; text: string; listLevel?: number; listStyle?: string }[] = [];
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  let codeBuffer: string[] = [];
  let inCode = false;
  const flushCode = () => {
    if (codeBuffer.length) result.push({ type: 'code', text: codeBuffer.join('\n').trimEnd() });
    codeBuffer = [];
  };
  const flushParagraph = (buffer: string[], level = 0) => {
    const value = buffer.join(' ').replace(/\s+/g, ' ').trim();
    if (value) result.push({ type: 'paragraph', text: linkifyPlainUrlsInHtml(escapePlainTextHtml(value)), listLevel: level });
    buffer.length = 0;
  };
  let paragraph: string[] = [];
  let paragraphLevel = 0;
  for (const raw of lines) {
    const line = raw.trim();
    const level = detectListLevelFromIndent(raw);
    if (/^```/.test(line)) {
      if (inCode) { flushCode(); inCode = false; }
      else { flushParagraph(paragraph, paragraphLevel); inCode = true; }
      continue;
    }
    if (inCode) { codeBuffer.push(raw); continue; }
    if (!line) { flushParagraph(paragraph, paragraphLevel); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    const numbered = line.match(/^(\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)[.)]\s+(.+)$/);
    const quote = line.match(/^>\s+(.+)$/);
    if (heading) { flushParagraph(paragraph, paragraphLevel); result.push({ type: (`h${Math.min(4, heading[1].length)}` as BlockType), text: linkifyPlainUrlsInHtml(escapePlainTextHtml(heading[2].trim())) }); continue; }
    if (bullet) { flushParagraph(paragraph, paragraphLevel); result.push({ type: 'bullet', text: linkifyPlainUrlsInHtml(escapePlainTextHtml(bullet[1].trim())), listLevel: level }); paragraphLevel = level; continue; }
    if (numbered) { flushParagraph(paragraph, paragraphLevel); const marker = numbered[1]; const listStyle = /^[a-z]$/i.test(marker) ? 'alpha' : /^[ivxlcdm]+$/i.test(marker) ? 'roman' : 'decimal'; result.push({ type: 'numbered', text: linkifyPlainUrlsInHtml(escapePlainTextHtml(numbered[2].trim())), listLevel: level, listStyle }); paragraphLevel = level; continue; }
    if (quote) { flushParagraph(paragraph, paragraphLevel); result.push({ type: 'quote', text: linkifyPlainUrlsInHtml(escapePlainTextHtml(quote[1].trim())) }); continue; }
    if (!paragraph.length) paragraphLevel = level;
    paragraph.push(line);
  }
  flushParagraph(paragraph, paragraphLevel);
  if (inCode) flushCode();
  return result;
}

function dataUrlToBlobUrl(dataUrl: string) {
  return dataUrl;
}

function shikiLanguageId(language?: string) {
  const key = (language || 'Plain text').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim();
  const map: Record<string, string> = {
    'plain text': 'text', 'bash': 'bash', 'shell': 'bash', 'zsh': 'bash', 'fish': 'fish', 'powershell': 'powershell', 'batch': 'bat',
    'javascript': 'javascript', 'typescript': 'typescript', 'jsx': 'jsx', 'tsx': 'tsx', 'html': 'html', 'css': 'css', 'scss': 'scss', 'sass': 'sass', 'less': 'less',
    'json': 'json', 'jsonc': 'jsonc', 'yaml': 'yaml', 'yml': 'yaml', 'markdown': 'markdown', 'mdx': 'mdx', 'xml': 'xml', 'svg': 'xml',
    'python': 'python', 'java': 'java', 'c': 'c', 'c++': 'cpp', 'cpp': 'cpp', 'c#': 'csharp', 'objective c': 'objective-c', 'go': 'go', 'rust': 'rust',
    'php': 'php', 'perl': 'perl', 'ruby': 'ruby', 'swift': 'swift', 'kotlin': 'kotlin', 'dart': 'dart', 'r': 'r', 'lua': 'lua', 'scala': 'scala',
    'haskell': 'haskell', 'elixir': 'elixir', 'erlang': 'erlang', 'sql': 'sql', 'graphql': 'graphql', 'dockerfile': 'dockerfile', 'nginx': 'nginx',
    'terraform': 'terraform', 'hcl': 'hcl', 'ini': 'ini', 'toml': 'toml', 'diff': 'diff', 'makefile': 'makefile', 'cmake': 'cmake', 'groovy': 'groovy'
  };
  return map[key] || key.split(' ')[0] || 'text';
}

function extractShikiCode(html: string) {
  const match = html.match(/<code[^>]*>([\s\S]*?)<\/code>/i);
  return match ? match[1] : html;
}


function normalizeHighlightedCodeRows(html: string) {
  const source = (html || '').replace(/\r\n?/g, '\n');
  const rows = source.split('\n');
  return rows.map((row) => `<div class="notex-code-row">${row || '<br>'}</div>`).join('');
}

function CodeEditable({ value, className, placeholder, highlightHtml, language, onChange, onKeyDown, onHoverLine }: {
  value: string;
  className?: string;
  placeholder?: string;
  highlightHtml: string;
  language?: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: any) => void;
  onHoverLine?: (line: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Priority-3: avoid the old highlightHtml -> setState -> render cycle for every
  // code edit. The rendered HTML is derived directly from props, so typing in large
  // code blocks produces one React pass instead of two.
  // noteX v1.7.002: render the sanitized language-aware highlight HTML again.
  // The highlighter now avoids coloring inside its own token markup, so syntax
  // colors work without leaking class="tok-*" text into the editor.
  const renderedHtml = useMemo(() => normalizeHighlightedCodeRows(highlightHtml || escapeCodeHtml(value || '')), [highlightHtml, value, language]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.innerHTML !== (renderedHtml || '')) el.innerHTML = renderedHtml || '';
  }, [renderedHtml]);
  return <div
    ref={ref}
    className={className}
    contentEditable
    suppressContentEditableWarning
    spellCheck={false}
    data-placeholder={placeholder || ''}
    onKeyDown={onKeyDown}
    onMouseMove={(e) => {
      if (!onHoverLine) return;
      const targetRow = (e.target as HTMLElement | null)?.closest?.('.notex-code-row') as HTMLElement | null;
      const root = ref.current;
      if (targetRow && root?.contains(targetRow)) {
        const rows = Array.from(root.querySelectorAll('.notex-code-row'));
        const idx = rows.indexOf(targetRow);
        onHoverLine(idx >= 0 ? idx + 1 : null);
        return;
      }
      const lineHeight = parseFloat(getComputedStyle(e.currentTarget).lineHeight || '0') || 21;
      const top = e.currentTarget.getBoundingClientRect().top;
      const line = Math.max(1, Math.floor((e.clientY - top + e.currentTarget.scrollTop) / lineHeight) + 1);
      onHoverLine(Math.min(line, Math.max(1, (value || '').split('\n').length)));
    }}
    onMouseLeave={() => onHoverLine?.(null)}
    onPaste={(e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    }}
    onInput={(e) => {
      const text = (e.currentTarget.innerText || '').replace(/\n$/, '');
      onChange(text);
    }}
    onBlur={(e) => {
      const el = e.currentTarget;
      el.innerHTML = renderedHtml || '';
    }}
  />;
}

function RichEditable({ blockId, html, placeholder, className, onHTMLChange, onSlash, onSlashShortcut, onEnter, onBackspaceEmpty, onBackspaceAtStart, onIndentList, onOutdentList, onOpenFormat, onRichPaste, onImagePaste, onFocusBlock, onBlurBlock }: {
  blockId: string;
  html: string;
  placeholder?: string;
  className?: string;
  onHTMLChange: (html: string, plain: string) => void;
  onSlash: (query: string) => void;
  onSlashShortcut?: (value: string) => boolean;
  onEnter: () => void;
  onBackspaceEmpty: () => void;
  onBackspaceAtStart?: () => void;
  onIndentList?: () => void;
  onOutdentList?: () => void;
  onOpenFormat: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onRichPaste: (html: string, plain: string) => void;
  onImagePaste?: (src: string) => void;
  onFocusBlock?: () => void;
  onBlurBlock?: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== (html || '')) el.innerHTML = html || '';
  }, [html]);
  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const plain = el.textContent || '';
    const trimmed = plain.trim();
    if ((trimmed === '/*' || trimmed === '/1' || trimmed === '/#') && onSlashShortcut?.(trimmed)) {
      el.innerHTML = '';
      onSlash('');
      return;
    }
    onHTMLChange(el.innerHTML, plain);
    if (trimmed.startsWith('/')) onSlash(trimmed);

  };
  const autoLinkOnBlur = () => {
    const el = ref.current;
    if (!el) { onBlurBlock?.(); return; }
    const linked = linkifyPlainUrlsInHtml(el.innerHTML);
    if (linked !== el.innerHTML) {
      el.innerHTML = linked;
      onHTMLChange(linked, el.textContent || '');
    }
    onBlurBlock?.();
  };
  const caretIsAtDocumentStart = () => {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || !sel.isCollapsed || !sel.anchorNode || !el.contains(sel.anchorNode)) return false;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.setEnd(sel.anchorNode, sel.anchorOffset);
    return range.toString().length === 0;
  };
  const openClickedLink = (e: ReactMouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement | null)?.closest('a') as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (!href) return;
    e.preventDefault();
    e.stopPropagation();
    if (href.startsWith('#page-') || href.startsWith('#page=')) {
      const pageId = href.replace(/^#page[-=]/, '');
      const pageUrl = `${window.location.origin}${window.location.pathname}${window.location.search}#page-${encodeURIComponent(pageId)}`;
      window.open(pageUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (href.startsWith('#')) {
      window.open(`${window.location.origin}${window.location.pathname}${window.location.search}${href}`, '_blank', 'noopener,noreferrer');
      return;
    }
    window.open(anchor.href, '_blank', 'noopener,noreferrer');
  };
  return <div
    ref={ref}
    className={`rich-editable ${className || ''}`}
    contentEditable
    suppressContentEditableWarning
    data-rich-block-id={blockId}
    data-placeholder={placeholder || ''}
    onClick={(e) => { onFocusBlock?.(); openClickedLink(e); }}
    onFocus={() => onFocusBlock?.()}
    onMouseDown={() => onFocusBlock?.()}
    onInput={emit}
    onBlur={autoLinkOnBlur}
    onDoubleClick={(e) => { /* native double-click text selection only */ }}
    onContextMenu={(e) => { e.preventDefault(); onOpenFormat(e); }}
    onPaste={(e) => {
      const imageItem = Array.from(e.clipboardData.items || []).find(item => item.type.startsWith('image/'));
      const imageFile = imageItem?.getAsFile() || Array.from(e.clipboardData.files || []).find(f => f.type.startsWith('image/'));
      if (imageFile && onImagePaste) {
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = () => onImagePaste(String(reader.result || ''));
        reader.readAsDataURL(imageFile);
        return;
      }
      const htmlData = e.clipboardData.getData('text/html');
      const textData = e.clipboardData.getData('text/plain');
      if (textData.trim().startsWith('data:image/') && onImagePaste) {
        e.preventDefault();
        onImagePaste(textData.trim());
        return;
      }
      if (htmlData && onImagePaste) {
        const doc = new DOMParser().parseFromString(htmlData, 'text/html');
        const img = doc.querySelector('img[src]') as HTMLImageElement | null;
        if (img?.src && (img.src.startsWith('data:image/') || !doc.body.textContent?.trim())) {
          e.preventDefault();
          onImagePaste(img.src);
          return;
        }
      }
      if (htmlData) {
        e.preventDefault();
        if (htmlHasBlockStructure(htmlData) || plainTextHasStructuredBlocks(textData)) {
          onRichPaste(sanitizeExternalHtml(htmlData), textData);
        } else {
          document.execCommand('insertHTML', false, sanitizeExternalHtml(htmlData, { inlineOnly: true }));
          setTimeout(emit, 0);
        }
        return;
      }
      if (plainTextHasStructuredBlocks(textData)) {
        e.preventDefault();
        onRichPaste('', textData);
        return;
      }
      setTimeout(emit, 0);
    }}
    onKeyDown={(e) => {
      if (e.key === 'Escape') { onSlash(''); return; }
      if (e.key === 'Tab') { e.preventDefault(); if (e.shiftKey) onOutdentList?.(); else onIndentList?.(); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnter(); return; }
      if (e.key === 'Backspace') {
        const text = ref.current?.textContent || '';
        const atStart = caretIsAtDocumentStart();
        if (text === '') { e.preventDefault(); onBackspaceEmpty(); return; }
        if (atStart && onBackspaceAtStart) { e.preventDefault(); onBackspaceAtStart(); return; }
      }
    }}
  />;
}

function TableCellEditable({ html, onHTMLChange, onFocusCell, onOpenMenu }: {
  html: string;
  onHTMLChange: (html: string, plain: string) => void;
  onFocusCell: () => void;
  onOpenMenu: (e: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== (html || '')) el.innerHTML = html || '';
  }, [html]);
  const emit = () => {
    const el = ref.current;
    if (!el) return;
    onHTMLChange(el.innerHTML, el.textContent || '');
  };
  return <div
    ref={ref}
    className="table-cell-editable"
    contentEditable
    suppressContentEditableWarning
    onFocus={() => { if (!window.getSelection()?.toString()) onFocusCell(); }}
    onInput={emit}
    onBlur={emit}
    onContextMenu={(e) => { e.preventDefault(); onOpenMenu(e); }}
    onMouseDown={(e) => { /* allow native text selection inside cell */ }}
    onPaste={(e) => {
      const htmlData = e.clipboardData.getData('text/html');
      const textData = e.clipboardData.getData('text/plain');
      e.preventDefault();
      const safeHtml = htmlData ? sanitizeExternalHtml(htmlData, { inlineOnly: true }) : escapePlainTextHtml(textData).replace(/\n/g, '<br>');
      document.execCommand('insertHTML', false, safeHtml);
      setTimeout(emit, 0);
    }}
    onKeyDown={(e) => {
      if ((e.ctrlKey || e.metaKey) && ['b','i','u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        const key = e.key.toLowerCase();
        document.execCommand(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline', false);
        setTimeout(emit, 0);
      }
    }}
  />;
}

export function BlockEditor({ pageId, onChanged, onCreatePage, onPageLoaded }: { pageId: string; onChanged?: () => void; onCreatePage?: () => void; onPageLoaded?: (ms: number) => void }) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [slashQuery, setSlashQuery] = useState('/');
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashPos, setSlashPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [formatFor, setFormatFor] = useState<string | null>(null);
  const [formatPos, setFormatPos] = useState<{ left: number; top: number } | null>(null);
  const [turnMenuFor, setTurnMenuFor] = useState<string | null>(null);
  const [colorMenuFor, setColorMenuFor] = useState<string | null>(null);
  const [formatMoreFor, setFormatMoreFor] = useState<string | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [activeTextBlockId, setActiveTextBlockId] = useState<string | null>(null);
  const [focusedTextBlockId, setFocusedTextBlockId] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [imageEditorHidden, setImageEditorHidden] = useState<Record<string, boolean>>({});
  const [tableMenu, setTableMenu] = useState<{ blockId: string; row: number; col: number; left: number; top: number } | null>(null);
  const [selectedCells, setSelectedCells] = useState<{ blockId: string; startRow: number; startCol: number; endRow: number; endCol: number } | null>(null);
  const [selectedBlockMenu, setSelectedBlockMenu] = useState<{ left: number; top: number } | null>(null);
  const [linkModalFor, setLinkModalFor] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [pageLinkSearch, setPageLinkSearch] = useState('');
  const [pagesForLink, setPagesForLink] = useState<{ id: string; title: string }[]>([]);
  const savedLinkRange = useRef<Range | null>(null);
  const [codeMoreFor, setCodeMoreFor] = useState<string | null>(null);
  const [codeLangFor, setCodeLangFor] = useState<string | null>(null);
  const [codeLangSearch, setCodeLangSearch] = useState('');
  const [codeLangActiveIndex, setCodeLangActiveIndex] = useState(0);
  const [codeTurnFor, setCodeTurnFor] = useState<string | null>(null);
  const [codeCopyToast, setCodeCopyToast] = useState<{ blockId: string; message: string } | null>(null);
  const [codeHoverLine, setCodeHoverLine] = useState<{ blockId: string; line: number } | null>(null);
  const [isBlockSelecting, setIsBlockSelecting] = useState(false);
  const [blockSelectionStart, setBlockSelectionStart] = useState<string | null>(null);
  const blockDragRef = useRef<{ active: boolean; startY: number; startX: number; moved: boolean; startedInsideEditor: boolean }>({ active: false, startY: 0, startX: 0, moved: false, startedInsideEditor: false });
  const pointerSelectRef = useRef<{ active: boolean; startX: number; startY: number; startBlockId: string | null; fromEditable: boolean }>({ active: false, startX: 0, startY: 0, startBlockId: null, fromEditable: false });
  const selectedBlockIdsRef = useRef<string[]>([]);
  useEffect(() => { selectedBlockIdsRef.current = selectedBlockIds; }, [selectedBlockIds]);
  const [customTemplates, setCustomTemplates] = useState<CustomBlockTemplate[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmText?: string; onConfirm: () => void | Promise<void> } | null>(null);

  function isEditableTarget(target: HTMLElement | null) {
    return !!target?.closest('[contenteditable="true"], textarea, input, select, .rich-editable, .table-cell-editable, .code-textarea-editor');
  }

  function hasNativeSelectionInsideEditable(target: HTMLElement | null) {
    const editable = target?.closest('[contenteditable="true"], textarea, input, .rich-editable, .table-cell-editable, .code-textarea-editor') as HTMLElement | null;
    const sel = window.getSelection();
    return !!editable && !!sel && !sel.isCollapsed && !!sel.anchorNode && !!sel.focusNode && editable.contains(sel.anchorNode) && editable.contains(sel.focusNode);
  }

  async function runConfirmDialog() {
    const dialog = confirmDialog;
    if (!dialog) return;
    setConfirmDialog(null);
    await dialog.onConfirm();
  }

  // Priority-3 performance: avoid recalculating static language lists on every
  // code block render/key event. The visible list only changes when the search
  // field changes, so memoizing it keeps large pages a little calmer.
  const visibleCodeLanguages = useMemo(() => filteredCodeLanguages(codeLangSearch), [codeLangSearch]);
  const slashMatches = useMemo(() => getSlashMatches(slashQuery, customTemplates), [slashQuery, customTemplates]);
  const blockIndexById = useMemo(() => new Map(blocks.map((block, index) => [block.id, index])), [blocks]);
  const selectedBlockIdSet = useMemo(() => new Set(selectedBlockIds), [selectedBlockIds]);
  const focusedBlock = useMemo(() => blocks.find(block => block.id === focusedTextBlockId) || null, [blocks, focusedTextBlockId]);
  const focusedBlockIsEmpty = !!focusedBlock && !((focusedBlock.text || '').replace(/<br\s*\/?>(\s*)/gi, '').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim());

  const blockNumberById = useMemo(() => {
    const counters: number[] = [0, 0, 0, 0];
    const map = new Map<string, number>();
    for (const block of blocks) {
      const type = block.type;
      const level = Math.max(0, Math.min(3, (block as any).listLevel || 0));
      if (type !== 'numbered') {
        if (!['paragraph','quote'].includes(type)) counters.fill(0);
        continue;
      }
      counters[level] = block.numberedStart || (counters[level] || 0) + 1;
      for (let i = level + 1; i < counters.length; i++) counters[i] = 0;
      map.set(block.id, counters[level]);
    }
    return map;
  }, [blocks]);

  function listLevelFor(block: Block) {
    return Math.max(0, Math.min(3, (block as any).listLevel || 0));
  }

  function listContinuationLevelFor(index: number) {
    const block = blocks[index];
    if (!block || block.type !== 'paragraph') return null;

    // A paragraph that is pasted after a list item should visually belong to
    // that list item until a clear section boundary appears. This keeps
    // AI/news/article paste results aligned under the list text instead of
    // jumping back to the page margin.
    for (let i = index - 1; i >= 0; i--) {
      const previous = blocks[i];
      if (!previous) break;
      if (previous.type === 'bullet' || previous.type === 'numbered') {
        return listLevelFor(previous);
      }
      if (previous.type === 'paragraph') continue;
      if (['h1', 'h2', 'h3', 'h4', 'divider', 'table', 'image', 'video', 'audio', 'file', 'bookmark', 'code', 'command', 'math'].includes(previous.type)) {
        break;
      }
    }
    return null;
  }

  function blockWrapClass(block: Block, index: number) {
    const continuationLevel = listContinuationLevelFor(index);
    const level = continuationLevel ?? listLevelFor(block);
    return [
      'block-wrap',
      `block-wrap-${block.type}`,
      `list-level-${level}`,
      continuationLevel !== null ? 'list-continuation-paragraph' : '',
      continuationLevel !== null ? `list-continuation-level-${continuationLevel}` : '',
      selectedBlockIds.includes(block.id) ? 'selected-block-line' : '',
      dragId && dragOverId === block.id && dragId !== block.id ? 'drop-before' : '',
      !dragId && dragOverId === block.id ? 'file-drop-over' : ''
    ].filter(Boolean).join(' ');
  }

  function numberMarkerFor(block: Block, index: number) {
    const value = blockNumberById.get(block.id) || index + 1;
    const style = (block as any).listStyle || (listLevelFor(block) === 1 ? 'alpha' : listLevelFor(block) === 2 ? 'roman' : 'decimal');
    if (style === 'alpha') return String.fromCharCode(96 + ((value - 1) % 26) + 1);
    if (style === 'roman') return toRoman(value).toLowerCase();
    return String(value);
  }

  function toRoman(num: number) {
    const table: [number, string][] = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
    let n = Math.max(1, Math.min(3999, num));
    let out = '';
    for (const [v, sym] of table) while (n >= v) { out += sym; n -= v; }
    return out;
  }


  async function loadCustomTemplates() {
    const setting = await db.settings.get('customBlockTemplates');
    setCustomTemplates(Array.isArray(setting?.value) ? setting.value : []);
  }
  useEffect(() => { void loadCustomTemplates(); }, []);

  async function load() {
    const started = performance.now();
    const loadedBlocks = await db.blocks.where('pageId').equals(pageId).sortBy('sort');
    setBlocks(loadedBlocks);
    onPageLoaded?.(Math.max(0, Math.round(performance.now() - started)));
  }
  useEffect(() => { load(); }, [pageId]);

  useEffect(() => {
    if (!formatFor && !turnMenuFor) return;
    const closeFloatingTools = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.format-toolbar') || target?.closest('.turn-to-menu') || target?.closest('.text-color-popover') || target?.closest('.format-more-popover') || target?.closest('.selected-block-menu') || target?.closest('.link-insert-modal') || target?.closest('.code-hover-toolbar') || target?.closest('.code-more-popover') || target?.closest('.code-language-popover')) return;
      setFormatFor(null);
      setTurnMenuFor(null);
      setColorMenuFor(null);
      setFormatMoreFor(null);
      setSelectedBlockMenu(null);
    };
    document.addEventListener('mousedown', closeFloatingTools);
    return () => document.removeEventListener('mousedown', closeFloatingTools);
  }, [formatFor, turnMenuFor]);



  useEffect(() => {
    if (!menuFor) return;
    const closeSlashMenu = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.slash-menu') || target?.closest('[data-rich-block-id]') || target?.closest('textarea')) return;
      setMenuFor(null);
      setSlashQuery('/');
    };
    const closeSlashOnEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuFor(null);
        setSlashQuery('/');
      }
    };
    document.addEventListener('mousedown', closeSlashMenu, true);
    document.addEventListener('touchstart', closeSlashMenu, true);
    document.addEventListener('keydown', closeSlashOnEsc, true);
    return () => {
      document.removeEventListener('mousedown', closeSlashMenu, true);
      document.removeEventListener('touchstart', closeSlashMenu, true);
      document.removeEventListener('keydown', closeSlashOnEsc, true);
    };
  }, [menuFor]);

  useLayoutEffect(() => {
    if (!menuFor) { setSlashPos(null); return; }
    const blockEl = document.querySelector(`[data-block-id="${menuFor}"]`) as HTMLElement | null;
    const anchor = blockEl?.querySelector('.rich-editable, textarea, .block-command textarea') as HTMLElement | null;
    const rect = (anchor || blockEl)?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(300, Math.max(260, window.innerWidth - 32));
    const preferredLeft = Math.max(12, Math.min(rect.left + 28, window.innerWidth - width - 12));
    const spaceBelow = window.innerHeight - rect.bottom - 14;
    const spaceAbove = rect.top - 14;
    const menuHeight = Math.min(520, Math.max(260, slashMatches.length * 42 + 86));
    const openUp = spaceBelow < 260 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(220, Math.min(openUp ? spaceAbove : spaceBelow, 520));
    // Use the estimated actual menu height for placement. Previously, when a
    // slash menu opened upward near the bottom of a long page, we subtracted
    // the full maxHeight, which pushed the menu too far above the active line.
    const actualHeight = Math.max(180, Math.min(menuHeight, maxHeight));
    const top = openUp ? Math.max(12, rect.top - actualHeight - 8) : Math.min(rect.bottom + 8, window.innerHeight - actualHeight - 12);
    setSlashPos({ left: preferredLeft, top, maxHeight });
  }, [menuFor, slashQuery, slashMatches.length, blocks.length]);

  useEffect(() => {
    if (!menuFor) return;
    if (slashActiveIndex >= slashMatches.length) setSlashActiveIndex(Math.max(0, slashMatches.length - 1));
    const navSlash = (e: KeyboardEvent) => {
      if (!menuFor) return;
      const matches = slashMatches;
      if (!matches.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashActiveIndex(i => Math.min(matches.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashActiveIndex(i => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const picked = matches[Math.max(0, Math.min(slashActiveIndex, matches.length - 1))];
        if (picked) applySlashItem(menuFor, picked);
      }
    };
    document.addEventListener('keydown', navSlash, true);
    return () => document.removeEventListener('keydown', navSlash, true);
  }, [menuFor, slashMatches, slashActiveIndex]);

  useEffect(() => {
    if (!codeMoreFor && !codeLangFor && !codeTurnFor) return;
    const closeCodeMenus = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.code-hover-toolbar') || target?.closest('.code-more-popover') || target?.closest('.code-language-popover') || target?.closest('.code-turn-popover')) return;
      setCodeMoreFor(null);
      setCodeLangFor(null);
      setCodeTurnFor(null);
    };
    const closeCodeMenusOnEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCodeMoreFor(null);
        setCodeLangFor(null);
        setCodeTurnFor(null);
      }
    };
    document.addEventListener('mousedown', closeCodeMenus);
    document.addEventListener('keydown', closeCodeMenusOnEsc);
    return () => {
      document.removeEventListener('mousedown', closeCodeMenus);
      document.removeEventListener('keydown', closeCodeMenusOnEsc);
    };
  }, [codeMoreFor, codeLangFor, codeTurnFor]);

  useEffect(() => {
    if (!codeLangFor) return;
    if (codeLangActiveIndex >= visibleCodeLanguages.length) setCodeLangActiveIndex(Math.max(0, visibleCodeLanguages.length - 1));
    const navLanguages = (e: KeyboardEvent) => {
      const langs = visibleCodeLanguages;
      if (!langs.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCodeLangActiveIndex(i => Math.min(langs.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCodeLangActiveIndex(i => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const block = blocks.find(b => b.id === codeLangFor);
        const lang = langs[Math.max(0, Math.min(codeLangActiveIndex, langs.length - 1))];
        if (block && lang) { setCodeLanguage(block, lang); setCodeLangSearch(''); setCodeLangActiveIndex(0); }
      }
    };
    document.addEventListener('keydown', navLanguages, true);
    return () => document.removeEventListener('keydown', navLanguages, true);
  }, [codeLangFor, visibleCodeLanguages, codeLangActiveIndex, blocks]);

  useEffect(() => {
    if (!selectedImageId) return;
    const closeImageSelection = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.image-resize-frame')) return;
      setSelectedImageId(null);
    };
    document.addEventListener('mousedown', closeImageSelection);
    return () => document.removeEventListener('mousedown', closeImageSelection);
  }, [selectedImageId]);

  function openFormatToolbar(blockId: string, e: ReactMouseEvent<HTMLElement>) {
    const w = 290;
    const h = 42;
    setFormatFor(blockId);
    setFormatPos({
      left: Math.max(8, Math.min(e.clientX - 12, window.innerWidth - w - 8)),
      top: Math.max(8, Math.min(e.clientY - h - 10, window.innerHeight - h - 8))
    });
    setTurnMenuFor(null);
    setColorMenuFor(null);
    setFormatMoreFor(null);
  }

  function copyCurrentTextSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    try { document.execCommand('copy'); } catch {}
    setFormatFor(null);
    setTurnMenuFor(null);
    setColorMenuFor(null);
    setFormatMoreFor(null);
  }

  function idsFromNativeSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return [];
    const range = sel.getRangeAt(0);
    const editor = document.querySelector('.editor');
    if (!editor) return [];
    const anchor = sel.anchorNode;
    const focus = sel.focusNode;
    if (!anchor || !focus || !editor.contains(anchor) || !editor.contains(focus)) return [];
    const rangeRect = range.getBoundingClientRect();
    const wraps = Array.from(editor.querySelectorAll<HTMLElement>('.block-wrap[data-block-id]'));
    return wraps
      .filter(el => {
        try {
          if (range.intersectsNode(el)) return true;
          if (!rangeRect.width && !rangeRect.height) return false;
          const rect = el.getBoundingClientRect();
          return !(rect.bottom < rangeRect.top || rect.top > rangeRect.bottom || rect.right < rangeRect.left || rect.left > rangeRect.right);
        } catch { return false; }
      })
      .map(el => el.dataset.blockId || '')
      .filter(Boolean);
  }

  function syncNativeBlockSelection() {
    const ids = idsFromNativeSelection();
    if (ids.length > 1) {
      setSelectedBlockIds(ids);
      setSelectedBlockMenu(null);
    }
  }

  function idsFromVerticalDrag(startY: number, endY: number) {
    const editor = document.querySelector('.editor');
    if (!editor) return [];
    const top = Math.min(startY, endY);
    const bottom = Math.max(startY, endY);
    return Array.from(editor.querySelectorAll<HTMLElement>('.block-wrap[data-block-id]'))
      .filter(el => {
        const r = el.getBoundingClientRect();
        // Select a block when the drag band intersects the block, not only when
        // the drag crosses its vertical center. This makes short, Notion-like
        // drags across wrapped/short blocks reliable.
        return r.bottom >= top - 2 && r.top <= bottom + 2;
      })
      .map(el => el.dataset.blockId || '')
      .filter(Boolean);
  }

  function clearNativeSelection() {
    try { window.getSelection()?.removeAllRanges(); } catch {}
  }

  function setBlockSelectionByIds(ids: string[]) {
    const unique = [...new Set(ids)].filter(Boolean);
    setSelectedBlockIds(unique);
    setSelectedBlockMenu(null);
    return unique;
  }

  function selectBlocksBetweenIds(startId: string | null, endId: string | null) {
    if (!startId || !endId) return [];
    const start = startId ? (blockIndexById.get(startId) ?? -1) : -1;
    const end = endId ? (blockIndexById.get(endId) ?? -1) : -1;
    if (start < 0 || end < 0) return [];
    const lo = Math.min(start, end), hi = Math.max(start, end);
    return setBlockSelectionByIds(blocks.slice(lo, hi + 1).map(b => b.id));
  }

  function blockIdFromPoint(x: number, y: number) {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.closest<HTMLElement>('.block-wrap[data-block-id]')?.dataset.blockId || null;
  }

  function selectBlocksFromDrag(startY: number, currentY: number) {
    const ids = idsFromVerticalDrag(startY, currentY);
    if (ids.length) {
      setBlockSelectionByIds(ids);
      clearNativeSelection();
    }
    return ids;
  }

  function isWholeRichEditableSelected(target: HTMLElement | null) {
    const rich = target?.closest('.rich-editable, .table-cell-editable, textarea, input') as HTMLElement | null;
    if (!rich) return false;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    if (!rich.contains(sel.anchorNode) || !rich.contains(sel.focusNode)) return false;
    const selected = String(sel.toString() || '').replace(/\s+/g, '');
    const text = String(rich.textContent || '').replace(/\s+/g, '');
    return !!text && selected.length >= text.length;
  }

  function wrapHtmlWithTag(html: string, tag: 'strong' | 'em' | 'u') {
    const trimmed = html || '';
    const re = new RegExp(`^\\s*<${tag}[^>]*>([\\s\\S]*)<\\/${tag}>\\s*$`, 'i');
    const m = trimmed.match(re);
    return m ? m[1] : `<${tag}>${trimmed || '&nbsp;'}</${tag}>`;
  }

  async function applyTableCellInlineFormat(command: 'bold' | 'italic' | 'underline') {
    if (!selectedCells) return false;
    const block = blocks.find(b => b.id === selectedCells.blockId);
    if (!block?.table) return false;
    const tag = command === 'bold' ? 'strong' : command === 'italic' ? 'em' : 'u';
    const table = block.table.map(row => [...row]);
    const r1 = Math.min(selectedCells.startRow, selectedCells.endRow);
    const r2 = Math.max(selectedCells.startRow, selectedCells.endRow);
    const c1 = Math.min(selectedCells.startCol, selectedCells.endCol);
    const c2 = Math.max(selectedCells.startCol, selectedCells.endCol);
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (table[r]) table[r][c] = wrapHtmlWithTag(table[r][c] || '', tag as any);
    await updateBlock(block.id, { table });
    return true;
  }

  useEffect(() => {
    const handleNativeBlockSelection = () => window.setTimeout(syncNativeBlockSelection, 0);
    const clearOnPointerOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.editor') || target?.closest('.selected-block-menu') || target?.closest('.format-toolbar')) return;
      setSelectedBlockIds([]);
    };
    const moveBlockSelecting = (e: MouseEvent) => {
      const drag = blockDragRef.current;
      if (!drag.active) return;
      const movedEnough = Math.abs(e.clientY - drag.startY) > 8 || Math.abs(e.clientX - drag.startX) > 18;
      if (!movedEnough) return;
      drag.moved = true;
      selectBlocksFromDrag(drag.startY, e.clientY);
    };
    const stopBlockSelecting = (e?: MouseEvent) => {
      setIsBlockSelecting(false);
      setBlockSelectionStart(null);
      const drag = blockDragRef.current;
      if (drag.active && drag.moved && e) {
        const ids = selectBlocksFromDrag(drag.startY, e.clientY);
        if (ids.length < 2) syncNativeBlockSelection();
      } else {
        syncNativeBlockSelection();
      }
      blockDragRef.current = { active: false, startY: 0, startX: 0, moved: false, startedInsideEditor: false };
    };
    document.addEventListener('selectionchange', handleNativeBlockSelection);
    document.addEventListener('mousedown', clearOnPointerOutside);
    document.addEventListener('mousemove', moveBlockSelecting);
    document.addEventListener('mouseup', stopBlockSelecting);
    return () => {
      document.removeEventListener('selectionchange', handleNativeBlockSelection);
      document.removeEventListener('mousedown', clearOnPointerOutside);
      document.removeEventListener('mousemove', moveBlockSelecting);
      document.removeEventListener('mouseup', stopBlockSelecting);
    };
  }, [blocks]);


  useEffect(() => {
    const startPointerSelection = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      const wrap = target?.closest<HTMLElement>('.block-wrap[data-block-id]');
      if (!wrap || !target?.closest('.editor')) return;
      if (target.closest('button, .format-toolbar, .floating-popover, .table-cell-editable, .mini-table, .code-hover-toolbar, .code-more-popover, .code-language-popover')) return;
      pointerSelectRef.current = { active: true, startX: e.clientX, startY: e.clientY, startBlockId: wrap.dataset.blockId || null, fromEditable: !!target.closest('[contenteditable="true"], textarea, input') };
    };
    const movePointerSelection = (e: MouseEvent) => {
      const drag = pointerSelectRef.current;
      if (!drag.active || !drag.startBlockId) return;
      const movedY = Math.abs(e.clientY - drag.startY);
      const movedX = Math.abs(e.clientX - drag.startX);
      if (movedY < 18 && movedX < 26) return;
      const endId = blockIdFromPoint(e.clientX, e.clientY) || idsFromVerticalDrag(drag.startY, e.clientY).at(-1) || drag.startBlockId;
      const ids = selectBlocksBetweenIds(drag.startBlockId, endId);
      if (ids.length > 1) {
        e.preventDefault();
        clearNativeSelection();
      }
    };
    const stopPointerSelection = () => {
      pointerSelectRef.current = { active: false, startX: 0, startY: 0, startBlockId: null, fromEditable: false };
    };
    document.addEventListener('mousedown', startPointerSelection, true);
    document.addEventListener('mousemove', movePointerSelection, true);
    document.addEventListener('mouseup', stopPointerSelection, true);
    return () => {
      document.removeEventListener('mousedown', startPointerSelection, true);
      document.removeEventListener('mousemove', movePointerSelection, true);
      document.removeEventListener('mouseup', stopPointerSelection, true);
    };
  }, [blocks]);

  useEffect(() => {
    const handleEditorShortcuts = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.editor')) return;

      if (e.key === 'Escape') {
        if (selectedBlockIds.length || selectedCells) {
          e.preventDefault();
          setSelectedBlockIds([]);
          setSelectedCells(null);
          setSelectedBlockMenu(null);
          window.getSelection()?.removeAllRanges();
        }
        return;
      }

      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedBlockIds.length > 0) {
        if (isEditableTarget(target) || hasNativeSelectionInsideEditable(target)) return;
        e.preventDefault();
        requestDeleteSelectedBlocks(selectedBlockIds);
        return;
      }

      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (['b', 'i', 'u'].includes(key)) {
        const activeTableCell = target?.closest('.table-cell-editable') as HTMLElement | null;
        const sel = window.getSelection();
        const hasNativeCellTextSelection = !!activeTableCell && !!sel && !sel.isCollapsed &&
          !!sel.anchorNode && !!sel.focusNode && activeTableCell.contains(sel.anchorNode) && activeTableCell.contains(sel.focusNode);
        if (hasNativeCellTextSelection) {
          e.preventDefault();
          document.execCommand(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline', false);
          setTimeout(() => {
            const cell = activeTableCell.closest('td');
            const editable = cell?.querySelector('.table-cell-editable') as HTMLElement | null;
            editable?.dispatchEvent(new Event('input', { bubbles: true }));
          }, 0);
          return;
        }
        if (selectedCells) {
          e.preventDefault();
          applyTableCellInlineFormat(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
          return;
        }
      }
      if (key === 'a') {
        const editable = target?.closest('.rich-editable, .table-cell-editable, textarea, input') as HTMLElement | null;
        if (editable && selectedBlockIds.length === 0 && !isWholeRichEditableSelected(target)) {
          // First Ctrl/Cmd+A keeps the browser-native behavior: select text
          // inside the current block/cell/input. The second press promotes the
          // selection to all block-wraps below.
          return;
        }
        e.preventDefault();
        setSelectedBlockIds(blocks.map(b => b.id));
        clearNativeSelection();
        return;
      }
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) document.execCommand('redo');
        else document.execCommand('undo');
        return;
      }
      if (key === 'y') {
        e.preventDefault();
        document.execCommand('redo');
        return;
      }
    };
    document.addEventListener('keydown', handleEditorShortcuts, true);
    return () => document.removeEventListener('keydown', handleEditorShortcuts, true);
  }, [blocks, selectedBlockIds, selectedCells]);


  useEffect(() => {
    const handleSelectedBlocksCopy = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.editor')) return;
      if (!selectedBlockIds.length) return;
      const { html, text } = selectedBlocksExport();
      if (!html && !text) return;
      e.preventDefault();
      e.clipboardData?.setData('text/html', html);
      e.clipboardData?.setData('text/plain', text);
    };
    document.addEventListener('copy', handleSelectedBlocksCopy, true);
    return () => document.removeEventListener('copy', handleSelectedBlocksCopy, true);
  }, [blocks, selectedBlockIds]);

  useEffect(() => {
    if (!tableMenu && !selectedCells) return;
    const closeTableTools = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.table-cell-menu') || target?.closest('.mini-table')) return;
      setTableMenu(null);
      setSelectedCells(null);
    };
    document.addEventListener('mousedown', closeTableTools);
    return () => document.removeEventListener('mousedown', closeTableTools);
  }, [tableMenu, selectedCells]);


  async function openLinkModal(blockId: string) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) savedLinkRange.current = sel.getRangeAt(0).cloneRange();
    setLinkModalFor(blockId);
    setLinkUrl('');
    setPageLinkSearch('');
    const pages = await db.pages.where('deleted').notEqual(1).toArray().catch(async () => (await db.pages.toArray()).filter(p => !p.deleted));
    setPagesForLink(pages.map(p => ({ id: p.id, title: p.title || 'Untitled' })));
  }

  function applyUrlLink() {
    if (!linkUrl.trim()) return;
    execFormat('createLink', linkUrl.trim());
    setLinkModalFor(null);
  }

  function applyPageLink(page: { id: string; title: string }) {
    const href = `#page-${page.id}`;
    execFormat('createLink', href);
    setLinkModalFor(null);
  }

  function blockTextForCopy(block: Block) {
    const raw = (block.text || '').replace(/<[^>]*>/g, '');
    if (block.type === 'bullet') return `• ${raw}`;
    if (block.type === 'numbered') return `${raw}`;
    if (block.type === 'todo') return `${block.checked ? '[x]' : '[ ]'} ${raw}`;
    if (block.type === 'command') return `$ ${raw}`;
    if (block.type === 'table' && block.table) return block.table.map(r => r.join('\t')).join('\n');
    return raw;
  }


  function sanitizeBlockHtml(value: string) {
    const div = document.createElement('div');
    div.innerHTML = value || '';
    div.querySelectorAll('script,style,iframe,object').forEach(el => el.remove());
    return div.innerHTML || '';
  }

  function selectedBlocksExport() {
    const selected = blocks.filter(b => selectedBlockIdSet.has(b.id));
    const html = selected.map(b => {
      const t = sanitizeBlockHtml(b.text || '');
      if (b.type === 'h1') return `<h1>${t}</h1>`;
      if (b.type === 'h2') return `<h2>${t}</h2>`;
      if (b.type === 'h3') return `<h3>${t}</h3>`;
      if (b.type === 'h4') return `<h4>${t}</h4>`;
      if (b.type === 'bullet') return `<div>• ${t}</div>`;
      if (b.type === 'numbered') return `<div>${blockTextForCopy(b)}</div>`;
      if (b.type === 'todo') return `<div>${b.checked ? '☑' : '☐'} ${t}</div>`;
      if (b.type === 'command') return `<pre style="background:#111;color:#fff;padding:6px 8px;border-radius:6px;white-space:pre-wrap;">$ ${t}</pre>`;
      if (b.type === 'table' && b.table) return `<table style="border-collapse:collapse;">${b.table.map(r => `<tr>${r.map(c => `<td style="border:1px solid #d8d8d8;padding:5px 7px;">${c}</td>`).join('')}</tr>`).join('')}</table>`;
      return `<p>${t}</p>`;
    }).join('');
    const text = selected.map(blockTextForCopy).join('\n');
    return { selected, html, text };
  }

  async function copyRichBlocks(html: string, text: string) {
    if (navigator.clipboard?.write && 'ClipboardItem' in window) {
      try {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })]);
        return true;
      } catch {}
    }
    const holder = document.createElement('div');
    holder.contentEditable = 'true';
    holder.style.position = 'fixed';
    holder.style.left = '-99999px';
    holder.innerHTML = html;
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    sel?.removeAllRanges();
    holder.remove();
    if (ok) return true;
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-99999px';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  }

  async function copySelectedBlocks() {
    const { selected, html, text } = selectedBlocksExport();
    if (!selected.length) return;
    await copyRichBlocks(html, text);
    setSelectedBlockMenu(null);
  }

  function singleBlockExport(block: Block) {
    const t = sanitizeBlockHtml(block.text || '');
    let html = `<p>${t}</p>`;
    if (block.type === 'h1') html = `<h1>${t}</h1>`;
    else if (block.type === 'h2') html = `<h2>${t}</h2>`;
    else if (block.type === 'h3') html = `<h3>${t}</h3>`;
    else if (block.type === 'h4') html = `<h4>${t}</h4>`;
    else if (block.type === 'bullet') html = `<ul><li>${t}</li></ul>`;
    else if (block.type === 'numbered') html = `<ol><li>${t}</li></ol>`;
    else if (block.type === 'quote') html = `<blockquote>${t}</blockquote>`;
    else if (block.type === 'command') html = `<pre><code>${escapeCodeHtml(block.text || '')}</code></pre>`;
    else if (block.type === 'code') html = `<pre><code>${escapeCodeHtml(block.text || '')}</code></pre>`;
    else if (block.type === 'table' && block.table) html = `<table>${block.table.map(r => `<tr>${r.map(c => `<td>${sanitizeBlockHtml(c || '')}</td>`).join('')}</tr>`).join('')}</table>`;
    return { html, text: blockTextForCopy(block) };
  }

  async function copySingleBlock(block: Block) {
    const { html, text } = singleBlockExport(block);
    await copyRichBlocks(html, text);
    setSelectedBlockIds([block.id]);
    window.setTimeout(() => setSelectedBlockIds(prev => prev.length === 1 && prev[0] === block.id ? [] : prev), 550);
  }

  function templateBlockPayload(block: Block): Partial<Block> {
    return {
      type: block.type, text: block.text || '', checked: block.checked, caption: block.caption,
      table: block.table ? block.table.map(row => [...row]) : undefined,
      tableColWidths: block.tableColWidths ? [...block.tableColWidths] : undefined,
      tableCellColors: block.tableCellColors ? { ...block.tableCellColors } : undefined,
      codeLanguage: block.codeLanguage, codeWrap: block.codeWrap, numberedStart: block.numberedStart,
      imageWidth: block.imageWidth, imageHeight: block.imageHeight, hpeTemplate: block.hpeTemplate
    };
  }

  async function persistCustomTemplates(next: CustomBlockTemplate[]) {
    await db.settings.put({ key: 'customBlockTemplates', value: next });
    setCustomTemplates(next);
  }

  async function saveBlockAsCustomTemplate(block: Block) {
    const sourceIds = selectedBlockIds.length > 1 && selectedBlockIdSet.has(block.id) ? selectedBlockIds : [block.id];
    const sourceSet = new Set(sourceIds);
    const sourceBlocks = blocks.filter(b => sourceSet.has(b.id));
    const firstText = (sourceBlocks[0]?.text || '').replace(/<[^>]*>/g, '').trim().slice(0, 42);
    const defaultName = firstText || (sourceBlocks.length > 1 ? `${sourceBlocks.length} block template` : `${block.type[0].toUpperCase()}${block.type.slice(1)} block`);
    const name = window.prompt(sourceBlocks.length > 1 ? 'Save selected blocks as template' : 'Save block as template', defaultName);
    if (!name?.trim()) return;
    const template: CustomBlockTemplate = {
      id: uid(), name: name.trim(), blocks: sourceBlocks.map(templateBlockPayload), createdAt: now(), updatedAt: now()
    };
    const templateKey = JSON.stringify(template.blocks.map(b => ({ type: b.type, text: b.text, table: b.table, codeLanguage: b.codeLanguage })));
    const deduped = customTemplates.filter(existing => existing.name !== template.name || JSON.stringify(existing.blocks.map(b => ({ type: b.type, text: b.text, table: b.table, codeLanguage: b.codeLanguage }))) !== templateKey);
    await persistCustomTemplates([template, ...deduped].slice(0, 50));
    setSelectedBlockIds([]);
    setFormatMoreFor(null);
    setFormatFor(null);
  }

  async function insertCustomTemplate(blockId: string, template: CustomBlockTemplate) {
    const target = blocks.find(b => b.id === blockId);
    if (!target || !template.blocks?.length) return;
    const t = now();
    const created = template.blocks.map((payload, index) => ({
      ...payload, id: uid(), pageId, workspaceId: target.workspaceId, sort: target.sort + index * 0.1, createdAt: t, updatedAt: t
    } as Block));
    await db.blocks.delete(blockId);
    await db.blocks.bulkAdd(created);
    await resequence();
    await touchPage();
    await load();
    focusBlock(created[0].id);
    setMenuFor(null);
    setSlashQuery('/');
  }


  async function insertPageLinkBlock(pageIdToLink: string, sortAfter?: number) {
    const page = await db.pages.get(pageIdToLink);
    if (!page) return;
    const sort = sortAfter ?? ((blocks.at(-1)?.sort || 0) + 1);
    const block: Block = { id: uid(), pageId, type: 'paragraph', text: `<a href="#page-${page.id}">${page.title || 'Untitled'}</a>`, sort: sort + 0.5, createdAt: now(), updatedAt: now() };
    await db.blocks.add(block);
    await resequence();
    await touchPage();
    await load();
    focusBlock(block.id);
  }

  async function touchPage() { await db.pages.update(pageId, { updatedAt: now() }); onChanged?.(); }
  function focusBlock(blockId: string, atStart = false) {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-rich-block-id="${blockId}"]`) as HTMLElement | null;
      const ta = document.querySelector(`[data-block-id="${blockId}"]`) as HTMLTextAreaElement | null;
      if (el) { el.focus(); const range = document.createRange(); range.selectNodeContents(el); range.collapse(atStart); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range); }
      else { ta?.focus(); if (ta) ta.selectionStart = ta.selectionEnd = atStart ? 0 : ta.value.length; }
    });
  }

  function focusPreviousBlock(blockId: string) {
    const idx = blocks.findIndex(b => b.id === blockId);
    if (idx > 0) focusBlock(blocks[idx - 1].id);
  }
  async function resequence() {
    const current = await db.blocks.where('pageId').equals(pageId).sortBy('sort');
    await Promise.all(current.map((b, i) => db.blocks.update(b.id, { sort: i + 1 })));
  }
  async function updateBlock(id: string, patch: Partial<Block>, shouldLoad = true) {
    await db.blocks.update(id, { ...patch, updatedAt: now() });
    await touchPage();
    if (shouldLoad) load();
  }
  function newBlock(type: BlockType, sort: number): Block {
    const t = now();
    const block: Block = { id: uid(), pageId, type, text: '', sort, createdAt: t, updatedAt: t };
    if (type === 'table') { block.table = [['','',''],['','',''],['','','']]; block.tableColWidths = [160,160,160]; }
    return block;
  }

  function cleanHTML(input: string) {
    const doc = new DOMParser().parseFromString(sanitizeExternalHtml(input || ''), 'text/html');
    return doc.body;
  }

  function htmlToBlocks(html: string, plain: string, baseSort: number): Block[] {
    const t = now();
    const make = (type: BlockType, text: string, offset: number, listLevel = 0, listStyle?: string): Block => ({ id: uid(), pageId, type, text: text.trim(), sort: baseSort + offset, createdAt: t, updatedAt: t, listLevel, listStyle } as Block);
    const result: Block[] = [];
    const push = (type: BlockType, value: string, listLevel = 0, listStyle?: string) => {
      const cleaned = value.replace(/(&nbsp;| )/g, ' ').trim();
      if (!cleaned) return;
      result.push(make(type, cleaned, result.length + 0.1, listLevel, listStyle));
    };
    const pushListItem = (type: BlockType, li: Element, level: number, listStyle?: string) => {
      const clone = li.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(':scope > ul, :scope > ol').forEach(child => child.remove());
      push(type, clone.innerHTML || clone.textContent || '', level, listStyle);
      Array.from(li.children).forEach(child => {
        const tag = child.tagName?.toLowerCase();
        if (tag === 'ul') Array.from(child.querySelectorAll(':scope > li')).forEach(nested => pushListItem('bullet', nested, level + 1));
        if (tag === 'ol') Array.from(child.querySelectorAll(':scope > li')).forEach(nested => pushListItem('numbered', nested, level + 1));
      });
    };
    if (html) {
      const body = cleanHTML(html);
      const nodes = Array.from(body.children.length ? body.children : body.childNodes) as Array<Element | ChildNode>;
      const walk = (node: Element | ChildNode) => {
        if (node.nodeType === Node.TEXT_NODE) { push('paragraph', (node.textContent || '').trim()); return; }
        const el = node as HTMLElement;
        const tag = el.tagName?.toLowerCase();
        if (!tag) return;
        if (['h1','h2','h3','h4'].includes(tag)) push(tag as BlockType, el.innerHTML);
        else if (tag === 'blockquote') push('quote', el.innerHTML);
        else if (tag === 'pre') push('code', el.textContent || '');
        else if (tag === 'code') push('code', el.textContent || '');
        else if (tag === 'ul') Array.from(el.querySelectorAll(':scope > li')).forEach(li => pushListItem('bullet', li, 0));
        else if (tag === 'ol') Array.from(el.querySelectorAll(':scope > li')).forEach(li => pushListItem('numbered', li, 0));
        else if (tag === 'table') {
          const block = make('table', '', result.length + 0.1);
          block.table = Array.from(el.querySelectorAll('tr')).map(tr => Array.from(tr.querySelectorAll('th,td')).map(td => (td.textContent || '').trim())).filter(row => row.length);
          if (block.table?.length) result.push(block);
        }
        else if (['p','div','section','article'].includes(tag)) {
          const children = Array.from(el.children);
          const hasBlockKids = children.some(c => ['h1','h2','h3','h4','p','ul','ol','pre','blockquote','table'].includes(c.tagName.toLowerCase()));
          if (hasBlockKids) children.forEach(walk); else push('paragraph', el.innerHTML);
        } else push('paragraph', el.innerHTML || el.textContent || '');
      };
      nodes.forEach(walk);
    }
    if (!result.length && plain) {
      const normalized = normalizeAiPlainTextToBlocks(plain);
      if (normalized.length) normalized.forEach(item => push(item.type, item.text, item.listLevel || 0, item.listStyle));
      else plain.split(/\n+/).map(x => x.trim()).filter(Boolean).forEach(line => push('paragraph', linkifyPlainUrlsInHtml(escapePlainTextHtml(line))));
    }
    return result;
  }

  async function pasteBlocksInto(block: Block, html: string, plain: string) {
    const imported = htmlToBlocks(html, plain, block.sort);
    if (!imported.length) return;
    const currentPlain = (block.text || '').replace(/<[^>]*>/g, '').trim();
    const batch = [...imported];
    if (!currentPlain) {
      const first = batch.shift()!;
      await db.blocks.update(block.id, { type: first.type, text: first.text, table: first.table, listLevel: (first as any).listLevel || 0, listStyle: (first as any).listStyle, updatedAt: now() });
    }
    if (batch.length) await db.blocks.bulkAdd(batch);
    await resequence(); await touchPage(); load();
  }
  async function addBlock(afterSort?: number, type: BlockType = 'paragraph') {
    const sort = afterSort ? afterSort + 0.5 : (blocks.at(-1)?.sort || 0) + 1;
    const created = newBlock(type, sort);
    await db.blocks.add(created);
    await resequence(); await touchPage(); await load();
    focusBlock(created.id);
    return created.id;
  }
  async function performDeleteBlock(id: string) {
    if (blocks.length <= 1) return;
    const idx = blocks.findIndex(b => b.id === id);
    const previous = blocks[idx - 1] || blocks[idx + 1];
    await db.blocks.delete(id);
    await resequence(); await touchPage(); await load();
    if (previous) focusBlock(previous.id);
  }

  function requestDeleteBlock(id: string) {
    if (blocks.length <= 1) return;
    setConfirmDialog({
      title: 'Delete block?',
      message: 'This block will be removed from the page.',
      confirmText: 'Delete',
      onConfirm: () => performDeleteBlock(id)
    });
  }

  async function requestDeleteSelectedBlocks(ids: string[]) {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (!uniqueIds.length) return;
    setConfirmDialog({
      title: uniqueIds.length === 1 ? 'Delete selected block?' : 'Delete selected blocks?',
      message: uniqueIds.length === 1 ? 'This block will be removed from the page.' : `Delete ${uniqueIds.length} selected blocks from this page?`,
      confirmText: 'Delete',
      onConfirm: async () => {
        const selectedSet = new Set(uniqueIds);
        const remaining = blocks.filter(b => !selectedSet.has(b.id));
        const firstSelectedIndex = Math.max(0, blocks.findIndex(b => selectedSet.has(b.id)));
        await Promise.all(uniqueIds.map(id => db.blocks.delete(id)));
        let focusId = remaining[Math.min(firstSelectedIndex, Math.max(0, remaining.length - 1))]?.id;
        if (!focusId) {
          const created = newBlock('paragraph', 1);
          await db.blocks.add(created);
          focusId = created.id;
        }
        setSelectedBlockIds([]);
        window.getSelection()?.removeAllRanges();
        await resequence();
        await touchPage();
        await load();
        focusBlock(focusId);
      }
    });
  }

  async function deleteBlock(id: string) {
    requestDeleteBlock(id);
  }

  async function handleBackspaceEmpty(block: Block) {
    if (block.type === 'bullet' || block.type === 'numbered') {
      await updateBlock(block.id, { type: 'paragraph', text: '' });
      focusBlock(block.id);
      return;
    }
    requestDeleteBlock(block.id);
  }
  async function duplicateBlock(id: string) {
    const source = blocks.find(b => b.id === id);
    if (!source) return;
    const copyBlock: Block = { ...source, id: uid(), sort: source.sort + 0.5, createdAt: now(), updatedAt: now() };
    await db.blocks.add(copyBlock);
    await resequence(); await touchPage(); await load();
    focusBlock(copyBlock.id);
  }
  async function convert(id: string, type: BlockType) {
    const patch: Partial<Block> = { type };
    const b = blocks.find(x => x.id === id);
    const plain = ((b?.text || '').replace(/<[^>]*>/g, '')).trim();
    if (plain.startsWith('/') || menuFor === id) patch.text = '';
    if (type === 'table') { patch.table = [['','',''],['','',''],['','','']]; patch.tableColWidths = [160,160,160]; }
    await updateBlock(id, patch); setMenuFor(null);
  }

  async function insertHpeTemplate(blockId: string) {
    const source = blocks.find(b => b.id === blockId);
    const base = source?.sort || (blocks.at(-1)?.sort || 0);
    const t = now();
    const mk = (type: BlockType, text: string, offset: number): Block => ({ id: uid(), pageId, type, text, sort: base + offset, createdAt: t, updatedAt: t });
    const tableBlock = mk('table', '', 0.1);
    tableBlock.hpeTemplate = 1;
    tableBlock.table = [
      ['Customer Name', 'Case ID', 'Product Model'],
      ['Contoso / Customer name here', 'HPE-000000000', 'HPE product model here'],
      ['Case Subject', 'Date/Time', 'Owner'],
      ['Short case subject here', new Date().toLocaleString(), 'Engineer / owner here']
    ];
    tableBlock.tableColWidths = [180, 180, 180];
    const section = (title: string, text: string, offset: number) => {
      const h = mk('h4', title, offset); h.hpeTemplate = 1;
      const p = mk('paragraph', `<span class="hpe-dummy">${text}</span>`, offset + 0.01); p.hpeTemplate = 1;
      return [h, p];
    };
    const template = [
      tableBlock,
      ...section('Executive Summary', 'Briefly summarize customer impact, current status, and the most important conclusion.', 0.2),
      ...section('Technical Investigation & Findings', 'List observed symptoms, logs checked, timelines, errors, configuration details, and evidence gathered.', 0.4),
      ...section('Root Cause Analysis', 'State the most probable root cause and supporting evidence. Mention if RCA is still under validation.', 0.6),
      ...section('Resolution & Actions Taken', 'Describe actions performed, configuration changes, patches, workaround, validation, and customer confirmation.', 0.8),
      ...section('Future Recommendation', 'Add prevention steps, monitoring recommendation, patch/firmware guidance, and follow-up actions.', 1.0)
    ];
    await db.blocks.delete(blockId);
    await db.blocks.bulkAdd(template);
    await resequence(); await touchPage(); await load();
    focusBlock(template[1].id);
  }

  function slashShortcut(value: string): BlockType | null {
    const trimmed = value.trim();
    if (trimmed === '/*') return 'bullet';
    if (trimmed === '/1') return 'numbered';
    if (trimmed === '/#') return 'command';
    return null;
  }

  async function applySlashItem(blockId: string, item: SlashItem) {
    if (item.customTemplate) {
      await insertCustomTemplate(blockId, item.customTemplate);
      return;
    }
    if (item.label === 'HPE Technical Case Summary') {
      await insertHpeTemplate(blockId);
      setMenuFor(null); setSlashQuery('/');
      return;
    }
    if (item.label === 'Page') {
      setMenuFor(null);
      setSlashQuery('/');
      if (onCreatePage) onCreatePage();
      return;
    }
    await convert(blockId, item.type);
    if (['Text', 'Bullet list', 'Numbered list'].includes(item.label)) await db.blocks.update(blockId, { text: '', updatedAt: now() });
    if (item.type === 'bullet' || item.type === 'numbered') focusBlock(blockId);
  }

  async function pickSlashCommand(blockId: string) {
    const match = getSlashMatches(slashQuery, customTemplates)[0];
    if (match) await applySlashItem(blockId, match);
  }

  function execFormat(command: string, value?: string) {
    const sel = window.getSelection();
    if (savedLinkRange.current) {
      sel?.removeAllRanges();
      sel?.addRange(savedLinkRange.current);
    }
    document.execCommand(command, false, value);
    savedLinkRange.current = null;
    const active = blocks.find(b => b.id === formatFor);
    if (!active) return;
    const el = document.querySelector(`[data-rich-block-id="${active.id}"]`) as HTMLDivElement | null;
    if (el) updateBlock(active.id, { text: el.innerHTML }, false);
  }

  async function updateTable(block: Block, r: number, c: number, value: string) {
    const table = (block.table || [[]]).map(row => [...row]);
    table[r][c] = value;
    await updateBlock(block.id, { table });
  }
  async function addTableRow(block: Block) {
    const table = (block.table && block.table.length ? block.table.map(row => [...row]) : [['', '', '']]);
    const cols = Math.max(1, ...table.map(row => row.length));
    table.push(Array.from({ length: cols }, () => ''));
    await updateBlock(block.id, { table });
  }
  async function addTableCol(block: Block) {
    const table = (block.table && block.table.length ? block.table.map(row => [...row]) : [['']]);
    table.forEach(row => row.push(''));
    const widths = [...(block.tableColWidths || [])];
    widths.push(160);
    await updateBlock(block.id, { table, tableColWidths: widths });
  }

  async function addTableRowFromHover(block: Block, e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await addTableRow(block);
  }

  async function addTableColFromHover(block: Block, e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await addTableCol(block);
  }

  async function toggleHeaderRow(block: Block) {
    await updateBlock(block.id, { tableHasHeader: !(block as any).tableHasHeader } as any);
    setTableMenu(null);
  }

  async function duplicateTableRow(block: Block, rowIndex: number) {
    const table = (block.table || [['']]).map(row => [...row]);
    const source = table[rowIndex] ? [...table[rowIndex]] : Array.from({ length: Math.max(1, ...table.map(r => r.length)) }, () => '');
    table.splice(rowIndex + 1, 0, source);
    await updateBlock(block.id, { table });
    setTableMenu(null);
  }

  async function duplicateTableColumnOnly(block: Block, colIndex: number) {
    await duplicateTableCell(block, 0, colIndex);
  }

  async function insertTableColumn(block: Block, colIndex: number, side: 'left' | 'right') {
    const table = (block.table || [['']]).map(row => [...row]);
    const at = side === 'left' ? colIndex : colIndex + 1;
    table.forEach(row => row.splice(at, 0, ''));
    const widths = [...(block.tableColWidths || [])];
    widths.splice(at, 0, 160);
    await updateBlock(block.id, { table, tableColWidths: widths });
    setTableMenu(null);
  }
  async function insertTableRow(block: Block, rowIndex: number, side: 'above' | 'below') {
    const table = (block.table || [['']]).map(row => [...row]);
    const cols = Math.max(1, ...table.map(row => row.length));
    const at = side === 'above' ? rowIndex : rowIndex + 1;
    table.splice(at, 0, Array.from({ length: cols }, () => ''));
    await updateBlock(block.id, { table });
    setTableMenu(null);
  }
  async function duplicateTableCell(block: Block, rowIndex: number, colIndex: number) {
    const table = (block.table || [['']]).map(row => [...row]);
    table.forEach(row => row.splice(colIndex + 1, 0, row[colIndex] || ''));
    const widths = [...(block.tableColWidths || [])];
    widths.splice(colIndex + 1, 0, widths[colIndex] || 160);
    await updateBlock(block.id, { table, tableColWidths: widths });
    setTableMenu(null);
  }
  async function deleteTableColumn(block: Block, colIndex: number) {
    const table = (block.table || [['']]).map(row => row.length > 1 ? row.filter((_, c) => c !== colIndex) : ['']);
    const widths = [...(block.tableColWidths || [])].filter((_, c) => c !== colIndex);
    await updateBlock(block.id, { table, tableColWidths: widths.length ? widths : [160] });
    setTableMenu(null);
  }
  async function deleteTableRow(block: Block, rowIndex: number) {
    const table = (block.table || [['']]).filter((_, r) => r !== rowIndex);
    await updateBlock(block.id, { table: table.length ? table : [['']] });
    setTableMenu(null);
  }
  async function setSelectedCellColor(block: Block, color: string) {
    const tableCellColors = { ...(block.tableCellColors || {}) };
    const sel = selectedCells?.blockId === block.id ? selectedCells : tableMenu ? { startRow: tableMenu.row, endRow: tableMenu.row, startCol: tableMenu.col, endCol: tableMenu.col } : null;
    if (sel) {
      const r1 = Math.min(sel.startRow, sel.endRow), r2 = Math.max(sel.startRow, sel.endRow);
      const c1 = Math.min(sel.startCol, sel.endCol), c2 = Math.max(sel.startCol, sel.endCol);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) tableCellColors[`${r}:${c}`] = color;
    }
    await updateBlock(block.id, { tableCellColors });
    setTableMenu(null);
  }
  async function clearSelectedCells(block: Block) {
    const table = (block.table || [['']]).map(row => [...row]);
    const sel = selectedCells?.blockId === block.id ? selectedCells : tableMenu ? { startRow: tableMenu.row, endRow: tableMenu.row, startCol: tableMenu.col, endCol: tableMenu.col } : null;
    if (sel) {
      const r1 = Math.min(sel.startRow, sel.endRow), r2 = Math.max(sel.startRow, sel.endRow);
      const c1 = Math.min(sel.startCol, sel.endCol), c2 = Math.max(sel.startCol, sel.endCol);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (table[r]) table[r][c] = '';
    }
    await updateBlock(block.id, { table });
    setTableMenu(null); setSelectedCells(null);
  }
  async function deleteTable(block: Block) {
    await deleteBlock(block.id);
    setTableMenu(null); setSelectedCells(null);
  }
  function isCellSelected(blockId: string, r: number, c: number) {
    if (!selectedCells || selectedCells.blockId !== blockId) return false;
    const r1 = Math.min(selectedCells.startRow, selectedCells.endRow), r2 = Math.max(selectedCells.startRow, selectedCells.endRow);
    const c1 = Math.min(selectedCells.startCol, selectedCells.endCol), c2 = Math.max(selectedCells.startCol, selectedCells.endCol);
    return r >= r1 && r <= r2 && c >= c1 && c <= c2;
  }

  function selectedCellClass(blockId: string, r: number, c: number) {
    if (!isCellSelected(blockId, r, c) || !selectedCells || selectedCells.blockId !== blockId) return '';
    const r1 = Math.min(selectedCells.startRow, selectedCells.endRow), r2 = Math.max(selectedCells.startRow, selectedCells.endRow);
    const c1 = Math.min(selectedCells.startCol, selectedCells.endCol), c2 = Math.max(selectedCells.startCol, selectedCells.endCol);
    return [
      'selected-cell',
      r === r1 ? 'selection-edge-top' : 'selection-interior-y',
      r === r2 ? 'selection-edge-bottom' : 'selection-interior-y',
      c === c1 ? 'selection-edge-left' : 'selection-interior-x',
      c === c2 ? 'selection-edge-right' : 'selection-interior-x'
    ].join(' ');
  }

  function openTableMenuAt(e: ReactMouseEvent, block: Block, row: number, col: number) {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 270;
    const menuHeight = 360;
    setTableMenu({
      blockId: block.id,
      row,
      col,
      left: Math.max(8, Math.min(e.clientX + 8, window.innerWidth - menuWidth - 12)),
      top: Math.max(8, Math.min(e.clientY + 8, window.innerHeight - menuHeight - 12))
    });
  }

  function selectTableColumn(block: Block, col: number) {
    const rows = Math.max(1, (block.table || [['']]).length);
    setSelectedCells({ blockId: block.id, startRow: 0, endRow: rows - 1, startCol: col, endCol: col });
  }

  function selectTableRow(block: Block, row: number) {
    const cols = Math.max(1, ...((block.table || [['']]).map(r => r.length)));
    setSelectedCells({ blockId: block.id, startRow: row, endRow: row, startCol: 0, endCol: cols - 1 });
  }

  function startTableColumnResize(block: Block, colIndex: number, e: ReactMouseEvent<HTMLSpanElement>) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const currentWidths = [...(block.tableColWidths || [])];
    const startWidth = currentWidths[colIndex] || (e.currentTarget.parentElement?.offsetWidth || 160);
    const table = e.currentTarget.closest('table') as HTMLTableElement | null;
    const col = table?.querySelectorAll('col')[colIndex] as HTMLTableColElement | undefined;
    const onMove = (move: MouseEvent) => {
      const next = Math.max(90, Math.min(520, startWidth + (move.clientX - startX)));
      if (col) col.style.width = `${next}px`;
    };
    const onUp = async (up: MouseEvent) => {
      const next = Math.max(90, Math.min(520, startWidth + (up.clientX - startX)));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const widths = [...(block.tableColWidths || [])];
      widths[colIndex] = next;
      await updateBlock(block.id, { tableColWidths: widths });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
  function numberFor(block: Block, index: number) {
    if (block.type !== 'numbered') return index + 1;
    return blockNumberById.get(block.id) || 1;
  }
  async function resetNumbering(block: Block) { await updateBlock(block.id, { numberedStart: 1 }); }
  async function continueNumbering(block: Block) { await updateBlock(block.id, { numberedStart: undefined as any }); }

  async function adjustListLevel(block: Block, delta: number) {
    if (!['bullet','numbered'].includes(block.type)) return;
    const nextLevel = Math.max(0, Math.min(3, ((block as any).listLevel || 0) + delta));
    await updateBlock(block.id, { listLevel: nextLevel } as any);
    focusBlock(block.id);
  }

  async function continueAfter(block: Block) {
    // Notion-like continuation: Enter creates a new block with the same block style and focuses it.
    // Empty list/task/toggle blocks fall back to a normal paragraph.
    const plain = (block.text || '').replace(/<[^>]*>/g, '').trim();
    const shouldReset = ['bullet','numbered','todo','toggle'].includes(block.type) && plain.length === 0;
    const id = await addBlock(block.sort, shouldReset ? 'paragraph' : block.type);
    if (block.type === 'numbered' && !shouldReset) {
      const next = blocks.find(b => b.id === id);
      if (next) await db.blocks.update(id, { numberedStart: undefined as any });
    }
  }

  async function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ordered = [...blocks];
    const from = ordered.findIndex(b => b.id === dragId);
    const to = ordered.findIndex(b => b.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    await Promise.all(ordered.map((b, i) => db.blocks.update(b.id, { sort: i + 1, updatedAt: now() })));
    setDragId(null); setDragOverId(null); await touchPage(); load();
  }

  function looksLikeImageUrl(value: string) {
    return /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(value.trim()) || value.trim().startsWith('data:image/');
  }

  function startImageResize(block: Block, e: ReactMouseEvent<HTMLSpanElement>, direction: string = 'se') {
    e.preventDefault();
    e.stopPropagation();
    const frame = (e.currentTarget.closest('.image-resize-frame') as HTMLElement | null);
    const startX = e.clientX;
    const startWidth = frame?.offsetWidth || block.imageWidth || 360;
    const maxWidth = frame?.parentElement?.clientWidth || 980;
    const isWest = direction.includes('w');
    const onMove = (move: MouseEvent) => {
      const delta = move.clientX - startX;
      const next = Math.max(120, Math.min(maxWidth, startWidth + (isWest ? -delta : delta)));
      if (frame) frame.style.width = `${next}px`;
    };
    const onUp = async (up: MouseEvent) => {
      const delta = up.clientX - startX;
      const next = Math.max(120, Math.min(maxWidth, startWidth + (isWest ? -delta : delta)));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      await updateBlock(block.id, { imageWidth: next });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  async function pasteImageInto(block: Block, src: string) {
    const imageSrc = await compressImageDataUrl(src);
    const plain = (block.text || '').replace(/<[^>]*>/g, '').trim();
    if (!plain && block.type === 'paragraph') {
      await updateBlock(block.id, { type: 'image', text: imageSrc, imageWidth: 420 } as any);
      setSelectedImageId(block.id);
      setImageEditorHidden(prev => ({ ...prev, [block.id]: true }));
      return;
    }
    const sort = block.sort + 0.5;
    const imageBlock: Block = { id: uid(), pageId, type: 'image', text: imageSrc, sort, imageWidth: 420, createdAt: now(), updatedAt: now() } as any;
    await db.blocks.add(imageBlock);
    await resequence();
    await touchPage();
    await load();
    setSelectedImageId(imageBlock.id);
    setImageEditorHidden(prev => ({ ...prev, [imageBlock.id]: true }));
  }



  function escapeHtml(value: string) {
    return (value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
  }

  function highlightInlineCode(text: string, language?: string) {
    const lang = (language || '').toLowerCase();
    let escaped = escapeHtml(text || '');
    // noteX v1.7.002: apply syntax spans only to plain text segments.
    // This prevents later regex passes from coloring inside generated
    // <span class="tok-*"> markup, which previously leaked strings such as
    // class="tok-number" into the visible PHP code.
    const applyOutsideTokenSpans = (html: string, regex: RegExp, cls: string) => {
      const parts = html.split(/(<span class="tok-[^"]+">[\s\S]*?<\/span>)/g);
      return parts.map(part => part.startsWith('<span class="tok-') ? part : part.replace(regex, `<span class="${cls}">$1</span>`)).join('');
    };
    const wrap = (regex: RegExp, cls: string) => { escaped = applyOutsideTokenSpans(escaped, regex, cls); };
    wrap(/(&quot;(?:\\.|[^&])*?&quot;|'(?:\\.|[^'])*?'|`(?:\\.|[^`])*?`)/g, 'tok-string');
    wrap(/(\/\/.*?$|#.*?$|--.*?$|\/\*[\s\S]*?\*\/)/gm, 'tok-comment');
    wrap(/\b(\d+(?:\.\d+)?)\b/g, 'tok-number');
    if (/javascript|typescript|jsx|tsx/.test(lang)) {
      wrap(/\b(import|from|export|default|const|let|var|function|return|class|extends|new|if|else|for|while|switch|case|break|continue|try|catch|finally|async|await|interface|type|implements|public|private|protected|true|false|null|undefined)\b/g, 'tok-keyword');
      wrap(/\b(console|Promise|Array|Object|String|Number|Boolean|React|useState|useEffect)\b/g, 'tok-builtins');
    } else if (/python/.test(lang)) {
      wrap(/\b(def|class|import|from|as|return|if|elif|else|for|while|try|except|finally|with|lambda|yield|async|await|True|False|None|self|pass|raise|global|nonlocal|in|is|not|and|or)\b/g, 'tok-keyword');
    } else if (/java|kotlin|swift|c\+\+|c#|\bc\b|go|rust|dart/.test(lang)) {
      wrap(/\b(public|private|protected|static|final|class|interface|enum|struct|func|function|fn|let|var|const|return|if|else|for|while|switch|case|break|continue|new|void|int|float|double|string|char|long|short|bool|boolean|true|false|null|nil|package|import|using|namespace|impl|trait|mut|defer|go|select|chan)\b/g, 'tok-keyword');
    } else if (/html|xml/.test(lang)) {
      wrap(/(&lt;\/?[\w:-]+|\/??&gt;)/g, 'tok-keyword');
      wrap(/\b([\w:-]+)(=)/g, 'tok-attr');
    } else if (/css|scss|sass/.test(lang)) {
      wrap(/([^{}\n]+)(?=\s*\{)/g, 'tok-selector');
      wrap(/\b([a-z-]+)(\s*:)/g, 'tok-attr');
      wrap(/(!important|@media|@keyframes|@import|@supports|from|to)\b/g, 'tok-keyword');
    } else if (/json|jsonc/.test(lang)) {
      wrap(/(&quot;[^&]*?&quot;)(\s*:)/g, 'tok-yaml-key');
      wrap(/\b(true|false|null)\b/g, 'tok-keyword');
    } else if (/php|perl|ruby|lua|elixir|erlang/.test(lang)) {
      wrap(/\b(function|class|def|end|module|use|my|our|sub|return|if|elsif|else|unless|while|for|foreach|do|begin|rescue|ensure|require|include|private|protected|public|true|false|null|nil|self|local)\b/g, 'tok-keyword');
      wrap(/(\$[A-Za-z_][A-Za-z0-9_]*)/g, 'tok-variable');
    } else if (/sql/.test(lang)) {
      wrap(/\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|GROUP|ORDER|BY|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TABLE|INDEX|AND|OR|NOT|NULL|VALUES|INTO|SET|LIMIT|HAVING|COUNT|SUM|AVG|MIN|MAX)\b/gi, 'tok-keyword');
    } else if (/bash|shell|zsh|fish|powershell|batch|dockerfile|nginx|apache|terraform|hcl|ansible|ini|toml|properties|makefile|cmake|gradle|groovy|log|diff|regexp|regular/.test(lang)) {
      wrap(/\b(sudo|apt|yum|dnf|systemctl|docker|kubectl|grep|awk|sed|cat|echo|export|FROM|RUN|COPY|CMD|ENTRYPOINT|resource|provider|variable|hosts|tasks|server|location|listen|proxy_pass|ERROR|WARN|INFO|DEBUG)\b/g, 'tok-keyword');
    }
    return escaped;
  }

  function highlightYaml(text: string) {
    return (text || '').split('\n').map((line) => {
      const raw = line || '';
      const leading = (raw.match(/^\s*/) || [''])[0];
      const trimmed = raw.slice(leading.length);
      const listMatch = trimmed.match(/^(-\s+)(.*)$/);
      const marker = listMatch ? `<span class="tok-muted">${escapeHtml(listMatch[1])}</span>` : '';
      const body = listMatch ? listMatch[2] : trimmed;
      const keyMatch = body.match(/^([A-Za-z0-9_.\/-]+)(\s*:\s*)(.*)$/);
      if (keyMatch) {
        const [, key, colon, rest] = keyMatch;
        let value = escapeHtml(rest || '');
        value = value.replace(/(&quot;.*?&quot;|'.*?')/g, '<span class="tok-string">$1</span>');
        value = value.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
        value = value.replace(/\b(true|false|null)\b/g, '<span class="tok-keyword">$1</span>');
        return `${escapeHtml(leading)}${marker}<span class="tok-yaml-key">${escapeHtml(key)}</span><span class="tok-muted">${escapeHtml(colon)}</span>${value}`;
      }
      let escapedBody = escapeHtml(body);
      escapedBody = escapedBody.replace(/(&quot;.*?&quot;|'.*?')/g, '<span class="tok-string">$1</span>');
      escapedBody = escapedBody.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
      return `${escapeHtml(leading)}${marker}${escapedBody}`;
    }).join('\n');
  }

  function highlightCode(text: string, language?: string) {
    const lang = (language || '').toLowerCase();
    if (/yaml|yml|ansible|kubernetes|k8s/.test(lang)) return highlightYaml(text || '');
    return highlightInlineCode(text || '', language);
  }

  function beginBlockRangeSelection(blockId: string, e: ReactMouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (target?.closest('textarea, [contenteditable="true"], input, button, table, .code-hover-toolbar')) return;
    if (e.button !== 0) return;
    setIsBlockSelecting(true);
    setBlockSelectionStart(blockId);
    setSelectedBlockIds([blockId]);
  }

  function extendBlockRangeSelection(blockId: string) {
    if (!isBlockSelecting || !blockSelectionStart) return;
    const start = blockIndexById.get(blockSelectionStart) ?? -1;
    const end = blockIndexById.get(blockId) ?? -1;
    if (start < 0 || end < 0) return;
    const lo = Math.min(start, end), hi = Math.max(start, end);
    setSelectedBlockIds(blocks.slice(lo, hi + 1).map(b => b.id));
  }

  async function copyBlockLink(block: Block) {
    const url = `${window.location.origin}${window.location.pathname}#block-${block.id}`;
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
    else {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.left = '-99999px';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }
    setCodeCopyToast({ blockId: block.id, message: 'Block link copied' });
    window.setTimeout(() => setCodeCopyToast(prev => prev?.blockId === block.id ? null : prev), 1300);
    setCodeMoreFor(null);
    setCodeLangFor(null);
    setCodeTurnFor(null);
  }

  async function copyCodeBlock(block: Block) {
    const text = block.text || '';
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-99999px';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }
    setCodeCopyToast({ blockId: block.id, message: 'Code copied' });
    window.setTimeout(() => setCodeCopyToast(prev => prev?.blockId === block.id ? null : prev), 1300);
    setCodeMoreFor(null);
    setCodeLangFor(null);
    setCodeTurnFor(null);
  }

  async function setCodeLanguage(block: Block, language: string) {
    // Force the stable contenteditable code editor to re-render highlighted HTML after language changes.
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest?.('.notex-code-editor')) active.blur();
    await updateBlock(block.id, { codeLanguage: language } as any);
    setCodeLangFor(null);
    setCodeMoreFor(null);
    setCodeTurnFor(null);
  }

  function codeLineNumbers(text: string) {
    const count = Math.max(1, (text || '').split('\n').length);
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  function openCodeMore(blockId: string, e?: ReactMouseEvent<HTMLButtonElement>) {
    e?.preventDefault();
    e?.stopPropagation();
    setCodeMoreFor(codeMoreFor === blockId ? null : blockId);
    setCodeLangFor(null);
    setCodeTurnFor(null);
  }

  async function toggleCodeWrap(block: Block) {
    await updateBlock(block.id, { codeWrap: !(block as any).codeWrap } as any);
    setCodeMoreFor(null);
    setCodeTurnFor(null);
  }


  function renderEquationPreview(input: string) {
    const raw = escapePlainTextHtml((input || '').trim() || 'E = mc^2');
    const pretty = raw
      .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1) ⁄ ($2)')
      .replace(/\\sqrt\{([^{}]+)\}/g, '√($1)')
      .replace(/\\sum/g, '∑')
      .replace(/\\int/g, '∫')
      .replace(/\\alpha/g, 'α').replace(/\\beta/g, 'β').replace(/\\gamma/g, 'γ').replace(/\\delta/g, 'δ')
      .replace(/\\lambda/g, 'λ').replace(/\\mu/g, 'μ').replace(/\\pi/g, 'π').replace(/\\theta/g, 'θ')
      .replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>')
      .replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>')
      .replace(/\^(\w)/g, '<sup>$1</sup>')
      .replace(/_(\w)/g, '<sub>$1</sub>');
    return pretty;
  }

  function renderMath(block: Block) {
    return <div className="block block-math math-block">
      <AutoResizeTextarea className="math-input" value={block.text || ''} placeholder="Type LaTeX equation, e.g. \\frac{a}{b} + x^2" onChange={e => updateBlock(block.id, { text: e.target.value })} />
      <div className="math-preview" dangerouslySetInnerHTML={{ __html: renderEquationPreview(block.text || '') }} />
      <div className="math-hint">LaTeX-style equation block. Inline formula: select text and click √x in the toolbar.</div>
    </div>;
  }

  function readFileAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function formatBytes(size = 0) {
    if (!size) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
    return `${(size / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
  }


  function fileKind(fileName = '', fileType = '') {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (fileType.includes('pdf') || ext === 'pdf') return { label: 'PDF', cls: 'pdf' };
    if (/word|document/.test(fileType) || ['doc','docx','rtf'].includes(ext)) return { label: 'DOC', cls: 'doc' };
    if (/excel|spreadsheet|sheet/.test(fileType) || ['xls','xlsx','csv'].includes(ext)) return { label: ext === 'csv' ? 'CSV' : 'XLS', cls: 'xls' };
    if (/powerpoint|presentation/.test(fileType) || ['ppt','pptx'].includes(ext)) return { label: 'PPT', cls: 'ppt' };
    if (fileType.startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg'].includes(ext)) return { label: 'IMG', cls: 'img' };
    if (fileType.startsWith('audio/') || ['mp3','wav','m4a','aac','flac'].includes(ext)) return { label: 'AUD', cls: 'aud' };
    if (fileType.startsWith('video/') || ['mp4','mov','mkv','webm'].includes(ext)) return { label: 'VID', cls: 'vid' };
    if (['zip','tar','gz','rar','7z'].includes(ext)) return { label: 'ZIP', cls: 'zip' };
    if (['txt','md','json','yaml','yml','xml','html','css','js','ts','py','sh'].includes(ext)) return { label: ext.toUpperCase().slice(0, 4), cls: 'code' };
    return { label: 'FILE', cls: 'file' };
  }


  function friendlyFileType(fileName = '', fileType = '') {
    const kind = fileKind(fileName, fileType);
    const ext = fileName.split('.').pop()?.toUpperCase() || '';
    const map: Record<string, string> = {
      pdf: 'PDF document',
      doc: 'Word document',
      xls: ext === 'CSV' ? 'CSV file' : 'Spreadsheet',
      ppt: 'Presentation',
      img: 'Image',
      aud: 'Audio',
      vid: 'Video',
      zip: 'Archive',
      code: ext ? `${ext} file` : 'Code/text file',
      file: ext ? `${ext} file` : 'Document'
    };
    return map[kind.cls] || 'Document';
  }

  function fileMetaFromBlock(block: Block) {
    const files = ((block as any).files || []) as Array<{ name: string; type: string; size: number; dataUrl: string; thumbnail?: string }>;
    if (files.length) return files;
    const fileName = (block as any).fileName || '';
    if (!fileName) return [];
    return [{ name: fileName, type: (block as any).fileType || 'application/octet-stream', size: (block as any).fileSize || 0, dataUrl: block.text || '', thumbnail: (block as any).thumbnail || '' }];
  }

  function plainTextFromHtml(html = '') {
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || div.innerText || '').trim();
  }

  function isVideoFile(fileName = '', fileType = '') {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return fileType.startsWith('video/') || ['mp4','mov','m4v','webm','mkv','avi'].includes(ext);
  }

  function makeVideoThumbnail(file: File) {
    return new Promise<string>((resolve) => {
      if (!isVideoFile(file.name, file.type)) { resolve(''); return; }
      const objectUrl = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      const cleanup = () => URL.revokeObjectURL(objectUrl);
      const finish = (value = '') => { cleanup(); resolve(value); };
      const drawFrame = () => {
        try {
          const width = video.videoWidth || 640;
          const height = video.videoHeight || 360;
          const maxWidth = 640;
          const scale = Math.min(1, maxWidth / width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) { finish(''); return; }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL('image/jpeg', 0.72));
        } catch {
          finish('');
        }
      };
      video.onloadedmetadata = () => {
        try {
          const targetTime = Number.isFinite(video.duration) && video.duration > 1 ? Math.min(1, video.duration / 4) : 0;
          video.currentTime = targetTime;
        } catch { drawFrame(); }
      };
      video.onseeked = drawFrame;
      video.onerror = () => finish('');
      window.setTimeout(() => finish(''), 5000);
      video.src = objectUrl;
    });
  }

  function compressImageDataUrl(src: string, maxSide = 1600, quality = 0.82) {
    return new Promise<string>((resolve) => {
      if (!src.startsWith('data:image/')) { resolve(src); return; }
      const img = new window.Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSide / Math.max(img.width || maxSide, img.height || maxSide));
          if (scale >= 1 && src.length < 1400000) { resolve(src); return; }
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round((img.width || maxSide) * scale));
          canvas.height = Math.max(1, Math.round((img.height || maxSide) * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(src); return; }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch { resolve(src); }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });
  }

  async function uploadImageFile(block: Block, file?: File | null) {
    if (!file || !file.type.startsWith('image/')) return;
    const maxImageSize = 8 * 1024 * 1024;
    if (file.size > maxImageSize) {
      alert(`This image is ${formatBytes(file.size)}. Please insert images up to ${formatBytes(maxImageSize)} to avoid heavy browser memory usage.`);
      return;
    }
    const original = await readFileAsDataUrl(file);
    const dataUrl = await compressImageDataUrl(original);
    await updateBlock(block.id, { text: dataUrl, fileName: file.name, fileType: file.type, fileSize: file.size } as any);
    setImageEditorHidden(prev => ({ ...prev, [block.id]: true }));
  }

  async function filePayloadFromFile(file: File) {
    const dataUrl = await readFileAsDataUrl(file);
    const thumbnail = await makeVideoThumbnail(file);
    return { name: file.name, type: file.type || 'application/octet-stream', size: file.size, dataUrl, thumbnail };
  }

  async function uploadDocumentFile(block: Block, file?: File | null) {
    if (!file) return;
    const maxSize = 12 * 1024 * 1024;
    if (file.size > maxSize) {
      alert(`This file is ${formatBytes(file.size)}. Please attach files up to ${formatBytes(maxSize)} to avoid heavy browser memory usage.`);
      return;
    }
    const payload = await filePayloadFromFile(file);
    await updateBlock(block.id, { text: payload.dataUrl, fileName: payload.name, fileType: payload.type, fileSize: payload.size, thumbnail: payload.thumbnail } as any);
  }

  async function createFileBlockFromFile(file: File, afterSort?: number, shouldReload = true) {
    if (file.type.startsWith('image/')) {
      const maxImageSize = 8 * 1024 * 1024;
      if (file.size > maxImageSize) {
        alert(`This image is ${formatBytes(file.size)}. Please insert images up to ${formatBytes(maxImageSize)} to avoid heavy browser memory usage.`);
        return;
      }
      const original = await readFileAsDataUrl(file);
      const imageSrc = await compressImageDataUrl(original);
      const sort = afterSort ? afterSort + 0.5 : (blocks.at(-1)?.sort || 0) + 1;
      await db.blocks.add({ id: uid(), pageId, type: 'image', text: imageSrc, sort, imageWidth: 420, fileName: file.name, fileType: file.type, fileSize: file.size, createdAt: now(), updatedAt: now() } as any);
      if (shouldReload) { await resequence(); await touchPage(); await load(); }
      return;
    }
    const maxSize = 12 * 1024 * 1024;
    if (file.size > maxSize) {
      alert(`This file is ${formatBytes(file.size)}. Please attach files up to ${formatBytes(maxSize)} to avoid heavy browser memory usage.`);
      return;
    }
    const payload = await filePayloadFromFile(file);
    const sort = afterSort ? afterSort + 0.5 : (blocks.at(-1)?.sort || 0) + 1;
    await db.blocks.add({ id: uid(), pageId, type: 'file', text: payload.dataUrl, sort, fileName: payload.name, fileType: payload.type, fileSize: payload.size, thumbnail: payload.thumbnail, createdAt: now(), updatedAt: now() } as any);
    if (shouldReload) { await resequence(); await touchPage(); await load(); }
  }

  async function createFileGroupFromFiles(files: File[], afterSort?: number) {
    const docs = files.filter(file => !file.type.startsWith('image/'));
    const images = files.filter(file => file.type.startsWith('image/'));
    let inserted = false;
    if (docs.length > 1) {
      const maxSize = 12 * 1024 * 1024;
      const tooLarge = docs.find(file => file.size > maxSize);
      if (tooLarge) {
        alert(`${tooLarge.name} is ${formatBytes(tooLarge.size)}. Please attach files up to ${formatBytes(maxSize)} to avoid heavy browser memory usage.`);
        return;
      }
      const payload = await Promise.all(docs.map(filePayloadFromFile));
      const sort = afterSort ? afterSort + 0.5 : (blocks.at(-1)?.sort || 0) + 1;
      await db.blocks.add({ id: uid(), pageId, type: 'file', text: '', sort, files: payload, fileName: `${payload.length} files`, fileType: 'notex/file-group', fileSize: payload.reduce((sum, item) => sum + (item.size || 0), 0), createdAt: now(), updatedAt: now() } as any);
      inserted = true;
    } else if (docs.length === 1) {
      await createFileBlockFromFile(docs[0], afterSort, false);
      inserted = true;
    }
    for (const [index, file] of images.entries()) {
      await createFileBlockFromFile(file, (afterSort ?? (blocks.at(-1)?.sort || 0)) + (docs.length ? 0.1 : 0) + index * 0.01, false);
      inserted = true;
    }
    if (inserted) { await resequence(); await touchPage(); await load(); }
  }

  async function convertBlockToFileBlock(block: Block, droppedFiles: File[]) {
    const files = droppedFiles.filter(Boolean);
    if (!files.length) return;
    const maxSize = 12 * 1024 * 1024;
    const tooLarge = files.find(file => file.size > maxSize);
    if (tooLarge) {
      alert(`${tooLarge.name} is ${formatBytes(tooLarge.size)}. Please attach files up to ${formatBytes(maxSize)} to avoid heavy browser memory usage.`);
      return;
    }
    const payload = await Promise.all(files.map(filePayloadFromFile));
    const existing = block.type === 'file' ? fileMetaFromBlock(block).filter(item => item.dataUrl) : [];
    const allFiles = [...existing, ...payload];
    const preservedCaption = (block as any).caption || (block.type === 'file' ? '' : plainTextFromHtml(block.text || ''));
    if (allFiles.length === 1) {
      const only = allFiles[0];
      await updateBlock(block.id, {
        type: 'file',
        text: only.dataUrl,
        fileName: only.name,
        fileType: only.type,
        fileSize: only.size,
        thumbnail: only.thumbnail || '',
        files: [],
        caption: preservedCaption
      } as any);
    } else {
      await updateBlock(block.id, {
        type: 'file',
        text: '',
        fileName: `${allFiles.length} files`,
        fileType: 'notex/file-group',
        fileSize: allFiles.reduce((sum, item) => sum + (item.size || 0), 0),
        files: allFiles,
        caption: preservedCaption
      } as any);
    }
    await touchPage();
    await load();
  }

  function getFilesFromDrop(e: ReactDragEvent<HTMLElement>) {
    return Array.from(e.dataTransfer?.files || []).filter(Boolean);
  }

  function renderFileBlock(block: Block) {
    const files = fileMetaFromBlock(block);
    const hasFile = files.length > 0 && files.some(item => !!item.dataUrl);
    const isGroup = files.length > 1;
    const totalSize = files.reduce((sum, item) => sum + (item.size || 0), 0);
    const removeFileAt = async (removeIndex: number) => {
      const next = files.filter((_, index) => index !== removeIndex);
      if (!next.length) {
        await updateBlock(block.id, { text: '', fileName: '', fileType: '', fileSize: 0, files: [], thumbnail: '', caption: '' } as any);
      } else if (next.length === 1) {
        const only = next[0];
        await updateBlock(block.id, { text: only.dataUrl, fileName: only.name, fileType: only.type, fileSize: only.size, thumbnail: only.thumbnail || '', files: [] } as any);
      } else {
        await updateBlock(block.id, { text: '', fileName: `${next.length} files`, fileType: 'notex/file-group', fileSize: next.reduce((sum, item) => sum + (item.size || 0), 0), files: next } as any);
      }
      await touchPage();
      await load();
    };
    return <div className={`block block-file file-block-card ${isGroup ? 'file-block-grid-mode' : ''}`} onDragOver={(e) => { if (getFilesFromDrop(e).length) e.preventDefault(); }} onDrop={(e) => { const files = getFilesFromDrop(e); if (!files.length) return; e.preventDefault(); if (files.length > 1) createFileGroupFromFiles(files, block.sort); else uploadDocumentFile(block, files[0]); }}>
      {!hasFile ? <label className="file-upload-card">
        <File size={18}/><span>Upload or drop file</span><em>PDF, Word, Excel, PowerPoint, text, archive, or other documents</em>
        <input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.json,.yaml,.yml,.zip,.tar,.gz,.mp4,.mov,.m4v,.webm,.mkv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,video/*" onChange={(e) => { const picked = Array.from(e.target.files || []); if (picked.length > 1) createFileGroupFromFiles(picked, block.sort); else uploadDocumentFile(block, picked[0]); }} />
      </label> : <>
        {isGroup && <div className="file-group-summary"><strong>{files.length} attached files</strong><span>{formatBytes(totalSize)}</span></div>}
        <div className={isGroup ? 'file-attachment-grid' : 'file-attachment-list'}>
          {files.map((item, index) => {
            const kind = fileKind(item.name, item.type);
            const isVideo = isVideoFile(item.name, item.type);
            return <div className={`file-attachment-row file-attachment-card ${isVideo ? 'video-attachment-card' : ''}`} key={`${item.name}-${index}`}>
              {isVideo ? <div className="video-attachment-thumb">
                {item.thumbnail ? <img src={item.thumbnail} alt="Video thumbnail" loading="lazy" /> : <video src={item.dataUrl} preload="metadata" muted playsInline />}
                <span className="video-play-badge">▶</span>
                <span className={`file-attachment-icon file-icon-${kind.cls}`}>{kind.label}</span>
              </div> : <span className={`file-attachment-icon file-icon-${kind.cls}`}>{kind.label}</span>}
              <span className="file-attachment-main"><strong title={item.name || 'noteX attachment'}>{item.name || 'noteX attachment'}</strong><em>{friendlyFileType(item.name, item.type)} · {formatBytes(item.size)}</em></span>
              <div className="file-card-actions"><a className="file-download-button" href={item.dataUrl} download={item.name || 'noteX attachment'}>Download</a><button className="file-item-remove" title="Remove this file" aria-label={`Remove ${item.name || 'file'}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void removeFileAt(index); }}>×</button></div>
            </div>;
          })}
        </div>
      </>}
      <input className="file-caption-input" value={(block as any).caption || ''} placeholder="Add a caption or note..." onChange={e => updateBlock(block.id, { caption: e.target.value } as any)} />
    </div>;
  }

  function renderMedia(block: Block, label: string) {
    if (block.type === 'file') return renderFileBlock(block);
    const isImage = block.type === 'image';
    const url = (block.text || '').trim();
    const hasPreview = isImage && looksLikeImageUrl(url);
    const editorHidden = imageEditorHidden[block.id] ?? url.startsWith('data:image/');
    const handles = ['nw','n','ne','e','se','s','sw','w'];
    return <div className={`block block-${block.type} media-block ${hasPreview ? 'media-block-with-preview' : ''}`}>
      {isImage && !hasPreview && <label className="image-upload-card">
        <Image size={18}/><span>Upload image</span><em>Choose a file from this device</em>
        <input type="file" accept="image/*" onChange={(e) => uploadImageFile(block, e.target.files?.[0])} />
      </label>}
      {hasPreview && <div
        className={`image-resize-frame ${selectedImageId === block.id ? 'selected' : ''}`}
        style={{ width: block.imageWidth ? `${block.imageWidth}px` : 'min(520px, 100%)' }}
        onMouseDown={(e) => { e.stopPropagation(); setSelectedImageId(block.id); }}
      >
        <img src={url} alt={(block as any).caption || label} draggable={false} loading="lazy" decoding="async" />
        {selectedImageId === block.id && handles.map(h => <span key={h} className={`image-resize-handle image-resize-handle-${h}`} onMouseDown={(e) => startImageResize(block, e, h)} />)}
      </div>}
      {isImage && hasPreview && <input className="image-caption-input" value={(block as any).caption || ''} placeholder="Add a caption..." onChange={e => updateBlock(block.id, { caption: e.target.value } as any)} />}
      {hasPreview && !editorHidden && <div className="image-url-card">
        <a href={url} target="_blank" rel="noreferrer" className="image-url-link">{url.startsWith('data:') ? 'Uploaded image data' : url}</a>
        <button className="image-url-close" title="Hide image link editor" onClick={() => setImageEditorHidden(prev => ({ ...prev, [block.id]: true }))}><XCircle size={13}/></button>
        <AutoResizeTextarea value={block.text} placeholder={`${label} URL or description`} onChange={e => updateBlock(block.id, { text: e.target.value })} />
      </div>}
      {(!hasPreview || !editorHidden) && !hasPreview && !isImage && <AutoResizeTextarea className="image-placeholder-input" value={block.text} placeholder={`${label} URL or description`} onChange={e => updateBlock(block.id, { text: e.target.value })} />}
      {isImage && !hasPreview && <AutoResizeTextarea className="image-placeholder-input" value={block.text} placeholder="Or paste an image URL" onChange={e => updateBlock(block.id, { text: e.target.value })} />}
      {hasPreview && editorHidden && selectedImageId === block.id && <button className="image-show-url" onClick={() => setImageEditorHidden(prev => ({ ...prev, [block.id]: false }))}>Show image link</button>}
    </div>;
  }

  return <div className="editor" onMouseDown={(e) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select, textarea, [contenteditable='true'], .rich-editable, .format-toolbar, .table-cell-menu, .code-more-popover, .code-language-popover, .code-hover-toolbar")) return;
    if (e.button !== 0) return;
    blockDragRef.current = { active: true, startY: e.clientY, startX: e.clientX, moved: false, startedInsideEditor: true };
  }} onMouseMove={(e) => {
    const drag = blockDragRef.current;
    if (!drag.active) return;
    const movedEnough = Math.abs(e.clientY - drag.startY) > 8 || Math.abs(e.clientX - drag.startX) > 18;
    if (!movedEnough) return;
    drag.moved = true;
    selectBlocksFromDrag(drag.startY, e.clientY);
  }} onMouseUp={(e) => {
    setIsBlockSelecting(false);
    setBlockSelectionStart(null);
    const drag = blockDragRef.current;
    if (drag.active && drag.moved) {
      const ids = selectBlocksFromDrag(drag.startY, e.clientY);
      if (ids.length < 2) syncNativeBlockSelection();
    } else syncNativeBlockSelection();
    blockDragRef.current = { active: false, startY: 0, startX: 0, moved: false, startedInsideEditor: false };
  }} onDragOver={(e) => { if (e.dataTransfer.types.includes('application/notex-page-id') || getFilesFromDrop(e).length) e.preventDefault(); }} onDrop={(e) => {
    const files = getFilesFromDrop(e);
    if (files.length) {
      e.preventDefault();
      const targetBlockId = (e.target as HTMLElement | null)?.closest('.block-wrap[data-block-id]')?.getAttribute('data-block-id');
      const targetBlock = blocks.find(b => b.id === targetBlockId);
      if (targetBlock) void convertBlockToFileBlock(targetBlock, files);
      else void createFileGroupFromFiles(files, blocks.at(-1)?.sort ?? 0);
      return;
    }
    const pid = e.dataTransfer.getData('application/notex-page-id');
    if (pid) { e.preventDefault(); insertPageLinkBlock(pid); }
  }}>
    {blocks.map((block, index) => <div className={blockWrapClass(block, index)} key={block.id} id={`block-${block.id}`} data-block-id={block.id} draggable={false}
      onMouseDown={(e) => beginBlockRangeSelection(block.id, e)}
      onMouseEnter={() => extendBlockRangeSelection(block.id)}
      onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) { e.preventDefault(); setSelectedBlockIds(prev => prev.includes(block.id) ? prev.filter(id => id !== block.id) : [...prev, block.id]); } }}
      onContextMenu={() => { /* text context menu is handled by the inline selection toolbar */ }}
      onDragOver={e => { if (getFilesFromDrop(e).length) { e.preventDefault(); setDragOverId(block.id); return; } e.preventDefault(); if (dragId && dragId !== block.id) setDragOverId(block.id); }} onDragEnter={(e) => { if (getFilesFromDrop(e).length) { setDragOverId(block.id); return; } if (dragId && dragId !== block.id) setDragOverId(block.id); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverId(null); }} onDrop={(e) => { const files = getFilesFromDrop(e); if (files.length) { e.preventDefault(); e.stopPropagation(); setDragOverId(null); void convertBlockToFileBlock(block, files); return; } const pid = e.dataTransfer.getData('application/notex-page-id'); if (pid) { e.preventDefault(); insertPageLinkBlock(pid, block.sort); } else dropOn(block.id); }}>
      <div className="block-actions simple">
        <button className="drag-handle" title="Drag block" draggable onDragStart={() => setDragId(block.id)} onDragEnd={() => setDragId(null)}><GripVertical size={14}/></button>
        <button title="Add block below" onClick={() => addBlock(block.sort)}><Plus size={14}/></button>
      </div>
      <div className="block-right-actions" onMouseDown={e => e.stopPropagation()}>
        <button className="block-copy-right" title="Copy block" onClick={() => copySingleBlock(block)}><Copy size={13}/></button>
        <button className="block-delete-right" title="Delete block" onClick={() => deleteBlock(block.id)}><X size={13}/></button>
      </div>
      {menuFor === block.id && <SlashMenu query={slashQuery} selectedIndex={slashActiveIndex} customTemplates={customTemplates} style={slashPos ? { position: 'fixed', left: slashPos.left, top: slashPos.top, maxHeight: slashPos.maxHeight } : undefined} onPick={(item) => applySlashItem(block.id, item)} />}
      {formatFor === block.id && createPortal(<div className="format-toolbar two-row-toolbar" style={{ left: formatPos?.left ?? 0, top: formatPos?.top ?? 0 }} onMouseDown={e => e.stopPropagation()}>
        <div className="format-row">
          <button title="Turn to" onClick={(e) => { e.preventDefault(); setTurnMenuFor(turnMenuFor === block.id ? null : block.id); setColorMenuFor(null); setFormatMoreFor(null); }}><Type size={14}/></button>
          <button title="Copy selected text" onClick={(e) => { e.preventDefault(); copyCurrentTextSelection(); }}><Copy size={14}/></button>
          <button className="format-text-color-btn" title="Text color" onClick={(e) => { e.preventDefault(); setColorMenuFor(colorMenuFor === block.id ? null : block.id); setTurnMenuFor(null); setFormatMoreFor(null); }}><span>A</span></button>
          <button className="format-bold-btn" title="Bold" onClick={() => execFormat('bold')}><Bold size={14}/></button>
          <button title="Italic" onClick={() => execFormat('italic')}><Italic size={14}/></button>
          <button title="Underline" onClick={() => execFormat('underline')}><Underline size={14}/></button>
          <button title="Strike-through" onClick={() => execFormat('strikeThrough')}><Strikethrough size={14}/></button>
        </div>
        <div className="format-row">
          <button title="Undo" onClick={() => document.execCommand('undo')}><span className="format-symbol">↶</span></button>
          <button title="Redo" onClick={() => document.execCommand('redo')}><span className="format-symbol">↷</span></button>
          <button title="Remove formatting" onClick={() => execFormat('removeFormat')}><span className="format-symbol paste-clean-symbol">⌧</span></button>
          <button title="Add link" onMouseDown={e => e.preventDefault()} onClick={() => openLinkModal(block.id)}><Link size={14}/></button>
          <button title="Mark as code" onClick={() => execFormat('formatBlock', 'pre')}><Code2 size={14}/></button>
          <button title="Mark as equation" onClick={() => execFormat('insertText', '√x')}><span className="format-symbol equation-symbol">√x</span></button>
          <button title="More" onClick={(e) => { e.preventDefault(); setFormatMoreFor(formatMoreFor === block.id ? null : block.id); setTurnMenuFor(null); setColorMenuFor(null); }}><MoreHorizontal size={14}/></button>
        </div>
        {colorMenuFor === block.id && <div className="text-color-popover">
          <div className="color-pop-title">Text color</div>
          <div className="color-grid">{['#2f3338','#737373','#9a6a4f','#d9730d','#cb912f','#448361','#337ea9','#9065b0','#c14c8a','#d44c47'].map(c => <button key={c} title={c} onClick={() => { execFormat('foreColor', c); setColorMenuFor(null); }}><span style={{ color: c }}>A</span></button>)}</div>
          <div className="color-pop-title">Background color</div>
          <div className="color-grid">{['#ffffff','#f1f1ef','#f4eeee','#fbecdd','#fbf3db','#edf3ec','#e7f3f8','#f6f0f8','#faedf3','#fdebec'].map(c => <button key={c} title={c} onClick={() => { execFormat('hiliteColor', c); setColorMenuFor(null); }}><span style={{ background: c }}>A</span></button>)}</div>
        </div>}
        {formatMoreFor === block.id && <div className="format-more-popover">
          <button onClick={() => { duplicateBlock(block.id); setFormatMoreFor(null); setFormatFor(null); }}><Copy size={13}/><span>Duplicate</span></button>
          {block.type === 'numbered' && <button onClick={() => { resetNumbering(block); setFormatMoreFor(null); setFormatFor(null); }}><ListOrdered size={13}/><span>Restart Numbering at 1</span></button>}
          {block.type === 'numbered' && <button onClick={() => { continueNumbering(block); setFormatMoreFor(null); setFormatFor(null); }}><ListOrdered size={13}/><span>Continue Numbering</span></button>}
          <button className="template-action" onClick={() => { void saveBlockAsCustomTemplate(block); }}><Bookmark size={13}/><span>{selectedBlockIds.length > 1 && selectedBlockIds.includes(block.id) ? 'Save Selected as Template' : 'Save as Template'}</span></button>
          <button className="danger" onClick={() => { deleteBlock(block.id); setFormatMoreFor(null); setFormatFor(null); }}><Trash2 size={13}/><span>Delete</span></button>
        </div>}
        {turnMenuFor === block.id && <div className="turn-to-menu">
          <div className="turn-title">Turn into</div>
          {block.type === 'numbered' && <><button onClick={() => resetNumbering(block)}><ListOrdered size={14}/><span>Restart numbering at 1</span></button><button onClick={() => continueNumbering(block)}><ListOrdered size={14}/><span>Continue previous numbering</span></button><div className="turn-divider" /></>}
          {[
            ['paragraph','Text', Type], ['h1','Heading 1', Heading1], ['h2','Heading 2', Heading2], ['h3','Heading 3', Heading3], ['h4','Heading 4', Heading4],
            ['bullet','Bullet list', List], ['numbered','Numbered list', ListOrdered], ['todo','To-do', CheckSquare], ['quote','Quote', Quote], ['math','Equation', Type], ['code','Code', Code2], ['command','Command', TerminalSquare]
          ].map(([type, label, Icon]: any) => <button key={type} onClick={() => { convert(block.id, type); setTurnMenuFor(null); setFormatFor(null); }}><Icon size={14}/><span>{label}</span></button>)}
        </div>}
      </div>, document.body)}
      {block.type === 'divider' ? <hr /> : block.type === 'table' ? <div className="table-block-shell">
        <table className={`mini-table resizable-table selectable-table ${(block as any).tableHasHeader !== false ? 'has-header-row' : ''}`}>
          <colgroup>{(block.table || [['','',''],['','',''],['','','']])[0]?.map((_, c) => <col key={c} style={{ width: (block.tableColWidths?.[c] || 160) }} />)}</colgroup>
          <tbody>{(block.table || [['','',''],['','',''],['','','']]).map((row, r) => <tr key={r} className={`${r === 0 && (block as any).tableHasHeader !== false ? 'table-header-row' : ''}`}>{row.map((cell, c) => <td
            key={c}
            style={{ background: block.tableCellColors?.[`${r}:${c}`] || undefined }}
            className={`${selectedCellClass(block.id, r, c)} ${c === row.length - 1 ? 'last-col-cell' : ''}`}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              const target = e.target as HTMLElement;
              if (target.closest('.table-cell-editable')) return;
              setTableMenu(null);
              setSelectedCells({ blockId: block.id, startRow: r, startCol: c, endRow: r, endCol: c });
            }}
            onMouseEnter={(e) => { if (e.buttons === 1 && selectedCells?.blockId === block.id) setSelectedCells({ ...selectedCells, endRow: r, endCol: c }); }}
            onContextMenu={(e) => {
              setSelectedCells({ blockId: block.id, startRow: r, startCol: c, endRow: r, endCol: c });
              openTableMenuAt(e, block, r, c);
            }}
          >
            {r === 0 && <button
              className="table-col-select-handle"
              title="Select column"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); selectTableColumn(block, c); }}
              onContextMenu={(e) => { selectTableColumn(block, c); openTableMenuAt(e, block, r, c); }}
            />}
            {c === 0 && <button
              className="table-row-select-handle"
              title="Select row"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); selectTableRow(block, r); }}
              onContextMenu={(e) => { selectTableRow(block, r); openTableMenuAt(e, block, r, c); }}
            />}
            <TableCellEditable html={cell} onHTMLChange={(html) => updateTable(block, r, c, html)} onFocusCell={() => setSelectedCells({ blockId: block.id, startRow: r, startCol: c, endRow: r, endCol: c })} onOpenMenu={(e) => { setSelectedCells({ blockId: block.id, startRow: r, startCol: c, endRow: r, endCol: c }); openTableMenuAt(e, block, r, c); }} />
            {r === 0 && c === row.length - 1 && <button className="table-delete-inline" title="Delete table" onMouseDown={e => e.stopPropagation()} onClick={() => deleteTable(block)}><XCircle size={12}/></button>}
            {r === 0 && <span className="table-col-resizer" onMouseDown={(e) => startTableColumnResize(block, c, e)} />}
          </td>)}</tr>)}</tbody>
        </table>
        <button className="table-add-row-hover" title="Add a new row" onMouseDown={(e) => addTableRowFromHover(block, e)}>+</button>
        <button className="table-add-col-hover" title="Add a new column" onMouseDown={(e) => addTableColFromHover(block, e)}>+</button>
        {tableMenu?.blockId === block.id && createPortal(<div className="table-cell-menu floating-popover" style={{ ['--table-menu-left' as any]: `${tableMenu.left}px`, ['--table-menu-top' as any]: `${tableMenu.top}px` }} onMouseDown={e => e.stopPropagation()}>
          <label><span className="table-menu-search-icon">⌕</span><input placeholder="Search actions..." /></label>
          <button onClick={() => toggleHeaderRow(block)}><Table2 size={15}/><span>Header Row</span><kbd>{(block as any).tableHasHeader === false ? 'Off' : 'On'}</kbd></button>
          <div className="table-color-row"><Paintbrush size={14}/><span>Color</span><button onClick={() => setSelectedCellColor(block, '#f7f7f7')}>Gray</button><button onClick={() => setSelectedCellColor(block, '#fff7d6')}>Yellow</button><button onClick={() => setSelectedCellColor(block, '#e8f2ff')}>Blue</button></div>
          <button onClick={() => insertTableColumn(block, tableMenu.col, 'left')}><ArrowLeft size={15}/><span>Insert left</span></button>
          <button onClick={() => insertTableColumn(block, tableMenu.col, 'right')}><ArrowRight size={15}/><span>Insert right</span></button>
          <button onClick={() => insertTableRow(block, tableMenu.row, 'above')}><ArrowLeft className="rotate-90" size={15}/><span>Insert above</span></button>
          <button onClick={() => insertTableRow(block, tableMenu.row, 'below')}><ArrowRight className="rotate-90" size={15}/><span>Insert below</span></button>
          <button onClick={() => duplicateTableRow(block, tableMenu.row)}><Copy size={15}/><span>Duplicate row</span><kbd>⌘D</kbd></button><button onClick={() => duplicateTableColumnOnly(block, tableMenu.col)}><Copy size={15}/><span>Duplicate column</span></button>
          <button onClick={() => clearSelectedCells(block)}><XCircle size={15}/><span>Clear contents</span></button>
          <button onClick={() => deleteTableColumn(block, tableMenu.col)} className="danger"><Trash2 size={15}/><span>Delete column</span></button>
          <button onClick={() => deleteTableRow(block, tableMenu.row)} className="danger"><Trash2 size={15}/><span>Delete row</span></button>
          <button onClick={() => deleteTable(block)} className="danger"><Trash2 size={15}/><span>Delete table</span></button>
        </div>, document.body)}
        </div> :
       block.type === 'math' ? renderMath(block) :
       block.type === 'image' ? renderMedia(block, 'Image') :
       block.type === 'video' ? renderMedia(block, 'Video') :
       block.type === 'audio' ? renderMedia(block, 'Audio') :
       block.type === 'file' ? renderMedia(block, 'File') :
       block.type === 'bookmark' ? renderMedia(block, 'Bookmark') :
       block.type === 'code' ? <div id={`block-${block.id}`} className={`block block-code code-block-shell notex-code-shell ${(block as any).codeWrap ? 'code-wrap-enabled' : ''} ${codeLanguageClass((block as any).codeLanguage)}`}>
          <div className="notex-code-topbar" onMouseDown={e => e.stopPropagation()}>
            <button className="code-language-pill notex-code-lang" title="Language" onClick={() => { const opening = codeLangFor !== block.id; setCodeLangFor(opening ? block.id : null); setCodeLangSearch(''); setCodeLangActiveIndex(0); setCodeMoreFor(null); }}>{(block as any).codeLanguage || 'Plain text'} <ChevronRight size={12}/></button>
            <div className="notex-code-actions">
              <button title="Copy code" onClick={(e) => { e.preventDefault(); e.stopPropagation(); copyCodeBlock(block); }}><Copy size={14}/></button>
              <button title="More options" onClick={(e) => openCodeMore(block.id, e)}><MoreHorizontal size={15}/></button>
            </div>
            {codeLangFor === block.id && <div className="code-language-popover floating-popover notex-language-popover" onMouseDown={e => e.stopPropagation()}>
              <label className="code-language-search"><span>⌕</span><input autoFocus value={codeLangSearch} placeholder="Search for a language" onChange={e => { setCodeLangSearch(e.target.value); setCodeLangActiveIndex(0); }} onKeyDown={e => { if (e.key === 'Escape') { setCodeLangFor(null); setCodeLangSearch(''); } }} /></label>
              <div className="code-language-list">{visibleCodeLanguages.map((lang, idx) => <button key={lang} className={idx === codeLangActiveIndex ? 'active' : ''} onMouseEnter={() => setCodeLangActiveIndex(idx)} onClick={() => { setCodeLanguage(block, lang); setCodeLangSearch(''); setCodeLangActiveIndex(0); }}><span>{lang}</span>{((block as any).codeLanguage || 'Plain text') === lang && <Check className="code-language-check" size={16}/>}</button>)}</div>
            </div>}
            {codeMoreFor === block.id && <div className="code-more-popover floating-popover notex-code-menu" onMouseDown={e => e.stopPropagation()}>
              <button onMouseEnter={() => { setCodeTurnFor(block.id); }} onClick={() => { setCodeTurnFor(codeTurnFor === block.id ? null : block.id); }}><Type size={15}/><span>Turn into</span><ChevronRight size={14}/></button>
              {codeTurnFor === block.id && <div className="code-turn-popover nested-code-turn-popover">
                {[
                  ['paragraph','Text', Type], ['h1','Heading 1', Heading1], ['h2','Heading 2', Heading2], ['h3','Heading 3', Heading3], ['h4','Heading 4', Heading4],
                  ['bullet','Bullet list', List], ['numbered','Numbered list', ListOrdered], ['todo','To-do', CheckSquare], ['quote','Quote', Quote], ['math','Equation', Type], ['command','Command', TerminalSquare]
                ].map(([type, label, Icon]: any) => <button key={type} onClick={() => { convert(block.id, type); setCodeTurnFor(null); setCodeMoreFor(null); }}><Icon size={14}/><span>{label}</span></button>)}
              </div>}
              <button onClick={() => toggleCodeWrap(block)}><ArrowLeft size={15}/><span>Wrap</span><i className={(block as any).codeWrap ? 'toggle on' : 'toggle'} /></button>
              <button onClick={() => copyCodeBlock(block)}><Code2 size={15}/><span>Copy code</span></button>
              <div className="code-menu-divider" />
              <button onClick={() => copyBlockLink(block)}><Link size={15}/><span>Copy link to block</span><em>⌘^L</em></button>
              <button onClick={() => { duplicateBlock(block.id); setCodeMoreFor(null); }}><Copy size={15}/><span>Duplicate</span><em>⌘D</em></button>
              <button className="danger" onClick={() => { deleteBlock(block.id); setCodeMoreFor(null); }}><Trash2 size={15}/><span>Delete</span><em>Del</em></button>
            </div>}
          </div>
          <div className="code-editor-layer notex-code-editor">
            <div className="code-line-numbers" aria-hidden="true">{codeLineNumbers(block.text || '').map(n => <span key={n} className={codeHoverLine?.blockId === block.id && codeHoverLine.line === n ? 'hovered' : ''}>{n}</span>)}</div>
            <CodeEditable className={(block as any).codeWrap ? 'wrap-code code-textarea-editor' : 'code-textarea-editor'} value={block.text || ''} placeholder="Type code..." highlightHtml={highlightCode(block.text || '', (block as any).codeLanguage)} language={(block as any).codeLanguage} onHoverLine={(line) => setCodeHoverLine(line ? { blockId: block.id, line } : null)} onChange={(value) => updateBlock(block.id, { text: value })} />
          </div>
          {codeCopyToast?.blockId === block.id && <div className="code-copy-toast">{codeCopyToast.message}</div>}
        </div> :
       block.type === 'command' ? <div className="block block-command"><span className="command-prefix">$</span><button className="command-delete-btn" title="Delete command block" onClick={() => deleteBlock(block.id)}><Trash2 size={12}/></button><CommandTextarea value={block.text || ''} blockId={block.id} onCommit={(value) => updateBlock(block.id, { text: value }, false)} onEscape={() => setMenuFor(null)} onBackspaceEmpty={() => handleBackspaceEmpty(block)} onEnter={() => menuFor === block.id ? pickSlashCommand(block.id) : continueAfter(block)} onSlashShortcut={(v) => { const quick = slashShortcut(v); if (quick) { convert(block.id, quick).then(() => db.blocks.update(block.id, { text: '', updatedAt: now() }).then(load)); return true; } return false; }} onSlashQuery={(v) => { if (v.trim().startsWith('/')) { setMenuFor(block.id); setSlashQuery(v.trim()); setSlashActiveIndex(0); } else if (menuFor === block.id) setMenuFor(null); }} /></div> :
        <div className={`block block-${block.type}`}>
          {block.type === 'todo' && <input type="checkbox" checked={!!block.checked} onChange={e => updateBlock(block.id, { checked: e.target.checked })} />}
          {block.type === 'bullet' && <span className="bullet-dot">•</span>}
          {block.type === 'numbered' && <span className="number-dot">{numberFor(block, index)}.</span>}
          {block.type === 'toggle' && <span className="toggle-dot"><ChevronRight size={16}/></span>}
          <RichEditable
            html={block.text || ''}
            blockId={block.id}
            className={`rich-${block.type}`}
            placeholder={focusedTextBlockId === block.id && focusedBlockIsEmpty ? 'Type / for commands' : ''}
            onFocusBlock={() => { setActiveTextBlockId(block.id); setFocusedTextBlockId(block.id); }}
            onBlurBlock={() => setTimeout(() => {
              const active = document.activeElement as HTMLElement | null;
              if (!active?.closest?.('[data-rich-block-id]')) setFocusedTextBlockId(null);
            }, 0)}
            onOpenFormat={(e) => openFormatToolbar(block.id, e)}
            onRichPaste={(html, plain) => pasteBlocksInto(block, html, plain)}
            onImagePaste={(src) => pasteImageInto(block, src)}
            onSlashShortcut={(value) => { const quick = slashShortcut(value); if (quick) { updateBlock(block.id, { type: quick, text: '' }).then(() => { setMenuFor(null); setSlashQuery('/'); focusBlock(block.id); }); return true; } return false; }}
            onHTMLChange={(html, plain) => { const quick = slashShortcut(plain); if (quick) { updateBlock(block.id, { type: quick, text: '' }).then(() => { setMenuFor(null); setSlashQuery('/'); focusBlock(block.id); }); return; } if (plain.trim().startsWith('/')) { setMenuFor(block.id); setSlashQuery(plain.trim()); setSlashActiveIndex(0); } else if (menuFor === block.id) setMenuFor(null); updateBlock(block.id, { text: html }, false); }}
            onSlash={(query) => { setMenuFor(block.id); setSlashQuery(query); }}
            onEnter={() => menuFor === block.id ? pickSlashCommand(block.id) : continueAfter(block)}
            onBackspaceEmpty={() => handleBackspaceEmpty(block)}
            onBackspaceAtStart={() => focusPreviousBlock(block.id)}
            onIndentList={() => adjustListLevel(block, 1)}
            onOutdentList={() => adjustListLevel(block, -1)}
          />
        </div>}
    </div>)}
    {linkModalFor && createPortal(<div className="link-modal-backdrop" onMouseDown={() => setLinkModalFor(null)}><div className="link-insert-modal" onMouseDown={e => e.stopPropagation()}>
      <h3>Insert link</h3>
      <label>URL<input autoFocus value={linkUrl} placeholder="https://example.com" onChange={e => setLinkUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyUrlLink(); if (e.key === 'Escape') setLinkModalFor(null); }} /></label>
      <button className="primary-link-action" onClick={applyUrlLink}>Apply link</button>
      <div className="link-modal-divider" />
      <label>Link to page<input value={pageLinkSearch} placeholder="Search page..." onChange={e => setPageLinkSearch(e.target.value)} /></label>
      <div className="page-link-results">{pagesForLink.filter(p => p.title.toLowerCase().includes(pageLinkSearch.toLowerCase())).slice(0, 8).map(p => <button key={p.id} onClick={() => applyPageLink(p)}>{p.title}</button>)}</div>
    </div></div>, document.body)}
    {confirmDialog && createPortal(<div className="notex-confirm-backdrop" onMouseDown={() => setConfirmDialog(null)}>
      <div className="notex-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="notex-confirm-title" onMouseDown={e => e.stopPropagation()}>
        <h3 id="notex-confirm-title">{confirmDialog.title}</h3>
        <p>{confirmDialog.message}</p>
        <div className="notex-confirm-actions">
          <button onClick={() => setConfirmDialog(null)}>Cancel</button>
          <button className="danger-button" onClick={() => void runConfirmDialog()}>{confirmDialog.confirmText || 'Delete'}</button>
        </div>
      </div>
    </div>, document.body)}
    <div className="blank-block-offer" onClick={() => addBlock()}>
      <div className="block-actions simple"><button title="Drag block"><GripVertical size={14}/></button><button title="Add block"><Plus size={14}/></button></div>
      <div className="block block-paragraph"><div className="rich-editable blank-offer-text" aria-label="Add a new block"></div></div>
    </div>
    <button className="add-block" onClick={() => addBlock()}>+ Add block</button>
  </div>;
}
