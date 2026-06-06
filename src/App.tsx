import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  Download,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  GripVertical,
  History,
  LayoutGrid,
  Link,
  LogOut,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Save,
  Star,
  Trash2,
  Upload,
  Wifi,
  ChevronRight,
  ChevronDown,
  Command,
  ArrowDown,
  ArrowUp,
  EyeOff,
  SlidersHorizontal,
  Clock3,
  Users,
  Lock,
  ListFilter,
  X,
  Image,
  Video,
  Music,
  Code2,
  Bookmark,
  Table2,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Pilcrow,
  RotateCcw,
  Tag,
  Check,
  Pin,
  PinOff,
  FileDown,
  Printer,
  Copy,
  Mail,
  Sun,
  Moon,
  Sparkles,
  Puzzle,
  Bot,
  Settings2
} from 'lucide-react';
import { db, Page, uid, now, type Block, type BlockType, type User, type Workspace, type SnapshotMeta } from './db/schema';
import { ensureSeedData } from './db/seed';
import { BlockEditor } from './components/BlockEditor';
import { PlainEditor } from './components/PlainEditor';
import { DatabaseViews } from './components/DatabaseViews';
import { cloudSyncMessage, createSnapshot, deleteAllSnapshots, deleteOldSnapshots, deleteSnapshotEverywhere, downloadBackup, formatBytes, getSnapshotMetas, getStorageDiagnostics, restoreBackup, restoreSnapshot } from './sync/backup';
import { APP_VERSION_LABEL } from './appVersion';
import './styles/app.css';

type TreeNode = Page & { children: TreeNode[] };

type SidebarSectionKey = 'recents' | 'favorites' | 'organize' | 'others' | 'addons';
type AddonKey = 'aiComposer' | 'templates';
type AddonState = Record<AddonKey, boolean>;
type AppTheme = 'light' | 'dark' | 'modern';

const GOOGLE_CLIENT_ID = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '';

const DEFAULT_ADDONS: AddonState = { aiComposer: true, templates: true };
const ADDON_CATALOG: { key: AddonKey; title: string; description: string; version: string; status: string }[] = [
  { key: 'aiComposer', title: 'AI Composer', description: 'Ask, summarize, rewrite, and generate notes using configurable LLM providers.', version: '0.1', status: 'Foundation' },
  { key: 'templates', title: 'Templates', description: 'Reusable page templates and note structures for faster writing.', version: '0.1', status: 'Core' }
];

type GoogleProfile = { sub: string; email: string; name: string; picture?: string };

declare global {
  interface Window { google?: any; }
}

const LOCAL_USER_ID = 'local-user';
const DEFAULT_WORKSPACE_SPECS: Array<{ id: string; name: string; type: Workspace['type'] }> = [
  { id: 'ws-personal', name: 'Personal', type: 'personal' },
  { id: 'ws-work', name: 'Work', type: 'work' },
  { id: 'ws-business', name: 'Business', type: 'business' }
];


function workspaceSort(workspaces: Workspace[]) {
  const order = { personal: 1, work: 2, business: 3, custom: 4 } as Record<Workspace['type'], number>;
  return [...workspaces].sort((a, b) => order[a.type] - order[b.type] || a.createdAt - b.createdAt);
}

function workspaceIdFor(userId: string, type: Workspace['type']) {
  if (userId === LOCAL_USER_ID) {
    const spec = DEFAULT_WORKSPACE_SPECS.find(x => x.type === type);
    if (spec) return spec.id;
  }
  return `ws-${userId.replace(/[^a-zA-Z0-9_-]/g, '-')}-${type}`;
}

async function ensureUserWorkspaces(user: User) {
  const t = now();
  const existing = await db.workspaces.where('userId').equals(user.id).toArray();
  if (existing.length === 0) {
    for (const spec of DEFAULT_WORKSPACE_SPECS) {
      await db.workspaces.put({ id: workspaceIdFor(user.id, spec.type), userId: user.id, name: spec.name, type: spec.type, createdAt: t, updatedAt: t });
    }
  }
  return workspaceSort(await db.workspaces.where('userId').equals(user.id).toArray());
}

async function ensureLocalUser() {
  const t = now();
  let user = await db.users.get(LOCAL_USER_ID);
  if (!user) {
    user = { id: LOCAL_USER_ID, email: 'local@notex.app', name: 'Local User', provider: 'local', createdAt: t, updatedAt: t };
    await db.users.put(user);
  }
  return user;
}

async function ensureActiveUserAndWorkspaces() {
  const savedUserId = (await db.settings.get('activeUserId'))?.value;
  if (!savedUserId) return null;
  let user = await db.users.get(savedUserId);
  if (!user && savedUserId === LOCAL_USER_ID) user = await ensureLocalUser();
  if (!user) return null;
  const workspaces = await ensureUserWorkspaces(user);
  const personal = workspaces.find(w => w.type === 'personal') || workspaces[0];
  if (personal) {
    const legacyPages = await db.pages.filter(p => !p.workspaceId).toArray();
    if (legacyPages.length) await Promise.all(legacyPages.map(p => db.pages.update(p.id, { workspaceId: personal.id })));
    const legacyBlocks = await db.blocks.filter(b => !b.workspaceId).toArray();
    if (legacyBlocks.length) await Promise.all(legacyBlocks.map(b => db.blocks.update(b.id, { workspaceId: personal.id })));
  }
  const savedUserWs = await db.settings.get(`activeWorkspaceId:${user.id}`);
  const activeWorkspaceId = workspaces.some(w => w.id === savedUserWs?.value) ? savedUserWs!.value : personal?.id;
  if (activeWorkspaceId) {
    await db.settings.put({ key: `activeWorkspaceId:${user.id}`, value: activeWorkspaceId });
    await db.settings.put({ key: 'activeWorkspaceId', value: activeWorkspaceId });
  }
  return { user, workspaces, activeWorkspaceId: activeWorkspaceId || '' };
}

async function ensureLocalUserAndWorkspaces() {
  const localUser = await ensureLocalUser();
  const workspaces = await ensureUserWorkspaces(localUser);
  const personal = workspaces.find(w => w.type === 'personal') || workspaces[0];
  return { user: localUser, workspaces, activeWorkspaceId: personal?.id || '' };
}

function decodeGoogleCredential(credential: string): GoogleProfile {
  const [, payload] = credential.split('.');
  if (!payload) throw new Error('Invalid Google credential.');
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(atob(normalized).split('').map(c => `%${('00' + c.charCodeAt(0).toString(16)).slice(-2)}`).join(''));
  const data = JSON.parse(json);
  if (!data.sub || !data.email) throw new Error('Google credential is missing required profile fields.');
  return { sub: String(data.sub), email: String(data.email), name: String(data.name || data.email), picture: data.picture ? String(data.picture) : undefined };
}

function loadGoogleIdentityScript() {
  return new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) { resolve(); return; }
    const existing = document.querySelector<HTMLScriptElement>('script[data-notex-google-identity]');
    if (existing) { existing.addEventListener('load', () => resolve(), { once: true }); existing.addEventListener('error', () => reject(new Error('Google Identity script failed to load.')), { once: true }); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.notexGoogleIdentity = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Identity script failed to load.'));
    document.head.appendChild(script);
  });
}


function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function bufferToBase64(buffer: ArrayBuffer) {
  return bytesToBase64(new Uint8Array(buffer));
}

function randomSalt() {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return bytesToBase64(salt);
}

async function deriveLocalPasswordHash(password: string, salt: string) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 120000, hash: 'SHA-256' }, keyMaterial, 256);
  return bufferToBase64(bits);
}

function userSyncLabel(user: User | null, fallback?: string) {
  if (user?.provider === 'google') return `Signed in as ${user.email}`;
  return fallback || 'Local mode';
}

function comparePageTitle(a: Pick<Page, 'title'>, b: Pick<Page, 'title'>) {
  return (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base', numeric: true });
}

function sortFolderFirst<T extends Pick<Page, 'id' | 'title'>>(items: T[], childCount: (id: string) => number) {
  return [...items].sort((a, b) => {
    const aFolder = childCount(a.id) > 0;
    const bFolder = childCount(b.id) > 0;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return comparePageTitle(a, b);
  });
}

function buildTree(pages: Page[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  pages.forEach(p => map.set(p.id, { ...p, children: [] }));
  const roots: TreeNode[] = [];
  map.forEach(node => {
    if (node.parentId && map.has(node.parentId)) map.get(node.parentId)!.children.push(node);
    else roots.push(node);
  });
  const childCount = (id: string) => map.get(id)?.children.length || 0;
  const sortTree = (items: TreeNode[]) => {
    items.sort((a, b) => {
      const aFolder = a.children.length > 0;
      const bFolder = b.children.length > 0;
      if (aFolder !== bFolder) return aFolder ? -1 : 1;
      return comparePageTitle(a, b);
    });
    items.forEach(n => sortTree(n.children));
  };
  roots.sort((a, b) => {
    const aFolder = childCount(a.id) > 0;
    const bFolder = childCount(b.id) > 0;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return comparePageTitle(a, b);
  });
  sortTree(roots);
  return roots;
}


function getHashPageId() {
  const raw = window.location.hash || '';
  const decoded = decodeURIComponent(raw);
  return decoded.match(/^#page[=-](.+)$/)?.[1] || '';
}

const loginHeroImages = [
  '/login-productivity-desk.svg',
  '/login-productivity-kanban.svg',
  '/login-productivity-calendar.svg',
  '/login-productivity-mindmap.svg',
  '/login-productivity-flow.svg'
];

export default function App() {
  const [pages, setPages] = useState<Page[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [authChecked, setAuthChecked] = useState(false);
  const [activePageId, setActivePageId] = useState<string>('');
  const [pageLoadMs, setPageLoadMs] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [syncStatus, setSyncStatus] = useState('Not signed in');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteHistory, setPaletteHistory] = useState<string[]>([]);
  const [selectedPaletteHistory, setSelectedPaletteHistory] = useState<string[]>([]);
  const [paletteActiveIndex, setPaletteActiveIndex] = useState(0);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [snapshotHistory, setSnapshotHistory] = useState<SnapshotMeta[]>([]);
  const [snapshotHistoryOpen, setSnapshotHistoryOpen] = useState(false);
  const [storageDiagnostics, setStorageDiagnostics] = useState<any>(null);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pageMenuId, setPageMenuId] = useState<string | null>(null);
  const [pageMenuInstance, setPageMenuInstance] = useState<string | null>(null);
  const [sectionMenuId, setSectionMenuId] = useState<SidebarSectionKey | null>(null);
  const [sectionMenuPos, setSectionMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [hiddenSections, setHiddenSections] = useState<Record<SidebarSectionKey, boolean>>({ recents: false, favorites: false, organize: false, others: false, addons: false });
  const [moveModalFor, setMoveModalFor] = useState<string | null>(null);
  const [moveQuery, setMoveQuery] = useState('');
  const [moveActiveIndex, setMoveActiveIndex] = useState(0);
  const [dragPageId, setDragPageId] = useState<string | null>(null);
  const [sidebarDropLine, setSidebarDropLine] = useState<string | null>(null);
  const [hoveredTreeId, setHoveredTreeId] = useState<string | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [googleInitError, setGoogleInitError] = useState('');
  const [pendingGoogleSwitchUserId, setPendingGoogleSwitchUserId] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryFilter, setLibraryFilter] = useState<'recents' | 'favorites' | 'shared' | 'private' | 'ai'>('recents');
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false);
  const [librarySearchQuery, setLibrarySearchQuery] = useState('');
  const [libraryFilterOpen, setLibraryFilterOpen] = useState(false);
  const [libraryFieldFilter, setLibraryFieldFilter] = useState<'all' | 'name' | 'created' | 'source' | 'edited' | 'visited' | 'tags'>('all');
  const [tagInput, setTagInput] = useState('');
  const [autoSaveText, setAutoSaveText] = useState('Autosaved just now');

  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [addonsOpen, setAddonsOpen] = useState(false);
  const [aiComposerOpen, setAiComposerOpen] = useState(false);
  const [enabledAddons, setEnabledAddons] = useState<AddonState>(DEFAULT_ADDONS);
  const [trashPages, setTrashPages] = useState<Page[]>([]);
  const [trashQuery, setTrashQuery] = useState('');
  const [selectedTrashIds, setSelectedTrashIds] = useState<string[]>([]);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceMenuPos, setWorkspaceMenuPos] = useState<{left:number; top:number} | null>(null);
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [workspaceAction, setWorkspaceAction] = useState<{ mode: 'rename' | 'delete'; workspaceId: string; value: string; pageCount?: number } | null>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [accountNameDraft, setAccountNameDraft] = useState('');
  const [pageMenuPos, setPageMenuPos] = useState<{left:number; top:number} | null>(null);
  const [fontMode, setFontMode] = useState<'default' | 'serif' | 'mono'>('default');
  const [appTheme, setAppTheme] = useState<AppTheme>('light');
  const [simpleModal, setSimpleModal] = useState<{ title: string; message: string; confirmText?: string; onConfirm?: () => void; inputValue?: string; inputPlaceholder?: string; onInputConfirm?: (value: string) => void } | null>(null);
  const [newPageChoice, setNewPageChoice] = useState<{ parentId: string | null } | null>(null);
  const currentWorkspace = useMemo(() => workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0] || null, [workspaces, activeWorkspaceId]);

  // Priority-3 performance: defer expensive local filtering so typing in the
  // sidebar/library/palette stays responsive on large workspaces. This does
  // not change what is shown; it only lets React keep input updates snappy.
  const deferredSidebarQuery = useDeferredValue(query);
  const deferredPaletteQuery = useDeferredValue(paletteQuery);
  const deferredLibrarySearchQuery = useDeferredValue(librarySearchQuery);
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [pinnedTabIds, setPinnedTabIds] = useState<string[]>([]);
  const [tabMenu, setTabMenu] = useState<{ pageId: string; left: number; top: number } | null>(null);
  const [historyIds, setHistoryIds] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [collapsedSections, setCollapsedSections] = useState<Record<SidebarSectionKey, boolean>>({
    recents: false,
    favorites: false,
    organize: false,
    others: false,
    addons: false
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef(false);
  const autoCollapsedRef = useRef(false);
  const lastExpandedSidebarWidthRef = useRef(280);
  const quickTextRef = useRef<HTMLTextAreaElement>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const accountAvatarRef = useRef<HTMLInputElement>(null);
  const pageTitleRef = useRef<HTMLDivElement>(null);
  const topActionsRef = useRef<HTMLDivElement>(null);
  const pendingTitleFocusRef = useRef<string | null>(null);
  const [localAuthOpen, setLocalAuthOpen] = useState(false);
  const [localAuthMode, setLocalAuthMode] = useState<'setup' | 'login'>('login');
  const [localAuthError, setLocalAuthError] = useState('');
  const localPasswordInputRef = useRef<HTMLInputElement | null>(null);
  const localPasswordConfirmInputRef = useRef<HTMLInputElement | null>(null);
  const localAuthWasOpenRef = useRef(false);
  const [knownUsers, setKnownUsers] = useState<User[]>([]);
  const [showTopButton, setShowTopButton] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [loginHeroIndex, setLoginHeroIndex] = useState(0);

  async function load(workspaceOverride?: string) {
    const identity = await ensureActiveUserAndWorkspaces();
    if (!identity) {
      setCurrentUser(null);
      setWorkspaces([]);
      setActiveWorkspaceId('');
      setPages([]);
      setTrashPages([]);
      setActivePageId('');
      setOpenTabIds([]);
      setHistoryIds([]);
      setHistoryIndex(-1);
      setSyncStatus('Signed out');
      setAuthChecked(true);
      return;
    }
    await ensureSeedData();
    setCurrentUser(identity.user);
    setWorkspaces(identity.workspaces);
    const effectiveWorkspaceId = workspaceOverride || identity.activeWorkspaceId;
    setActiveWorkspaceId(effectiveWorkspaceId);
    setAuthChecked(true);
    const collapseSetting = await db.settings.get('v1.6.60.defaultCollapsed');
    if (!collapseSetting?.value) {
      const seedPages = await db.pages.toArray();
      const parentIds = new Set(seedPages.map(p => p.parentId).filter(Boolean) as string[]);
      await Promise.all(seedPages.filter(p => parentIds.has(p.id) && p.collapsed === 0).map(p => db.pages.update(p.id, { collapsed: 1 })));
      await db.settings.put({ key: 'v1.6.60.defaultCollapsed', value: true });
    }
    const scopedPages = await db.pages.where('workspaceId').equals(effectiveWorkspaceId).toArray();
    scopedPages.sort((a, b) => b.updatedAt - a.updatedAt);
    const all = scopedPages.filter(p => !p.deleted);
    setPages(all);
    setTrashPages(scopedPages.filter(p => !!p.deleted));
    const [latestSnapshotMetas, totalSnapshots] = await Promise.all([
      getSnapshotMetas(1),
      db.snapshots.count()
    ]);
    setSnapshots(latestSnapshotMetas);
    setSnapshotCount(totalSnapshots);
    const saved = await db.settings.get(`activePageId:${effectiveWorkspaceId}`);
    const legacySaved = await db.settings.get('activePageId');
    const hashPageId = getHashPageId();
    const savedId = (hashPageId && all.some(p => p.id === hashPageId) ? hashPageId : '') || saved?.value || legacySaved?.value;
    const id = savedId && all.some(p => p.id === savedId) ? savedId : '';
    if (id) {
      pendingTitleFocusRef.current = id;
      setActivePageId(id);
      setOpenTabIds(prev => prev.includes(id) ? prev : [...prev, id]);
      setHistoryIds(prev => prev.length ? prev : [id]);
      setHistoryIndex(prev => prev >= 0 ? prev : 0);
    } else {
      setActivePageId('');
      setHistoryIndex(-1);
    }
    const sync = await db.settings.get('syncProvider');
    setSyncStatus(userSyncLabel(identity.user, sync?.value));
    const w = await db.settings.get('sidebarWidth');
    if (typeof w?.value === 'number') setSidebarWidth(Math.min(420, Math.max(230, w.value)));
    const fm = await db.settings.get('fontMode');
    if (fm?.value === 'serif' || fm?.value === 'mono' || fm?.value === 'default') setFontMode(fm.value);
    const savedTheme = await db.settings.get('appTheme');
    if (savedTheme?.value === 'light' || savedTheme?.value === 'dark' || savedTheme?.value === 'modern') setAppTheme(savedTheme.value);
    const savedPinned = await db.settings.get('pinnedTabIds');
    if (Array.isArray(savedPinned?.value)) setPinnedTabIds(savedPinned.value.filter((id: string) => id === '__library__' || all.some(p => p.id === id)));
    const savedPaletteHistory = await db.settings.get('paletteHistory');
    if (Array.isArray(savedPaletteHistory?.value)) setPaletteHistory(savedPaletteHistory.value.slice(0, 10));
    const savedAddons = await db.settings.get('enabledAddons');
    if (savedAddons?.value && typeof savedAddons.value === 'object') setEnabledAddons({ ...DEFAULT_ADDONS, ...savedAddons.value });
    if ((import.meta as any).env?.DEV) {
      const [workspacePageCount, workspaceBlockCount, activeBlockCount] = await Promise.all([
        db.pages.where('workspaceId').equals(effectiveWorkspaceId).count(),
        db.blocks.where('workspaceId').equals(effectiveWorkspaceId).count(),
        id ? db.blocks.where('pageId').equals(id).count() : Promise.resolve(0)
      ]);
      console.info('[noteX diagnostics]', {
        workspaceId: effectiveWorkspaceId,
        pagesLoaded: all.length,
        workspacePageCount,
        workspaceBlockCount,
        activePageId: id || null,
        activeBlockCount,
        snapshotCount: totalSnapshots,
        latestSnapshotMetaLoadedOnly: latestSnapshotMetas.length > 0,
        sidebarCollapsed
      });
    }
    if (all.length === 0) {
      setSidebarCollapsed(true);
      setCollapsedSections({ recents: true, favorites: true, organize: true, others: true, addons: false });
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLoginHeroIndex(i => (i + 1) % loginHeroImages.length);
    }, 6500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const openHashPage = async () => {
      const hashPageId = getHashPageId();
      if (!hashPageId) return;
      const page = await db.pages.get(hashPageId);
      if (!page || page.deleted) return;
      if (page.workspaceId && page.workspaceId !== activeWorkspaceId) {
        await db.settings.put({ key: 'activeWorkspaceId', value: page.workspaceId });
        await load(page.workspaceId);
      }
      await selectPage(hashPageId, false);
    };
    window.addEventListener('hashchange', openHashPage);
    return () => window.removeEventListener('hashchange', openHashPage);
  }, [activeWorkspaceId]);

  useEffect(() => {
    setPageLoadMs(activePageId ? null : null);
  }, [activePageId]);


  useEffect(() => {
    const applyResponsiveSidebar = () => {
      const narrow = window.innerWidth < 980;
      if (narrow) {
        if (!sidebarCollapsed) {
          lastExpandedSidebarWidthRef.current = sidebarWidth;
          autoCollapsedRef.current = true;
          setSidebarCollapsed(true);
        }
        return;
      }
      if (autoCollapsedRef.current) {
        autoCollapsedRef.current = false;
        setSidebarCollapsed(false);
        setSidebarWidth(w => Math.min(420, Math.max(230, lastExpandedSidebarWidthRef.current || w || 280)));
      }
    };
    applyResponsiveSidebar();
    window.addEventListener('resize', applyResponsiveSidebar);
    return () => window.removeEventListener('resize', applyResponsiveSidebar);
  }, [sidebarCollapsed, sidebarWidth]);

  useEffect(() => {
    const main = document.querySelector('.main') as HTMLElement | null;
    const updateTopButton = () => {
      const mainTop = main?.scrollTop || 0;
      const windowTop = window.scrollY || document.documentElement.scrollTop || 0;
      setShowTopButton(Math.max(mainTop, windowTop) > 280);
    };
    window.addEventListener('scroll', updateTopButton, { passive: true });
    main?.addEventListener('scroll', updateTopButton, { passive: true });
    updateTopButton();
    return () => {
      window.removeEventListener('scroll', updateTopButton);
      main?.removeEventListener('scroll', updateTopButton);
    };
  }, [activePageId, libraryOpen]);

  function scrollNoteXToTop() {
    const main = document.querySelector('.main') as HTMLElement | null;
    if (main && main.scrollHeight > main.clientHeight) main.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }


  async function refreshKnownUsers() {
    const users = await db.users.toArray();
    const sorted = users.sort((a, b) => {
      const rank = (u: User) => u.provider === 'local' ? 0 : 1;
      return rank(a) - rank(b) || b.updatedAt - a.updatedAt || a.email.localeCompare(b.email);
    });
    setKnownUsers(sorted);
  }

  useEffect(() => { if (authOpen) void refreshKnownUsers(); }, [authOpen, currentUser?.id]);

  async function switchToGoogleUser(userId: string) {
    const user = await db.users.get(userId);
    if (!user || user.provider !== 'google') return;
    setPendingGoogleSwitchUserId(userId);
    setGoogleInitError('Please confirm this Google account before switching.');
    void triggerGoogleLogin(userId);
  }

  async function activateGoogleUser(user: User) {
    const userWorkspaces = await ensureUserWorkspaces(user);
    const savedWs = await db.settings.get(`activeWorkspaceId:${user.id}`);
    const fallback = userWorkspaces.find(w => w.type === 'personal') || userWorkspaces[0];
    const workspaceId = userWorkspaces.some(w => w.id === savedWs?.value) ? savedWs!.value : fallback?.id;
    await db.settings.put({ key: 'activeUserId', value: user.id });
    if (workspaceId) {
      await db.settings.put({ key: `activeWorkspaceId:${user.id}`, value: workspaceId });
      await db.settings.put({ key: 'activeWorkspaceId', value: workspaceId });
    }
    await db.settings.put({ key: 'syncProvider', value: `Google SSO connected: ${user.email}` });
    setAuthOpen(false);
    setWorkspaceMenuOpen(false);
    setPendingGoogleSwitchUserId(null);
    setGoogleInitError('');
    setSyncStatus(`Google SSO connected: ${user.email}`);
    await load(workspaceId);
  }

  useEffect(() => {
    if ((!authOpen && currentUser) || !GOOGLE_CLIENT_ID || !googleButtonRef.current) return;
    let cancelled = false;
    setGoogleInitError('');
    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !googleButtonRef.current || !window.google?.accounts?.id) return;
        googleButtonRef.current.innerHTML = '';
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          locale: 'en',
          callback: (response: { credential?: string }) => {
            if (response?.credential) void handleGoogleCredential(response.credential);
          }
        });
        window.google.accounts.id.renderButton(googleButtonRef.current, { theme: 'outline', size: 'large', width: 260, text: 'signin_with' });
      })
      .catch(error => setGoogleInitError(error instanceof Error ? error.message : 'Unable to initialize Google Sign-In.'));
    return () => { cancelled = true; };
  }, [authOpen, currentUser, authChecked]);

  useEffect(() => {
    const tick = () => {
      const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setAutoSaveText(`Autosaved ${stamp}`);
      void db.settings.put({ key: 'lastAutoSaveAt', value: Date.now() });
    };
    tick();
    const timer = window.setInterval(tick, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if (e.key === 'Escape') {
        setPageMenuId(null);
        setPageMenuInstance(null);
        setPageMenuPos(null);
        setSectionMenuId(null);
        setMoveModalFor(null);
        setActionMenuOpen(false);
        setWorkspaceMenuOpen(false);
        setLibrarySearchOpen(false);
        setLibraryFilterOpen(false);
      setTabMenu(null);
      setExportMenuOpen(false);
        setTrashOpen(false);
        setTabMenu(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const closeFloatingMenus = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.page-menu-popover, .move-modal-inline, .move-backdrop-inline, .section-menu-popover, .workspace-menu, .side-more, .mini, .section-mini, .brand-profile, .library-filter-popover, .library-tools, .tab-context-menu, .export-more-wrap, .export-more-menu, .backup-modal, .workspace-manager-modal, .account-settings-modal')) return;
      setPageMenuId(null);
      setPageMenuInstance(null);
      setPageMenuPos(null);
      setSectionMenuId(null);
      setSectionMenuPos(null);
      setWorkspaceMenuOpen(false);
      setLibraryFilterOpen(false);
      setTabMenu(null);
      setExportMenuOpen(false);
    };
    window.addEventListener('mousedown', closeFloatingMenus);
    return () => window.removeEventListener('mousedown', closeFloatingMenus);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const next = Math.min(420, Math.max(230, e.clientX));
      setSidebarWidth(next);
    };
    const onUp = async () => {
      if (!resizeRef.current) return;
      resizeRef.current = false;
      await db.settings.put({ key: 'sidebarWidth', value: sidebarWidth });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [sidebarWidth]);

  const pageById = useMemo(() => new Map(pages.map(p => [p.id, p])), [pages]);
  const pageChildrenByParent = useMemo(() => {
    const map = new Map<string, Page[]>();
    for (const page of pages) {
      if (!page.parentId || page.deleted) continue;
      const bucket = map.get(page.parentId) || [];
      if (bucket.length < 8) bucket.push(page);
      map.set(page.parentId, bucket);
    }
    return map;
  }, [pages]);
  const activePage = useMemo(() => activePageId ? pageById.get(activePageId) : undefined, [pageById, activePageId]);
  useEffect(() => {
    const el = pageTitleRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.style.height = 'auto';
      el.style.height = `${Math.max(58, el.scrollHeight + 10)}px`;
    });
  }, [activePage?.id, activePage?.title]);

  useEffect(() => {
    if (!activePage || pendingTitleFocusRef.current !== activePage.id) return;
    pendingTitleFocusRef.current = null;
    requestAnimationFrame(() => {
      const el = pageTitleRef.current;
      if (!el) return;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  }, [activePage?.id]);

  const sidebarQueryText = useMemo(() => deferredSidebarQuery.trim().toLowerCase(), [deferredSidebarQuery]);
  const searchablePages = useMemo(() => {
    if (!sidebarQueryText) return pages;
    return pages.filter(p => p.title.toLowerCase().includes(sidebarQueryText));
  }, [pages, sidebarQueryText]);
  const normalPages = useMemo(() => searchablePages.filter(p => p.section !== 'other'), [searchablePages]);
  const otherPages = useMemo(() => searchablePages.filter(p => p.section === 'other' || ['canvas ideas', 'project database', 'research notes'].includes(p.title.toLowerCase())), [searchablePages]);
  const recentPages = useMemo(() => [...searchablePages].sort((a, b) => (b.lastOpenedAt || b.updatedAt) - (a.lastOpenedAt || a.updatedAt)).slice(0, 5), [searchablePages]);
  const favoritePages = useMemo(() => searchablePages.filter(p => p.favorite), [searchablePages]);
  const childCountForPage = useCallback((id: string) => (pageChildrenByParent.get(id) || []).filter(p => !p.deleted).length, [pageChildrenByParent]);
  const sortedRecentPages = useMemo(() => sortFolderFirst(recentPages, childCountForPage), [recentPages, childCountForPage]);
  const sortedFavoritePages = useMemo(() => sortFolderFirst(favoritePages, childCountForPage), [favoritePages, childCountForPage]);
  const sortedOtherPages = useMemo(() => sortFolderFirst(otherPages, childCountForPage), [otherPages, childCountForPage]);
  const tree = useMemo(() => buildTree(normalPages), [normalPages]);
  const recentTree = useMemo(() => buildTree(sortedRecentPages), [sortedRecentPages]);
  const favoriteTree = useMemo(() => buildTree(sortedFavoritePages), [sortedFavoritePages]);
  const otherTree = useMemo(() => buildTree(sortedOtherPages), [sortedOtherPages]);
  const breadcrumbs = useMemo(() => {
    const path: Page[] = [];
    let cur = activePage;
    while (cur) {
      path.unshift(cur);
      cur = cur.parentId ? pageById.get(cur.parentId) : undefined;
    }
    return path;
  }, [pageById, activePage]);

  const openTabs = useMemo(() => {
    const pinned = openTabIds.filter(id => pinnedTabIds.includes(id));
    const regular = openTabIds.filter(id => !pinnedTabIds.includes(id));
    return [...pinned, ...regular].map(id => pageById.get(id)).filter(Boolean).slice(0, 10) as Page[];
  }, [openTabIds, pinnedTabIds, pageById]);
  const formatPageMetaDate = (ts: number) => new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const pageMetaText = activePage ? `Created ${formatPageMetaDate(activePage.createdAt)} — Updated ${formatPageMetaDate(activePage.updatedAt)}` : '';
  const latestSnapshot = snapshots[0] || null;
  const formatSnapshotLabel = (label?: string) => (label || 'Manual snapshot').replace(/^Manual snapshot/i, 'Manual');

  useEffect(() => {
    const el = pageTitleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(58, el.scrollHeight + 10)}px`;
  }, [activePage?.id, activePage?.title]);

  function formatAgo(ts?: number) {
    if (!ts) return '-';
    const diff = Math.max(0, Date.now() - ts);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 31) return `${days}d ago`;
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }


  useEffect(() => {
    if (!actionMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (topActionsRef.current && !topActionsRef.current.contains(target)) setActionMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [actionMenuOpen]);

  async function selectPage(id: string, pushHistory = true) {
    const t = now();
    setActivePageId(id);
    setOpenTabIds(prev => prev.includes(id) ? prev : [...prev, id]);
    if (pushHistory) {
      setHistoryIds(prev => {
        const base = historyIndex >= 0 ? prev.slice(0, historyIndex + 1) : prev;
        if (base.at(-1) === id) return base;
        const next = [...base, id];
        setHistoryIndex(next.length - 1);
        return next;
      });
    }
    setPages(ps => ps.map(p => p.id === id ? { ...p, lastOpenedAt: t } : p));
    await db.pages.update(id, { lastOpenedAt: t });
    await db.settings.put({ key: `activePageId:${activeWorkspaceId}`, value: id });
    await db.settings.put({ key: 'activePageId', value: id });
    setPaletteOpen(false);
  }


  function goHome() {
    if (sidebarCollapsed) setSidebarCollapsed(false);
    setLibraryOpen(false);
    const homePage = normalPages.find(p => !p.parentId && !p.deleted) || normalPages[0] || pages.find(p => !p.deleted);
    if (homePage) {
      void selectPage(homePage.id);
    } else {
      setLibraryOpen(true);
    }
  }

  function closeTab(id: string) {
    setTabMenu(null);
    const idx = openTabIds.indexOf(id);
    const next = openTabIds.filter(x => x !== id);
    setOpenTabIds(next);
    if (id === activePageId) {
      const fallback = next[idx] || next[idx - 1] || '';
      if (fallback) {
        selectPage(fallback);
      } else {
        setActivePageId('');
        setHistoryIndex(-1);
        void db.settings.delete(`activePageId:${activeWorkspaceId}`);
        void db.settings.delete('activePageId');
      }
    }
  }


  async function togglePinnedTab(id: string) {
    setPinnedTabIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      void db.settings.put({ key: 'pinnedTabIds', value: next });
      return next;
    });
    if (id !== '__library__') setOpenTabIds(prev => prev.includes(id) ? prev : [id, ...prev]);
    setTabMenu(null);
  }

  function closeOtherTabs(id: string) {
    const keep = new Set([...pinnedTabIds, id]);
    setOpenTabIds(prev => prev.filter(x => keep.has(x)));
    if (!keep.has(activePageId)) selectPage(id);
    setTabMenu(null);
  }

  function closeTabsToRight(id: string) {
    setOpenTabIds(prev => {
      const ordered = [...prev];
      const idx = ordered.indexOf(id);
      if (idx < 0) return prev;
      const keep = new Set([...ordered.slice(0, idx + 1), ...pinnedTabIds]);
      return ordered.filter(x => keep.has(x));
    });
    setTabMenu(null);
  }


  async function duplicateTab(pageId: string) {
    await duplicatePage(pageId);
    setTabMenu(null);
  }

  function TabContextMenu() {
    if (!tabMenu) return null;
    const isLibrary = tabMenu.pageId === '__library__';
    const page = isLibrary ? ({ id: '__library__', title: 'Library' } as Page) : pages.find(p => p.id === tabMenu.pageId);
    if (!page) return null;
    const pinned = pinnedTabIds.includes(page.id);
    return createPortal(<div className="tab-context-menu floating-popover" style={({ '--tab-menu-left': `${tabMenu.left}px`, '--tab-menu-top': `${tabMenu.top}px` } as React.CSSProperties)} onClick={e => e.stopPropagation()}>
      <button onClick={() => togglePinnedTab(page.id)}>{pinned ? <PinOff size={14}/> : <Pin size={14}/>}<span>{pinned ? 'Unpin tab' : 'Pin tab'}</span></button>
      {!isLibrary && <button onClick={() => duplicateTab(page.id)}><Copy size={14}/><span>Duplicate tab</span></button>}
      <button onClick={() => { isLibrary ? setLibraryOpen(false) : closeTab(page.id); setTabMenu(null); }}><X size={14}/><span>Close tab</span></button>
      {!isLibrary && <button onClick={() => closeOtherTabs(page.id)}><PanelLeft size={14}/><span>Close other tabs</span></button>}
      {!isLibrary && <button onClick={() => closeTabsToRight(page.id)}><ChevronRight size={14}/><span>Close tabs to the right</span></button>}
    </div>, document.body);
  }

  function navigateTab(direction: -1 | 1) {
    const tabs = openTabs.filter(t => !t.deleted);
    if (!tabs.length || libraryOpen) return;
    const current = tabs.findIndex(t => t.id === activePageId);
    if (current < 0) return;
    const next = current + direction;
    if (next < 0 || next >= tabs.length) return;
    selectPage(tabs[next].id);
  }

  function pageDepth(parentId: string | null): number {
    if (!parentId) return 0;
    const byId = new Map(pages.map(p => [p.id, p]));
    let depth = 1;
    let cur = byId.get(parentId);
    while (cur?.parentId) { depth += 1; cur = byId.get(cur.parentId); }
    return depth;
  }

  async function openQuickNew(parentId: string | null = null) {
    if (!currentUser || !activeWorkspaceId) {
      setAuthOpen(true);
      return;
    }
    if (parentId && pageDepth(parentId) >= 3) {
      setSimpleModal({ title: 'Maximum depth reached', message: 'Maximum subpage depth is 3.', confirmText: 'Done' });
      return;
    }
    setNewPageChoice({ parentId });
  }

  async function createPage(parentId: string | null = null, title = 'New Page', initialBlockType: BlockType = 'paragraph', initialText = '', editorMode: 'block' | 'plain' = 'block') {
    if (!currentUser || !activeWorkspaceId) {
      setAuthOpen(true);
      return;
    }
    if (parentId && pageDepth(parentId) >= 3) {
      setSimpleModal({ title: 'Maximum depth reached', message: 'Maximum subpage depth is 3.', confirmText: 'Done' });
      return;
    }
    const t = now();
    const id = uid();
    const workspaceId = activeWorkspaceId;
    await db.pages.add({ id, workspaceId, title: title.trim() || 'New Page', icon: editorMode === 'plain' ? '📝' : '📄', parentId, collapsed: 1, favorite: 0, lastOpenedAt: t, section: undefined, createdAt: t, updatedAt: t, editorMode });
    await db.blocks.add({ id: uid(), workspaceId, pageId: id, type: editorMode === 'plain' ? 'richDocument' : initialBlockType, text: editorMode === 'plain' ? '<p><br></p>' : initialText, sort: 1, createdAt: t, updatedAt: t });
    await db.settings.put({ key: `activePageId:${workspaceId}`, value: id });
    await db.settings.put({ key: 'activePageId', value: id });
    setActivePageId(id);
    setOpenTabIds(prev => prev.includes(id) ? prev : [...prev, id]);
    setHistoryIds(prev => [...prev, id]);
    setHistoryIndex(prev => prev + 1);
    await load();
  }

  async function toggleCollapse(id: string) {
    const p = pages.find(x => x.id === id);
    if (!p) return;
    await db.pages.update(id, { collapsed: p.collapsed ? 0 : 1 });
    await load();
  }

  function toggleSection(key: SidebarSectionKey) {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  async function updateTitle(title: string, refreshState = true) {
    if (!activePage) return;
    const cleanTitle = title.replace(/\u00a0/g, ' ').trimEnd();
    const t = now();
    await db.pages.update(activePage.id, { title: cleanTitle, updatedAt: t });
    if (refreshState) setPages(pages.map(p => p.id === activePage.id ? { ...p, title: cleanTitle, updatedAt: t } : p));
  }

  async function setWorkspaceFont(mode: 'default' | 'serif' | 'mono') {
    setFontMode(mode);
    await db.settings.put({ key: 'fontMode', value: mode });
  }

  async function setNoteXTheme(theme: AppTheme) {
    setAppTheme(theme);
    await db.settings.put({ key: 'appTheme', value: theme });
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-notex-theme', appTheme);
  }, [appTheme]);

  async function toggleFavorite() {
    if (!activePage) return;
    const favorite = activePage.favorite ? 0 : 1;
    await db.pages.update(activePage.id, { favorite, updatedAt: now() });
    await load();
  }

  async function deletePage() {
    if (!activePage) return;
    const ids = new Set([activePage.id]);
    let changed = true;
    while (changed) {
      changed = false;
      pages.forEach(p => {
        if (p.parentId && ids.has(p.parentId) && !ids.has(p.id)) {
          ids.add(p.id);
          changed = true;
        }
      });
    }
    await Promise.all([...ids].map(id => db.pages.update(id, { deleted: 1, updatedAt: now() })));
    setActivePageId('');
    await db.settings.delete(`activePageId:${activeWorkspaceId}`);
    await db.settings.delete('activePageId');
    await load();
  }


  async function favoritePage(id: string) {
    const p = pages.find(x => x.id === id);
    if (!p) return;
    await db.pages.update(id, { favorite: p.favorite ? 0 : 1, updatedAt: now() });
    setPageMenuId(null); setPageMenuInstance(null); setPageMenuPos(null); await load();
  }

  async function copyPageLink(id: string) {
    const link = `${location.origin}${location.pathname}${location.search}#page-${id}`;
    await navigator.clipboard?.writeText(link);
    setPageMenuId(null); setPageMenuInstance(null); setPageMenuPos(null);
    setSimpleModal({ title: 'Copied link', message: 'The page link has been copied to your clipboard.', confirmText: 'Done' });
  }

  async function duplicatePage(id: string) {
    const source = pages.find(p => p.id === id);
    if (!source) return;
    const t = now();
    const newId = uid();
    await db.pages.add({ ...source, id: newId, workspaceId: activeWorkspaceId, title: `${source.title} copy`, favorite: 0, lastOpenedAt: t, createdAt: t, updatedAt: t });
    const blocks = await db.blocks.where('pageId').equals(id).toArray();
    await db.blocks.bulkAdd(blocks.map(b => ({ ...b, id: uid(), workspaceId: activeWorkspaceId, pageId: newId, createdAt: t, updatedAt: t })));
    setPageMenuId(null); setPageMenuInstance(null); setPageMenuPos(null); await selectPage(newId); await load();
  }

  async function renamePage(id: string) {
    const p = pages.find(x => x.id === id);
    if (!p) return;
    setSimpleModal({
      title: 'Rename page',
      message: 'Enter a new title for this page.',
      inputValue: p.title,
      inputPlaceholder: 'Page title',
      confirmText: 'Rename',
      onInputConfirm: async (value) => {
        const title = value.trim();
        if (!title) return;
        await db.pages.update(id, { title, updatedAt: now() });
        setPageMenuId(null); setPageMenuInstance(null); setPageMenuPos(null); await load();
      }
    });
  }

  function isDescendant(parentId: string, childId: string): boolean {
    const byId = new Map(pages.map(p => [p.id, p]));
    let cur = byId.get(childId);
    while (cur?.parentId) {
      if (cur.parentId === parentId) return true;
      cur = byId.get(cur.parentId);
    }
    return false;
  }

  function canMoveTo(pageId: string, parentId: string | null) {
    if (!parentId) return true;
    if (pageId === parentId) return false;
    if (isDescendant(pageId, parentId)) return false;
    return pageDepth(parentId) < 3;
  }

  async function movePageTo(id: string, parentId: string | null) {
    if (!canMoveTo(id, parentId)) { setSimpleModal({ title: 'Cannot move page', message: 'Maximum subpage depth is 3.', confirmText: 'Done' }); return; }
    await db.pages.update(id, { parentId, updatedAt: now() });
    setPageMenuId(null); setPageMenuInstance(null); setPageMenuPos(null); setMoveModalFor(null); setMoveQuery(''); await load();
  }

  async function movePage(id: string) {
    setMoveModalFor(id);
    setMoveQuery('');
    setMoveActiveIndex(0);
  }

  async function dropPageOn(targetParentId: string | null) {
    if (!dragPageId) return;
    await movePageTo(dragPageId, targetParentId);
    setDragPageId(null);
    setSidebarDropLine(null);
  }

  async function sortSection(id: SidebarSectionKey) {
    // Sorting is visual in this local-first prototype; the section already sorts by last edited.
    setSectionMenuId(null);
  }

  function moveSection(id: SidebarSectionKey, direction: 'up' | 'down') {
    // Reserved for customizable section ordering in a future release.
    setSectionMenuId(null);
  }

  function hideSection(id: SidebarSectionKey) {
    setHiddenSections(prev => ({ ...prev, [id]: true }));
    setSectionMenuId(null);
  }

  function customizeSidebar() {
    setHiddenSections({ recents: false, favorites: false, organize: false, others: false, addons: false });
    setSectionMenuId(null);
    setSimpleModal({ title: 'Sidebar customized', message: 'Sidebar sections have been restored. Section ordering will be expanded in the next release.', confirmText: 'Done' });
  }


  async function performDeleteSpecificPage(id: string) {
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      pages.forEach(child => {
        if (child.parentId && ids.has(child.parentId) && !ids.has(child.id)) {
          ids.add(child.id);
          changed = true;
        }
      });
    }
    await Promise.all([...ids].map(pid => db.pages.update(pid, { deleted: 1, updatedAt: now() })));
    setPageMenuId(null);
    setPageMenuInstance(null);
    setPageMenuPos(null);
    if (ids.has(activePageId)) {
      setActivePageId('');
      await db.settings.delete(`activePageId:${activeWorkspaceId}`);
      await db.settings.delete('activePageId');
    }
    await load();
  }

  async function deleteSpecificPage(id: string) {
    const p = pages.find(x => x.id === id);
    if (!p) return;
    setPageMenuId(null); setPageMenuInstance(null); setPageMenuPos(null);
    setSimpleModal({
      title: 'Move to Trash',
      message: `Move "${p.title}" to trash?`,
      confirmText: 'Move to Trash',
      onConfirm: () => { void performDeleteSpecificPage(id); }
    });
  }

  function toggleLibrarySelection(id: string) {
    setSelectedLibraryIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  }

  async function deleteSelectedLibraryPages() {
    const ids = selectedLibraryIds.filter(id => pages.some(p => p.id === id && !p.deleted));
    if (!ids.length) return;
    setSimpleModal({
      title: 'Move selected pages to trash',
      message: `Move ${ids.length} selected page${ids.length > 1 ? 's' : ''} to trash?`,
      confirmText: 'Move to Trash',
      onConfirm: async () => {
        for (const id of ids) await performDeleteSpecificPage(id);
        setSelectedLibraryIds([]);
      }
    });
  }


  async function openTrashModal() {
    const trashed = (await db.pages.orderBy('updatedAt').reverse().toArray()).filter(p => p.workspaceId === activeWorkspaceId && !!p.deleted);
    setTrashPages(trashed);
    setTrashQuery('');
    setSelectedTrashIds([]);
    setTrashOpen(true);
  }

  async function restoreTrashedPage(id: string) {
    await db.pages.update(id, { deleted: 0, updatedAt: now() });
    await load();
    const trashed = (await db.pages.orderBy('updatedAt').reverse().toArray()).filter(p => p.workspaceId === activeWorkspaceId && !!p.deleted);
    setTrashPages(trashed);
  }

  async function permanentlyDeletePage(id: string) {
    const ids = new Set([id]);
    const allPages = await db.pages.toArray();
    let changed = true;
    while (changed) {
      changed = false;
      allPages.forEach(child => {
        if (child.parentId && ids.has(child.parentId) && !ids.has(child.id)) {
          ids.add(child.id);
          changed = true;
        }
      });
    }
    for (const pid of ids) {
      await db.blocks.where('pageId').equals(pid).delete();
      await db.pages.delete(pid);
    }
    await load();
    const trashed = (await db.pages.orderBy('updatedAt').reverse().toArray()).filter(p => p.workspaceId === activeWorkspaceId && !!p.deleted);
    setTrashPages(trashed);
  }


  async function permanentlyDeletePages(ids: string[]) {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    if (!uniqueIds.length) return;
    setSimpleModal({
      title: 'Delete permanently?',
      message: `This will permanently delete ${uniqueIds.length} page${uniqueIds.length > 1 ? 's' : ''}. This action cannot be undone.`,
      confirmText: 'Delete permanently',
      onConfirm: async () => {
        for (const id of uniqueIds) await permanentlyDeletePage(id);
        setSelectedTrashIds([]);
      }
    });
  }

  function TrashModal() {
    const visible = trashPages.filter(p => p.title.toLowerCase().includes(trashQuery.toLowerCase()));
    const visibleIds = visible.map(p => p.id);
    const selectedVisible = selectedTrashIds.filter(id => visibleIds.includes(id));
    const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length;
    const byId = new Map([...pages, ...trashPages].map(p => [p.id, p]));
    const pathOf = (p: Page) => {
      const parts: string[] = [];
      let cur: Page | undefined = p;
      while (cur?.parentId && byId.has(cur.parentId)) {
        cur = byId.get(cur.parentId);
        if (cur) parts.unshift(cur.title);
      }
      return parts.length ? parts.join(' / ') : 'Private';
    };
    return createPortal(<div className="trash-backdrop" onClick={() => setTrashOpen(false)}>
      <div className="trash-modal compact-trash-modal" onClick={e => e.stopPropagation()}>
        <label className="trash-search"><Search size={15}/><input autoFocus placeholder="Search pages in Trash" value={trashQuery} onChange={e => setTrashQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setTrashOpen(false); }}/></label>
        <div className="trash-filters compact-trash-filters"><button><Users size={14}/> Last edited by <ChevronDown size={12}/></button><button><FileText size={14}/> In <ChevronDown size={12}/></button><button><LayoutGrid size={14}/> Teamspaces <ChevronDown size={12}/></button></div>
        <div className="trash-bulkbar">
          <label><input type="checkbox" checked={allVisibleSelected} onChange={e => setSelectedTrashIds(e.target.checked ? visibleIds : [])} /> Select all</label>
          <button className="trash-delete-all" disabled={visible.length === 0} onClick={() => permanentlyDeletePages(selectedTrashIds.length ? selectedTrashIds : visibleIds)}><Trash2 size={13}/> Delete {selectedTrashIds.length ? 'selected' : 'all'}</button>
        </div>
        <div className="trash-list compact-trash-list">
          {visible.map(p => <div key={p.id} className={`trash-row ${selectedTrashIds.includes(p.id) ? 'selected' : ''}`}>
            <input className="trash-row-check" type="checkbox" checked={selectedTrashIds.includes(p.id)} onChange={() => setSelectedTrashIds(ids => ids.includes(p.id) ? ids.filter(x => x !== p.id) : [...ids, p.id])}/>
            <FileText size={18}/>
            <div className="trash-row-main"><strong>{p.title}</strong><span>{pathOf(p)}</span></div>
            <button title="Restore page" onClick={() => restoreTrashedPage(p.id)}><RotateCcw size={14}/></button>
            <button title="Delete permanently" onClick={() => permanentlyDeletePages([p.id])}><Trash2 size={14}/></button>
          </div>)}
          {visible.length === 0 && <div className="trash-empty">No deleted pages found.</div>}
        </div>
        <div className="trash-footer compact-trash-footer"><span>Once a page has been in Trash for 30 days, it will be automatically deleted</span><button title="Help">?</button></div>
      </div>
    </div>, document.body);
  }

  function PageMenu({ page }: { page: Page }) {
    const menu = <div className="page-menu-popover floating-popover" style={pageMenuPos ? ({ '--popover-left': `${pageMenuPos.left}px`, '--popover-top': `${pageMenuPos.top}px` } as React.CSSProperties) : undefined} onClick={e => e.stopPropagation()}>
      <div className="page-menu-title">Page</div>
      <button onClick={() => favoritePage(page.id)}><Star size={15}/><span>{page.favorite ? 'Remove Favorite' : 'Add to Favorite'}</span></button>
      <button onClick={() => copyPageLink(page.id)}><Link size={15}/><span>Copy Link</span></button>
      <button onClick={() => duplicatePage(page.id)}><FilePlus size={15}/><span>Duplicate</span></button>
      <button onClick={() => renamePage(page.id)}><FileText size={15}/><span>Rename</span></button>
      <button onClick={(e) => { e.stopPropagation(); movePage(page.id); }}><FolderOpen size={15}/><span>Move To</span></button>
      <div className="page-menu-divider" />
      <button className="danger" onClick={() => deleteSpecificPage(page.id)}><Trash2 size={15}/><span>Move to Trash</span></button>
    </div>;
    return createPortal(menu, document.body);
  }

  async function completeGoogleSignIn(profile: GoogleProfile, migrateLocalData: boolean) {
    const t = now();
    const userId = `google-${profile.sub}`;
    const user: User = {
      id: userId,
      email: profile.email,
      name: profile.name || profile.email,
      avatar: profile.picture,
      provider: 'google',
      providerSub: profile.sub,
      createdAt: (await db.users.get(userId))?.createdAt || t,
      updatedAt: t
    };
    await db.users.put(user);
    const googleWorkspaces = await ensureUserWorkspaces(user);
    const personal = googleWorkspaces.find(w => w.type === 'personal') || googleWorkspaces[0];

    if (migrateLocalData) {
      const localUser = await ensureLocalUser();
      const localWorkspaces = await ensureUserWorkspaces(localUser);
      const targetByType = new Map(googleWorkspaces.map(w => [w.type, w.id]));
      for (const localWs of localWorkspaces) {
        const targetWorkspaceId = targetByType.get(localWs.type) || personal?.id;
        if (!targetWorkspaceId) continue;
        await db.pages.where('workspaceId').equals(localWs.id).modify({ workspaceId: targetWorkspaceId });
        await db.blocks.where('workspaceId').equals(localWs.id).modify({ workspaceId: targetWorkspaceId });
      }
      if (personal) {
        const legacyPages = await db.pages.filter(p => !p.workspaceId).toArray();
        if (legacyPages.length) await Promise.all(legacyPages.map(p => db.pages.update(p.id, { workspaceId: personal.id })));
        const legacyBlocks = await db.blocks.filter(b => !b.workspaceId).toArray();
        if (legacyBlocks.length) await Promise.all(legacyBlocks.map(b => db.blocks.update(b.id, { workspaceId: personal.id })));
      }
    }

    await db.settings.put({ key: 'activeUserId', value: user.id });
    if (personal) {
      await db.settings.put({ key: `activeWorkspaceId:${user.id}`, value: personal.id });
      await db.settings.put({ key: 'activeWorkspaceId', value: personal.id });
    }
    await db.settings.put({ key: 'syncProvider', value: `Google SSO connected: ${profile.email}` });
    setAuthOpen(false);
    setWorkspaceMenuOpen(false);
    setSyncStatus(`Signed in as ${profile.email}`);
    await load(personal?.id);
    setSimpleModal({ title: 'Google account connected', message: `noteX is now using ${profile.email}. Your noteX workspaces remain internal: Personal, Work, and Business.`, confirmText: 'Done' });
  }

  async function handleGoogleProfile(profile: GoogleProfile) {
    try {
      const userId = `google-${profile.sub}`;
      if (pendingGoogleSwitchUserId) {
        if (pendingGoogleSwitchUserId !== userId) {
          setPendingGoogleSwitchUserId(null);
          setGoogleInitError('The selected Google account does not match the account you chose to switch to.');
          setSimpleModal({ title: 'Google account mismatch', message: 'Please sign in with the same Google account that you selected in Account Center.', confirmText: 'Done' });
          return;
        }
        const existing = await db.users.get(userId);
        if (existing) {
          await activateGoogleUser(existing);
          return;
        }
      }
      const localUser = await ensureLocalUser();
      const localWorkspaces = await ensureUserWorkspaces(localUser);
      const localWorkspaceIds = new Set(localWorkspaces.map(w => w.id));
      const localPages = await db.pages.filter(p => !!p.workspaceId && localWorkspaceIds.has(p.workspaceId) && !p.deleted).toArray();
      const targetUser = await db.users.get(userId);
      if (currentUser?.provider === 'local' && !targetUser && localPages.length > 0) {
        setSimpleModal({
          title: 'Move local notes to Google account?',
          message: `You have ${localPages.length} local page${localPages.length > 1 ? 's' : ''}. Click Continue to bind those notes to ${profile.email}. Close this dialog to keep using local mode.`,
          confirmText: 'Continue',
          onConfirm: () => { void completeGoogleSignIn(profile, true); }
        });
        return;
      }
      await completeGoogleSignIn(profile, false);
    } catch (error) {
      setSimpleModal({ title: 'Google sign-in failed', message: error instanceof Error ? error.message : 'Unable to read the Google profile.', confirmText: 'Done' });
    }
  }

  async function handleGoogleCredential(credential: string) {
    try {
      const profile = decodeGoogleCredential(credential);
      await handleGoogleProfile(profile);
    } catch (error) {
      setSimpleModal({ title: 'Google sign-in failed', message: error instanceof Error ? error.message : 'Unable to read the Google credential.', confirmText: 'Done' });
    }
  }

  async function signOutNoteX() {
    await db.settings.delete('activeUserId');
    await db.settings.delete('activeWorkspaceId');
    await db.settings.put({ key: 'syncProvider', value: 'Signed out' });
    try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch {}
    setAuthOpen(false);
    setWorkspaceMenuOpen(false);
    setCurrentUser(null);
    setWorkspaces([]);
    setActiveWorkspaceId('');
    setActivePageId('');
    setPages([]);
    setTrashPages([]);
    setOpenTabIds([]);
    setHistoryIds([]);
    setHistoryIndex(-1);
    setSyncStatus('Signed out');
    setAuthChecked(true);
  }


  async function handleRestore(file?: File) {
    if (!file) return;
    try {
      await restoreBackup(file);
      await load();
      setBackupOpen(false);
      setSimpleModal({ title: 'Restore complete', message: 'noteX backup restored successfully.', confirmText: 'Done' });
    } catch (error) {
      setSimpleModal({ title: 'Restore failed', message: error instanceof Error ? error.message : 'The selected file could not be restored.', confirmText: 'Done' });
    }
  }

  async function makeSnapshot() {
    try {
      const meta = await createSnapshot('Manual snapshot');
      const [latestSnapshotMetas, totalSnapshots] = await Promise.all([getSnapshotMetas(1), db.snapshots.count()]);
      setSnapshots(latestSnapshotMetas);
      setSnapshotCount(totalSnapshots);
      if (snapshotHistoryOpen) setSnapshotHistory(await getSnapshotMetas(20));
      setSimpleModal({ title: 'Snapshot created', message: `A local snapshot has been created. Estimated size: ${formatBytes(meta.sizeBytes || 0)}.`, confirmText: 'Done' });
    } catch (error) {
      setSimpleModal({ title: 'Snapshot failed', message: error instanceof Error ? error.message : 'The local snapshot could not be created.', confirmText: 'Done' });
    }
  }

  async function restoreSnap(id: string) {
    setSimpleModal({
      title: 'Restore snapshot',
      message: 'Restore this snapshot? Current local data will be replaced.',
      confirmText: 'Restore',
      onConfirm: async () => { await restoreSnapshot(id); await load(); }
    });
  }

  async function refreshSnapshotState() {
    const [latestSnapshotMetas, totalSnapshots] = await Promise.all([getSnapshotMetas(1), db.snapshots.count()]);
    setSnapshots(latestSnapshotMetas);
    setSnapshotCount(totalSnapshots);
    if (snapshotHistoryOpen) setSnapshotHistory(await getSnapshotMetas(20));
  }

  async function deleteSnapshot(id: string) {
    await deleteSnapshotEverywhere(id);
    await refreshSnapshotState();
  }

  async function deleteAllSnapshotData() {
    await deleteAllSnapshots();
    await refreshSnapshotState();
    setSimpleModal({ title: 'Snapshots deleted', message: 'All local snapshots have been deleted from this browser.', confirmText: 'Done' });
  }

  async function cleanupOldSnapshotData() {
    const removed = await deleteOldSnapshots(10);
    await refreshSnapshotState();
    setSimpleModal({ title: 'Snapshot cleanup complete', message: removed ? `Deleted ${removed} old snapshots and kept the latest 10.` : 'No old snapshots needed to be deleted.', confirmText: 'Done' });
  }

  async function refreshStorageDiagnostics() {
    const stats = await getStorageDiagnostics(activeWorkspaceId, activePageId);
    setStorageDiagnostics(stats);
  }


  useEffect(() => {
    if (!snapshotHistoryOpen) return;
    let cancelled = false;
    getSnapshotMetas(20)
      .then(items => { if (!cancelled) setSnapshotHistory(items); })
      .catch(error => console.warn('[noteX snapshots] Failed to load snapshot history', error));
    return () => { cancelled = true; };
  }, [snapshotHistoryOpen]);


  function AuthModal() {
    if (!authOpen) return null;
    const localUser = knownUsers.find(u => u.provider === 'local');
    const googleUsers = knownUsers.filter(u => u.provider === 'google');
    const localIsCurrent = currentUser?.provider === 'local';
    const googleIsCurrent = currentUser?.provider === 'google';
    return createPortal(
      <div className="auth-backdrop account-center-backdrop" onMouseDown={() => setAuthOpen(false)}>
        <div className="auth-modal account-center-modal" onMouseDown={e => e.stopPropagation()}>
          <div className="auth-head account-center-head">
            <div>
              <h3>Account Center</h3>
              <p>Choose which secured noteX identity you want to use. Local and Google accounts stay separated.</p>
            </div>
            <button className="backup-close" title="Close" onClick={() => setAuthOpen(false)}><X size={16}/></button>
          </div>

          <div className="account-current-card">
            {currentUser?.avatar ? <img src={currentUser.avatar} alt="avatar" /> : <span>{(currentUser?.name || 'N').slice(0,1).toUpperCase()}</span>}
            <div>
              <small>Current session</small>
              <strong>{currentUser?.name || 'Not signed in'}</strong>
              <p>{currentUser?.email || 'Sign in required'} · {currentUser?.provider === 'google' ? 'Google account' : 'Local mode'}</p>
            </div>
          </div>

          <div className="account-list-title">Switch account</div>
          <div className="account-list">
            <div className={`account-switch-card ${localIsCurrent ? 'active' : ''}`}>
              <span className="account-avatar local-avatar"><Lock size={16}/></span>
              <div>
                <strong>Local User</strong>
                <p>{localUser?.email || 'local@notex.app'} · This browser only</p>
              </div>
              {localIsCurrent ? <span className="account-badge">Active</span> : <button onClick={() => { setAuthOpen(false); void openLocalAuth(); }}>Unlock</button>}
            </div>

            {googleUsers.length > 0 ? googleUsers.map(user => {
              const active = currentUser?.id === user.id;
              return <div key={user.id} className={`account-switch-card ${active ? 'active' : ''}`}>
                {user.avatar ? <img className="account-avatar" src={user.avatar} alt="avatar" /> : <span className="account-avatar google-avatar">G</span>}
                <div>
                  <strong>{user.name || user.email}</strong>
                  <p>{user.email} · Google identity</p>
                </div>
                {active ? <span className="account-badge">Active</span> : <button onClick={() => void switchToGoogleUser(user.id)}>Verify & Switch</button>}
              </div>;
            }) : <div className="account-switch-card muted">
              <span className="account-avatar google-avatar">G</span>
              <div>
                <strong>Google Account</strong>
                <p>Sign in to create a Google-bound noteX identity.</p>
              </div>
              <button onClick={() => void triggerGoogleLogin()}>Sign in</button>
            </div>}
          </div>

          {!googleIsCurrent && googleUsers.length === 0 && GOOGLE_CLIENT_ID && <div className="google-button-slot hidden-login-google" ref={googleButtonRef} />}
          {!GOOGLE_CLIENT_ID && <div className="auth-config-warning"><strong>Google Client ID is not configured.</strong><span>Create a <code>.env</code> file and add <code>VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com</code>, then restart <code>npm run dev</code>.</span></div>}
          {googleInitError && <p className="auth-error">{googleInitError}</p>}

          <div className="account-center-info">
            <div><strong>Workspaces</strong><span>{workspaces.map(w => w.name).join(' · ') || 'Personal · Work · Business'}</span></div>
            <p>Switching accounts never merges notes. Use Backup & Restore or migration actions when you intentionally want to move data.</p>
          </div>

          <div className="account-center-actions">
            <button onClick={signOutNoteX}><LogOut size={14}/> Sign Out</button>
          </div>
        </div>
      </div>,
      document.body
    );
  }


  useEffect(() => {
    if (!localAuthOpen) {
      localAuthWasOpenRef.current = false;
      return;
    }
    if (localAuthWasOpenRef.current) return;
    localAuthWasOpenRef.current = true;
    window.requestAnimationFrame(() => {
      if (localPasswordInputRef.current) localPasswordInputRef.current.value = '';
      if (localPasswordConfirmInputRef.current) localPasswordConfirmInputRef.current.value = '';
      localPasswordInputRef.current?.focus({ preventScroll: true });
    });
  }, [localAuthOpen, localAuthMode]);

  async function openLocalAuth() {
    const existingHash = (await db.settings.get('localPasswordHash'))?.value;
    setLocalAuthMode(existingHash ? 'login' : 'setup');
    setLocalAuthError('');
    localAuthWasOpenRef.current = false;
    setLocalAuthOpen(true);
  }

  async function completeLocalLogin() {
    const password = (localPasswordInputRef.current?.value || '').trim();
    if (password.length < 6) {
      setLocalAuthError('Use at least 6 characters for the local password.');
      return;
    }
    try {
      const savedHash = (await db.settings.get('localPasswordHash'))?.value;
      const savedSalt = (await db.settings.get('localPasswordSalt'))?.value;
      if (localAuthMode === 'setup') {
        const confirmPassword = (localPasswordConfirmInputRef.current?.value || '').trim();
        if (password !== confirmPassword) {
          setLocalAuthError('Password confirmation does not match.');
          return;
        }
        const salt = randomSalt();
        const hash = await deriveLocalPasswordHash(password, salt);
        await db.settings.put({ key: 'localPasswordSalt', value: salt });
        await db.settings.put({ key: 'localPasswordHash', value: hash });
      } else {
        if (!savedHash || !savedSalt) {
          setLocalAuthMode('setup');
          setLocalAuthError('Create a local password first.');
          return;
        }
        const hash = await deriveLocalPasswordHash(password, savedSalt);
        if (hash !== savedHash) {
          setLocalAuthError('Incorrect local password.');
          return;
        }
      }
      const identity = await ensureLocalUserAndWorkspaces();
      await db.settings.put({ key: 'activeUserId', value: identity.user.id });
      await db.settings.put({ key: `activeWorkspaceId:${identity.user.id}`, value: identity.activeWorkspaceId });
      await db.settings.put({ key: 'activeWorkspaceId', value: identity.activeWorkspaceId });
      await db.settings.put({ key: 'syncProvider', value: 'Local password mode' });
      setLocalAuthOpen(false);
      setSyncStatus('Local mode');
      await load(identity.activeWorkspaceId);
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : 'Unable to unlock local mode.');
    }
  }

  function LocalAuthModal() {
    if (!localAuthOpen) return null;
    const setup = localAuthMode === 'setup';
    return createPortal(
      <div className="simple-modal-backdrop local-auth-backdrop" onMouseDown={() => setLocalAuthOpen(false)}>
        <form className="simple-modal local-auth-modal stable-local-auth" onMouseDown={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); void completeLocalLogin(); }}>
          <div className="local-auth-icon"><Lock size={18}/></div>
          <h3>{setup ? 'Create Local Password' : 'Unlock Local Mode'}</h3>
          <p>{setup ? 'Protect the local noteX account on this browser with a password.' : 'Enter your local password to continue without Google.'}</p>
          <input ref={localPasswordInputRef} className="local-auth-input" type="password" placeholder="Local password" defaultValue="" />
          {setup && <input ref={localPasswordConfirmInputRef} className="local-auth-input" type="password" placeholder="Confirm password" defaultValue="" />}
          <div className={`auth-error local-auth-error ${localAuthError ? 'visible' : ''}`}>{localAuthError || '\u00A0'}</div>
          <div className="local-auth-actions">
            <button type="button" onClick={() => setLocalAuthOpen(false)}>Cancel</button>
            <button type="submit" className="primary-button">{setup ? 'Create & Continue' : 'Unlock'}</button>
          </div>
          <div className="local-auth-note"><Lock size={12}/> This is a local UI password gate. Your IndexedDB data stays on this browser.</div>
        </form>
      </div>,
      document.body
    );
  }


  async function triggerGoogleLogin(expectedUserId?: string) {
    if (!GOOGLE_CLIENT_ID) return;
    if (expectedUserId) setPendingGoogleSwitchUserId(expectedUserId);
    setGoogleInitError('');
    try {
      await loadGoogleIdentityScript();
      const google = window.google?.accounts;
      if (!google) throw new Error('Google Identity Services is not available.');
      if (google.oauth2?.initTokenClient) {
        const tokenClient = google.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'openid email profile',
          prompt: 'select_account',
          callback: async (tokenResponse: { access_token?: string; error?: string }) => {
            if (tokenResponse?.error) {
              setPendingGoogleSwitchUserId(null);
              setGoogleInitError(tokenResponse.error);
              return;
            }
            if (!tokenResponse?.access_token) {
              setGoogleInitError('Google did not return an access token.');
              return;
            }
            try {
              const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
                headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
              });
              if (!res.ok) throw new Error('Unable to read Google profile.');
              const data = await res.json();
              await handleGoogleProfile({ sub: data.sub, email: data.email, name: data.name || data.email, picture: data.picture });
            } catch (error) {
              setPendingGoogleSwitchUserId(null);
              setGoogleInitError(error instanceof Error ? error.message : 'Unable to finish Google login.');
            }
          }
        });
        tokenClient.requestAccessToken({ prompt: 'select_account' });
        return;
      }
      if (!google.id) throw new Error('Google Identity Services is not available.');
      google.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        locale: 'en',
        callback: (response: { credential?: string }) => {
          if (response?.credential) void handleGoogleCredential(response.credential);
        }
      });
      google.id.prompt((notification: any) => {
        if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) {
          setGoogleInitError('Google sign-in popup was not displayed. Please allow popups or use localhost with the configured Google Client ID.');
        }
      });
    } catch (error) {
      setPendingGoogleSwitchUserId(null);
      setGoogleInitError(error instanceof Error ? error.message : 'Unable to start Google Sign-In.');
    }
  }

  function LoginGate() {
    return <div className="login-gate">
      <div className="login-card modern-login-card">
        <div className="login-visual" aria-hidden="true">{loginHeroImages.map((src, index) => <img key={src} src={src} alt="" className={index === loginHeroIndex ? 'active' : ''} />)}</div>
        <div className="login-glass-panel">
          <div className="login-brand"><BookOpen size={28}/><span>noteX</span></div>
          <div className="login-slogan">Think. Organize. Execute</div>
          <div className="login-actions-stack">
            {GOOGLE_CLIENT_ID ? <>
              <button className="login-google-custom" type="button" onClick={() => void triggerGoogleLogin()}><span className="login-google-g">G</span><span>Login with Google</span></button>
              <div className="google-button-slot login-google-slot hidden-login-google" ref={googleButtonRef} />
            </> : <div className="auth-config-warning"><strong>Google Client ID is not configured.</strong><span>Create a <code>.env</code> file and add <code>VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com</code>, then restart <code>npm run dev</code>.</span></div>}
            <div className="login-divider"><span>or</span></div>
            <button className="login-local-custom" type="button" onClick={() => void openLocalAuth()}><Lock size={15}/><span>Continue Locally</span></button>
          </div>
          {googleInitError && <p className="auth-error">{googleInitError}</p>}
        </div>
      </div>
      <div className="login-footnote"><Lock size={13}/> Google is used only for identity. Local mode stays in this browser.</div>
      {LocalAuthModal()}
      {simpleModal && <div className="simple-modal-backdrop" onClick={() => setSimpleModal(null)}><div className="simple-modal" onClick={e => e.stopPropagation()}><h3>{simpleModal.title}</h3><p>{simpleModal.message}</p><div>{simpleModal.onConfirm && <button className="primary-button" onClick={() => { const fn = simpleModal.onConfirm; setSimpleModal(null); fn?.(); }}>{simpleModal.confirmText || 'Confirm'}</button>}{!simpleModal.onConfirm && <button className="primary-button" onClick={() => setSimpleModal(null)}>{simpleModal.confirmText || 'Done'}</button>}</div></div></div>}
    </div>;
  }


  useEffect(() => {
    if (!backupOpen) return;
    refreshStorageDiagnostics().catch(error => console.warn('[noteX diagnostics] Failed to collect storage diagnostics', error));
  }, [backupOpen, activeWorkspaceId, activePageId]);


  function BackupModal() {
    if (!backupOpen) return null;
    const activePages = pages.filter(p => !p.deleted).length;
    const trashedPages = pages.filter(p => p.deleted).length;
    return createPortal(
      <div className="backup-backdrop" onMouseDown={() => setBackupOpen(false)}>
        <div className="backup-modal" onMouseDown={e => e.stopPropagation()}>
          <div className="backup-head">
            <div>
              <h3>Backup & Restore</h3>
              <p>Move your noteX pages to another desktop by exporting one JSON backup file, then restoring it on the new browser.</p>
            </div>
            <button className="backup-close" title="Close" onClick={() => setBackupOpen(false)}><X size={16}/></button>
          </div>
          <div className="backup-stats">
            <div><strong>{activePages}</strong><span>active pages</span></div>
            <div><strong>{trashedPages}</strong><span>trash</span></div>
            <div><strong>{snapshotCount}</strong><span>snapshots</span></div>
          </div>
          <div className="backup-section-label"><span>Storage diagnostics</span><em>Lightweight local data overview</em></div>
          <div className="storage-diagnostics-card">
            <div className="storage-diagnostics-head"><strong>Local storage status</strong><button onClick={refreshStorageDiagnostics}>Refresh</button></div>
            {storageDiagnostics ? <div className="storage-diagnostics-grid">
              <span><b>{storageDiagnostics.workspacePageCount}</b><em>workspace pages</em></span>
              <span><b>{storageDiagnostics.workspaceBlockCount}</b><em>workspace blocks</em></span>
              <span><b>{storageDiagnostics.activePageBlockCount}</b><em>active page blocks</em></span>
              <span><b>{formatBytes(storageDiagnostics.activePageBytes)}</b><em>active page size</em></span>
              <span><b>{formatBytes(storageDiagnostics.snapshotBytes)}</b><em>tracked snapshots</em></span>
              <span><b>{storageDiagnostics.snapshotCount}</b><em>snapshot records</em></span>
            </div> : <p>Open this panel to calculate lightweight local storage statistics.</p>}
          </div>
          <div className="backup-section-label actions-label"><span>Backup actions</span><em>Export, restore, or create a safe local point</em></div>
          <div className="backup-actions-grid">
            <button className="backup-action-card backup-action-export" onClick={() => { downloadBackup(); setSimpleModal({ title: 'Backup exported', message: 'Your noteX JSON backup download has started. Keep this file together with your noteX app ZIP when moving to another desktop.', confirmText: 'Done' }); }}>
              <Upload size={18}/><strong>Export backup JSON</strong><span>Download pages, blocks, database views, settings, users, and workspaces. Local snapshots are excluded to prevent recursive bloat.</span>
            </button>
            <button className="backup-action-card backup-action-restore" onClick={() => fileRef.current?.click()}>
              <Download size={18}/><strong>Restore from JSON</strong><span>Replace the current browser data with a selected noteX backup file.</span>
            </button>
            <button className="backup-action-card backup-action-snapshot" onClick={() => makeSnapshot()}>
              <Save size={18}/><strong>Create local snapshot</strong><span>Save a non-recursive local restore point inside this browser before large edits.</span>
            </button>
          </div>
          <div className="snapshot-maintenance-row">
            <button onClick={() => setSnapshotHistoryOpen(true)}><History size={14}/>Manage snapshots</button>
            <button onClick={() => setSimpleModal({ title: 'Clean up old snapshots', message: 'Keep only the latest 10 tracked snapshots?', confirmText: 'Clean up', onConfirm: cleanupOldSnapshotData })}><RotateCcw size={14}/>Keep latest 10</button>
            <button className="danger-soft" onClick={() => setSimpleModal({ title: 'Delete all snapshots', message: 'Delete all local snapshots from this browser? This can also remove old oversized legacy snapshots.', confirmText: 'Delete all', onConfirm: deleteAllSnapshotData })}><Trash2 size={14}/>Delete all snapshots</button>
          </div>
          <details className="backup-guide compact-guide">
            <summary>Migration checklist</summary>
            <ol>
              <li>On the old desktop, click <strong>Export backup JSON</strong>.</li>
              <li>Copy <code>noteX-v1.6.157.zip</code> and the exported <code>noteX-backup-*.json</code>.</li>
              <li>Run noteX on the new desktop, then click <strong>Restore from JSON</strong>.</li>
            </ol>
          </details>
          {snapshots.length > 0 && <div className="backup-snapshots">
            <h4>Latest local snapshot</h4>
            {snapshots.slice(0, 1).map(s => <button key={s.id} onClick={() => restoreSnap(s.id)}><History size={13}/><span>{s.label}</span><em>{new Date(s.createdAt).toLocaleString()} · {formatBytes(s.sizeBytes || 0)}</em></button>)}
          </div>}
        </div>
      </div>,
      document.body
    );
  }

  function SidebarPageItem({ page, compact = false, menuKey }: { page: Page; compact?: boolean; menuKey: string }) {
    const isMenuOpen = pageMenuId === page.id && pageMenuInstance === menuKey;
    return <div className={`side-page-row ${page.id === activePageId ? 'selected' : ''} ${compact ? 'compact' : ''}`}>
      <button className="side-page" onClick={() => selectPage(page.id)}>{page.favorite ? <Star size={14} className="favorite-dot"/> : <SidebarPageTypeIcon page={page} hasChildren={(pageChildrenByParent.get(page.id) || []).length > 0} size={14}/>}<span>{page.title}</span></button>
      <button className="side-more" title="Page options" onClick={(e) => { e.stopPropagation(); setSectionMenuId(null); setSectionMenuPos(null); const nextOpen = !(pageMenuId === page.id && pageMenuInstance === menuKey); const r = e.currentTarget.getBoundingClientRect(); setPageMenuPos(nextOpen ? { left: r.right + 8, top: Math.max(8, Math.min(r.top - 6, window.innerHeight - 330)) } : null); setPageMenuId(nextOpen ? page.id : null); setPageMenuInstance(nextOpen ? menuKey : null); }}><MoreHorizontal size={14}/></button>
      {isMenuOpen && <PageMenu page={page}/>} 
    </div>;
  }

  function SectionMenu({ id }: { id: SidebarSectionKey }) {
    const menu = <div className="section-menu-popover floating-popover" style={sectionMenuPos ? ({ '--popover-left': `${sectionMenuPos.left}px`, '--popover-top': `${sectionMenuPos.top}px` } as React.CSSProperties) : undefined} onClick={e => e.stopPropagation()}>
      <button onClick={() => sortSection(id)}><ArrowDown size={15}/><span>Sort</span><em>Last edited</em></button>
      <button onClick={() => sortSection(id)}><span className="hash-icon">#</span><span>Show</span><em>10</em></button>
      <button onClick={() => moveSection(id, 'up')}><ArrowUp size={15}/><span>Move up</span></button>
      <button onClick={() => moveSection(id, 'down')}><ArrowDown size={15}/><span>Move down</span></button>
      <button onClick={() => hideSection(id)}><EyeOff size={15}/><span>Hide section</span></button>
      <div className="page-menu-divider" />
      <button onClick={customizeSidebar}><SlidersHorizontal size={15}/><span>Customize sidebar</span></button>
    </div>;
    return createPortal(menu, document.body);
  }

  function Section({ id, title, icon, children, count }: { id: SidebarSectionKey; title: string; icon: ReactNode; children: React.ReactNode; count?: number }) {
    if (hiddenSections[id]) return null;
    const collapsed = collapsedSections[id];
    return <section className={`side-section ${id}-section`}>
      <div className="side-section-head">
        <button className="side-section-toggle" onClick={() => toggleSection(id)}>
          <span>{icon}</span><strong>{title}</strong>{typeof count === 'number' && <em>{count}</em>}{collapsed ? <ChevronRight size={14}/> : <ChevronDown size={14}/>} 
        </button>
        <button className="section-mini" title="Section options" onClick={(e) => { e.stopPropagation(); setPageMenuId(null); setPageMenuInstance(null); const nextOpen = sectionMenuId !== id; const r = e.currentTarget.getBoundingClientRect(); setSectionMenuPos(nextOpen ? { left: r.right + 8, top: Math.max(8, Math.min(r.top - 6, window.innerHeight - 300)) } : null); setSectionMenuId(nextOpen ? id : null); }}><MoreHorizontal size={14}/></button>
        {id === 'addons' ? <button className="section-mini addon-manage-mini" title="Manage add-ons" onClick={(e) => { e.stopPropagation(); setAddonsOpen(true); }}><Settings2 size={14}/></button> : <button className="section-mini" title="Add new page" onClick={() => openQuickNew(null)}><Plus size={14}/></button>}
        {sectionMenuId === id && <SectionMenu id={id}/>}
      </div>
      {!collapsed && <div className="side-section-body" onDragOver={e => e.preventDefault()} onDrop={() => { setSidebarDropLine(null); return id === 'organize' ? dropPageOn(null) : undefined; }}>{children}</div>}
    </section>;
  }


  function SidebarPageTypeIcon({ page, hasChildren = false, size = 14 }: { page: Pick<Page, 'editorMode'>; hasChildren?: boolean; size?: number }) {
    const mode = page.editorMode || 'block';
    const iconClass = hasChildren ? 'directory' : mode === 'plain' ? 'plain-doc' : 'block-doc';
    return <span className={`notex-sidebar-icon ${iconClass}`} style={{ '--icon-size': `${size}px` } as React.CSSProperties} aria-hidden="true">
      {hasChildren ? <svg viewBox="0 0 24 24" role="img">
        <path className="icon-soft" d="M3.75 7.2h5.7l1.45 1.65h9.35c.75 0 1.35.6 1.35 1.35v7.85c0 .78-.63 1.42-1.42 1.42H3.82c-.78 0-1.42-.64-1.42-1.42V8.55c0-.75.6-1.35 1.35-1.35Z" />
        <path className="icon-line" d="M3.75 7.2h5.7l1.45 1.65h9.35c.75 0 1.35.6 1.35 1.35v7.85c0 .78-.63 1.42-1.42 1.42H3.82c-.78 0-1.42-.64-1.42-1.42V8.55c0-.75.6-1.35 1.35-1.35Z" />
      </svg> : <svg viewBox="0 0 24 24" role="img">
        <path className="icon-soft" d="M6.25 3.5h8.35l3.15 3.25v13.05c0 .94-.76 1.7-1.7 1.7h-9.8c-.94 0-1.7-.76-1.7-1.7V5.2c0-.94.76-1.7 1.7-1.7Z" />
        <path className="icon-line" d="M6.25 3.5h8.35l3.15 3.25v13.05c0 .94-.76 1.7-1.7 1.7h-9.8c-.94 0-1.7-.76-1.7-1.7V5.2c0-.94.76-1.7 1.7-1.7Z" />
        <path className="icon-fold" d="M14.6 3.65v3.1h3" />
        <path className="icon-content" d="M7.8 10.2h6.8M7.8 13.3h6.8M7.8 16.4h4.6" />
      </svg>}
      {!hasChildren && mode !== 'plain' && <span className="notex-sidebar-slash">/</span>}
    </span>;
  }

  function PageTree({ nodes, depth = 0, menuKeyPrefix = 'tree' }: { nodes: TreeNode[]; depth?: number; menuKeyPrefix?: string }) {
    return <>{nodes.map(n => {
      const hasChildren = n.children.length > 0;
      const isExpanded = hasChildren && !n.collapsed;
      const isHovered = hoveredTreeId === n.id;
      const menuKey = `${menuKeyPrefix}-${n.id}`;
      return <div key={n.id} className={isExpanded ? 'tree-branch-open' : ''} data-depth={depth} style={{ '--tree-depth': depth } as React.CSSProperties}>
        <div
          className={`tree-row ${n.id === activePageId ? 'selected' : ''} ${dragPageId === n.id ? 'dragging' : ''} ${sidebarDropLine === n.id ? 'sidebar-drop-line' : ''} ${hasChildren ? 'has-children' : 'is-leaf'} ${isExpanded ? 'expanded' : ''}`}
          data-depth={depth}
          style={{ paddingLeft: 4 + depth * 16, '--tree-depth': depth } as React.CSSProperties}
          draggable
          onMouseEnter={() => setHoveredTreeId(n.id)}
          onMouseLeave={() => setHoveredTreeId(current => current === n.id ? null : current)}
          onDragStart={(e) => { setDragPageId(n.id); e.dataTransfer.setData('application/notex-page-id', n.id); e.dataTransfer.effectAllowed = 'copyMove'; }}
          onDragEnd={() => { setDragPageId(null); setSidebarDropLine(null); }}
          onDragOver={e => { e.preventDefault(); if (dragPageId && dragPageId !== n.id) setSidebarDropLine(n.id); }}
          onDragLeave={() => sidebarDropLine === n.id && setSidebarDropLine(null)}
          onDrop={(e) => { e.stopPropagation(); setSidebarDropLine(null); dropPageOn(n.id); }}>
          <button className="twisty tree-merged-icon" onClick={() => hasChildren ? toggleCollapse(n.id) : selectPage(n.id)} title={hasChildren ? (isExpanded ? 'Collapse page' : 'Expand page') : 'Open page'}>
            {hasChildren
              ? (isExpanded ? <ChevronDown size={13}/> : (isHovered ? <ChevronRight size={13}/> : <SidebarPageTypeIcon page={n} hasChildren size={14}/>))
              : <SidebarPageTypeIcon page={n} hasChildren={false} size={14}/>} 
          </button>
          <button className="tree-title" onClick={() => selectPage(n.id)}><span>{n.title}</span></button>
          <button className="mini" title="Page options" onClick={(e) => { e.stopPropagation(); setSectionMenuId(null); setSectionMenuPos(null); const nextOpen = !(pageMenuId === n.id && pageMenuInstance === menuKey); const r = e.currentTarget.getBoundingClientRect(); setPageMenuPos(nextOpen ? { left: r.right + 8, top: Math.max(8, Math.min(r.top - 6, window.innerHeight - 330)) } : null); setPageMenuId(nextOpen ? n.id : null); setPageMenuInstance(nextOpen ? menuKey : null); }}><MoreHorizontal size={14}/></button>
          {depth < 2 && <button className="mini" title="Add subpage" onClick={() => openQuickNew(n.id)}><Plus size={14}/></button>}
          {pageMenuId === n.id && pageMenuInstance === menuKey && <PageMenu page={n}/>} 
        </div>
        {isExpanded && depth < 2 && <div className="tree-children"><PageTree nodes={n.children} depth={depth + 1} menuKeyPrefix={menuKeyPrefix}/></div>} 
      </div>;
    })}</>;
  }


  async function addTagToActivePage(value?: string) {
    if (!activePage) return;
    const clean = (value ?? tagInput).trim().replace(/^#/, '').toLowerCase();
    if (!clean) return;
    const current = activePage.tags || [];
    if (current.map(t => t.toLowerCase()).includes(clean.toLowerCase())) {
      setTagInput('');
      return;
    }
    await db.pages.update(activePage.id, { tags: [...current, clean], updatedAt: now() });
    setTagInput('');
    await load();
  }

  async function removeTagFromActivePage(tag: string) {
    if (!activePage) return;
    await db.pages.update(activePage.id, { tags: (activePage.tags || []).filter(t => t !== tag), updatedAt: now() });
    await load();
  }


  function safeFileName(name: string) {
    return (name || 'noteX-page').replace(/[\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90) || 'noteX-page';
  }

  function escapeXml(value: string) {
    return (value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function crc32(bytes: Uint8Array) {
    let c = ~0;
    for (let i = 0; i < bytes.length; i++) {
      c ^= bytes[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return ~c >>> 0;
  }

  function u16(n: number) { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, n, true); return a; }
  function u32(n: number) { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n, true); return a; }
  function concatBytes(chunks: Uint8Array[]) { const len = chunks.reduce((s, x) => s + x.length, 0); const out = new Uint8Array(len); let o = 0; chunks.forEach(x => { out.set(x, o); o += x.length; }); return out; }

  function makeZip(files: { name: string; data: string }[]) {
    const enc = new TextEncoder();
    const local: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const file of files) {
      const name = enc.encode(file.name);
      const data = enc.encode(file.data);
      const crc = crc32(data);
      const header = concatBytes([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name]);
      local.push(header, data);
      const cdir = concatBytes([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
      central.push(cdir);
      offset += header.length + data.length;
    }
    const centralBlob = concatBytes(central);
    const end = concatBytes([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralBlob.length), u32(offset), u16(0)]);
    return new Blob([concatBytes([...local, centralBlob, end])], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }


  function htmlToPlain(value: string) {
    if (!value) return '';
    const div = document.createElement('div');
    div.innerHTML = value;
    return (div.textContent || div.innerText || '').replace(/\u00a0/g, ' ').trim();
  }

  function sanitizeInlineHtml(value: string) {
    if (!value) return '';
    const div = document.createElement('div');
    div.innerHTML = value;
    div.querySelectorAll('script,style,iframe,object').forEach(el => el.remove());
    div.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        const val = attr.value || '';
        if (name.startsWith('on')) el.removeAttribute(attr.name);
        if ((name === 'href' || name === 'src') && /^javascript:/i.test(val)) el.removeAttribute(attr.name);
      });
    });
    return div.innerHTML.trim();
  }

  function blockPlainText(block: Block, index: number) {
    if (block.type === 'table' && block.table) return block.table.map(r => r.join('\t')).join('\n');
    const raw = htmlToPlain(block.text || '');
    if (block.type === 'bullet') return `• ${raw}`;
    if (block.type === 'numbered') return `${index + 1}. ${raw}`;
    if (block.type === 'todo') return `${block.checked ? '[x]' : '[ ]'} ${raw}`;
    if (block.type === 'command') return `$ ${raw}`;
    return raw;
  }

  async function copyRichToClipboard(html: string, text: string) {
    const navClipboard = navigator.clipboard;
    if (navClipboard?.write && 'ClipboardItem' in window) {
      try {
        await navClipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })]);
        return 'rich';
      } catch {}
    }

    // Works on more browsers/origins than navigator.clipboard, including some HTTP dev setups.
    const holder = document.createElement('div');
    holder.setAttribute('contenteditable', 'true');
    holder.style.position = 'fixed';
    holder.style.left = '-99999px';
    holder.style.top = '0';
    holder.style.width = '640px';
    holder.innerHTML = html;
    document.body.appendChild(holder);
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(holder);
    selection?.removeAllRanges();
    selection?.addRange(range);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    selection?.removeAllRanges();
    holder.remove();
    if (ok) return 'rich';

    if (navClipboard?.writeText) {
      await navClipboard.writeText(text);
      return 'text';
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-99999px';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    if (!ok) throw new Error('Clipboard is unavailable in this browser context.');
    return 'text';
  }

  function buildEmailExport(page: Page, blocks: Block[]) {
    const title = page.title || 'Untitled';
    const tagsHtml = (page.tags || []).length ? `<p style="font-size:12px;color:#777;margin:0 0 8px;">Tags: ${(page.tags || []).map(escapeXml).join(', ')}</p>` : '';
    const bodyHtml = blocks.map((b, i) => blockToEmailHtml(b, i)).join('');
    const html = `<div style="font-family:Inter,Roboto,Arial,sans-serif;color:#222;"><h1 style="font-size:24px;line-height:1.25;margin:0 0 8px;font-weight:600;">${escapeXml(title)}</h1>${tagsHtml}${bodyHtml}</div>`;
    const text = `${title}\n${(page.tags || []).length ? `Tags: ${(page.tags || []).join(', ')}\n` : ''}${blocks.map((b, i) => blockPlainText(b, i)).join('\n')}`;
    return { title, html, text };
  }

  async function buildPageExportXml(page: Page) {
    const blocks = await db.blocks.where('pageId').equals(page.id).sortBy('sort');
    const paragraphs: string[] = [];
    const para = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
    paragraphs.push(para(page.title, 'Title'));
    (page.tags || []).length && paragraphs.push(para(`Tags: ${(page.tags || []).join(', ')}`));
    for (const b of blocks) {
      if (b.type === 'richDocument') { paragraphs.push(para(htmlToPlain(b.text || ''))); continue; }
      if (b.type === 'divider') { paragraphs.push('<w:p><w:r><w:t>────────────────</w:t></w:r></w:p>'); continue; }
      if (b.type === 'table' && b.table) {
        const rows = b.table.map(row => `<w:tr>${row.map(cell => `<w:tc><w:p><w:r><w:t>${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('');
        paragraphs.push(`<w:tbl>${rows}</w:tbl>`); continue;
      }
      const prefix = b.type === 'bullet' ? '• ' : b.type === 'numbered' ? `${blocks.filter(x => x.type === 'numbered').findIndex(x => x.id === b.id) + 1}. ` : b.type === 'todo' ? `${b.checked ? '☑' : '☐'} ` : b.type === 'command' ? '$ ' : '';
      const style = b.type === 'h1' ? 'Heading1' : b.type === 'h2' ? 'Heading2' : b.type === 'h3' ? 'Heading3' : b.type === 'h4' ? 'Heading4' : undefined;
      paragraphs.push(para(`${prefix}${htmlToPlain(b.text || '')}`, style));
    }
    return paragraphs.join('');
  }


  function blockToEmailHtml(block: Block, index: number) {
    const inline = sanitizeInlineHtml(block.text || '');
    const plain = escapeXml(htmlToPlain(block.text || ''));
    const style = 'margin:0 0 6px 0;font-family:Inter,Roboto,Arial,sans-serif;font-size:13px;line-height:1.45;color:#222;';
    if (block.type === 'richDocument') return `<div style="${style}">${sanitizeInlineHtml(block.text || '')}</div>`;
    if (block.type === 'h1') return `<h1 style="font-size:22px;line-height:1.25;margin:14px 0 8px;font-weight:600;">${inline}</h1>`;
    if (block.type === 'h2') return `<h2 style="font-size:18px;line-height:1.3;margin:12px 0 7px;font-weight:600;">${inline}</h2>`;
    if (block.type === 'h3') return `<h3 style="font-size:15px;line-height:1.35;margin:10px 0 6px;font-weight:600;">${inline}</h3>`;
    if (block.type === 'h4') return `<h4 style="font-size:13px;line-height:1.35;margin:9px 0 5px;font-weight:600;">${inline}</h4>`;
    if (block.type === 'bullet') return `<div style="${style}">• ${inline}</div>`;
    if (block.type === 'numbered') return `<div style="${style}">${index + 1}. ${inline}</div>`;
    if (block.type === 'todo') return `<div style="${style}">${block.checked ? '☑' : '☐'} ${inline}</div>`;
    if (block.type === 'quote') return `<blockquote style="margin:8px 0;padding-left:12px;border-left:3px solid #ddd;color:#555;">${inline}</blockquote>`;
    if (block.type === 'command') return `<pre style="background:#111;color:#fff;border-radius:6px;padding:7px 9px;font-size:12px;line-height:1.4;white-space:pre-wrap;">$ ${plain}</pre>`;
    if (block.type === 'code') return `<pre style="background:#f7f7f7;border:1px solid #e5e5e5;border-radius:6px;padding:7px 9px;font-size:12px;line-height:1.4;white-space:pre-wrap;">${plain}</pre>`;
    if (block.type === 'divider') return `<hr style="border:0;border-top:1px dashed #d8d8d8;margin:10px 0;"/>`;
    if (block.type === 'table' && block.table) {
      const rows = block.table.map(row => `<tr>${row.map(cell => `<td style="border:1px solid #d8d8d8;padding:5px 7px;font-size:12px;">${escapeXml(cell)}</td>`).join('')}</tr>`).join('');
      return `<table style="border-collapse:collapse;margin:8px 0;width:auto;"><tbody>${rows}</tbody></table>`;
    }
    return `<p style="${style}">${inline || '&nbsp;'}</p>`;
  }

  async function copyActivePageContent() {
    if (!activePage) return;
    const blocks = await db.blocks.where('pageId').equals(activePage.id).sortBy('sort');
    const { html, text } = buildEmailExport(activePage, blocks);
    try {
      const mode = await copyRichToClipboard(html, text);
      setSimpleModal({ title: 'Copied to clipboard', message: mode === 'rich' ? 'All page content was copied with rich formatting for email clients.' : 'All page content was copied as plain text.', confirmText: 'Done' });
    } catch (err) {
      setSimpleModal({ title: 'Copy failed', message: err instanceof Error ? err.message : 'Clipboard access is unavailable in this browser context.', confirmText: 'Done' });
    }
  }

  async function exportActivePageDocx() {
    if (!activePage) return;
    const body = await buildPageExportXml(activePage);
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
    const blob = makeZip([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/document.xml', data: documentXml }
    ]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(activePage.title)}.docx`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setSimpleModal({ title: 'DOCX export started', message: 'The current page is being downloaded as a DOCX file.', confirmText: 'Done' });
  }

  async function exportActivePagePdf() {
    if (!activePage) return;
    const blocks = await db.blocks.where('pageId').equals(activePage.id).sortBy('sort');
    const { html } = buildEmailExport(activePage, blocks);
    const win = window.open('', '_blank');
    if (!win) { setSimpleModal({ title: 'PDF export blocked', message: 'Please allow pop-ups so noteX can open the print-to-PDF window.', confirmText: 'Done' }); return; }
    win.document.write(`<!doctype html><html><head><title>${escapeXml(activePage.title)}</title><style>body{font-family:Inter,Roboto,Arial,sans-serif;margin:48px;color:#222;line-height:1.55}pre{white-space:pre-wrap}table{border-collapse:collapse}td{border:1px solid #d8d8d8;padding:5px 7px}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:12px;color:#555}hr{border:0;border-top:1px dashed #bbb}</style></head><body>${html}<script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`);
    win.document.close();
  }

  async function exportActivePageEml() {
    if (!activePage) return;
    const blocks = await db.blocks.where('pageId').equals(activePage.id).sortBy('sort');
    const { title, html, text } = buildEmailExport(activePage, blocks);
    const boundary = `notex-${Date.now()}`;
    const eml = [
      `Subject: ${title.replace(/[\r\n]+/g, ' ')}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      text,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      `<!doctype html><html><body>${html}</body></html>`,
      '',
      `--${boundary}--`
    ].join('\r\n');
    const blob = new Blob([eml], { type: 'message/rfc822' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(activePage.title)}.eml`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setSimpleModal({ title: 'Email export started', message: 'The current page is being downloaded as an .eml email draft file.', confirmText: 'Done' });
  }



  async function savePaletteHistoryItem(value: string) {
    const clean = value.trim();
    if (!clean) return;
    const next = [clean, ...paletteHistory.filter(x => x.toLowerCase() !== clean.toLowerCase())].slice(0, 10);
    setPaletteHistory(next);
    await db.settings.put({ key: 'paletteHistory', value: next });
  }

  async function removePaletteHistoryItem(value: string) {
    const next = paletteHistory.filter(x => x !== value);
    setPaletteHistory(next);
    setSelectedPaletteHistory(prev => prev.filter(x => x !== value));
    await db.settings.put({ key: 'paletteHistory', value: next });
  }

  async function clearPaletteHistory() {
    setPaletteHistory([]);
    setSelectedPaletteHistory([]);
    await db.settings.put({ key: 'paletteHistory', value: [] });
  }

  async function deleteSelectedPaletteHistory() {
    if (!selectedPaletteHistory.length) return;
    const selected = new Set(selectedPaletteHistory);
    const next = paletteHistory.filter(x => !selected.has(x));
    setPaletteHistory(next);
    setSelectedPaletteHistory([]);
    await db.settings.put({ key: 'paletteHistory', value: next });
  }

  function togglePaletteHistoryItem(value: string, checked: boolean) {
    setSelectedPaletteHistory(prev => checked ? Array.from(new Set([...prev, value])) : prev.filter(x => x !== value));
  }


  function blockToPlainText(block: Block) {
    if (block.type === 'table' && block.table) return block.table.map(row => row.join(' | ')).join('\n');
    if (block.caption && block.text) return `${block.text}\nCaption: ${block.caption}`;
    return block.text || '';
  }

  async function collectAiContext(question: string) {
    const terms = question.toLowerCase().split(/\s+/).filter(Boolean);
    const workspacePages = pages.filter(p => !p.deleted);
    const scored = workspacePages.map(p => {
      const hay = `${p.title} ${(p.tags || []).join(' ')}`.toLowerCase();
      const score = terms.reduce((acc, term) => acc + (hay.includes(term) ? 2 : 0), 0) + (p.lastOpenedAt ? 0.25 : 0);
      return { page: p, score };
    }).sort((a, b) => b.score - a.score || b.page.updatedAt - a.page.updatedAt).slice(0, 6);
    const chosen = scored.length ? scored.map(x => x.page) : workspacePages.slice(0, 6);
    const context = [] as { pageId: string; title: string; text: string }[];
    for (const page of chosen) {
      const blocks = await db.blocks.where('pageId').equals(page.id).sortBy('sort');
      const text = blocks.map(blockToPlainText).filter(Boolean).join('\n').slice(0, 4500);
      context.push({ pageId: page.id, title: page.title, text });
    }
    return context;
  }

  async function createAiAnswerPage(question: string, answer: string, sources: { pageId: string; title: string }[] = [], note?: string) {
    if (!currentUser || !activeWorkspaceId) return;
    const t = now();
    const id = uid();
    const title = `AI Answer - ${question.slice(0, 42) || 'Question'}`;
    const blocksToAdd: Block[] = [
      { id: uid(), workspaceId: activeWorkspaceId, pageId: id, type: 'h2', text: 'Question', sort: 1, createdAt: t, updatedAt: t },
      { id: uid(), workspaceId: activeWorkspaceId, pageId: id, type: 'quote', text: question, sort: 2, createdAt: t, updatedAt: t },
      { id: uid(), workspaceId: activeWorkspaceId, pageId: id, type: 'h2', text: 'Answer', sort: 3, createdAt: t, updatedAt: t },
      { id: uid(), workspaceId: activeWorkspaceId, pageId: id, type: 'paragraph', text: answer || 'No answer returned.', sort: 4, createdAt: t, updatedAt: t }
    ];
    if (sources.length) {
      blocksToAdd.push({ id: uid(), workspaceId: activeWorkspaceId, pageId: id, type: 'h2', text: 'Sources', sort: 5, createdAt: t, updatedAt: t });
      sources.slice(0, 8).forEach((source, idx) => blocksToAdd.push({ id: uid(), workspaceId: activeWorkspaceId, pageId: id, type: 'bullet', text: source.title, sort: 6 + idx, createdAt: t, updatedAt: t }));
    }
    if (note) blocksToAdd.push({ id: uid(), workspaceId: activeWorkspaceId, pageId: id, type: 'quote', text: note, sort: 99, createdAt: t, updatedAt: t });
    await db.pages.add({ id, workspaceId: activeWorkspaceId, title, icon: '✨', parentId: null, collapsed: 1, favorite: 0, lastOpenedAt: t, section: 'other', createdAt: t, updatedAt: t });
    await db.blocks.bulkAdd(blocksToAdd);
    await db.settings.put({ key: `activePageId:${activeWorkspaceId}`, value: id });
    await db.settings.put({ key: 'activePageId', value: id });
    setPaletteOpen(false);
    setPaletteQuery('');
    setActivePageId(id);
    setOpenTabIds(prev => prev.includes(id) ? prev : [...prev, id]);
    await load();
  }

  async function askAiFromPalette() {
    const question = paletteQuery.trim();
    if (!question || aiBusy) return;
    setAiBusy(true);
    await savePaletteHistoryItem(question);
    try {
      const context = await collectAiContext(question);
      const endpoint = (import.meta.env.VITE_NOTEX_AI_ENDPOINT || '').trim();
      if (!endpoint) {
        await createAiAnswerPage(
          question,
          'AI Ask is ready in noteX, but no AI endpoint is configured yet. Set VITE_NOTEX_AI_ENDPOINT in your .env file and run a small backend that calls Gemini with your GEMINI_API_KEY stored server-side.',
          context.map(c => ({ pageId: c.pageId, title: c.title })),
          'Security note: do not put a permanent Gemini API key directly in the browser frontend.'
        );
        return;
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, context, workspace: currentWorkspace?.name || 'Current workspace' })
      });
      if (!response.ok) throw new Error(`AI endpoint returned ${response.status}`);
      const data = await response.json();
      const answer = String(data.answer || data.text || 'No answer returned.');
      const sources = Array.isArray(data.sources) ? data.sources : context.map(c => ({ pageId: c.pageId, title: c.title }));
      await createAiAnswerPage(question, answer, sources);
    } catch (error: any) {
      await createAiAnswerPage(
        question,
        `I could not get an AI response. ${error?.message || 'Unknown error.'}`,
        [],
        'Check VITE_NOTEX_AI_ENDPOINT and the backend server logs.'
      );
    } finally {
      setAiBusy(false);
    }
  }

  const paletteSearchText = useMemo(() => deferredPaletteQuery.trim().toLowerCase(), [deferredPaletteQuery]);
  const paletteItems = useMemo(() => [
    ...(paletteSearchText ? [{ label: `Ask AI: ${deferredPaletteQuery.trim()}`, hint: 'Create an AI answer page from noteX context', action: askAiFromPalette }] : []),
    ...pages.map(p => ({ label: p.title, hint: 'Open page', action: () => selectPage(p.id) })),
    { label: 'Create new page', hint: 'Workspace', action: () => openQuickNew(null) },
    { label: 'Create subpage', hint: activePage?.title || 'No active page', action: () => openQuickNew(activePageId || null) },
    { label: activePage?.favorite ? 'Remove from favorites' : 'Add to favorites', hint: activePage?.title || 'No active page', action: toggleFavorite },
    { label: 'Backup & Restore', hint: 'Export/import noteX data', action: () => setBackupOpen(true) },
    { label: 'Export JSON', hint: 'Backup', action: downloadBackup },
    { label: 'Create snapshot', hint: 'Local backup history', action: makeSnapshot },
    { label: 'Restore JSON', hint: 'Import backup file', action: () => fileRef.current?.click() }
  ].filter(i => i.label.toLowerCase().includes(paletteSearchText)), [paletteSearchText, deferredPaletteQuery, pages, activePage?.title, activePage?.favorite, activePageId]);
  const paletteVisibleItems = useMemo(() => paletteItems.slice(0, 12), [paletteItems]);
  const paletteHistoryVisible = !paletteSearchText ? paletteHistory : [];
  const paletteTotalRows = paletteHistoryVisible.length + paletteVisibleItems.length;

  useEffect(() => {
    if (paletteOpen) setPaletteActiveIndex(0);
    else setSelectedPaletteHistory([]);
  }, [paletteOpen, paletteQuery]);

  function runPaletteRow(index: number) {
    if (index < paletteHistoryVisible.length) {
      const item = paletteHistoryVisible[index];
      setPaletteQuery(item);
      return;
    }
    const item = paletteVisibleItems[index - paletteHistoryVisible.length];
    if (!item) return;
    savePaletteHistoryItem(paletteQuery || item.label);
    item.action();
    setPaletteOpen(false);
  }

  function LibraryPage() {
    const search = deferredLibrarySearchQuery.trim().toLowerCase();
    const visible = useMemo(() => pages
      .filter(p => !p.deleted)
      .filter(p => {
        if (libraryFilter === 'favorites' && !p.favorite) return false;
        if (libraryFilter === 'shared') return false;
        if (libraryFilter === 'private' && p.section === 'other') return false;
        if (libraryFilter === 'ai' && !(p.title.toLowerCase().includes('ai') || p.title.toLowerCase().includes('meeting'))) return false;
        if (!search) return true;
        const sourceTitle = p.parentId ? (pageById.get(p.parentId)?.title || 'Subpage') : (p.section === 'other' ? 'Private' : 'My Notes');
        const tagText = (p.tags || []).join(' ');
        const editedAgo = formatAgo(p.updatedAt);
        const visitedAgo = formatAgo(p.lastOpenedAt || p.updatedAt);
        const haystack = [p.title, tagText, 'Prasetyo', sourceTitle, editedAgo, visitedAgo].join(' ').toLowerCase();
        if (libraryFieldFilter === 'name') return p.title.toLowerCase().includes(search);
        if (libraryFieldFilter === 'created') return 'prasetyo'.includes(search);
        if (libraryFieldFilter === 'source') return sourceTitle.toLowerCase().includes(search);
        if (libraryFieldFilter === 'edited') return editedAgo.toLowerCase().includes(search);
        if (libraryFieldFilter === 'visited') return visitedAgo.toLowerCase().includes(search);
        if (libraryFieldFilter === 'tags') return tagText.toLowerCase().includes(search);
        return haystack.includes(search);
      })
      .sort((a,b) => (b.lastOpenedAt || b.updatedAt) - (a.lastOpenedAt || a.updatedAt)), [pages, search, libraryFilter, libraryFieldFilter, pageById]);
    const tab = (key: typeof libraryFilter, label: string, icon: ReactNode) => (
      <button className={libraryFilter === key ? 'active' : ''} onClick={() => setLibraryFilter(key)}>{icon}{label}</button>
    );
    const visibleIds = useMemo(() => visible.map(p => p.id), [visible]);
    const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds]);
    const selectedVisible = useMemo(() => selectedLibraryIds.filter(id => visibleSet.has(id)), [selectedLibraryIds, visibleSet]);
    const allSelected = visible.length > 0 && selectedVisible.length === visible.length;
    const childrenByParent = useMemo(() => {
      const map = new Map<string | null, Page[]>();
      visible.forEach(p => {
        const parentKey = p.parentId && visibleSet.has(p.parentId) ? p.parentId : null;
        if (!map.has(parentKey)) map.set(parentKey, []);
        map.get(parentKey)!.push(p);
      });
      return map;
    }, [visible, visibleSet]);
    const toggleLibraryCollapse = async (id: string) => {
      const p = pageById.get(id);
      await db.pages.update(id, { collapsed: p?.collapsed === 0 ? 1 : 0 });
      await load();
    };
    const renderLibraryRows = (parentId: string | null = null, depth = 0): ReactNode[] => {
      const rows = childrenByParent.get(parentId) || [];
      return rows.flatMap(p => {
        const hasChildren = (childrenByParent.get(p.id) || []).length > 0;
        const isCollapsed = p.collapsed !== 0;
        const row = <tr
          key={p.id}
          draggable
          className={`${selectedLibraryIds.includes(p.id) ? 'selected-row' : ''} ${dragPageId === p.id ? 'dragging-row' : ''}`}
          onDragStart={(e) => { e.stopPropagation(); setDragPageId(p.id); }}
          onDragEnd={() => setDragPageId(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropPageOn(p.id); }}
          onClick={() => { setLibraryOpen(false); selectPage(p.id); }}>
          <td className="library-check-cell" onClick={e => e.stopPropagation()}><input type="checkbox" checked={selectedLibraryIds.includes(p.id)} onChange={() => toggleLibrarySelection(p.id)} /></td>
          <td><div className="library-name-cell library-tree-name" style={{ paddingLeft: depth * 18, '--library-depth': depth } as React.CSSProperties}>{hasChildren ? <button className="library-twisty" onClick={(e) => { e.stopPropagation(); toggleLibraryCollapse(p.id); }}>{isCollapsed ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}</button> : <span className="library-twisty-spacer"/>}<SidebarPageTypeIcon page={p} hasChildren={hasChildren} size={14}/><span>{p.title}</span></div></td>
          <td><div className="library-tags-cell">{(p.tags || []).length ? (p.tags || []).slice(0,3).map(t => <span key={t} className="tag-pill small">{t}</span>) : <span className="muted-cell">—</span>}</div></td>
          <td><div className="library-created-cell"><span className="avatar">P</span><span>Prasetyo</span></div></td>
          <td><div className="library-source-cell">{p.parentId ? <><FileText size={14}/><span>{pageById.get(p.parentId)?.title || 'Subpage'}</span></> : p.section === 'other' ? <><Lock size={14}/><span>Private</span></> : <><FileText size={14}/><span>My Notes</span></>}</div></td>
          <td>{formatAgo(p.updatedAt)}</td>
          <td>{formatAgo(p.lastOpenedAt || p.updatedAt)}</td>
          <td className="library-action-cell" onClick={e => e.stopPropagation()}><button title="Move to Trash" onClick={() => deleteSpecificPage(p.id)}><Trash2 size={14}/></button></td>
        </tr>;
        return isCollapsed ? [row] : [row, ...renderLibraryRows(p.id, depth + 1)];
      });
    };
    const libraryRows = renderLibraryRows(null);
    return <section className="library-page">
      <div className="library-head"><h1>Library</h1><button className="primary-button" onClick={() => openQuickNew(null)}>New Page</button></div>
      <div className="library-controls">
        <div className="library-tabs">
          {tab('recents', 'Recents', <Clock3 size={16}/>)}
          {tab('favorites', 'Favorites', <Star size={16}/>)}
          {tab('shared', 'Shared', <Users size={16}/>)}
          {tab('private', 'Private', <Lock size={16}/>)}
          {tab('ai', 'AI Meeting Notes', <FileText size={16}/>)}
        </div>
        <div className={`library-tools ${librarySearchOpen ? 'searching' : ''}`}>
          <button className={libraryFilterOpen ? 'active' : ''} title="Filter" onClick={() => { setLibraryFilterOpen(v => !v); setLibrarySearchOpen(false); }}><ListFilter size={15}/></button>
          {librarySearchOpen && <label className="library-inline-search"><Search size={14}/><input autoFocus placeholder="Type to search..." value={librarySearchQuery} onChange={e => setLibrarySearchQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setLibrarySearchOpen(false); }} /><button title="Close search" onClick={() => { setLibrarySearchOpen(false); setLibrarySearchQuery(''); }}><X size={13}/></button></label>}
          {!librarySearchOpen && <button className={librarySearchOpen ? 'active' : ''} title="Search" onClick={() => { setLibrarySearchOpen(v => !v); setLibraryFilterOpen(false); }}><Search size={15}/></button>}
          {libraryFilterOpen && <div className="library-filter-popover">
            <input autoFocus placeholder="Filter by..." value={librarySearchQuery} onChange={e => setLibrarySearchQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setLibraryFilterOpen(false); }} />
            {[
              ['name','Page name', FileText], ['tags','Tags', Tag], ['created','Created by', Users], ['source','Source', FileText], ['edited','Last edited time', Clock3], ['visited','Last visited time', Clock3]
            ].map(([key, label, Icon]: any) => <button key={key} className={libraryFieldFilter === key ? 'active' : ''} onClick={() => setLibraryFieldFilter(key)}><Icon size={16}/><span>{label}</span></button>)}
            <div className="library-filter-footer"><button onClick={() => setLibraryFieldFilter('all')}><Plus size={15}/> Add advanced filter</button></div>
          </div>}
        </div>
      </div>
      {selectedLibraryIds.length > 0 && <div className="library-selection-bar"><span>{selectedLibraryIds.length} selected</span><button className="library-delete-selected" title="Move selected pages to trash" onClick={deleteSelectedLibraryPages}><Trash2 size={16}/></button></div>}
      <div className="library-table-wrap" onDragOver={e => e.preventDefault()} onDrop={(e) => { e.preventDefault(); dropPageOn(null); }}>
      <table className="library-table compact-library-table"><colgroup><col className="col-check"/><col className="col-name"/><col className="col-tags"/><col className="col-created"/><col className="col-source"/><col className="col-edited"/><col className="col-opened"/><col className="col-action"/></colgroup><thead><tr><th className="library-check-cell"><input type="checkbox" checked={allSelected} onChange={(e) => setSelectedLibraryIds(e.target.checked ? visibleIds : [])} /></th><th>Page name</th><th>Tags</th><th>Created by</th><th>Source</th><th>Last edited time</th><th>Last opened</th><th className="library-action-cell">Action</th></tr></thead><tbody>
        {libraryRows}
        {visible.length === 0 && <tr><td colSpan={8} className="library-empty">No pages in this view.</td></tr>}
      </tbody></table>
      </div>
    </section>;
  }

  function MoveModal() {
    if (!moveModalFor) return null;
    const moving = pages.find(p => p.id === moveModalFor);
    const filteredPages = pages
      .filter(p => !p.deleted && p.id !== moveModalFor && canMoveTo(moveModalFor, p.id))
      .filter(p => p.title.toLowerCase().includes(moveQuery.toLowerCase()));
    const options = [
      { id: '__root__', title: 'Private pages', root: true, favorite: false },
      ...filteredPages.map(p => ({ id: p.id, title: p.title, root: false, favorite: !!p.favorite }))
    ];
    const style = pageMenuPos ? ({ '--move-left': `${pageMenuPos.left + 246}px`, '--move-top': `${pageMenuPos.top + 154}px` } as React.CSSProperties) : undefined;
    const chooseMoveOption = (index: number) => {
      const item = options[index];
      if (!item) return;
      movePageTo(moveModalFor, item.root ? null : item.id);
    };
    return createPortal(<div className="move-backdrop-inline" onMouseDown={() => setMoveModalFor(null)}>
      <div className="move-modal move-modal-inline floating-popover" style={style} onMouseDown={e => e.stopPropagation()}>
        <label className="move-search"><Search size={16}/><input autoFocus placeholder="Move page to..." value={moveQuery} onChange={e => { setMoveQuery(e.target.value); setMoveActiveIndex(0); }} onKeyDown={e => {
          if (e.key === 'Escape') { setMoveModalFor(null); return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); setMoveActiveIndex(i => Math.min(options.length - 1, i + 1)); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); setMoveActiveIndex(i => Math.max(0, i - 1)); return; }
          if (e.key === 'Enter') { e.preventDefault(); chooseMoveOption(moveActiveIndex); }
        }} /></label>
        <div className="move-scroll-region">
          <div className="move-heading">Suggested</div>
          {options.map((item, index) => <button key={item.id} className={`move-option ${moveActiveIndex === index ? 'active' : ''}`} onMouseEnter={() => setMoveActiveIndex(index)} onClick={() => chooseMoveOption(index)}>{item.root ? <Folder size={18}/> : <FileText size={18}/>}<span>{item.title}</span>{item.root ? <small>Root</small> : (item.favorite ? <Star size={14}/> : null)}</button>)}
          {options.length === 0 && <p className="move-empty">No matching page found.</p>}
        </div>
        <div className="move-footer">Moving: {moving?.title || 'Page'} <kbd>esc</kbd></div>
      </div>
    </div>, document.body);
  }



  async function switchWorkspace(id: string) {
    if (!id || id === activeWorkspaceId) return;
    if (currentUser) await db.settings.put({ key: `activeWorkspaceId:${currentUser.id}`, value: id });
    await db.settings.put({ key: 'activeWorkspaceId', value: id });
    setActiveWorkspaceId(id);
    setWorkspaceMenuOpen(false);
    setActivePageId('');
    setOpenTabIds([]);
    setHistoryIds([]);
    setHistoryIndex(-1);
    await load(id);
  }

  async function renameWorkspace(id: string) {
    const workspace = workspaces.find(w => w.id === id);
    if (!workspace) return;
    setWorkspaceAction({ mode: 'rename', workspaceId: id, value: workspace.name });
  }


  async function createWorkspaceFromManager() {
    if (!currentUser) return;
    const name = newWorkspaceName.trim();
    if (!name) return;
    if (workspaces.length >= 3) {
      setSimpleModal({ title: 'Maximum workspaces reached', message: 'Each noteX account can have up to 3 workspaces. Delete one workspace before creating another.', confirmText: 'Done' });
      return;
    }
    const t = now();
    const id = `ws-${currentUser.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-${uid().slice(0, 8)}`;
    await db.workspaces.add({ id, userId: currentUser.id, name, type: 'custom', createdAt: t, updatedAt: t });
    setNewWorkspaceName('');
    await switchWorkspace(id);
    setWorkspaceManagerOpen(true);
  }

  async function deleteWorkspace(id: string) {
    const workspace = workspaces.find(w => w.id === id);
    if (!workspace || !currentUser) return;
    if (workspaces.length <= 1) {
      setSimpleModal({ title: 'Cannot delete workspace', message: 'Each account must keep at least one workspace.', confirmText: 'Done' });
      return;
    }
    const pageCount = await db.pages.where('workspaceId').equals(id).count();
    setWorkspaceAction({ mode: 'delete', workspaceId: id, value: '', pageCount });
  }

  async function confirmWorkspaceAction() {
    if (!workspaceAction || !currentUser) return;
    const workspace = workspaces.find(w => w.id === workspaceAction.workspaceId);
    if (!workspace) { setWorkspaceAction(null); return; }
    if (workspaceAction.mode === 'rename') {
      const name = workspaceAction.value.trim();
      if (!name) return;
      await db.workspaces.update(workspace.id, { name, updatedAt: now() });
      setWorkspaceAction(null);
      await load(activeWorkspaceId);
      return;
    }
    if (workspaceAction.value.trim() !== workspace.name) {
      setSimpleModal({ title: 'Workspace not deleted', message: 'The confirmation text did not match the workspace name.', confirmText: 'Done' });
      return;
    }
    const workspacePages = await db.pages.where('workspaceId').equals(workspace.id).toArray();
    const pageIds = workspacePages.map(p => p.id);
    if (pageIds.length) await db.blocks.where('pageId').anyOf(pageIds).delete();
    await db.pages.where('workspaceId').equals(workspace.id).delete();
    await db.workspaces.delete(workspace.id);
    const remaining = workspaceSort((await db.workspaces.where('userId').equals(currentUser.id).toArray()).filter(w => w.id !== workspace.id));
    const next = remaining[0]?.id || '';
    if (next) {
      await db.settings.put({ key: `activeWorkspaceId:${currentUser.id}`, value: next });
      await db.settings.put({ key: 'activeWorkspaceId', value: next });
    }
    setWorkspaceAction(null);
    await load(next);
  }


  function openAccountSettings() {
    setAccountNameDraft(currentUser?.name || '');
    setAccountSettingsOpen(true);
    setAuthOpen(false);
  }

  async function saveAccountSettings() {
    if (!currentUser) return;
    const name = accountNameDraft.trim() || (currentUser.provider === 'local' ? 'Local User' : currentUser.email);
    await db.users.update(currentUser.id, { name, updatedAt: now() });
    setAccountSettingsOpen(false);
    await refreshKnownUsers();
    await load(activeWorkspaceId);
  }

  async function handleAvatarUpload(file?: File) {
    if (!file || !currentUser) return;
    if (!file.type.startsWith('image/')) {
      setSimpleModal({ title: 'Invalid picture', message: 'Please choose an image file for your profile picture.', confirmText: 'Done' });
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const avatar = String(reader.result || '');
      await db.users.update(currentUser.id, { avatar, updatedAt: now() });
      await refreshKnownUsers();
      await load(activeWorkspaceId);
    };
    reader.readAsDataURL(file);
  }

  async function removeAccountAvatar() {
    if (!currentUser) return;
    await db.users.update(currentUser.id, { avatar: undefined, updatedAt: now() });
    await refreshKnownUsers();
    await load(activeWorkspaceId);
  }

  function renderWorkspaceManagerModal() {
    if (!workspaceManagerOpen || !currentUser) return null;
    const canCreate = workspaces.length < 3;
    const actionWorkspace = workspaceAction ? workspaces.find(w => w.id === workspaceAction.workspaceId) : null;
    return createPortal(<div className="simple-modal-backdrop workspace-manager-backdrop" onMouseDown={() => { setWorkspaceAction(null); setWorkspaceManagerOpen(false); }}>
      <div className="workspace-manager-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="workspace-manager-head"><div><h3>Manage Workspaces</h3><p>Create, rename, or delete up to 3 internal noteX workspaces for this account.</p></div><button className="icon-only" onClick={() => { setWorkspaceAction(null); setWorkspaceManagerOpen(false); }}><X size={16}/></button></div>
        <div className="workspace-manager-list">{workspaces.map(w => <div key={w.id} className={`workspace-manager-row ${w.id === activeWorkspaceId ? 'active' : ''}`}><span className="workspace-dot large">{w.name.slice(0,1).toUpperCase()}</span><div><strong>{w.name}</strong><p>{w.id === activeWorkspaceId ? 'Current workspace' : 'Internal noteX workspace'}</p></div><button onClick={() => renameWorkspace(w.id)}>Rename</button><button className="danger" disabled={workspaces.length <= 1} onClick={() => void deleteWorkspace(w.id)}>Delete</button></div>)}</div>
        <div className="workspace-create-box"><input value={newWorkspaceName} onChange={e => setNewWorkspaceName(e.target.value)} placeholder={canCreate ? 'New workspace name' : 'Maximum 3 workspaces reached'} disabled={!canCreate} onKeyDown={e => { if (e.key === 'Enter') void createWorkspaceFromManager(); }} /><button className="primary-button" disabled={!canCreate || !newWorkspaceName.trim()} onClick={() => void createWorkspaceFromManager()}><Plus size={14}/> New Workspace</button></div>
        <p className="workspace-manager-note">Deleting a workspace permanently removes the pages inside it. Export a backup first if you need a copy.</p>
        {workspaceAction && actionWorkspace && <div className="workspace-action-layer" onMouseDown={() => setWorkspaceAction(null)}>
          <div className="workspace-action-modal" onMouseDown={e => e.stopPropagation()}>
            <div className={`workspace-action-icon ${workspaceAction.mode === 'delete' ? 'danger' : ''}`}>{workspaceAction.mode === 'delete' ? <Trash2 size={18}/> : <SlidersHorizontal size={18}/>}</div>
            <h3>{workspaceAction.mode === 'delete' ? 'Delete Workspace' : 'Rename Workspace'}</h3>
            <p>{workspaceAction.mode === 'delete' ? `This permanently deletes “${actionWorkspace.name}” and ${workspaceAction.pageCount || 0} page${workspaceAction.pageCount === 1 ? '' : 's'} inside it. Type the workspace name to confirm.` : 'Give this workspace a clear name for your notes and projects.'}</p>
            <input autoFocus value={workspaceAction.value} placeholder={workspaceAction.mode === 'delete' ? actionWorkspace.name : 'Workspace name'} onChange={e => setWorkspaceAction({ ...workspaceAction, value: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') void confirmWorkspaceAction(); if (e.key === 'Escape') setWorkspaceAction(null); }} />
            <div className="workspace-action-buttons"><button onClick={() => setWorkspaceAction(null)}>Cancel</button><button className={workspaceAction.mode === 'delete' ? 'danger-button' : 'primary-button'} disabled={workspaceAction.mode === 'rename' ? !workspaceAction.value.trim() : workspaceAction.value.trim() !== actionWorkspace.name} onClick={() => void confirmWorkspaceAction()}>{workspaceAction.mode === 'delete' ? 'Delete Workspace' : 'Rename Workspace'}</button></div>
          </div>
        </div>}
      </div>
    </div>, document.body);
  }

  function renderAccountSettingsModal() {
    if (!accountSettingsOpen || !currentUser) return null;
    const avatarText = (currentUser.name || currentUser.email || 'N').slice(0,1).toUpperCase();
    return createPortal(<div className="simple-modal-backdrop account-settings-backdrop" onMouseDown={() => setAccountSettingsOpen(false)}>
      <div className="account-settings-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="account-settings-head"><div><h3>Account Settings</h3><p>Update your noteX display profile for this browser.</p></div><button className="icon-only" aria-label="Close Account Settings" onClick={() => setAccountSettingsOpen(false)}><X size={16}/></button></div>
        <div className="account-settings-profile"><div className="account-settings-avatar">{currentUser.avatar ? <img src={currentUser.avatar} alt="profile" /> : <span>{avatarText}</span>}</div><div><strong>{currentUser.provider === 'google' ? 'Google Profile' : 'Local Profile'}</strong><p>{currentUser.email}</p><div className="avatar-actions"><button onClick={() => accountAvatarRef.current?.click()}><Upload size={14}/> Upload Picture</button>{currentUser.avatar && <button onClick={() => void removeAccountAvatar()}>Remove Picture</button>}</div><input ref={accountAvatarRef} type="file" accept="image/*" hidden onChange={e => void handleAvatarUpload(e.target.files?.[0])} /></div></div>
        <label className="account-settings-field"><span>Display Name</span><input value={accountNameDraft} onChange={e => setAccountNameDraft(e.target.value)} placeholder="Display name" /></label>
        <div className="account-theme-section">
          <div className="account-theme-title"><span>Appearance Theme</span><em>Choose the visual style for this browser.</em></div>
          <div className="theme-choice-row" role="radiogroup" aria-label="noteX theme">
            <button type="button" className={appTheme === 'light' ? 'active' : ''} onClick={() => void setNoteXTheme('light')} aria-pressed={appTheme === 'light'}><Sun size={16}/><strong>Light</strong><small>Current clean style</small></button>
            <button type="button" className={appTheme === 'dark' ? 'active' : ''} onClick={() => void setNoteXTheme('dark')} aria-pressed={appTheme === 'dark'}><Moon size={16}/><strong>Dark</strong><small>Low-light workspace</small></button>
            <button type="button" className={appTheme === 'modern' ? 'active' : ''} onClick={() => void setNoteXTheme('modern')} aria-pressed={appTheme === 'modern'}><Sparkles size={16}/><strong>Modern</strong><small>Glassmorphism</small></button>
          </div>
        </div>
        {currentUser.provider === 'google' && <p className="account-settings-note">Google provides your identity. This profile picture is a noteX local display override for this browser.</p>}
        {currentUser.provider === 'local' && <p className="account-settings-note">Local mode stays on this browser. Password change will be added in a later version.</p>}
        <div className="account-settings-actions"><button onClick={() => setAccountSettingsOpen(false)}>Cancel</button><button className="primary-button" onClick={() => void saveAccountSettings()}>Save Changes</button></div>
      </div>
    </div>, document.body);
  }


  async function toggleAddon(key: AddonKey) {
    const next = { ...enabledAddons, [key]: !enabledAddons[key] };
    setEnabledAddons(next);
    await db.settings.put({ key: 'enabledAddons', value: next });
  }

  function openAddon(key: AddonKey) {
    if (!enabledAddons[key]) {
      setSimpleModal({ title: 'Add-on disabled', message: 'Enable this add-on from the Add-ons Manager before opening it.', confirmText: 'Done' });
      return;
    }
    if (key === 'aiComposer') setAiComposerOpen(true);
    if (key === 'templates') setSimpleModal({ title: 'Templates Add-on', message: 'Templates are enabled. A full template gallery can be added in the next add-on release.', confirmText: 'Done' });
  }

  function renderAddonsManagerModal() {
    if (!addonsOpen) return null;
    return createPortal(<div className="simple-modal-backdrop addons-backdrop top-layer-modal" onMouseDown={() => setAddonsOpen(false)}>
      <div className="addons-manager-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="addons-manager-head"><div><h3>Add-ons Manager</h3><p>Enable, disable, and configure optional noteX features for this workspace.</p></div><button className="icon-only" aria-label="Close Add-ons Manager" onClick={() => setAddonsOpen(false)}><X size={16}/></button></div>
        <div className="addons-manager-list">
          {ADDON_CATALOG.map(addon => <div key={addon.key} className={`addon-manager-card ${enabledAddons[addon.key] ? 'enabled' : 'disabled'}`}>
            <span className="addon-card-icon">{addon.key === 'aiComposer' ? <Bot size={18}/> : <FileText size={18}/>}</span>
            <div className="addon-card-main"><div><strong>{addon.title}</strong><em>v{addon.version} · {addon.status}</em></div><p>{addon.description}</p></div>
            <div className="addon-card-actions"><button onClick={() => void toggleAddon(addon.key)}>{enabledAddons[addon.key] ? 'Disable' : 'Enable'}</button><button onClick={() => openAddon(addon.key)} disabled={!enabledAddons[addon.key]}><Settings2 size={13}/> Settings</button></div>
          </div>)}
        </div>
        <div className="addons-manager-note"><strong>Provider-ready design.</strong><span>AI Composer is prepared for Gemini first, then OpenAI, Claude, Ollama, and custom OpenAI-compatible endpoints later.</span></div>
      </div>
    </div>, document.body);
  }

  function renderAiComposerModal() {
    if (!aiComposerOpen) return null;
    return createPortal(<div className="simple-modal-backdrop ai-composer-backdrop top-layer-modal" onMouseDown={() => setAiComposerOpen(false)}>
      <div className="ai-composer-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="ai-composer-head"><div><span className="ai-composer-icon"><Bot size={18}/></span></div><div><h3>AI Composer</h3><p>Add-on foundation for Ask Page, Summarize, Rewrite, Explain Code, and Generate Blocks.</p></div><button className="icon-only" aria-label="Close AI Composer" onClick={() => setAiComposerOpen(false)}><X size={16}/></button></div>
        <div className="ai-composer-grid">
          {['Ask current page', 'Summarize page', 'Rewrite selection', 'Generate note', 'Explain code block', 'Create blocks'].map(label => <button key={label} onClick={() => setSimpleModal({ title: label, message: 'This AI Composer action is prepared for the provider integration release. Gemini will be the recommended first provider.', confirmText: 'Done' })}><Sparkles size={15}/><span>{label}</span></button>)}
        </div>
        <div className="ai-provider-box"><strong>Provider</strong><p>Gemini first, with OpenAI, Claude, Ollama/local, and custom endpoints planned behind the same add-on UI.</p></div>
      </div>
    </div>, document.body);
  }

  function renderQuickNewModal() {
    if (!newPageChoice) return null;
    const parent = newPageChoice.parentId ? pageById.get(newPageChoice.parentId) : null;
    const pick = async (mode: 'block' | 'plain') => {
      const parentId = newPageChoice.parentId;
      setNewPageChoice(null);
      await createPage(parentId, mode === 'plain' ? 'New Document' : 'New Page', 'paragraph', '', mode);
    };
    return createPortal(<div className="simple-modal-backdrop page-type-backdrop top-layer-modal" onMouseDown={() => setNewPageChoice(null)}>
      <div className="page-type-modal" onMouseDown={e => e.stopPropagation()}>
        <button className="modal-close page-type-close" title="Close" aria-label="Close" onClick={() => setNewPageChoice(null)}><X size={16}/></button>
        <div className="page-type-head"><h2>Choose page type</h2><p>{parent ? `Create inside ${parent.title || 'Untitled page'}` : 'Choose how this page will be edited. The choice is locked after creation.'}</p></div>
        <div className="page-type-grid">
          <button className="page-type-card block-choice" onClick={() => void pick('block')}>
            <span className="page-type-icon"><LayoutGrid size={20}/></span>
            <strong>Block Page</strong>
            <em>Structured notes, files, images, code, tables, and blocks.</em>
            <span className="page-type-tag">Current noteX editor</span>
          </button>
          <button className="page-type-card plain-choice" onClick={() => void pick('plain')}>
            <span className="page-type-icon"><FileText size={20}/></span>
            <strong>Plain Document</strong>
            <em>Long-form writing with a simple toolbar for headings, lists, and formatting.</em>
            <span className="page-type-tag">Toolbar editor</span>
          </button>
        </div>
        <p className="page-type-note"><Lock size={13}/> Mode is selected once when creating a page and cannot be switched later.</p>
      </div>
    </div>, document.body);
  }


  if (!authChecked) return <div className="login-gate"><div className="login-card"><div className="login-brand"><BookOpen size={30}/><span>noteX</span></div><p>Loading noteX...</p></div></div>;
  if (!currentUser) return <LoginGate />;

  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`} data-theme={appTheme} style={{ '--sidebar-width': `${sidebarCollapsed ? 52 : sidebarWidth}px` } as React.CSSProperties}>
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} onClick={() => { if (sidebarCollapsed) setSidebarCollapsed(false); }}>
      <div className="brand" role="button" tabIndex={0} title="Go to home" onClick={goHome} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); } }}><BookOpen size={21}/>{sidebarCollapsed && <strong>noteX</strong>}{!sidebarCollapsed && <><strong>noteX</strong><div className="brand-actions"><button className="workspace-avatar brand-profile" title="Workspace" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setWorkspaceMenuPos({ left: r.right + 8, top: r.top }); setWorkspaceMenuOpen(v => !v); }}>{(currentWorkspace?.name || 'P').slice(0,1).toUpperCase()}</button></div></>}{workspaceMenuOpen && !sidebarCollapsed && createPortal(<div className="workspace-menu compact-workspace-menu floating-popover" style={workspaceMenuPos ? ({ '--popover-left': `${workspaceMenuPos.left}px`, '--popover-top': `${workspaceMenuPos.top}px` } as React.CSSProperties) : undefined} onClick={e => e.stopPropagation()}><div className="workspace-card-head modern-workspace-head"><span className="workspace-avatar large">{(currentWorkspace?.name || 'P').slice(0,1).toUpperCase()}</span><div><strong>{currentWorkspace?.name || 'Personal'}</strong><p>{currentUser?.email || 'local@notex.app'} · {workspaces.length}/3 workspaces</p></div></div><div className="workspace-menu-section-label">Workspaces</div><div className="workspace-switch-list modern-workspace-list">{workspaces.map(w => <button key={w.id} className={w.id === activeWorkspaceId ? 'active' : ''} onClick={() => switchWorkspace(w.id)}><span className="workspace-dot">{w.name.slice(0,1).toUpperCase()}</span><span>{w.name}</span>{w.id === activeWorkspaceId && <Check size={14}/>}</button>)}</div><div className="workspace-actions-grid"><button onClick={() => currentWorkspace && renameWorkspace(currentWorkspace.id)}><SlidersHorizontal size={15}/> Rename</button><button onClick={() => { setWorkspaceMenuOpen(false); setWorkspaceManagerOpen(true); }}><FolderOpen size={15}/> Manage</button><button disabled={workspaces.length >= 3} title={workspaces.length >= 3 ? 'Maximum 3 workspaces reached' : 'Create a new noteX workspace'} onClick={() => { setWorkspaceMenuOpen(false); setWorkspaceManagerOpen(true); }}><Plus size={15}/> New</button></div><div className="workspace-menu-section-label">Account</div><button onClick={() => { setWorkspaceMenuOpen(false); openAccountSettings(); }}><Users size={15}/> Account Settings</button><button onClick={() => setAuthOpen(true)}><Users size={15}/> Switch Account</button><button className="workspace-signout" onClick={signOutNoteX}><LogOut size={15}/> Sign Out</button></div>, document.body)}</div>
      {!sidebarCollapsed && <div className="sidebar-action-row"><button className="new-page" onClick={() => openQuickNew(null)}>Create Note</button><button className="brand-search" title="Search notes (Ctrl/Cmd + Shift + F)" onClick={() => setPaletteOpen(true)}><Search size={15}/></button></div>}

      {!sidebarCollapsed && <div className="sections-wrap">
        <Section id="recents" title="Recents" icon={<History size={14}/>} count={recentPages.length}>
          {sortedRecentPages.length ? sortedRecentPages.map(p => <SidebarPageItem key={p.id} page={p} compact menuKey={`recents-${p.id}`} />) : <p className="empty-side">No Recent Notes</p>}
        </Section>

        <Section id="favorites" title="Favorites" icon={<Star size={14}/>} count={favoritePages.length}>
          {sortedFavoritePages.length ? sortedFavoritePages.map(p => <SidebarPageItem key={p.id} page={p} compact menuKey={`favorites-${p.id}`} />) : null}
        </Section>

        <Section id="organize" title="Private" icon={<Folder size={14}/>} count={normalPages.length}>
          <div className="page-list tree"><PageTree nodes={tree}/></div>
          {normalPages.length > 20 && <button className="more-pages sidebar-more-pages" onClick={() => setLibraryOpen(true)}><MoreHorizontal size={13}/><span>More</span></button>}
        </Section>

        <Section id="others" title="Others" icon={<LayoutGrid size={14}/>} count={otherPages.length}>
          {sortedOtherPages.length ? sortedOtherPages.map(p => <SidebarPageItem key={p.id} page={p} compact menuKey={`others-${p.id}`} />) : <p className="empty-side">No Other Pages</p>}
        </Section>

        <Section id="addons" title="Add-ons" icon={<Puzzle size={14}/>} count={Object.values(enabledAddons).filter(Boolean).length}>
          {enabledAddons.aiComposer && <button className="side-page addon-side-page" onClick={() => openAddon('aiComposer')}><Bot size={14}/><span>AI Composer</span></button>}
          {enabledAddons.templates && <button className="side-page addon-side-page" onClick={() => openAddon('templates')}><FileText size={14}/><span>Templates</span></button>}
          <button className="side-page addon-side-page addon-manager-link" onClick={() => setAddonsOpen(true)}><Settings2 size={14}/><span>Manage Add-ons</span></button>
        </Section>

        <div className="side-system-block">
          <div className="side-section-separator" />
          <button className="side-system-link" onClick={() => setLibraryOpen(true)}><BookOpen size={14}/><span>Library</span></button>
          <button className="side-system-link" onClick={openTrashModal}><Trash2 size={14}/><span>Trash</span></button>
        </div>
      </div>}

      {!sidebarCollapsed && currentUser && <button className="sidebar-signout-button" onClick={signOutNoteX}><LogOut size={14}/><span>Sign Out</span></button>}
      {!sidebarCollapsed && <button className="resize-handle" title="Resize sidebar" onMouseDown={(e) => { e.preventDefault(); resizeRef.current = true; }}><GripVertical size={16}/></button>}
    </aside>

    <main className="main">
      <div className="window-tabs">
        <button className="tab-icon" title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setSidebarCollapsed(v => !v)}><PanelLeft size={17}/></button>
        <button className="tab-nav" title="Back" disabled={libraryOpen || openTabs.findIndex(t => t.id === activePageId) <= 0} onClick={() => navigateTab(-1)}>‹</button>
        <button className="tab-nav" title="Forward" disabled={libraryOpen || openTabs.findIndex(t => t.id === activePageId) < 0 || openTabs.findIndex(t => t.id === activePageId) >= openTabs.length - 1} onClick={() => navigateTab(1)}>›</button>
        <div className="tab-strip">
          {(libraryOpen || pinnedTabIds.includes('__library__')) && <div className={`page-tab ${libraryOpen ? 'active' : ''} library-tab ${pinnedTabIds.includes('__library__') ? 'pinned' : ''}`} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); const w = 205; const h = 168; setTabMenu({ pageId: '__library__', left: Math.max(8, Math.min(e.clientX, window.innerWidth - w - 8)), top: Math.max(8, Math.min(e.clientY + 8, window.innerHeight - h - 8)) }); }} onClick={() => setLibraryOpen(true)} data-tooltip={pinnedTabIds.includes('__library__') ? 'Library' : undefined}>{pinnedTabIds.includes('__library__') && <Pin size={12} className="pin-mark"/>}<span>{pinnedTabIds.includes('__library__') ? 'Li' : 'Library'}</span>{!pinnedTabIds.includes('__library__') && <button className="tab-close" title="Close Library" onClick={(e) => { e.stopPropagation(); setLibraryOpen(false); }}><X size={12}/></button>}</div>}
          {openTabs.map(tab => { const pinned = pinnedTabIds.includes(tab.id); return <div key={tab.id} className={`page-tab ${pinned ? 'pinned' : ''} ${!libraryOpen && tab.id === activePageId ? 'active' : ''}`} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); const w = 205; const h = 168; setTabMenu({ pageId: tab.id, left: Math.max(8, Math.min(e.clientX, window.innerWidth - w - 8)), top: Math.max(8, Math.min(e.clientY + 8, window.innerHeight - h - 8)) }); }} onClick={() => { setLibraryOpen(false); selectPage(tab.id); }} title={pinned ? `${tab.title} · pinned` : tab.title} data-tooltip={pinned ? tab.title : undefined}>{pinned && <Pin size={12} className="pin-mark"/>}<span>{pinned ? (tab.title || 'Page').slice(0, 2) : tab.title}</span>{!pinned && <button className="tab-close" title="Close tab" onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}><X size={12}/></button>}</div>; })}
          <button className="tab-add" title="New Page" onClick={() => openQuickNew(null)}><Plus size={15}/></button>
        </div>
        <span className="app-version-badge" data-version={APP_VERSION_LABEL}>{APP_VERSION_LABEL}</span>
      </div>
      <input ref={fileRef} type="file" accept="application/json" hidden onChange={e => { handleRestore(e.target.files?.[0]); e.currentTarget.value = ''; }}/>
      {!libraryOpen && activePage && <header className="topbar">
        <div className="crumb">{breadcrumbs.length ? breadcrumbs.map((p, i) => {
          const children = pageChildrenByParent.get(p.id) || [];
          return <span className={`crumb-item ${children.length ? 'has-children' : ''}`} key={p.id}>
            {i > 0 && <b>/</b>}
            <button className="crumb-link" onClick={() => selectPage(p.id)} title={p.title}>{p.title}</button>
            {children.length > 0 && <div className="crumb-menu">{children.map(child => <button key={child.id} onClick={() => selectPage(child.id)} title={child.title}><FileText size={15}/><span>{child.title}</span><ChevronRight size={14}/></button>)}</div>}
          </span>;
        }) : <span className="crumb-item"><button className="crumb-link">Untitled</button></span>}</div>
        <div className="toolbar compact-topbar">
          <span className="page-load-timer" title="Approximate active page block load time">loaded time: {pageLoadMs == null ? 'loading…' : `${pageLoadMs} ms`}</span>
          <button className="share-button" onClick={() => setSimpleModal({ title: 'Share', message: 'Share is prepared for the cloud-sync release.', confirmText: 'Done' })}><Link size={14}/> Share</button>
          <button onClick={toggleFavorite} className={`icon-button ${activePage?.favorite ? 'active' : ''}`} title={activePage?.favorite ? 'Remove favorite' : 'Add favorite'}><Star size={16}/></button>
          <div className="actions-wrap" ref={topActionsRef}>
            <button className="icon-button more-action" onClick={(e) => { e.stopPropagation(); setActionMenuOpen(v => !v); }} title="Actions"><MoreHorizontal size={18}/></button>
            {actionMenuOpen && <div className="top-actions-menu" onClick={e => e.stopPropagation()}>
              <label className="action-search"><Search size={15}/><input placeholder="Search actions..." /></label>
              <div className="font-row"><button className={fontMode === 'default' ? 'selected' : ''} onClick={() => setWorkspaceFont('default')}><strong>Ag</strong><span>Default</span></button><button className={fontMode === 'serif' ? 'selected' : ''} onClick={() => setWorkspaceFont('serif')}><strong>Ag</strong><span>Serif</span></button><button className={fontMode === 'mono' ? 'selected' : ''} onClick={() => setWorkspaceFont('mono')}><strong>Ag</strong><span>Mono</span></button></div>
              <button onClick={() => { copyPageLink(activePageId); setActionMenuOpen(false); }}><Link size={16}/><span>Copy Link</span><em>⌘L</em></button>
              <button onClick={() => { navigator.clipboard?.writeText(document.querySelector('.page')?.textContent || ''); setActionMenuOpen(false); setSimpleModal({ title: 'Copied contents', message: 'The visible page contents have been copied.', confirmText: 'Done' }); }}><FileText size={16}/><span>Copy Page Contents</span></button>
              <button onClick={() => { duplicatePage(activePageId); setActionMenuOpen(false); }}><FilePlus size={16}/><span>Duplicate</span><em>⌘D</em></button>
              <button onClick={() => { movePage(activePageId); setActionMenuOpen(false); }}><FolderOpen size={16}/><span>Move To</span><em>⌘⇧P</em></button>
              <button className="danger" onClick={() => { setActionMenuOpen(false); setSimpleModal({ title: 'Move to Trash', message: `Move ${activePage?.title || 'this page'} to trash?`, confirmText: 'Move to Trash', onConfirm: () => deletePage() }); }}><Trash2 size={16}/><span>Move to Trash</span></button>
              <div className="page-menu-divider" />
              <button onClick={() => { setBackupOpen(true); setActionMenuOpen(false); }}><Save size={16}/><span>Backup & Restore</span></button>
              <button onClick={() => { downloadBackup(); setActionMenuOpen(false); setSimpleModal({ title: 'Export', message: 'Your JSON backup export has started.', confirmText: 'Done' }); }}><Upload size={16}/><span>Export JSON</span></button>
              <button onClick={() => { fileRef.current?.click(); setActionMenuOpen(false); }}><Download size={16}/><span>Restore JSON</span></button>
            </div>}
          </div>
        </div>
      </header>}

      {libraryOpen ? <LibraryPage /> : activePage ? <section className={`page editor-font-${fontMode} ${(activePage.editorMode || 'block') === 'plain' ? 'plain-page' : 'block-page'}`}>
        <div className="page-kicker"><FileText size={15}/>{activePage.favorite ? 'Favorite note' : 'Local note'}</div>
        <div
          key={activePage.id}
          ref={pageTitleRef}
          className={`page-title ${['New Page','New Document'].includes(activePage.title) ? 'is-placeholder-title' : ''}`}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={(activePage.editorMode || 'block') === 'plain' ? 'New Document' : 'New Page'}
          onFocus={e => {
            const el = e.currentTarget;
            if (['New Page','New Document'].includes((el.textContent || '').trim())) {
              el.textContent = '';
              updateTitle('', false);
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const fallbackTitle = (activePage.editorMode || 'block') === 'plain' ? 'New Document' : 'New Page';
              const text = (e.currentTarget.textContent || '').trim() || fallbackTitle;
              updateTitle(text);
              requestAnimationFrame(() => {
                const firstBlock = document.querySelector('.plain-rich-editor, .editor [contenteditable="true"], .editor textarea') as HTMLElement | null;
                firstBlock?.focus();
              });
            }
          }}
          onInput={e => { updateTitle(e.currentTarget.textContent || '', false); }}
          onBlur={e => {
            const text = (e.currentTarget.textContent || '').trim();
            if (!text) { const fallbackTitle = (activePage.editorMode || 'block') === 'plain' ? 'New Document' : 'New Page'; e.currentTarget.textContent = fallbackTitle; updateTitle(fallbackTitle); }
            else updateTitle(text);
          }}
        >{['New Page','New Document'].includes(activePage.title) ? activePage.title : activePage.title}</div>
        {pageMetaText && <div className="page-meta-line">{pageMetaText}</div>}
        <div className="page-tags"><div className="page-tags-left"><Tag size={13}/>{(activePage.tags || []).map(t => <button key={t} className="tag-pill" onClick={() => removeTagFromActivePage(t)} title="Remove tag">{t}<X size={11}/></button>)}<label className="tag-input"><input placeholder="Add Tag..." value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); if (tagInput.trim()) addTagToActivePage(); requestAnimationFrame(() => { const firstBlock = document.querySelector('.plain-rich-editor, .editor [contenteditable="true"], .editor textarea') as HTMLElement | null; firstBlock?.focus(); }); return; } if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTagToActivePage(); } }} onBlur={() => { if (tagInput.trim()) addTagToActivePage(); }}/></label></div><div className="page-tags-right"><div className="page-export-actions compact"><button className="export-copy" title="Copy all editor content" onClick={copyActivePageContent}><Copy size={12}/><span>Copy</span></button><div className="export-more-wrap"><button className="export-more" title="More export options" onClick={(e) => { e.stopPropagation(); setExportMenuOpen(v => !v); }}><MoreHorizontal size={14}/><span>More</span></button>{exportMenuOpen && <div className="export-more-menu floating-popover" onClick={e => e.stopPropagation()}><button className="export-pdf" onClick={() => { setExportMenuOpen(false); exportActivePagePdf(); }}><Printer size={13}/><span>Export PDF</span></button><button className="export-docx" onClick={() => { setExportMenuOpen(false); exportActivePageDocx(); }}><FileDown size={13}/><span>Export DOCX</span></button><button className="export-email" onClick={() => { setExportMenuOpen(false); exportActivePageEml(); }}><Mail size={13}/><span>Export Email (.eml)</span></button></div>}</div></div></div></div>
        {(activePage.editorMode || 'block') === 'plain' ? <PlainEditor pageId={activePage.id} workspaceId={activePage.workspaceId} onChanged={load} onPageLoaded={setPageLoadMs}/> : <BlockEditor pageId={activePage.id} onChanged={load} onCreatePage={() => createPage(activePage.id)} onPageLoaded={setPageLoadMs}/>}
        {activePage.title.toLowerCase().includes('database') && <DatabaseViews />}
        <div className="page-footer-row">
          {!activePage.title.toLowerCase().includes('database') && <div className="credits">noteX | copyright © 2026 by nixnux</div>}
          <section className="snapshots compact-snapshots"><h3><History size={16}/> Snapshot</h3>{latestSnapshot ? <button onClick={() => restoreSnap(latestSnapshot.id)}><span>Latest:</span><em>{formatSnapshotLabel(latestSnapshot.label)} · {new Date(latestSnapshot.createdAt).toLocaleString()}</em></button> : <span className="snapshot-inline">No snapshots yet</span>}{snapshotCount > 1 && <button className="snapshot-more-button" title="Show snapshot history" onClick={() => setSnapshotHistoryOpen(true)}><MoreHorizontal size={14}/></button>}</section>
        </div>
      </section> : <section className="empty no-page-selected"><div className="empty-state-card"><h1>{pages.length === 0 && trashPages.length === 0 ? 'Welcome to noteX' : 'No Page Selected'}</h1><p>{pages.length === 0 && trashPages.length === 0 ? 'Create your first note or import a previous noteX JSON backup to continue from another device.' : 'Select a page from the sidebar to start editing, or create a new note.'}</p><div className="empty-state-actions"><button className="primary-button create-empty-page" onClick={() => openQuickNew(null)}>Create Note</button>{pages.length === 0 && trashPages.length === 0 && <button className="secondary-button import-empty-backup" onClick={() => fileRef.current?.click()}><Upload size={13}/><span>Import Backup JSON</span></button>}</div></div></section>}
    </main>

    {trashOpen && <TrashModal />}

    {snapshotHistoryOpen && createPortal(<div className="modal-backdrop snapshot-history-backdrop top-layer-modal" onMouseDown={() => setSnapshotHistoryOpen(false)}>
      <div className="snapshot-history-modal" onMouseDown={e => e.stopPropagation()}>
        <button className="modal-close icon-only" title="Close" onClick={() => setSnapshotHistoryOpen(false)}><X size={16}/></button>
        <div className="snapshot-history-hero"><span className="snapshot-history-icon"><History size={18}/></span><div><h2>Snapshot History</h2><p>Restore or clean up previous local snapshots for this browser.</p></div></div>
        <div className="snapshot-history-tools">
          <button onClick={() => setSimpleModal({ title: 'Clean up old snapshots', message: 'Keep only the latest 10 tracked snapshots?', confirmText: 'Clean up', onConfirm: cleanupOldSnapshotData })}><RotateCcw size={14}/>Keep latest 10</button>
          <button className="danger-soft" onClick={() => setSimpleModal({ title: 'Delete all snapshots', message: 'Delete all local snapshots from this browser? This cannot be undone.', confirmText: 'Delete all', onConfirm: deleteAllSnapshotData })}><Trash2 size={14}/>Delete all</button>
        </div>
        <div className="snapshot-history-list">
          {snapshotHistory.length === 0 && <div className="snapshot-history-empty">No tracked snapshot metadata yet. If you have oversized legacy snapshots, use <strong>Delete all</strong> to clear them safely.</div>}
          {snapshotHistory.map((s, index) => <div className="snapshot-history-row" key={s.id}>
            <button className="snapshot-history-restore" onClick={() => { setSnapshotHistoryOpen(false); restoreSnap(s.id); }}><span className="snapshot-history-row-icon"><History size={14}/></span><span className="snapshot-history-name">{index === 0 ? 'Latest' : formatSnapshotLabel(s.label)}</span><em>{new Date(s.createdAt).toLocaleString()} · {formatBytes(s.sizeBytes || 0)}</em></button>
            <button className="snapshot-history-delete" title="Delete snapshot" onClick={(e) => { e.stopPropagation(); setSimpleModal({ title: 'Delete snapshot', message: 'Delete this local snapshot? This cannot be undone.', confirmText: 'Delete', onConfirm: () => deleteSnapshot(s.id) }); }}><Trash2 size={15}/></button>
          </div>)}
        </div>
      </div>
    </div>, document.body)}
    {renderQuickNewModal()}
    <MoveModal />
    {renderWorkspaceManagerModal()}
    {renderAccountSettingsModal()}
    {renderAddonsManagerModal()}
    {renderAiComposerModal()}
    <AuthModal />
    {LocalAuthModal()}
    <BackupModal />
    <TabContextMenu />
    {showTopButton && <button className="scroll-top-button" title="Back to top" onClick={scrollNoteXToTop}><ArrowUp size={18}/></button>}
    {paletteOpen && <div className="palette-backdrop" onClick={() => setPaletteOpen(false)}>
      <div className="palette modern-search-palette" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteActiveIndex(i => Math.min(Math.max(paletteTotalRows - 1, 0), i + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteActiveIndex(i => Math.max(0, i - 1)); } if (e.key === 'Enter') { e.preventDefault(); runPaletteRow(paletteActiveIndex); } if (e.key === 'Escape') setPaletteOpen(false); }}>
        <label className="palette-search-field"><Command size={17}/><input autoFocus placeholder="Search or ask a question in noteX..." value={paletteQuery} onChange={e => setPaletteQuery(e.target.value)} /></label>{paletteQuery.trim() && <div className="palette-ai-row"><button className="palette-ai-button" disabled={aiBusy} onClick={askAiFromPalette}><span>{aiBusy ? 'Asking AI...' : 'Ask AI in noteX'}</span><em>Creates a new answer page</em></button></div>}
        {!paletteQuery.trim() && paletteHistory.length > 0 && <div className="palette-history modern-history-list">
          <div className="palette-history-head">
            <label className="palette-select-all"><input type="checkbox" checked={selectedPaletteHistory.length === paletteHistory.length && paletteHistory.length > 0} onChange={e => setSelectedPaletteHistory(e.target.checked ? paletteHistory : [])}/><span>Search history</span></label>
            <div className="palette-history-actions"><button disabled={!selectedPaletteHistory.length} onClick={deleteSelectedPaletteHistory}>Delete Selected</button><button disabled={!paletteHistory.length} onClick={clearPaletteHistory}>Delete All</button></div>
          </div>
          {paletteHistory.map((item, i) => <div className={`palette-history-row ${paletteActiveIndex === i ? 'active' : ''}`} key={item}>
            <input className="palette-history-check" type="checkbox" checked={selectedPaletteHistory.includes(item)} onChange={e => togglePaletteHistoryItem(item, e.target.checked)} onClick={e => e.stopPropagation()} />
            <button className="palette-history-main" onMouseEnter={() => setPaletteActiveIndex(i)} onClick={() => setPaletteQuery(item)}><History size={13}/><span>{item}</span></button>
            <button className="palette-history-delete" title="Delete history" onClick={() => removePaletteHistoryItem(item)}><X size={13}/></button>
          </div>)}
        </div>}
        <div className="palette-results-list">{paletteVisibleItems.map((item, i) => { const rowIndex = paletteHistoryVisible.length + i; return <button className={paletteActiveIndex === rowIndex ? 'active' : ''} key={i} onMouseEnter={() => setPaletteActiveIndex(rowIndex)} onClick={() => { savePaletteHistoryItem(paletteQuery || item.label); item.action(); setPaletteOpen(false); }}><strong>{item.label}</strong><span>{item.hint}</span></button>; })}</div>
      </div>
    </div>}
    {simpleModal && createPortal(<div className="simple-modal-backdrop top-layer-modal" onClick={() => setSimpleModal(null)}><div className="simple-modal" onClick={e => e.stopPropagation()}><h3>{simpleModal.title}</h3><p>{simpleModal.message}</p>{simpleModal.inputValue !== undefined && <input className="simple-modal-input" autoFocus value={simpleModal.inputValue} placeholder={simpleModal.inputPlaceholder || ''} onChange={e => setSimpleModal({ ...simpleModal, inputValue: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { const value = simpleModal.inputValue || ''; const fn = simpleModal.onInputConfirm; setSimpleModal(null); fn?.(value); } }} /> }<div>{simpleModal.onConfirm && <button className="primary-button" onClick={() => { const fn = simpleModal.onConfirm; setSimpleModal(null); fn?.(); }}>{simpleModal.confirmText || 'Confirm'}</button>}{simpleModal.onInputConfirm && <button className="primary-button" onClick={() => { const value = simpleModal.inputValue || ''; const fn = simpleModal.onInputConfirm; setSimpleModal(null); fn?.(value); }}>{simpleModal.confirmText || 'Done'}</button>}{!simpleModal.onConfirm && !simpleModal.onInputConfirm && <button className="primary-button" onClick={() => setSimpleModal(null)}>{simpleModal.confirmText || 'Done'}</button>}</div></div></div>, document.body)}
  </div>;
}
