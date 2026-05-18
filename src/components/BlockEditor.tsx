import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { TextareaHTMLAttributes } from 'react';
import { AudioLines, Bookmark, Bold, Check, CheckSquare, ChevronRight, Code2, File, GripVertical, Heading1, Heading2, Heading3, Heading4, Image, Italic, Link, List, ListOrdered, Minus, MoreHorizontal, Palette, Plus, Quote, Strikethrough, Table2, TerminalSquare, ToggleLeft, Type, Underline, Video, Trash2, Copy, ArrowLeft, ArrowRight, Paintbrush, XCircle, X } from 'lucide-react';
import { db, Block, BlockType, uid, now } from '../db/schema';

type SlashGroup = 'Suggested' | 'Basic blocks' | 'Media';
type SlashItem = { type: BlockType; label: string; desc: string; group: SlashGroup; shortcut?: string; Icon: any };

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

function getSlashMatches(query: string) {
  const q = query.replace(/^\//, '').trim().toLowerCase();
  return slashItems.filter(item => !q || item.label.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q) || item.type.toLowerCase().includes(q) || (q === 'cmd' && item.type === 'command')); 
}

function SlashMenu({ query, selectedIndex, onPick, style }: { query: string; selectedIndex: number; onPick: (item: SlashItem) => void; style?: CSSProperties }) {
  const groups: SlashGroup[] = ['Suggested', 'Basic blocks', 'Media'];
  const visibleItems = getSlashMatches(query);
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
}

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
      setLocalValue(v);
      if (onSlashShortcut(v)) return;
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

function CodeEditable({ value, className, placeholder, highlightHtml, language, onChange, onKeyDown }: {
  value: string;
  className?: string;
  placeholder?: string;
  highlightHtml: string;
  language?: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: any) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [renderedHtml, setRenderedHtml] = useState(highlightHtml || '');
  useEffect(() => {
    let cancelled = false;
    const code = value || '';
    const lang = shikiLanguageId(language);
    import('shiki').then(async ({ codeToHtml }) => {
      try {
        const html = await codeToHtml(code, { lang: lang as any, theme: 'github-light' });
        if (!cancelled) setRenderedHtml(extractShikiCode(html));
      } catch {
        if (!cancelled) setRenderedHtml(highlightHtml || escapeCodeHtml(code));
      }
    }).catch(() => { if (!cancelled) setRenderedHtml(highlightHtml || escapeCodeHtml(code)); });
    return () => { cancelled = true; };
  }, [value, language, highlightHtml]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    el.innerHTML = renderedHtml || '';
  }, [renderedHtml, value]);
  return <div
    ref={ref}
    className={className}
    contentEditable
    suppressContentEditableWarning
    spellCheck={false}
    data-placeholder={placeholder || ''}
    onKeyDown={onKeyDown}
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

function RichEditable({ blockId, html, placeholder, className, onHTMLChange, onSlash, onEnter, onBackspaceEmpty, onBackspaceAtStart, onOpenFormat, onRichPaste, onImagePaste }: {
  blockId: string;
  html: string;
  placeholder?: string;
  className?: string;
  onHTMLChange: (html: string, plain: string) => void;
  onSlash: (query: string) => void;
  onEnter: () => void;
  onBackspaceEmpty: () => void;
  onBackspaceAtStart?: () => void;
  onOpenFormat: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onRichPaste: (html: string, plain: string) => void;
  onImagePaste?: (src: string) => void;
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
    onHTMLChange(el.innerHTML, plain);
    const trimmed = plain.trim();
    if (trimmed.startsWith('/')) onSlash(trimmed);

  };
  return <div
    ref={ref}
    className={`rich-editable ${className || ''}`}
    contentEditable
    suppressContentEditableWarning
    data-rich-block-id={blockId}
    data-placeholder={placeholder || ''}
    onInput={emit}
    onDoubleClick={(e) => { /* native double-click text selection only */ }}
    onContextMenu={(e) => { e.preventDefault(); onOpenFormat(e); }}
    onPaste={(e) => {
      const file = Array.from(e.clipboardData.files || []).find(f => f.type.startsWith('image/'));
      if (file && onImagePaste) {
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = () => onImagePaste(String(reader.result || ''));
        reader.readAsDataURL(file);
        return;
      }
      const htmlData = e.clipboardData.getData('text/html');
      const textData = e.clipboardData.getData('text/plain');
      if (htmlData && onImagePaste) {
        const doc = new DOMParser().parseFromString(htmlData, 'text/html');
        const img = doc.querySelector('img[src]') as HTMLImageElement | null;
        if (img?.src) {
          e.preventDefault();
          onImagePaste(img.src);
          return;
        }
      }
      if (htmlData && /<table[\s>]/i.test(htmlData)) {
        e.preventDefault();
        onRichPaste(htmlData, textData);
        return;
      }
      setTimeout(emit, 0);
    }}
    onKeyDown={(e) => {
      if (e.key === 'Escape') { onSlash(''); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnter(); return; }
      if (e.key === 'Backspace') {
        const text = ref.current?.textContent || '';
        const sel = window.getSelection();
        const atStart = !!sel && sel.isCollapsed && sel.anchorOffset === 0 && ref.current?.contains(sel.anchorNode);
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
    onFocus={onFocusCell}
    onInput={emit}
    onBlur={emit}
    onContextMenu={(e) => { e.preventDefault(); onOpenMenu(e); }}
    onPaste={(e) => {
      const htmlData = e.clipboardData.getData('text/html');
      const textData = e.clipboardData.getData('text/plain');
      e.preventDefault();
      document.execCommand('insertHTML', false, htmlData || textData.replace(/\n/g, '<br>'));
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

export function BlockEditor({ pageId, onChanged, onCreatePage }: { pageId: string; onChanged?: () => void; onCreatePage?: () => void }) {
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
  const [isBlockSelecting, setIsBlockSelecting] = useState(false);
  const [blockSelectionStart, setBlockSelectionStart] = useState<string | null>(null);
  const blockDragRef = useRef<{ active: boolean; startY: number; startX: number; moved: boolean; startedInsideEditor: boolean }>({ active: false, startY: 0, startX: 0, moved: false, startedInsideEditor: false });
  const selectedBlockIdsRef = useRef<string[]>([]);
  useEffect(() => { selectedBlockIdsRef.current = selectedBlockIds; }, [selectedBlockIds]);

  async function load() { setBlocks(await db.blocks.where('pageId').equals(pageId).sortBy('sort')); }
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
    const menuHeight = Math.min(520, Math.max(260, getSlashMatches(slashQuery).length * 42 + 86));
    const openUp = spaceBelow < 260 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(220, Math.min(openUp ? spaceAbove : spaceBelow, 520));
    // Use the estimated actual menu height for placement. Previously, when a
    // slash menu opened upward near the bottom of a long page, we subtracted
    // the full maxHeight, which pushed the menu too far above the active line.
    const actualHeight = Math.max(180, Math.min(menuHeight, maxHeight));
    const top = openUp ? Math.max(12, rect.top - actualHeight - 8) : Math.min(rect.bottom + 8, window.innerHeight - actualHeight - 12);
    setSlashPos({ left: preferredLeft, top, maxHeight });
  }, [menuFor, slashQuery, blocks.length]);

  useEffect(() => {
    if (!menuFor) return;
    const items = getSlashMatches(slashQuery);
    if (slashActiveIndex >= items.length) setSlashActiveIndex(Math.max(0, items.length - 1));
    const navSlash = (e: KeyboardEvent) => {
      if (!menuFor) return;
      const matches = getSlashMatches(slashQuery);
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
  }, [menuFor, slashQuery, slashActiveIndex, blocks]);

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
    const languages = filteredCodeLanguages(codeLangSearch);
    if (codeLangActiveIndex >= languages.length) setCodeLangActiveIndex(Math.max(0, languages.length - 1));
    const navLanguages = (e: KeyboardEvent) => {
      const langs = filteredCodeLanguages(codeLangSearch);
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
  }, [codeLangFor, codeLangSearch, codeLangActiveIndex, blocks]);

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

  function selectBlocksFromDrag(startY: number, currentY: number) {
    const ids = idsFromVerticalDrag(startY, currentY);
    if (ids.length) {
      setSelectedBlockIds(ids);
      setSelectedBlockMenu(null);
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
        e.preventDefault();
        const selectedSet = new Set(selectedBlockIds);
        const remaining = blocks.filter(b => !selectedSet.has(b.id));
        const firstSelectedIndex = Math.max(0, blocks.findIndex(b => selectedSet.has(b.id)));
        Promise.all(selectedBlockIds.map(id => db.blocks.delete(id))).then(async () => {
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
        });
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
        document.execCommand('undo');
        return;
      }
      if (key === 'r') {
        e.preventDefault();
        document.execCommand('redo');
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
    const selected = blocks.filter(b => selectedBlockIds.includes(b.id));
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
    const doc = new DOMParser().parseFromString(input || '', 'text/html');
    doc.querySelectorAll('script,style,meta,link').forEach(el => el.remove());
    doc.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || name === 'style' || name === 'class') el.removeAttribute(attr.name);
      });
    });
    return doc.body;
  }

  function htmlToBlocks(html: string, plain: string, baseSort: number): Block[] {
    const t = now();
    const make = (type: BlockType, text: string, offset: number): Block => ({ id: uid(), pageId, type, text: text.trim(), sort: baseSort + offset, createdAt: t, updatedAt: t });
    const result: Block[] = [];
    const push = (type: BlockType, value: string) => {
      const cleaned = value.replace(/(&nbsp;| )/g, ' ').trim();
      if (!cleaned) return;
      result.push(make(type, cleaned, result.length + 0.1));
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
        else if (tag === 'ul') Array.from(el.querySelectorAll(':scope > li')).forEach(li => push('bullet', (li as HTMLElement).innerHTML));
        else if (tag === 'ol') Array.from(el.querySelectorAll(':scope > li')).forEach(li => push('numbered', (li as HTMLElement).innerHTML));
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
    if (!result.length && plain) plain.split(/\n+/).map(x => x.trim()).filter(Boolean).forEach(line => push('paragraph', line));
    return result;
  }

  async function pasteBlocksInto(block: Block, html: string, plain: string) {
    const imported = htmlToBlocks(html, plain, block.sort);
    if (!imported.length) return;
    const currentPlain = (block.text || '').replace(/<[^>]*>/g, '').trim();
    const batch = [...imported];
    if (!currentPlain) {
      const first = batch.shift()!;
      await db.blocks.update(block.id, { type: first.type, text: first.text, table: first.table, updatedAt: now() });
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
  async function deleteBlock(id: string) {
    if (blocks.length <= 1) return;
    const idx = blocks.findIndex(b => b.id === id);
    const previous = blocks[idx - 1] || blocks[idx + 1];
    await db.blocks.delete(id);
    await resequence(); await touchPage(); await load();
    if (previous) focusBlock(previous.id);
  }

  async function handleBackspaceEmpty(block: Block) {
    if (block.type === 'bullet' || block.type === 'numbered') {
      await updateBlock(block.id, { type: 'paragraph', text: '' });
      focusBlock(block.id);
      return;
    }
    await deleteBlock(block.id);
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
    const match = getSlashMatches(slashQuery)[0];
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
    if (block.numberedStart) return block.numberedStart;
    let n = 1;
    for (let i = index - 1; i >= 0; i--) {
      const prev = blocks[i];
      if (prev.type !== 'numbered') break;
      n = (prev.numberedStart || numberFor(prev, i)) + 1;
      break;
    }
    return n;
  }
  async function resetNumbering(block: Block) { await updateBlock(block.id, { numberedStart: 1 }); }
  async function continueNumbering(block: Block) { await updateBlock(block.id, { numberedStart: undefined as any }); }

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
    const plain = (block.text || '').replace(/<[^>]*>/g, '').trim();
    if (!plain && block.type === 'paragraph') {
      await updateBlock(block.id, { type: 'image', text: src, imageWidth: 420 } as any);
      setSelectedImageId(block.id);
      setImageEditorHidden(prev => ({ ...prev, [block.id]: true }));
      return;
    }
    const sort = block.sort + 0.5;
    const imageBlock: Block = { id: uid(), pageId, type: 'image', text: src, sort, imageWidth: 420, createdAt: now(), updatedAt: now() } as any;
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
    const wrap = (regex: RegExp, cls: string) => { escaped = escaped.replace(regex, `<span class="${cls}">$1</span>`); };
    wrap(/(\/\/.*?$|#.*?$|--.*?$|\/\*[\s\S]*?\*\/)/gm, 'tok-comment');
    wrap(/(&quot;(?:\\.|[^&])*?&quot;|'(?:\\.|[^'])*?'|`(?:\\.|[^`])*?`)/g, 'tok-string');
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
    const start = blocks.findIndex(b => b.id === blockSelectionStart);
    const end = blocks.findIndex(b => b.id === blockId);
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
    const raw = (input || '').trim() || 'E = mc^2';
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

  async function uploadImageFile(block: Block, file?: File | null) {
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await updateBlock(block.id, { text: dataUrl } as any);
    setImageEditorHidden(prev => ({ ...prev, [block.id]: true }));
  }

  function renderMedia(block: Block, label: string) {
    const isImage = block.type === 'image';
    const url = (block.text || '').trim();
    const hasPreview = isImage && looksLikeImageUrl(url);
    const editorHidden = !!imageEditorHidden[block.id];
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
        <img src={url} alt={(block as any).caption || label} draggable={false} />
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
    if (target.closest("button, input, select, .format-toolbar, .table-cell-menu, .code-more-popover, .code-language-popover, .code-hover-toolbar")) return;
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
  }} onDragOver={(e) => { if (e.dataTransfer.types.includes('application/notex-page-id')) e.preventDefault(); }} onDrop={(e) => { const pid = e.dataTransfer.getData('application/notex-page-id'); if (pid) { e.preventDefault(); insertPageLinkBlock(pid); } }}>
    {blocks.map((block, index) => <div className={`block-wrap block-wrap-${block.type} ${selectedBlockIds.includes(block.id) ? 'selected-block-line' : ''} ${dragId && dragOverId === block.id && dragId !== block.id ? 'drop-before' : ''}`} key={block.id} id={`block-${block.id}`} data-block-id={block.id} draggable={false}
      onMouseDown={(e) => beginBlockRangeSelection(block.id, e)}
      onMouseEnter={() => extendBlockRangeSelection(block.id)}
      onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) { e.preventDefault(); setSelectedBlockIds(prev => prev.includes(block.id) ? prev.filter(id => id !== block.id) : [...prev, block.id]); } }}
      onContextMenu={() => { /* text context menu is handled by the inline selection toolbar */ }}
      onDragOver={e => { e.preventDefault(); if (dragId && dragId !== block.id) setDragOverId(block.id); }} onDragEnter={() => { if (dragId && dragId !== block.id) setDragOverId(block.id); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverId(null); }} onDrop={(e) => { const pid = e.dataTransfer.getData('application/notex-page-id'); if (pid) { e.preventDefault(); insertPageLinkBlock(pid, block.sort); } else dropOn(block.id); }}>
      <div className="block-actions simple">
        <button className="drag-handle" title="Drag block" draggable onDragStart={() => setDragId(block.id)} onDragEnd={() => setDragId(null)}><GripVertical size={14}/></button>
        <button title="Add block below" onClick={() => addBlock(block.sort)}><Plus size={14}/></button>
      </div>
      <button className="block-delete-right" title="Delete block" onMouseDown={e => e.stopPropagation()} onClick={() => deleteBlock(block.id)}><X size={13}/></button>
      {menuFor === block.id && <SlashMenu query={slashQuery} selectedIndex={slashActiveIndex} style={slashPos ? { position: 'fixed', left: slashPos.left, top: slashPos.top, maxHeight: slashPos.maxHeight } : undefined} onPick={(item) => applySlashItem(block.id, item)} />}
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
            className={`${isCellSelected(block.id, r, c) ? 'selected-cell' : ''} ${c === row.length - 1 ? 'last-col-cell' : ''}`}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
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
              <div className="code-language-list">{filteredCodeLanguages(codeLangSearch).map((lang, idx) => <button key={lang} className={idx === codeLangActiveIndex ? 'active' : ''} onMouseEnter={() => setCodeLangActiveIndex(idx)} onClick={() => { setCodeLanguage(block, lang); setCodeLangSearch(''); setCodeLangActiveIndex(0); }}><span>{lang}</span>{((block as any).codeLanguage || 'Plain text') === lang && <Check className="code-language-check" size={16}/>}</button>)}</div>
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
            <div className="code-line-numbers" aria-hidden="true">{codeLineNumbers(block.text || '').map(n => <span key={n}>{n}</span>)}</div>
            <CodeEditable className={(block as any).codeWrap ? 'wrap-code code-textarea-editor' : 'code-textarea-editor'} value={block.text || ''} placeholder="Type code..." highlightHtml={highlightCode(block.text || '', (block as any).codeLanguage)} language={(block as any).codeLanguage} onChange={(value) => updateBlock(block.id, { text: value })} />
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
            placeholder="Type / for commands"
            onOpenFormat={(e) => openFormatToolbar(block.id, e)}
            onRichPaste={(html, plain) => pasteBlocksInto(block, html, plain)}
            onImagePaste={(src) => pasteImageInto(block, src)}
            onHTMLChange={(html, plain) => { const quick = slashShortcut(plain); if (quick) { convert(block.id, quick).then(() => db.blocks.update(block.id, { text: '', updatedAt: now() }).then(load)); return; } if (plain.trim().startsWith('/')) { setMenuFor(block.id); setSlashQuery(plain.trim()); setSlashActiveIndex(0); } else if (menuFor === block.id) setMenuFor(null); updateBlock(block.id, { text: html }, false); }}
            onSlash={(query) => { setMenuFor(block.id); setSlashQuery(query); }}
            onEnter={() => menuFor === block.id ? pickSlashCommand(block.id) : continueAfter(block)}
            onBackspaceEmpty={() => handleBackspaceEmpty(block)}
            onBackspaceAtStart={() => focusPreviousBlock(block.id)}
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
    <div className="blank-block-offer" onClick={() => addBlock()}>
      <div className="block-actions simple"><button title="Drag block"><GripVertical size={14}/></button><button title="Add block"><Plus size={14}/></button></div>
      <div className="block block-paragraph"><div className="rich-editable blank-offer-text">Type / for commands</div></div>
    </div>
    <button className="add-block" onClick={() => addBlock()}>+ Add block</button>
  </div>;
}
