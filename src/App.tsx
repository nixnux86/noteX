import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  Mail
} from 'lucide-react';
import { db, Page, Snapshot, uid, now, type Block, type BlockType, type User, type Workspace } from './db/schema';
import { ensureSeedData } from './db/seed';
import { BlockEditor } from './components/BlockEditor';
import { DatabaseViews } from './components/DatabaseViews';
import { cloudSyncMessage, createSnapshot, downloadBackup, restoreBackup, restoreSnapshot } from './sync/backup';
import './styles/app.css';

type TreeNode = Page & { children: TreeNode[] };

type SidebarSectionKey = 'recents' | 'favorites' | 'organize' | 'others';

const GOOGLE_CLIENT_ID = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '';

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

function buildTree(pages: Page[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  pages.forEach(p => map.set(p.id, { ...p, children: [] }));
  const roots: TreeNode[] = [];
  map.forEach(node => {
    if (node.parentId && map.has(node.parentId)) map.get(node.parentId)!.children.push(node);
    else roots.push(node);
  });
  const sort = (a: TreeNode, b: TreeNode) => b.updatedAt - a.updatedAt;
  roots.sort(sort);
  map.forEach(n => n.children.sort(sort));
  return roots;
}

export default function App() {
  const [pages, setPages] = useState<Page[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [authChecked, setAuthChecked] = useState(false);
  const [activePageId, setActivePageId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [syncStatus, setSyncStatus] = useState('Not signed in');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteHistory, setPaletteHistory] = useState<string[]>([]);
  const [selectedPaletteHistory, setSelectedPaletteHistory] = useState<string[]>([]);
  const [paletteActiveIndex, setPaletteActiveIndex] = useState(0);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotHistoryOpen, setSnapshotHistoryOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pageMenuId, setPageMenuId] = useState<string | null>(null);
  const [pageMenuInstance, setPageMenuInstance] = useState<string | null>(null);
  const [sectionMenuId, setSectionMenuId] = useState<SidebarSectionKey | null>(null);
  const [sectionMenuPos, setSectionMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [hiddenSections, setHiddenSections] = useState<Record<SidebarSectionKey, boolean>>({ recents: false, favorites: false, organize: false, others: false });
  const [moveModalFor, setMoveModalFor] = useState<string | null>(null);
  const [moveQuery, setMoveQuery] = useState('');
  const [moveActiveIndex, setMoveActiveIndex] = useState(0);
  const [dragPageId, setDragPageId] = useState<string | null>(null);
  const [sidebarDropLine, setSidebarDropLine] = useState<string | null>(null);
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
  const [simpleModal, setSimpleModal] = useState<{ title: string; message: string; confirmText?: string; onConfirm?: () => void; inputValue?: string; inputPlaceholder?: string; onInputConfirm?: (value: string) => void } | null>(null);
  const currentWorkspace = useMemo(() => workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0] || null, [workspaces, activeWorkspaceId]);
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [pinnedTabIds, setPinnedTabIds] = useState<string[]>([]);
  const [tabMenu, setTabMenu] = useState<{ pageId: string; left: number; top: number } | null>(null);
  const [historyIds, setHistoryIds] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [collapsedSections, setCollapsedSections] = useState<Record<SidebarSectionKey, boolean>>({
    recents: false,
    favorites: false,
    organize: false,
    others: false
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef(false);
  const quickTextRef = useRef<HTMLTextAreaElement>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const accountAvatarRef = useRef<HTMLInputElement>(null);
  const pageTitleRef = useRef<HTMLDivElement>(null);
  const topActionsRef = useRef<HTMLDivElement>(null);
  const pendingTitleFocusRef = useRef<string | null>(null);
  const [localAuthOpen, setLocalAuthOpen] = useState(false);
  const [localAuthMode, setLocalAuthMode] = useState<'setup' | 'login'>('login');
  const [localPassword, setLocalPassword] = useState('');
  const [localPasswordConfirm, setLocalPasswordConfirm] = useState('');
  const [localAuthError, setLocalAuthError] = useState('');
  const localPasswordInputRef = useRef<HTMLInputElement | null>(null);
  const localPasswordConfirmInputRef = useRef<HTMLInputElement | null>(null);
  const [knownUsers, setKnownUsers] = useState<User[]>([]);

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
    const allPages = await db.pages.orderBy('updatedAt').reverse().toArray();
    const scopedPages = allPages.filter(p => p.workspaceId === effectiveWorkspaceId);
    const all = scopedPages.filter(p => !p.deleted);
    setPages(all);
    setTrashPages(scopedPages.filter(p => !!p.deleted));
    setSnapshots(await db.snapshots.orderBy('createdAt').reverse().toArray());
    const saved = await db.settings.get(`activePageId:${effectiveWorkspaceId}`);
    const legacySaved = await db.settings.get('activePageId');
    const savedId = saved?.value || legacySaved?.value;
    const id = savedId && all.some(p => p.id === savedId) ? savedId : all[0]?.id;
    if (id && !activePageId) {
      pendingTitleFocusRef.current = id;
    setActivePageId(id);
      setOpenTabIds(prev => prev.includes(id) ? prev : [...prev, id]);
      setHistoryIds(prev => prev.length ? prev : [id]);
      setHistoryIndex(prev => prev >= 0 ? prev : 0);
    }
    const sync = await db.settings.get('syncProvider');
    setSyncStatus(userSyncLabel(identity.user, sync?.value));
    const w = await db.settings.get('sidebarWidth');
    if (typeof w?.value === 'number') setSidebarWidth(Math.min(420, Math.max(230, w.value)));
    const fm = await db.settings.get('fontMode');
    if (fm?.value === 'serif' || fm?.value === 'mono' || fm?.value === 'default') setFontMode(fm.value);
    const savedPinned = await db.settings.get('pinnedTabIds');
    if (Array.isArray(savedPinned?.value)) setPinnedTabIds(savedPinned.value.filter((id: string) => id === '__library__' || all.some(p => p.id === id)));
    const savedPaletteHistory = await db.settings.get('paletteHistory');
    if (Array.isArray(savedPaletteHistory?.value)) setPaletteHistory(savedPaletteHistory.value.slice(0, 10));
    if (all.length === 0) {
      setSidebarCollapsed(true);
      setCollapsedSections({ recents: true, favorites: true, organize: true, others: true });
    }
  }

  useEffect(() => { load(); }, []);


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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
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

  const activePage = pages.find(p => p.id === activePageId);
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

  const searchablePages = useMemo(() => pages.filter(p => p.title.toLowerCase().includes(query.toLowerCase())), [pages, query]);
  const normalPages = useMemo(() => searchablePages.filter(p => p.section !== 'other'), [searchablePages]);
  const otherPages = useMemo(() => searchablePages.filter(p => p.section === 'other' || ['canvas ideas', 'project database', 'research notes'].includes(p.title.toLowerCase())), [searchablePages]);
  const recentPages = useMemo(() => [...searchablePages].sort((a, b) => (b.lastOpenedAt || b.updatedAt) - (a.lastOpenedAt || a.updatedAt)).slice(0, 5), [searchablePages]);
  const favoritePages = useMemo(() => searchablePages.filter(p => p.favorite), [searchablePages]);
  const tree = useMemo(() => buildTree(normalPages), [normalPages]);
  const recentTree = useMemo(() => buildTree(recentPages), [recentPages]);
  const favoriteTree = useMemo(() => buildTree(favoritePages), [favoritePages]);
  const otherTree = useMemo(() => buildTree(otherPages), [otherPages]);
  const breadcrumbs = useMemo(() => {
    const byId = new Map(pages.map(p => [p.id, p]));
    const path: Page[] = [];
    let cur = activePage;
    while (cur) {
      path.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return path;
  }, [pages, activePage]);

  const openTabs = useMemo(() => {
    const pinned = openTabIds.filter(id => pinnedTabIds.includes(id));
    const regular = openTabIds.filter(id => !pinnedTabIds.includes(id));
    return [...pinned, ...regular].map(id => pages.find(p => p.id === id)).filter(Boolean).slice(0, 10) as Page[];
  }, [openTabIds, pinnedTabIds, pages]);
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

  function closeTab(id: string) {
    setTabMenu(null);
    setOpenTabIds(prev => {
      const idx = prev.indexOf(id);
      const next = prev.filter(x => x !== id);
      if (id === activePageId) {
        const fallback = next[idx] || next[idx - 1] || pages.find(p => !p.deleted)?.id || '';
        if (fallback) selectPage(fallback);
        else setActivePageId('');
      }
      return next;
    });
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
    await createPage(parentId);
  }

  async function createPage(parentId: string | null = null, title = 'New Page', initialBlockType: BlockType = 'paragraph', initialText = '') {
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
    await db.pages.add({ id, workspaceId, title: title.trim() || 'New Page', icon: '📄', parentId, collapsed: 1, favorite: 0, lastOpenedAt: t, createdAt: t, updatedAt: t });
    await db.blocks.add({ id: uid(), workspaceId, pageId: id, type: initialBlockType, text: initialText, sort: 1, createdAt: t, updatedAt: t });
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
    const link = `${location.origin}${location.pathname}#page=${id}`;
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
    setHiddenSections({ recents: false, favorites: false, organize: false, others: false });
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
    await createSnapshot('Manual snapshot');
    await load();
    setSimpleModal({ title: 'Snapshot created', message: 'A local snapshot has been created.', confirmText: 'Done' });
  }

  async function restoreSnap(id: string) {
    setSimpleModal({
      title: 'Restore snapshot',
      message: 'Restore this snapshot? Current local data will be replaced.',
      confirmText: 'Restore',
      onConfirm: async () => { await restoreSnapshot(id); await load(); }
    });
  }


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
    if (!localAuthOpen) return;
    window.requestAnimationFrame(() => {
      if (localPasswordInputRef.current) localPasswordInputRef.current.value = '';
      if (localPasswordConfirmInputRef.current) localPasswordConfirmInputRef.current.value = '';
      localPasswordInputRef.current?.focus({ preventScroll: true });
    });
  }, [localAuthOpen, localAuthMode]);

  async function openLocalAuth() {
    const existingHash = (await db.settings.get('localPasswordHash'))?.value;
    setLocalAuthMode(existingHash ? 'login' : 'setup');
    setLocalPassword('');
    setLocalPasswordConfirm('');
    setLocalAuthError('');
    setLocalAuthOpen(true);
  }

  async function completeLocalLogin() {
    const password = (localPasswordInputRef.current?.value || localPassword).trim();
    if (password.length < 6) {
      setLocalAuthError('Use at least 6 characters for the local password.');
      return;
    }
    try {
      const savedHash = (await db.settings.get('localPasswordHash'))?.value;
      const savedSalt = (await db.settings.get('localPasswordSalt'))?.value;
      if (localAuthMode === 'setup') {
        const confirmPassword = (localPasswordConfirmInputRef.current?.value || localPasswordConfirm).trim();
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
          <input ref={localPasswordInputRef} className="local-auth-input" type="password" placeholder="Local password" defaultValue="" onChange={() => { if (localAuthError) setLocalAuthError(''); }} />
          {setup && <input ref={localPasswordConfirmInputRef} className="local-auth-input" type="password" placeholder="Confirm password" defaultValue="" onChange={() => { if (localAuthError) setLocalAuthError(''); }} />}
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
        <div className="login-visual" aria-hidden="true"><img src="/login-productivity.png" alt="" /></div>
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
            <div><strong>{snapshots.length}</strong><span>snapshots</span></div>
          </div>
          <div className="backup-actions-grid">
            <button onClick={() => { downloadBackup(); setSimpleModal({ title: 'Backup exported', message: 'Your noteX JSON backup download has started. Keep this file together with your noteX app ZIP when moving to another desktop.', confirmText: 'Done' }); }}>
              <Upload size={18}/><strong>Export backup JSON</strong><span>Download all pages, blocks, database views, settings, and snapshots.</span>
            </button>
            <button onClick={() => fileRef.current?.click()}>
              <Download size={18}/><strong>Restore from JSON</strong><span>Replace the current browser data with a selected noteX backup file.</span>
            </button>
            <button onClick={() => makeSnapshot()}>
              <Save size={18}/><strong>Create local snapshot</strong><span>Save a local restore point inside this browser before large edits.</span>
            </button>
          </div>
          <div className="backup-guide">
            <h4>Simple migration checklist</h4>
            <ol>
              <li>On the old desktop, click <strong>Export backup JSON</strong>.</li>
              <li>Copy both files to the new desktop: <code>noteX-v1.6.116.zip</code> and the exported <code>noteX-backup-*.json</code>.</li>
              <li>Run noteX on the new desktop, then click <strong>Restore from JSON</strong>.</li>
            </ol>
          </div>
          {snapshots.length > 0 && <div className="backup-snapshots">
            <h4>Recent local snapshots</h4>
            {snapshots.slice(0, 5).map(s => <button key={s.id} onClick={() => restoreSnap(s.id)}><History size={13}/><span>{s.label}</span><em>{new Date(s.createdAt).toLocaleString()}</em></button>)}
          </div>}
        </div>
      </div>,
      document.body
    );
  }

  function SidebarPageItem({ page, compact = false, menuKey }: { page: Page; compact?: boolean; menuKey: string }) {
    const isMenuOpen = pageMenuId === page.id && pageMenuInstance === menuKey;
    return <div className={`side-page-row ${page.id === activePageId ? 'selected' : ''} ${compact ? 'compact' : ''}`}>
      <button className="side-page" onClick={() => selectPage(page.id)}>{page.favorite ? <Star size={14} className="favorite-dot"/> : <FileText size={14}/>}<span>{page.title}</span></button>
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
        <button className="section-mini" title="Add new page" onClick={() => openQuickNew(null)}><Plus size={14}/></button>
        {sectionMenuId === id && <SectionMenu id={id}/>}
      </div>
      {!collapsed && <div className="side-section-body" onDragOver={e => e.preventDefault()} onDrop={() => { setSidebarDropLine(null); return id === 'organize' ? dropPageOn(null) : undefined; }}>{children}</div>}
    </section>;
  }

  function PageTree({ nodes, depth = 0, menuKeyPrefix = 'tree' }: { nodes: TreeNode[]; depth?: number; menuKeyPrefix?: string }) {
    return <>{nodes.map(n => <div key={n.id}>
      <div className={`tree-row ${n.id === activePageId ? 'selected' : ''} ${dragPageId === n.id ? 'dragging' : ''} ${sidebarDropLine === n.id ? 'sidebar-drop-line' : ''}`} data-depth={depth} style={{ paddingLeft: 8 + depth * 16, '--tree-depth': depth } as React.CSSProperties} draggable onDragStart={(e) => { setDragPageId(n.id); e.dataTransfer.setData('application/notex-page-id', n.id); e.dataTransfer.effectAllowed = 'copyMove'; }} onDragEnd={() => { setDragPageId(null); setSidebarDropLine(null); }} onDragOver={e => { e.preventDefault(); if (dragPageId && dragPageId !== n.id) setSidebarDropLine(n.id); }} onDragLeave={() => sidebarDropLine === n.id && setSidebarDropLine(null)} onDrop={(e) => { e.stopPropagation(); setSidebarDropLine(null); dropPageOn(n.id); }}>
        <button className="twisty" onClick={() => n.children.length ? toggleCollapse(n.id) : undefined}>{n.children.length ? (n.collapsed ? <ChevronRight size={13}/> : <ChevronDown size={13}/>) : <span/>}</button>
        <button className="tree-title" onClick={() => selectPage(n.id)}>{n.children.length ? (n.collapsed ? <Folder size={14}/> : <FolderOpen size={14}/>) : <FileText size={14}/>}<span>{n.title}</span></button>
        <button className="mini" title="Page options" onClick={(e) => { e.stopPropagation(); setSectionMenuId(null); setSectionMenuPos(null); const key = `${menuKeyPrefix}-${n.id}`; const nextOpen = !(pageMenuId === n.id && pageMenuInstance === key); const r = e.currentTarget.getBoundingClientRect(); setPageMenuPos(nextOpen ? { left: r.right + 8, top: Math.max(8, Math.min(r.top - 6, window.innerHeight - 330)) } : null); setPageMenuId(nextOpen ? n.id : null); setPageMenuInstance(nextOpen ? key : null); }}><MoreHorizontal size={14}/></button>
        {depth < 2 && <button className="mini" title="Add subpage" onClick={() => openQuickNew(n.id)}><Plus size={14}/></button>}
        {pageMenuId === n.id && pageMenuInstance === `${menuKeyPrefix}-${n.id}` && <PageMenu page={n}/>} 
      </div>
      {!n.collapsed && n.children.length > 0 && depth < 2 && <PageTree nodes={n.children} depth={depth + 1} menuKeyPrefix={menuKeyPrefix}/>} 
    </div>)}</>;
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

  const paletteItems = [
    ...pages.map(p => ({ label: p.title, hint: 'Open page', action: () => selectPage(p.id) })),
    { label: 'Create new page', hint: 'Workspace', action: () => createPage(null) },
    { label: 'Create subpage', hint: activePage?.title || 'No active page', action: () => createPage(activePageId || null) },
    { label: activePage?.favorite ? 'Remove from favorites' : 'Add to favorites', hint: activePage?.title || 'No active page', action: toggleFavorite },
    { label: 'Backup & Restore', hint: 'Export/import noteX data', action: () => setBackupOpen(true) },
    { label: 'Export JSON', hint: 'Backup', action: downloadBackup },
    { label: 'Create snapshot', hint: 'Local backup history', action: makeSnapshot },
    { label: 'Restore JSON', hint: 'Import backup file', action: () => fileRef.current?.click() }
  ].filter(i => i.label.toLowerCase().includes(paletteQuery.toLowerCase()));
  const paletteVisibleItems = paletteItems.slice(0, 12);
  const paletteHistoryVisible = !paletteQuery.trim() ? paletteHistory : [];
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
    const all = pages.filter(p => !p.deleted);
    const visible = all.filter(p => {
      if (libraryFilter === 'favorites' && !p.favorite) return false;
      if (libraryFilter === 'shared') return false;
      if (libraryFilter === 'private' && p.section === 'other') return false;
      if (libraryFilter === 'ai' && !(p.title.toLowerCase().includes('ai') || p.title.toLowerCase().includes('meeting'))) return false;
      const search = librarySearchQuery.trim().toLowerCase();
      if (!search) return true;
      const sourceTitle = p.parentId ? (pages.find(x => x.id === p.parentId)?.title || 'Subpage') : (p.section === 'other' ? 'Private' : 'My Notes');
      const tagText = (p.tags || []).join(' ');
      const haystack = [p.title, tagText, 'Prasetyo', sourceTitle, formatAgo(p.updatedAt), formatAgo(p.lastOpenedAt || p.updatedAt)].join(' ').toLowerCase();
      if (libraryFieldFilter === 'name') return p.title.toLowerCase().includes(search);
      if (libraryFieldFilter === 'created') return 'prasetyo'.includes(search);
      if (libraryFieldFilter === 'source') return sourceTitle.toLowerCase().includes(search);
      if (libraryFieldFilter === 'edited') return formatAgo(p.updatedAt).toLowerCase().includes(search);
      if (libraryFieldFilter === 'visited') return formatAgo(p.lastOpenedAt || p.updatedAt).toLowerCase().includes(search);
      if (libraryFieldFilter === 'tags') return (p.tags || []).join(' ').toLowerCase().includes(search);
      return haystack.includes(search);
    }).sort((a,b) => (b.lastOpenedAt || b.updatedAt) - (a.lastOpenedAt || a.updatedAt));
    const tab = (key: typeof libraryFilter, label: string, icon: ReactNode) => (
      <button className={libraryFilter === key ? 'active' : ''} onClick={() => setLibraryFilter(key)}>{icon}{label}</button>
    );
    const visibleIds = visible.map(p => p.id);
    const selectedVisible = selectedLibraryIds.filter(id => visibleIds.includes(id));
    const allSelected = visible.length > 0 && selectedVisible.length === visible.length;
    const visibleSet = new Set(visibleIds);
    const childrenByParent = new Map<string | null, Page[]>();
    visible.forEach(p => {
      const parentKey = p.parentId && visibleSet.has(p.parentId) ? p.parentId : null;
      if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
      childrenByParent.get(parentKey)!.push(p);
    });
    const toggleLibraryCollapse = async (id: string) => {
      const p = pages.find(x => x.id === id);
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
          <td><div className="library-name-cell library-tree-name" style={{ paddingLeft: depth * 18, '--library-depth': depth } as React.CSSProperties}>{hasChildren ? <button className="library-twisty" onClick={(e) => { e.stopPropagation(); toggleLibraryCollapse(p.id); }}>{isCollapsed ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}</button> : <span className="library-twisty-spacer"/>}<FileText size={14}/><span>{p.title}</span></div></td>
          <td><div className="library-tags-cell">{(p.tags || []).length ? (p.tags || []).slice(0,3).map(t => <span key={t} className="tag-pill small">{t}</span>) : <span className="muted-cell">—</span>}</div></td>
          <td><div className="library-created-cell"><span className="avatar">P</span><span>Prasetyo</span></div></td>
          <td><div className="library-source-cell">{p.parentId ? <><FileText size={14}/><span>{pages.find(x => x.id === p.parentId)?.title || 'Subpage'}</span></> : p.section === 'other' ? <><Lock size={14}/><span>Private</span></> : <><FileText size={14}/><span>My Notes</span></>}</div></td>
          <td>{formatAgo(p.updatedAt)}</td>
          <td>{formatAgo(p.lastOpenedAt || p.updatedAt)}</td>
          <td className="library-action-cell" onClick={e => e.stopPropagation()}><button title="Move to Trash" onClick={() => deleteSpecificPage(p.id)}><Trash2 size={14}/></button></td>
        </tr>;
        return isCollapsed ? [row] : [row, ...renderLibraryRows(p.id, depth + 1)];
      });
    };
    const libraryRows = renderLibraryRows(null);
    return <section className="library-page">
      <div className="library-head"><h1>Library</h1><button className="primary-button" onClick={() => createPage(null)}>New Page</button></div>
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
        {currentUser.provider === 'google' && <p className="account-settings-note">Google provides your identity. This profile picture is a noteX local display override for this browser.</p>}
        {currentUser.provider === 'local' && <p className="account-settings-note">Local mode stays on this browser. Password change will be added in a later version.</p>}
        <div className="account-settings-actions"><button onClick={() => setAccountSettingsOpen(false)}>Cancel</button><button className="primary-button" onClick={() => void saveAccountSettings()}>Save Changes</button></div>
      </div>
    </div>, document.body);
  }

  function renderQuickNewModal() {
    return null;
  }


  if (!authChecked) return <div className="login-gate"><div className="login-card"><div className="login-brand"><BookOpen size={30}/><span>noteX</span></div><p>Loading noteX...</p></div></div>;
  if (!currentUser) return <LoginGate />;

  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`} style={{ gridTemplateColumns: `${sidebarCollapsed ? 52 : sidebarWidth}px 1fr` }}>
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} onClick={() => { if (sidebarCollapsed) setSidebarCollapsed(false); }}>
      <div className="brand" onClick={() => { if (sidebarCollapsed) setSidebarCollapsed(false); }}><BookOpen size={21}/>{sidebarCollapsed && <strong>noteX</strong>}{!sidebarCollapsed && <><strong>noteX</strong><span>v1.6.117</span><div className="brand-actions"><button className="workspace-avatar brand-profile" title="Workspace" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setWorkspaceMenuPos({ left: r.right + 8, top: r.top }); setWorkspaceMenuOpen(v => !v); }}>{(currentWorkspace?.name || 'P').slice(0,1).toUpperCase()}</button><button className="brand-search" title="Search notes" onClick={() => setPaletteOpen(true)}><Search size={15}/></button></div></>}{workspaceMenuOpen && !sidebarCollapsed && createPortal(<div className="workspace-menu compact-workspace-menu floating-popover" style={workspaceMenuPos ? ({ '--popover-left': `${workspaceMenuPos.left}px`, '--popover-top': `${workspaceMenuPos.top}px` } as React.CSSProperties) : undefined} onClick={e => e.stopPropagation()}><div className="workspace-card-head modern-workspace-head"><span className="workspace-avatar large">{(currentWorkspace?.name || 'P').slice(0,1).toUpperCase()}</span><div><strong>{currentWorkspace?.name || 'Personal'}</strong><p>{currentUser?.email || 'local@notex.app'} · {workspaces.length}/3 workspaces</p></div></div><div className="workspace-menu-section-label">Workspaces</div><div className="workspace-switch-list modern-workspace-list">{workspaces.map(w => <button key={w.id} className={w.id === activeWorkspaceId ? 'active' : ''} onClick={() => switchWorkspace(w.id)}><span className="workspace-dot">{w.name.slice(0,1).toUpperCase()}</span><span>{w.name}</span>{w.id === activeWorkspaceId && <Check size={14}/>}</button>)}</div><div className="workspace-actions-grid"><button onClick={() => currentWorkspace && renameWorkspace(currentWorkspace.id)}><SlidersHorizontal size={15}/> Rename</button><button onClick={() => { setWorkspaceMenuOpen(false); setWorkspaceManagerOpen(true); }}><FolderOpen size={15}/> Manage</button><button disabled={workspaces.length >= 3} title={workspaces.length >= 3 ? 'Maximum 3 workspaces reached' : 'Create a new noteX workspace'} onClick={() => { setWorkspaceMenuOpen(false); setWorkspaceManagerOpen(true); }}><Plus size={15}/> New</button></div><div className="workspace-menu-section-label">Account</div><button onClick={() => { setWorkspaceMenuOpen(false); openAccountSettings(); }}><Users size={15}/> Account Settings</button><button onClick={() => setAuthOpen(true)}><Users size={15}/> Switch Account</button><button className="workspace-signout" onClick={signOutNoteX}><LogOut size={15}/> Sign Out</button></div>, document.body)}</div>
      {!sidebarCollapsed && <button className="new-page" onClick={() => openQuickNew(null)}>Create Note</button>}

      {!sidebarCollapsed && <div className="sections-wrap">
        <Section id="recents" title="Recents" icon={<History size={14}/>} count={recentPages.length}>
          {recentPages.length ? recentPages.map(p => <SidebarPageItem key={p.id} page={p} compact menuKey={`recents-${p.id}`} />) : <p className="empty-side">No Recent Notes</p>}
        </Section>

        <Section id="favorites" title="Favorites" icon={<Star size={14}/>} count={favoritePages.length}>
          {favoritePages.length ? favoritePages.map(p => <SidebarPageItem key={p.id} page={p} compact menuKey={`favorites-${p.id}`} />) : null}
        </Section>

        <Section id="organize" title="Private" icon={<Folder size={14}/>} count={normalPages.length}>
          <div className="page-list tree"><PageTree nodes={tree}/></div>
          {normalPages.length > 20 && <button className="more-pages" onClick={() => setLibraryOpen(true)}><MoreHorizontal size={13}/><span>More</span></button>}
        </Section>

        <Section id="others" title="Others" icon={<LayoutGrid size={14}/>} count={otherPages.length}>
          {otherPages.length ? otherPages.map(p => <SidebarPageItem key={p.id} page={p} compact menuKey={`others-${p.id}`} />) : <p className="empty-side">No Other Pages</p>}
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
          <button className="tab-add" title="New Page" onClick={() => createPage(null)}><Plus size={15}/></button>
        </div>
      </div>
      {!libraryOpen && activePage && <header className="topbar">
        <div className="crumb">{breadcrumbs.length ? breadcrumbs.map((p, i) => {
          const children = pages.filter(child => child.parentId === p.id && !child.deleted).slice(0, 8);
          return <span className={`crumb-item ${children.length ? 'has-children' : ''}`} key={p.id}>
            {i > 0 && <b>/</b>}
            <button className="crumb-link" onClick={() => selectPage(p.id)} title={p.title}>{p.title}</button>
            {children.length > 0 && <div className="crumb-menu">{children.map(child => <button key={child.id} onClick={() => selectPage(child.id)} title={child.title}><FileText size={15}/><span>{child.title}</span><ChevronRight size={14}/></button>)}</div>}
          </span>;
        }) : <span className="crumb-item"><button className="crumb-link">Untitled</button></span>}</div>
        <div className="toolbar compact-topbar">
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
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={e => { handleRestore(e.target.files?.[0]); e.currentTarget.value = ''; }}/>
        </div>
      </header>}

      {libraryOpen ? <LibraryPage /> : activePage ? <section className={`page editor-font-${fontMode}`}>
        <div className="page-kicker"><FileText size={15}/>{activePage.favorite ? 'Favorite note' : 'Local note'}</div>
        <div
          key={activePage.id}
          ref={pageTitleRef}
          className="page-title"
          contentEditable
          suppressContentEditableWarning
          data-placeholder="New Page"
          onFocus={e => {
            const el = e.currentTarget;
            if ((el.textContent || '').trim() === 'New Page') {
              el.textContent = '';
              updateTitle('', false);
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const text = (e.currentTarget.textContent || '').trim() || 'New Page';
              updateTitle(text);
              requestAnimationFrame(() => {
                const firstBlock = document.querySelector('.editor [contenteditable="true"], .editor textarea') as HTMLElement | null;
                firstBlock?.focus();
              });
            }
          }}
          onInput={e => { updateTitle(e.currentTarget.textContent || '', false); }}
          onBlur={e => {
            const text = (e.currentTarget.textContent || '').trim();
            if (!text) { e.currentTarget.textContent = 'New Page'; updateTitle('New Page'); }
            else updateTitle(text);
          }}
        >{activePage.title === 'New Page' ? 'New Page' : activePage.title}</div>
        {pageMetaText && <div className="page-meta-line">{pageMetaText}</div>}
        <div className="page-tags"><div className="page-tags-left"><Tag size={13}/>{(activePage.tags || []).map(t => <button key={t} className="tag-pill" onClick={() => removeTagFromActivePage(t)} title="Remove tag">{t}<X size={11}/></button>)}<label className="tag-input"><input placeholder="Add Tag..." value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); if (tagInput.trim()) addTagToActivePage(); requestAnimationFrame(() => { const firstBlock = document.querySelector('.editor [contenteditable="true"], .editor textarea') as HTMLElement | null; firstBlock?.focus(); }); return; } if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTagToActivePage(); } }} onBlur={() => { if (tagInput.trim()) addTagToActivePage(); }}/></label></div><div className="page-tags-right"><div className="page-export-actions compact"><button className="export-copy" title="Copy all editor content" onClick={copyActivePageContent}><Copy size={12}/><span>Copy</span></button><div className="export-more-wrap"><button className="export-more" title="More export options" onClick={(e) => { e.stopPropagation(); setExportMenuOpen(v => !v); }}><MoreHorizontal size={14}/><span>More</span></button>{exportMenuOpen && <div className="export-more-menu floating-popover" onClick={e => e.stopPropagation()}><button className="export-pdf" onClick={() => { setExportMenuOpen(false); exportActivePagePdf(); }}><Printer size={13}/><span>Export PDF</span></button><button className="export-docx" onClick={() => { setExportMenuOpen(false); exportActivePageDocx(); }}><FileDown size={13}/><span>Export DOCX</span></button><button className="export-email" onClick={() => { setExportMenuOpen(false); exportActivePageEml(); }}><Mail size={13}/><span>Export Email (.eml)</span></button></div>}</div></div></div></div>
        <BlockEditor pageId={activePage.id} onChanged={load} onCreatePage={() => createPage(activePage.id)}/>
        {activePage.title.toLowerCase().includes('database') && <DatabaseViews />}
        <div className="page-footer-row">
          {!activePage.title.toLowerCase().includes('database') && <div className="credits">noteX | copyright © 2026 by nixnux</div>}
          <section className="snapshots compact-snapshots"><h3><History size={16}/> Snapshot</h3>{latestSnapshot ? <button onClick={() => restoreSnap(latestSnapshot.id)}><span>Latest:</span><em>{formatSnapshotLabel(latestSnapshot.label)} · {new Date(latestSnapshot.createdAt).toLocaleString()}</em></button> : <span className="snapshot-inline">No snapshots yet</span>}{snapshots.length > 1 && <button className="snapshot-more-button" title="Show snapshot history" onClick={() => setSnapshotHistoryOpen(true)}><MoreHorizontal size={14}/></button>}</section>
        </div>
      </section> : <section className="empty"><button className="primary-button create-first-page" onClick={() => openQuickNew(null)}>Create First Page</button></section>}
    </main>

    {trashOpen && <TrashModal />}

    {snapshotHistoryOpen && createPortal(<div className="modal-backdrop snapshot-history-backdrop" onMouseDown={() => setSnapshotHistoryOpen(false)}>
      <div className="snapshot-history-modal" onMouseDown={e => e.stopPropagation()}>
        <button className="modal-close icon-only" title="Close" onClick={() => setSnapshotHistoryOpen(false)}><X size={16}/></button>
        <div className="snapshot-history-hero"><span className="snapshot-history-icon"><History size={18}/></span><div><h2>Snapshot History</h2><p>Restore a previous local snapshot for this browser.</p></div></div>
        <div className="snapshot-history-list">
          {snapshots.map((s, index) => <button key={s.id} onClick={() => { setSnapshotHistoryOpen(false); restoreSnap(s.id); }}><span className="snapshot-history-row-icon"><History size={14}/></span><span className="snapshot-history-name">{index === 0 ? 'Latest' : formatSnapshotLabel(s.label)}</span><em>{new Date(s.createdAt).toLocaleString()}</em></button>)}
        </div>
      </div>
    </div>, document.body)}
    <MoveModal />
    {renderWorkspaceManagerModal()}
    {renderAccountSettingsModal()}
    <AuthModal />
    {LocalAuthModal()}
    <BackupModal />
    <TabContextMenu />
    {paletteOpen && <div className="palette-backdrop" onClick={() => setPaletteOpen(false)}><div className="palette" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteActiveIndex(i => Math.min(Math.max(paletteTotalRows - 1, 0), i + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteActiveIndex(i => Math.max(0, i - 1)); } if (e.key === 'Enter') { e.preventDefault(); runPaletteRow(paletteActiveIndex); } if (e.key === 'Escape') setPaletteOpen(false); }}><label><Command size={17}/><input autoFocus placeholder="Search or ask a question in noteX..." value={paletteQuery} onChange={e => setPaletteQuery(e.target.value)} /></label>{!paletteQuery.trim() && paletteHistory.length > 0 && <div className="palette-history"><div className="palette-history-head"><label className="palette-select-all"><input type="checkbox" checked={selectedPaletteHistory.length === paletteHistory.length && paletteHistory.length > 0} onChange={e => setSelectedPaletteHistory(e.target.checked ? paletteHistory : [])}/><span>Recent searches</span></label><div><button disabled={!selectedPaletteHistory.length} onClick={deleteSelectedPaletteHistory}>Delete selected</button><button onClick={clearPaletteHistory}>Clear all</button></div></div>{paletteHistory.map((item, i) => <div className={`palette-history-row ${paletteActiveIndex === i ? 'active' : ''}`} key={item}><input className="palette-history-check" type="checkbox" checked={selectedPaletteHistory.includes(item)} onChange={e => togglePaletteHistoryItem(item, e.target.checked)} onClick={e => e.stopPropagation()} /><button onMouseEnter={() => setPaletteActiveIndex(i)} onClick={() => setPaletteQuery(item)}><History size={13}/><span>{item}</span></button><button title="Remove from history" onClick={() => removePaletteHistoryItem(item)}><X size={12}/></button></div>)}</div>}<div>{paletteVisibleItems.map((item, i) => { const rowIndex = paletteHistoryVisible.length + i; return <button className={paletteActiveIndex === rowIndex ? 'active' : ''} key={i} onMouseEnter={() => setPaletteActiveIndex(rowIndex)} onClick={() => { savePaletteHistoryItem(paletteQuery || item.label); item.action(); setPaletteOpen(false); }}><strong>{item.label}</strong><span>{item.hint}</span></button>; })}</div></div></div>}
    {simpleModal && <div className="simple-modal-backdrop" onClick={() => setSimpleModal(null)}><div className="simple-modal" onClick={e => e.stopPropagation()}><h3>{simpleModal.title}</h3><p>{simpleModal.message}</p>{simpleModal.inputValue !== undefined && <input className="simple-modal-input" autoFocus value={simpleModal.inputValue} placeholder={simpleModal.inputPlaceholder || ''} onChange={e => setSimpleModal({ ...simpleModal, inputValue: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { const value = simpleModal.inputValue || ''; const fn = simpleModal.onInputConfirm; setSimpleModal(null); fn?.(value); } }} /> }<div>{simpleModal.onConfirm && <button className="primary-button" onClick={() => { const fn = simpleModal.onConfirm; setSimpleModal(null); fn?.(); }}>{simpleModal.confirmText || 'Confirm'}</button>}{simpleModal.onInputConfirm && <button className="primary-button" onClick={() => { const value = simpleModal.inputValue || ''; const fn = simpleModal.onInputConfirm; setSimpleModal(null); fn?.(value); }}>{simpleModal.confirmText || 'Done'}</button>}{!simpleModal.onConfirm && !simpleModal.onInputConfirm && <button className="primary-button" onClick={() => setSimpleModal(null)}>{simpleModal.confirmText || 'Done'}</button>}</div></div></div>}
  </div>;
}
