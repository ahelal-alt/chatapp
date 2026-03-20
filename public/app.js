const appRoot = document.getElementById('app');
const SESSION_KEY = 'pulsechat-session';
const THEME_KEY = 'pulsechat-theme';
const APP_DB_NAME = 'pulsechat-app-db';
const APP_DB_VERSION = 1;
const TAB_ID = window.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const REALTIME_CHANNEL_NAME = 'pulsechat-realtime';
const REALTIME_LEADER_LOCK_KEY = 'pulsechat-realtime-leader';
const REALTIME_SIGNAL_KEY = 'pulsechat-realtime-signal';
const OUTBOX_OWNER_KEY = 'pulsechat-outbox-owner';
const LEADER_HEARTBEAT_MS = 3000;
const LEADER_STALE_MS = 10000;
const OUTBOX_STALE_MS = 12000;
const REALTIME_EVENT_TTL_MS = 4000;

const demoWorkspace = createDemoWorkspace();

const state = {
  screen: 'auth',
  authView: 'login',
  activeSection: 'chats',
  chatListFilter: 'all',
  workspaceQuery: '',
  requestTab: 'incoming',
  selectedChatId: demoWorkspace.chats[0]?.id || null,
  selectedContactId: demoWorkspace.contacts[0]?.id || null,
  selectedGroupId: demoWorkspace.groups[0]?.id || null,
  token: null,
  refreshToken: null,
  dataSource: 'demo',
  isLoading: true,
  isSubmitting: false,
  user: null,
  privacy: null,
  chats: [],
  messagesByChat: {},
  contacts: [],
  requests: { incoming: [], outgoing: [] },
  groups: [],
  notifications: [],
  unreadNotificationCount: 0,
  filesHub: {
    items: [],
    isLoading: false,
    error: '',
    filters: {
      kind: 'all',
      chatId: '',
      senderId: '',
      q: '',
      from: '',
    },
  },
  admin: {
    summary: null,
  },
  e2ee: {
    supported: Boolean(window.crypto?.subtle),
    ready: false,
    privateKey: null,
    publicKey: '',
    keyVersion: 0,
    partnerKeys: {},
  },
  typingByChat: {},
  toasts: [],
  socket: null,
  connectedChatId: null,
  theme: 'light',
  liveConnectionState: 'idle',
  offline: {
    isOnline: window.navigator?.onLine ?? true,
    isSyncing: false,
    usingCachedWorkspace: false,
    pendingCount: 0,
  },
  replyDraft: null,
  voiceDraft: null,
  voiceRecorder: createInitialVoiceRecorderState(),
  detailRailOpen: false,
  mobileChatListVisible: true,
  coordination: {
    tabId: TAB_ID,
    isLeader: false,
    leaderId: '',
    hasBroadcastChannel: Boolean(window.BroadcastChannel),
  },
  modal: null,
};

appRoot.addEventListener('click', handleClick);
appRoot.addEventListener('submit', handleSubmit);
appRoot.addEventListener('input', handleInput);

window.addEventListener('online', handleConnectivityChange);
window.addEventListener('offline', handleConnectivityChange);
window.addEventListener('resize', handleViewportChange);
window.addEventListener('pagehide', () => {
  teardownVoiceLifecycle({ preserveQueuedDraft: true, silent: true });
  revokeAllTrackedObjectUrls();
});

let appDbPromise = null;
const trackedObjectUrls = new Set();
const processedRealtimeEvents = new Map();
let coordinationChannel = null;
let leadershipHeartbeatTimer = null;
let typingEmitAt = 0;
let realtimeSignalSequence = 0;
let joinedSocketRooms = new Set();

init();

function getAppDb() {
  if (!window.indexedDB || typeof window.indexedDB.open !== 'function') {
    return Promise.resolve(null);
  }

  if (!appDbPromise) {
    appDbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(APP_DB_NAME, APP_DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv', { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return appDbPromise;
}

async function dbPut(storeName, value) {
  const db = await getAppDb();
  if (!db) {
    return;
  }

  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGet(storeName, key) {
  const db = await getAppDb();
  if (!db) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function dbGetAll(storeName) {
  const db = await getAppDb();
  if (!db) {
    return [];
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function dbDelete(storeName, key) {
  const db = await getAppDb();
  if (!db) {
    return;
  }

  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function nowMs() {
  return Date.now();
}

function readStorageJson(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || 'null');
  } catch (error) {
    return null;
  }
}

function writeStorageJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Ignore storage quota and private-mode failures for coordination state.
  }
}

function removeStorageKey(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    // Ignore storage failures for coordination cleanup.
  }
}

function isFreshLock(lock, ttlMs) {
  return Boolean(lock?.tabId && (nowMs() - Number(lock.updatedAt || 0)) < ttlMs);
}

function readLeaderLock() {
  return readStorageJson(REALTIME_LEADER_LOCK_KEY);
}

function readOutboxOwner() {
  return readStorageJson(OUTBOX_OWNER_KEY);
}

function isRealtimeLeader() {
  return state.coordination.isLeader;
}

function canHoldRealtimeLeadership() {
  return Boolean(state.token && state.dataSource === 'api');
}

function pruneRealtimeEvents() {
  const currentTime = nowMs();
  for (const [key, expiresAt] of processedRealtimeEvents.entries()) {
    if (expiresAt <= currentTime) {
      processedRealtimeEvents.delete(key);
    }
  }
}

function rememberRealtimeEvent(key, ttlMs = REALTIME_EVENT_TTL_MS) {
  pruneRealtimeEvents();
  const currentTime = nowMs();
  const expiresAt = processedRealtimeEvents.get(key) || 0;
  if (expiresAt > currentTime) {
    return false;
  }

  processedRealtimeEvents.set(key, currentTime + ttlMs);
  return true;
}

function serializeReactionSignature(reactions = []) {
  return normalizeReactions(reactions)
    .map((item) => `${item.userId}:${item.emoji}`)
    .sort()
    .join('|');
}

function getRealtimeEventKey(kind, payload = {}) {
  switch (kind) {
    case 'presence:update':
      return `${kind}:${payload.userId}:${payload.isOnline}:${payload.lastSeen || ''}`;
    case 'chat:updated':
      return `${kind}:${payload.chatId}:${payload.lastMessageAt || ''}:${payload.unreadCount ?? ''}:${payload.lastMessagePreview || ''}`;
    case 'message:new':
      return `${kind}:${payload._id || payload.id || ''}:${payload.clientMessageId || ''}`;
    case 'message:updated':
      return `${kind}:${payload._id || payload.id || ''}:${payload.editedAt || payload.updatedAt || payload.createdAt || ''}`;
    case 'message:deleted':
      return `${kind}:${payload.chatId}:${payload.messageId}`;
    case 'message:seen':
      return `${kind}:${payload.chatId}:${payload.messageId}`;
    case 'message:reactions':
      return `${kind}:${payload.chatId}:${payload.messageId}:${serializeReactionSignature(payload.reactions || [])}`;
    case 'message:typing':
      return `${kind}:${payload.chatId}:${payload.fullName || ''}`;
    case 'message:stop-typing':
      return `${kind}:${payload.chatId}`;
    case 'notification:new':
      return `${kind}:${payload._id || payload.id || ''}`;
    case 'notification:read':
      return `${kind}:${payload.all ? 'all' : payload.notificationId || ''}`;
    case 'notification:count':
      return `${kind}:${payload.unreadCount ?? ''}`;
    default:
      return `${kind}:${JSON.stringify(payload)}`;
  }
}

function shouldProcessRealtimeEvent(kind, payload) {
  const ttl = kind === 'message:seen' || kind === 'message:typing' || kind === 'message:stop-typing'
    ? 1200
    : REALTIME_EVENT_TTL_MS;
  return rememberRealtimeEvent(getRealtimeEventKey(kind, payload), ttl);
}

function buildRealtimeSignal(type, payload = {}) {
  return {
    id: `${TAB_ID}:${++realtimeSignalSequence}:${nowMs()}`,
    tabId: TAB_ID,
    type,
    payload,
    ts: nowMs(),
  };
}

function postRealtimeSignal(type, payload = {}) {
  const message = buildRealtimeSignal(type, payload);
  if (coordinationChannel) {
    coordinationChannel.postMessage(message);
    return;
  }

  writeStorageJson(REALTIME_SIGNAL_KEY, message);
  removeStorageKey(REALTIME_SIGNAL_KEY);
}

function updateLeaderState(tabId, isLeader) {
  const nextLeaderId = tabId || '';
  const nextLiveState = isLeader
    ? state.liveConnectionState
    : (state.dataSource === 'api' && state.token ? 'standby' : 'idle');
  const changed = state.coordination.isLeader !== isLeader
    || state.coordination.leaderId !== nextLeaderId
    || state.liveConnectionState !== nextLiveState;

  state.coordination.isLeader = isLeader;
  state.coordination.leaderId = nextLeaderId;
  state.liveConnectionState = nextLiveState;
  return changed;
}

async function refreshPendingOutboxCount() {
  state.offline.pendingCount = (await dbGetAll('outbox')).length;
}

function releaseOutboxOwnership() {
  const lock = readOutboxOwner();
  if (lock?.tabId === TAB_ID) {
    removeStorageKey(OUTBOX_OWNER_KEY);
  }
}

function acquireOutboxOwnership() {
  if (!isRealtimeLeader()) {
    return false;
  }

  const current = readOutboxOwner();
  if (isFreshLock(current, OUTBOX_STALE_MS) && current.tabId !== TAB_ID) {
    return false;
  }

  const next = {
    tabId: TAB_ID,
    updatedAt: nowMs(),
  };
  writeStorageJson(OUTBOX_OWNER_KEY, next);
  return readOutboxOwner()?.tabId === TAB_ID;
}

function renewOutboxOwnership() {
  const current = readOutboxOwner();
  if (current?.tabId !== TAB_ID) {
    return false;
  }

  writeStorageJson(OUTBOX_OWNER_KEY, {
    tabId: TAB_ID,
    updatedAt: nowMs(),
  });
  return true;
}

async function reconcileRealtimeState({ refreshActiveChat = true } = {}) {
  if (state.dataSource !== 'api' || !state.token) {
    return;
  }

  const [chatsRes, notificationsRes] = await Promise.allSettled([
    apiFetch('/api/v1/chats?limit=20'),
    apiFetch('/api/v1/notifications?limit=20'),
  ]);

  if (chatsRes.status === 'fulfilled') {
    const selectedChatId = state.selectedChatId;
    state.chats = (chatsRes.value.data || []).map((item) => normalizeChat(item, state.user));
    applyGroupDetailsToChats();
    state.selectedChatId = state.chats.some((item) => item.id === selectedChatId)
      ? selectedChatId
      : state.chats[0]?.id || null;
  }

  if (notificationsRes.status === 'fulfilled') {
    state.notifications = (notificationsRes.value.data || []).map(normalizeNotification);
    state.unreadNotificationCount = state.notifications.filter((item) => !item.isRead).length;
  }

  if (refreshActiveChat && state.selectedChatId) {
    await loadChatMessages(state.selectedChatId);
  }

  render();
}

function emitSocketCommand(kind, payload = {}) {
  if (isRealtimeLeader() && state.socket?.connected) {
    state.socket.emit(kind, payload);
    return;
  }

  postRealtimeSignal('emit-socket', { kind, payload });
}

function broadcastSocketEvent(kind, payload) {
  if (!isRealtimeLeader()) {
    return;
  }

  postRealtimeSignal('socket-event', { kind, payload });
}

function syncSocketChatRooms() {
  if (!isRealtimeLeader() || !state.socket?.connected) {
    return;
  }

  const desiredRooms = new Set(state.chats.map((chat) => String(chat.id)));
  for (const chatId of desiredRooms) {
    if (!joinedSocketRooms.has(chatId)) {
      state.socket.emit('chat:join', { chatId });
      joinedSocketRooms.add(chatId);
    }
  }

  for (const chatId of [...joinedSocketRooms]) {
    if (!desiredRooms.has(chatId)) {
      state.socket.emit('chat:leave', { chatId });
      joinedSocketRooms.delete(chatId);
    }
  }

  state.connectedChatId = state.selectedChatId || null;
}

async function applyRealtimeEvent(kind, payload, { broadcast = false } = {}) {
  if (!shouldProcessRealtimeEvent(kind, payload)) {
    return;
  }

  switch (kind) {
    case 'presence:update': {
      state.contacts = state.contacts.map((contact) => (
        String(contact.id) === String(payload.userId)
          ? { ...contact, isOnline: payload.isOnline, lastSeen: payload.lastSeen ?? null }
          : contact
      ));
      break;
    }
    case 'chat:updated': {
      const chat = state.chats.find((item) => item.id === String(payload.chatId));
      if (!chat) {
        break;
      }
      if (payload.lastMessagePreview !== undefined) {
        chat.lastMessagePreview = payload.lastMessagePreview;
      }
      if (payload.lastMessageAt !== undefined) {
        chat.lastMessageAt = payload.lastMessageAt;
      }
      if (Number.isFinite(Number(payload.unreadCount))) {
        chat.unreadCount = Number(payload.unreadCount);
      }
      state.chats.sort((left, right) => new Date(right.lastMessageAt) - new Date(left.lastMessageAt));
      break;
    }
    case 'message:new': {
      const message = normalizeMessage(payload);
      const chatId = message.chatId;
      const current = state.messagesByChat[chatId] || [];
      const existingIndex = current.findIndex((item) => (
        item.id === message.id
          || (message.clientMessageId && item.clientMessageId && item.clientMessageId === message.clientMessageId)
      ));
      if (existingIndex >= 0) {
        current[existingIndex] = { ...current[existingIndex], ...message, deliveryState: 'sent' };
        state.messagesByChat[chatId] = [...current];
      } else {
        state.messagesByChat[chatId] = [...current, message];
      }
      syncFilesHubFromMessage(message);
      const chat = state.chats.find((item) => item.id === chatId);
      if (chat) {
        chat.lastMessagePreview = getMessagePreviewText(message);
        chat.lastMessageAt = message.createdAt;
        if (!message.mine && state.selectedChatId !== chatId) {
          chat.unreadCount = Number(chat.unreadCount || 0) + 1;
        }
      }

      if (isRealtimeLeader() && !message.mine) {
        emitSocketCommand('message:delivered', { messageId: message.id });
        if (state.selectedChatId === chatId) {
          emitSocketCommand('message:seen', { messageId: message.id });
        }
      }

      await persistChatMessagesCache(chatId);
      if (message.isEncrypted) {
        resolveMessageForDisplay(message).then((decryptedMessage) => {
          upsertMessageForChat(chatId, decryptedMessage);
          recalculateChatFromMessages(chatId);
          persistChatMessagesCache(chatId);
          render();
        });
      }
      break;
    }
    case 'message:updated': {
      const message = normalizeMessage(payload);
      state.messagesByChat[message.chatId] = (state.messagesByChat[message.chatId] || []).map((item) => (
        item.id === message.id ? { ...item, ...message } : item
      ));
      syncFilesHubFromMessage(message);
      await persistChatMessagesCache(message.chatId);
      if (message.isEncrypted) {
        resolveMessageForDisplay(message).then((decryptedMessage) => {
          upsertMessageForChat(message.chatId, decryptedMessage);
          recalculateChatFromMessages(message.chatId);
          persistChatMessagesCache(message.chatId);
          render();
        });
      }
      break;
    }
    case 'message:deleted': {
      state.messagesByChat[payload.chatId] = (state.messagesByChat[payload.chatId] || []).filter((item) => item.id !== String(payload.messageId));
      state.filesHub.items = state.filesHub.items.filter((item) => item.messageId !== String(payload.messageId));
      recalculateChatFromMessages(payload.chatId);
      await persistChatMessagesCache(payload.chatId);
      break;
    }
    case 'message:seen': {
      state.messagesByChat[payload.chatId] = (state.messagesByChat[payload.chatId] || []).map((item) => (
        item.id === String(payload.messageId)
          ? { ...item, seenCount: Number(item.seenCount || 0) + 1 }
          : item
      ));
      break;
    }
    case 'message:reactions': {
      state.messagesByChat[payload.chatId] = (state.messagesByChat[payload.chatId] || []).map((item) => (
        item.id === String(payload.messageId)
          ? { ...item, reactions: normalizeReactions(payload.reactions) }
          : item
      ));
      await persistChatMessagesCache(payload.chatId);
      break;
    }
    case 'message:typing': {
      state.typingByChat[payload.chatId] = `${payload.fullName || 'Someone'} is typing...`;
      break;
    }
    case 'message:stop-typing': {
      delete state.typingByChat[payload.chatId];
      break;
    }
    case 'notification:new': {
      const notification = normalizeNotification(payload);
      const existed = state.notifications.some((item) => item.id === notification.id);
      state.notifications = [notification, ...state.notifications.filter((item) => item.id !== notification.id)];
      if (!existed && !notification.isRead) {
        state.unreadNotificationCount += 1;
      }
      break;
    }
    case 'notification:read': {
      if (payload.all) {
        state.notifications = state.notifications.map((item) => ({ ...item, isRead: true }));
      } else {
        state.notifications = state.notifications.map((item) => (
          item.id === String(payload.notificationId) ? { ...item, isRead: true } : item
        ));
      }
      state.unreadNotificationCount = state.notifications.filter((item) => !item.isRead).length;
      break;
    }
    case 'notification:count': {
      if (payload.unreadCount > state.unreadNotificationCount) {
        pushToast('New activity', 'Your live notifications have been updated.', 'info');
      }
      state.unreadNotificationCount = payload.unreadCount;
      break;
    }
    default:
      return;
  }

  if (broadcast) {
    broadcastSocketEvent(kind, payload);
  }

  render();
}

function setRealtimeFollower(leaderId = '') {
  const wasLeader = state.coordination.isLeader;
  if (wasLeader) {
    disconnectSocket();
    releaseOutboxOwnership();
  }
  const changed = updateLeaderState(leaderId, false);
  if (changed) {
    render();
  }
}

async function promoteRealtimeLeader() {
  if (!canHoldRealtimeLeadership()) {
    setRealtimeFollower('');
    return;
  }

  const nextLock = {
    tabId: TAB_ID,
    updatedAt: nowMs(),
  };
  writeStorageJson(REALTIME_LEADER_LOCK_KEY, nextLock);
  if (readLeaderLock()?.tabId !== TAB_ID) {
    setRealtimeFollower(readLeaderLock()?.tabId || '');
    return;
  }

  updateLeaderState(TAB_ID, true);
  postRealtimeSignal('leader-heartbeat', { tabId: TAB_ID, updatedAt: nextLock.updatedAt });
  connectLiveSocket();
  if (state.screen === 'workspace' && !state.isLoading) {
    reconcileRealtimeState({ refreshActiveChat: true }).catch(() => null);
  }
  render();
}

async function refreshLeadership() {
  if (!canHoldRealtimeLeadership()) {
    if (isRealtimeLeader()) {
      releaseLeadership();
    }
    setRealtimeFollower('');
    return;
  }

  const current = readLeaderLock();
  if (isRealtimeLeader()) {
    writeStorageJson(REALTIME_LEADER_LOCK_KEY, {
      tabId: TAB_ID,
      updatedAt: nowMs(),
    });
    postRealtimeSignal('leader-heartbeat', { tabId: TAB_ID, updatedAt: nowMs() });
    return;
  }

  if (!isFreshLock(current, LEADER_STALE_MS) || current.tabId === TAB_ID) {
    await promoteRealtimeLeader();
    return;
  }

  updateLeaderState(current.tabId, false);
}

function releaseLeadership() {
  const current = readLeaderLock();
  if (current?.tabId === TAB_ID) {
    removeStorageKey(REALTIME_LEADER_LOCK_KEY);
    postRealtimeSignal('leader-release', { tabId: TAB_ID });
  }
  releaseOutboxOwnership();
}

function handleCoordinationMessage(message) {
  if (!message || message.tabId === TAB_ID) {
    return;
  }

  if (message.type === 'leader-heartbeat') {
    if (!isRealtimeLeader()) {
      const changed = updateLeaderState(message.payload?.tabId || message.tabId, false);
      if (changed) {
        render();
      }
    }
    return;
  }

  if (message.type === 'leader-release') {
    if (!isRealtimeLeader() && state.coordination.leaderId === (message.payload?.tabId || message.tabId)) {
      const changed = updateLeaderState('', false);
      window.setTimeout(() => {
        refreshLeadership().catch(() => null);
      }, 50);
      if (changed) {
        render();
      }
    }
    return;
  }

  if (message.type === 'emit-socket' && isRealtimeLeader() && state.socket?.connected) {
    state.socket.emit(message.payload?.kind, message.payload?.payload || {});
    return;
  }

  if (message.type === 'socket-event') {
    applyRealtimeEvent(message.payload?.kind, message.payload?.payload || {}, { broadcast: false }).catch(() => null);
    return;
  }

  if (message.type === 'outbox-changed') {
    refreshPendingOutboxCount().then(() => {
      if (isRealtimeLeader() && state.offline.isOnline) {
        flushPendingOutbox();
      } else if (state.offline.pendingCount !== Number(message.payload?.pendingCount ?? state.offline.pendingCount)) {
        state.offline.pendingCount = Number(message.payload?.pendingCount ?? state.offline.pendingCount);
        render();
      }
    }).catch(() => null);
  }
}

function handleStorageEvent(event) {
  if (event.key === REALTIME_SIGNAL_KEY && event.newValue) {
    handleCoordinationMessage(readStorageJson(REALTIME_SIGNAL_KEY));
    return;
  }

  if (event.key === REALTIME_LEADER_LOCK_KEY) {
    const current = readLeaderLock();
    if (current?.tabId && current.tabId !== TAB_ID) {
      setRealtimeFollower(current.tabId);
    } else if (!current && !isRealtimeLeader()) {
      window.setTimeout(() => {
        refreshLeadership().catch(() => null);
      }, 50);
    }
    return;
  }

  if (event.key === SESSION_KEY) {
    const session = readSession();
    state.token = session?.token || null;
    state.refreshToken = session?.refreshToken || null;
    if (!state.token) {
      disconnectSocket();
      setRealtimeFollower('');
    } else if (isRealtimeLeader()) {
      connectLiveSocket();
    }
    render();
    return;
  }

  if (event.key === THEME_KEY) {
    state.theme = readTheme();
    applyTheme();
    render();
  }
}

function initTabCoordination() {
  if (typeof window.BroadcastChannel === 'function') {
    coordinationChannel = new window.BroadcastChannel(REALTIME_CHANNEL_NAME);
    coordinationChannel.onmessage = (event) => {
      handleCoordinationMessage(event.data);
    };
  }

  window.addEventListener('storage', handleStorageEvent);
  window.addEventListener('beforeunload', releaseLeadership);
  window.addEventListener('pagehide', releaseLeadership);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshLeadership().catch(() => null);
    }
  });

  leadershipHeartbeatTimer = window.setInterval(() => {
    refreshLeadership().catch(() => null);
  }, LEADER_HEARTBEAT_MS);
  refreshLeadership().catch(() => null);
}

function createInitialVoiceRecorderState() {
  return {
    status: supportsVoiceRecording() ? 'idle' : 'unsupported',
    durationMs: 0,
    error: '',
    recorder: null,
    stream: null,
    startedAt: 0,
    sessionId: '',
    shouldCreateDraft: false,
  };
}

function getActiveVoiceState() {
  return state.voiceDraft?.status || state.voiceRecorder.status || 'idle';
}

function createTrackedObjectUrl(blob) {
  if (typeof URL.createObjectURL !== 'function') {
    return '';
  }

  const url = URL.createObjectURL(blob);
  trackedObjectUrls.add(url);
  return url;
}

function revokeTrackedObjectUrl(url) {
  if (!url || !trackedObjectUrls.has(url) || typeof URL.revokeObjectURL !== 'function') {
    return;
  }

  URL.revokeObjectURL(url);
  trackedObjectUrls.delete(url);
}

function revokeAllTrackedObjectUrls() {
  for (const url of [...trackedObjectUrls]) {
    revokeTrackedObjectUrl(url);
  }
}

function setVoiceRecorderStatus(status, extras = {}) {
  state.voiceRecorder = {
    ...state.voiceRecorder,
    ...extras,
    status,
  };
}

function describeVoiceSupportIssue(error) {
  if (!supportsVoiceRecording()) {
    return 'Voice recording is not supported in this browser.';
  }

  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Microphone access was denied. Allow microphone permission to record a voice note.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found on this device.';
    case 'AbortError':
      return 'Recording was interrupted before it could start.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The microphone is busy or unavailable right now.';
    default:
      return error?.message || 'The microphone could not be accessed.';
  }
}

function clearVoiceDurationTimer() {
  if (voiceDurationTimer) {
    window.clearInterval(voiceDurationTimer);
    voiceDurationTimer = null;
  }
}

function stopVoiceStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function cleanupVoiceRecorderResources() {
  clearVoiceDurationTimer();
  stopVoiceStream(state.voiceRecorder?.stream);
}

function bufferToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function base64ToBytes(value) {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function requiresPrivateEncryption(chat) {
  return Boolean(
    chat
      && chat.type === 'private'
      && (chat.e2eeCapable || chat.partnerPublicKey),
  );
}

function getUndecryptableMessageLabel(message) {
  if (message?.type === 'voice' || message?.type === 'audio') {
    return 'Encrypted voice message';
  }
  if (message?.type && message.type !== 'text') {
    return `Encrypted ${message.type} message`;
  }

  return 'Encrypted message';
}

function getMessagePreviewText(message) {
  if (!message) {
    return 'No messages yet';
  }

  if (message.isEncrypted) {
    return message.decryptedText || getUndecryptableMessageLabel(message);
  }

  return message.text || message.fileName || capitalize(message.type || 'message');
}

async function exportPublicKeyString(key) {
  const jwk = await window.crypto.subtle.exportKey('jwk', key);
  return JSON.stringify(jwk);
}

async function importPublicKeyString(value) {
  const jwk = typeof value === 'string' ? JSON.parse(value) : value;
  return window.crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    true,
    ['encrypt'],
  );
}

async function importPrivateKeyString(value) {
  const jwk = typeof value === 'string' ? JSON.parse(value) : value;
  return window.crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    true,
    ['decrypt'],
  );
}

async function ensureE2EESetup() {
  if (state.dataSource !== 'api' || !state.token || !state.e2ee.supported || !state.user?.id) {
    return;
  }

  const storedKey = await dbGet('kv', `e2ee-private:${state.user.id}`);
  if (storedKey?.value?.privateKey && state.user.encryptionEnabled) {
    state.e2ee.privateKey = await importPrivateKeyString(storedKey.value.privateKey);
    state.e2ee.publicKey = storedKey.value.publicKey || state.user.encryptionPublicKey || '';
    state.e2ee.keyVersion = storedKey.value.keyVersion || state.user.encryptionKeyVersion || 1;
    state.e2ee.ready = true;
    return;
  }

  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  );
  const publicKey = await exportPublicKeyString(keyPair.publicKey);
  const privateKey = JSON.stringify(await window.crypto.subtle.exportKey('jwk', keyPair.privateKey));

  await apiFetch('/api/v1/users/me/encryption-key', {
    method: 'PUT',
    headers: {},
    body: JSON.stringify({
      publicKey,
      keyVersion: 1,
    }),
  });

  await dbPut('kv', {
    key: `e2ee-private:${state.user.id}`,
    value: {
      publicKey,
      privateKey,
      keyVersion: 1,
    },
  });

  state.user.encryptionEnabled = true;
  state.user.encryptionPublicKey = publicKey;
  state.user.encryptionKeyVersion = 1;
  state.e2ee.privateKey = keyPair.privateKey;
  state.e2ee.publicKey = publicKey;
  state.e2ee.keyVersion = 1;
  state.e2ee.ready = true;
}

async function fetchPartnerEncryptionKey(userId) {
  if (!userId) {
    return null;
  }

  if (state.e2ee.partnerKeys[userId]) {
    return state.e2ee.partnerKeys[userId];
  }

  const response = await apiFetch(`/api/v1/users/${userId}/encryption-key`);
  if (!response.data?.publicKey) {
    return null;
  }

  const key = {
    publicKey: response.data.publicKey,
    keyVersion: response.data.keyVersion || 1,
  };
  state.e2ee.partnerKeys[userId] = key;
  return key;
}

async function encryptPrivateMessage(chat, text) {
  if (!requiresPrivateEncryption(chat)) {
    return null;
  }

  if (!state.e2ee.ready || !chat?.partnerId || !state.e2ee.publicKey) {
    throw new Error('Secure messaging is not ready on this device yet. Refresh your session or sign in again.');
  }

  const partnerKeyInfo = await fetchPartnerEncryptionKey(chat.partnerId);
  if (!partnerKeyInfo?.publicKey) {
    throw new Error('This private conversation is encrypted, but the recipient key is unavailable right now.');
  }

  const recipientKey = await importPublicKeyString(partnerKeyInfo.publicKey);
  const selfPublicKey = await importPublicKeyString(state.e2ee.publicKey);
  const symmetricKey = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  const rawKey = await window.crypto.subtle.exportKey('raw', symmetricKey);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(text);
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    symmetricKey,
    encodedText,
  );

  const [selfWrapped, recipientWrapped] = await Promise.all([
    window.crypto.subtle.encrypt({ name: 'RSA-OAEP' }, selfPublicKey, rawKey),
    window.crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipientKey, rawKey),
  ]);

  return {
    isEncrypted: true,
    ciphertext: bufferToBase64(ciphertext),
    ciphertextIv: bufferToBase64(iv),
    encryptionVersion: 1,
    encryptedKeys: [
      { userId: state.user.id, keyCiphertext: bufferToBase64(selfWrapped) },
      { userId: chat.partnerId, keyCiphertext: bufferToBase64(recipientWrapped) },
    ],
  };
}

function getCurrentUserEncryptedKey(payload) {
  return (payload?.encryptedKeys || []).find((item) => String(item.userId) === String(state.user?.id));
}

async function decryptEncryptedTextPayload(payload) {
  if (!payload?.isEncrypted) {
    return {
      decryptedText: payload?.text || '',
      decryptionFailed: false,
      decryptionError: '',
    };
  }

  if (!state.e2ee.privateKey || !state.user?.id) {
    return {
      decryptedText: getUndecryptableMessageLabel(payload),
      decryptionFailed: true,
      decryptionError: 'missing_local_key',
    };
  }

  const encryptedKey = getCurrentUserEncryptedKey(payload);
  if (!encryptedKey?.keyCiphertext || !payload.ciphertext || !payload.ciphertextIv) {
    return {
      decryptedText: getUndecryptableMessageLabel(payload),
      decryptionFailed: true,
      decryptionError: 'missing_encrypted_payload',
    };
  }

  try {
    const rawKey = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      state.e2ee.privateKey,
      base64ToBytes(encryptedKey.keyCiphertext),
    );
    const symmetricKey = await window.crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    const plaintext = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(payload.ciphertextIv) },
      symmetricKey,
      base64ToBytes(payload.ciphertext),
    );

    return {
      decryptedText: new TextDecoder().decode(plaintext),
      decryptionFailed: false,
      decryptionError: '',
    };
  } catch (error) {
    return {
      decryptedText: getUndecryptableMessageLabel(payload),
      decryptionFailed: true,
      decryptionError: error?.message || 'decrypt_failed',
    };
  }
}

async function resolveMessageForDisplay(message) {
  if (!message?.isEncrypted) {
    return message;
  }

  return {
    ...message,
    ...(await decryptEncryptedTextPayload(message)),
  };
}

async function buildOutgoingTextPayload(chat, text) {
  const encryptedPayload = await encryptPrivateMessage(chat, text);
  return {
    text: encryptedPayload ? '' : text,
    ...encryptedPayload,
  };
}

function sanitizeCachedMessage(message) {
  if (!message?.isEncrypted) {
    return message;
  }

  return {
    ...message,
    decryptedText: '',
    decryptionFailed: false,
    decryptionError: '',
  };
}

function sanitizeCachedChat(chat) {
  if (!requiresPrivateEncryption(chat)) {
    return chat;
  }

  return {
    ...chat,
    lastMessagePreview: chat.lastMessagePreview ? 'Encrypted message' : chat.lastMessagePreview,
  };
}

async function decryptMessageContent(message) {
  return resolveMessageForDisplay(message);
}

async function decryptChatMessages(chatId) {
  const messages = state.messagesByChat[chatId] || [];
  if (!messages.some((item) => item.isEncrypted)) {
    return;
  }

  const decrypted = await Promise.all(messages.map((message) => resolveMessageForDisplay(message)));
  state.messagesByChat[chatId] = decrypted;
  await persistChatMessagesCache(chatId);
  render();
}

async function init() {
  state.theme = readTheme();
  applyTheme();
  initTabCoordination();
  await hydratePendingOutbox();
  const stored = readSession();

  if (stored?.token) {
    state.token = stored.token;
    state.refreshToken = stored.refreshToken;
    const loaded = await loadLiveWorkspace();

    if (loaded) {
      state.screen = 'workspace';
      state.isLoading = false;
      render();
      return;
    }
  }

  state.isLoading = false;
  state.screen = 'auth';
  render();
}

function handleConnectivityChange() {
  state.offline.isOnline = window.navigator?.onLine ?? true;

  if (state.offline.isOnline) {
    pushToast('Back online', 'Queued work will resume automatically.', 'success');
    if (isRealtimeLeader()) {
      flushPendingOutbox();
    }
  } else {
    pushToast('Offline mode', 'Recent chats stay available and new messages will queue locally.', 'info');
  }

  render();
}

function workspaceSnapshot() {
  return {
    user: state.user,
    privacy: state.privacy,
    chats: state.chats.map(sanitizeCachedChat),
    contacts: state.contacts,
    requests: state.requests,
    groups: state.groups,
    notifications: state.notifications,
    unreadNotificationCount: state.unreadNotificationCount,
    filesHubItems: state.filesHub.items,
    adminSummary: state.admin.summary,
    selectedChatId: state.selectedChatId,
    selectedContactId: state.selectedContactId,
    selectedGroupId: state.selectedGroupId,
    cachedAt: new Date().toISOString(),
  };
}

async function persistWorkspaceCache() {
  await dbPut('kv', {
    key: 'workspace',
    value: workspaceSnapshot(),
  });
}

async function persistChatMessagesCache(chatId) {
  await dbPut('kv', {
    key: `messages:${chatId}`,
    value: (state.messagesByChat[chatId] || []).map(sanitizeCachedMessage),
  });
}

async function loadCachedWorkspace() {
  const workspace = await dbGet('kv', 'workspace');
  if (!workspace?.value) {
    return false;
  }

  const cached = workspace.value;
  state.user = cached.user;
  state.privacy = cached.privacy;
  state.chats = cached.chats || [];
  state.contacts = cached.contacts || [];
  state.requests = cached.requests || { incoming: [], outgoing: [] };
  state.groups = cached.groups || [];
  state.notifications = cached.notifications || [];
  state.unreadNotificationCount = cached.unreadNotificationCount || 0;
  state.filesHub.items = cached.filesHubItems || [];
  state.admin.summary = cached.adminSummary || null;
  state.dataSource = 'api';
  state.offline.usingCachedWorkspace = true;
  state.selectedChatId = cached.selectedChatId || state.chats[0]?.id || null;
  state.selectedContactId = cached.selectedContactId || state.contacts[0]?.id || null;
  state.selectedGroupId = cached.selectedGroupId || state.groups[0]?.id || null;
  state.messagesByChat = {};

  if (state.selectedChatId) {
    const cachedMessages = await dbGet('kv', `messages:${state.selectedChatId}`);
    state.messagesByChat[state.selectedChatId] = cachedMessages?.value || [];
  }

  await hydratePendingOutbox();
  return true;
}

function buildLocalPendingMessage(entry) {
  const mediaUrl = entry.payload.type === 'voice' && entry.fileBlob
    ? (entry.runtimePreviewUrl || entry.previewUrl || createTrackedObjectUrl(entry.fileBlob))
    : (entry.previewUrl || entry.payload.mediaUrl || '');

  return {
    id: entry.localId,
    clientMessageId: entry.clientMessageId,
    chatId: entry.chatId,
    senderId: state.user?.id || 'me',
    senderName: state.user?.fullName || 'You',
    text: entry.plaintext || entry.payload.text || '',
    type: entry.payload.type || 'text',
    mediaUrl,
    thumbnailUrl: entry.payload.thumbnailUrl || '',
    mimeType: entry.payload.mimeType || '',
    fileName: entry.payload.fileName || '',
    fileSize: Number(entry.payload.fileSize || 0),
    duration: Number(entry.payload.duration || 0),
    isEncrypted: Boolean(entry.payload.isEncrypted),
    ciphertext: entry.payload.ciphertext || '',
    ciphertextIv: entry.payload.ciphertextIv || '',
    encryptionVersion: Number(entry.payload.encryptionVersion || 0),
    encryptedKeys: Array.isArray(entry.payload.encryptedKeys) ? entry.payload.encryptedKeys : [],
    replyText: entry.replyText || '',
    createdAt: entry.createdAt,
    editedAt: null,
    pinnedAt: null,
    seenCount: 0,
    deliveryState: entry.deliveryState || 'queued',
    mine: true,
    decryptedText: '',
    decryptionFailed: false,
    decryptionError: '',
  };
}

async function buildLocalPendingMessageForDisplay(entry) {
  const message = buildLocalPendingMessage(entry);
  if (!message.isEncrypted) {
    return message;
  }

  return {
    ...message,
    ...(await decryptEncryptedTextPayload(message)),
  };
}

function upsertMessageForChat(chatId, message) {
  const current = state.messagesByChat[chatId] || [];
  const matchIndex = current.findIndex((item) => (
    item.id === message.id
      || (message.clientMessageId && item.clientMessageId && item.clientMessageId === message.clientMessageId)
  ));

  if (matchIndex >= 0) {
    current[matchIndex] = { ...current[matchIndex], ...message };
    state.messagesByChat[chatId] = [...current];
    return;
  }

  state.messagesByChat[chatId] = [...current, message];
}

function revokePendingMessagePreview(chatId, localMessageId) {
  const current = state.messagesByChat[chatId] || [];
  const localMessage = current.find((item) => item.id === localMessageId);
  revokeTrackedObjectUrl(localMessage?.mediaUrl);
}

async function queueOutboundMessage(entry) {
  const persistedEntry = entry.payload?.isEncrypted
    ? { ...entry, plaintext: '', localPreviewText: '' }
    : entry;
  await dbPut('outbox', persistedEntry);
  state.offline.pendingCount = (await dbGetAll('outbox')).length;
  revokePendingMessagePreview(persistedEntry.chatId, persistedEntry.localId);
  const localMessage = await buildLocalPendingMessageForDisplay(persistedEntry);
  upsertMessageForChat(persistedEntry.chatId, localMessage);
  syncFilesHubFromMessage(localMessage);
  const chat = state.chats.find((item) => item.id === persistedEntry.chatId);
  if (chat) {
    chat.lastMessagePreview = getMessagePreviewText(localMessage) || 'Pending message';
    chat.lastMessageAt = localMessage.createdAt;
  }
  await persistChatMessagesCache(persistedEntry.chatId);
  await persistWorkspaceCache();
  postRealtimeSignal('outbox-changed', { pendingCount: state.offline.pendingCount });
  render();
}

async function setOutboxEntryState(entryId, deliveryState) {
  const entry = await dbGet('outbox', entryId);
  if (!entry) {
    return;
  }

  await dbPut('outbox', {
    ...entry,
    deliveryState,
  });
}

async function hydratePendingOutbox() {
  const entries = (await dbGetAll('outbox')).sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
  state.offline.pendingCount = entries.length;

  for (const entry of entries) {
    if (!state.messagesByChat[entry.chatId]) {
      const cachedMessages = await dbGet('kv', `messages:${entry.chatId}`);
      state.messagesByChat[entry.chatId] = cachedMessages?.value || [];
    }

    const runtimePreviewUrl = entry.payload?.type === 'voice' && entry.fileBlob
      ? createTrackedObjectUrl(entry.fileBlob)
      : '';
    const hydratedEntry = {
      ...entry,
      deliveryState: entry.deliveryState === 'sending' ? 'queued' : entry.deliveryState,
      ...(runtimePreviewUrl ? { runtimePreviewUrl } : {}),
    };
    revokePendingMessagePreview(entry.chatId, entry.localId);
    upsertMessageForChat(entry.chatId, await buildLocalPendingMessageForDisplay(hydratedEntry));
  }
}

async function flushPendingOutbox() {
  if (state.dataSource !== 'api' || !state.token || !state.offline.isOnline || state.offline.isSyncing || !isRealtimeLeader()) {
    return;
  }

  if (!acquireOutboxOwnership()) {
    await refreshPendingOutboxCount();
    render();
    return;
  }

  const entries = (await dbGetAll('outbox')).sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
  if (!entries.length) {
    state.offline.pendingCount = 0;
    releaseOutboxOwnership();
    render();
    return;
  }

  state.offline.isSyncing = true;
  render();

  for (const entry of entries) {
    try {
      if (!isRealtimeLeader() || !renewOutboxOwnership()) {
        break;
      }
      await setOutboxEntryState(entry.id, 'sending');
      revokePendingMessagePreview(entry.chatId, entry.localId);
      upsertMessageForChat(entry.chatId, await buildLocalPendingMessageForDisplay({ ...entry, deliveryState: 'sending' }));
      let payload = { ...entry.payload };
      const chat = state.chats.find((item) => String(item.id) === String(entry.chatId));

      if (requiresPrivateEncryption(chat)) {
        if (payload.type && payload.type !== 'text') {
          const error = new Error('Encrypted private chats currently support secure text messages only.');
          error.status = 400;
          throw error;
        }

        if (!payload.isEncrypted) {
          const plaintext = String(payload.text || entry.plaintext || '').trim();
          if (!plaintext) {
            const error = new Error('Encrypted message payload is incomplete and cannot be retried safely.');
            error.status = 400;
            throw error;
          }

          payload = {
            ...payload,
            ...(await buildOutgoingTextPayload(chat, plaintext)),
          };
        }
      }

      if (entry.fileBlob) {
        const upload = await uploadChatMediaFile(entry.fileBlob);
        payload = {
          ...payload,
          mediaUrl: upload.data?.url || payload.mediaUrl,
          mimeType: upload.data?.mimeType || payload.mimeType,
          fileName: upload.data?.fileName || payload.fileName,
          fileSize: upload.data?.fileSize || payload.fileSize,
        };
      }

      const response = await apiFetch('/api/v1/messages', {
        method: 'POST',
        headers: {},
        body: JSON.stringify(payload),
      });
      let message = normalizeMessage(response.data);
      if (message.isEncrypted) {
        message = await decryptMessageContent(message);
      }
      upsertMessageForChat(entry.chatId, message);
      syncFilesHubFromMessage(message);
      revokePendingMessagePreview(entry.chatId, entry.localId);
      await dbDelete('outbox', entry.id);
      await persistChatMessagesCache(entry.chatId);
    } catch (error) {
      const nextState = error.status ? 'failed' : 'queued';
      await setOutboxEntryState(entry.id, nextState);
      revokePendingMessagePreview(entry.chatId, entry.localId);
      upsertMessageForChat(entry.chatId, await buildLocalPendingMessageForDisplay({ ...entry, deliveryState: nextState }));
      if (!error.status) {
        state.offline.isOnline = false;
        break;
      }
    }
  }

  state.offline.pendingCount = (await dbGetAll('outbox')).length;
  state.offline.isSyncing = false;
  await persistWorkspaceCache();
  releaseOutboxOwnership();
  postRealtimeSignal('outbox-changed', { pendingCount: state.offline.pendingCount });
  render();
}

async function retryPendingMessage(localMessageId) {
  const entries = await dbGetAll('outbox');
  const entry = entries.find((item) => item.localId === localMessageId || item.id === localMessageId);
  if (!entry) {
    pushToast('Retry unavailable', 'This queued message could not be found locally.', 'error');
    return;
  }

  await dbPut('outbox', {
    ...entry,
    deliveryState: 'queued',
  });

  revokePendingMessagePreview(entry.chatId, entry.localId);
  upsertMessageForChat(entry.chatId, await buildLocalPendingMessageForDisplay({ ...entry, deliveryState: 'queued' }));
  postRealtimeSignal('outbox-changed', {});
  render();
  if (isRealtimeLeader()) {
    await flushPendingOutbox();
  }
}

function createDemoWorkspace() {
  const user = {
    id: 'user-me',
    fullName: 'Ahmed Helal',
    username: 'ahelal',
    email: 'ahmed@example.com',
    bio: 'Building a chat app with a strong backend and a calmer, more intentional UI.',
    location: 'Riyadh, Saudi Arabia',
    statusMessage: 'Shipping the next screen.',
    isOnline: true,
    lastSeen: new Date().toISOString(),
    profileImage: '',
    role: 'user',
  };

  const chats = [
    {
      id: 'chat-1',
      type: 'private',
      title: 'Sara Nasser',
      subtitle: 'Typing a cleaner dashboard for the admin flow.',
      partnerId: 'contact-1',
      partnerName: 'Sara Nasser',
      partnerStatus: 'Online now',
      avatarText: 'SN',
      avatarImage: '',
      unreadCount: 3,
      pinned: true,
      muted: false,
      lastMessagePreview: 'The contacts screen feels much stronger now.',
      lastMessageAt: offsetMinutes(-3),
      memberCount: 2,
    },
    {
      id: 'chat-2',
      type: 'private',
      title: 'Omar Alaa',
      subtitle: 'Shared the latest API response shape.',
      partnerId: 'contact-2',
      partnerName: 'Omar Alaa',
      partnerStatus: 'Last seen 12 minutes ago',
      avatarText: 'OA',
      avatarImage: '',
      unreadCount: 0,
      pinned: false,
      muted: true,
      lastMessagePreview: 'I sent the validation notes.',
      lastMessageAt: offsetMinutes(-18),
      memberCount: 2,
    },
    {
      id: 'chat-3',
      type: 'group',
      title: 'PulseChat Design Crew',
      subtitle: '6 members',
      groupId: 'group-1',
      avatarText: 'PD',
      avatarImage: '',
      unreadCount: 7,
      pinned: false,
      muted: false,
      lastMessagePreview: 'Let’s keep the onboarding screen warm and focused.',
      lastMessageAt: offsetMinutes(-42),
      memberCount: 6,
    },
  ];

  const contacts = [
    {
      id: 'contact-1',
      fullName: 'Sara Nasser',
      username: 'saranasser',
      statusMessage: 'Drafting a better request flow.',
      isOnline: true,
      lastSeen: offsetMinutes(-1),
      profileImage: '',
      isFavorite: true,
    },
    {
      id: 'contact-2',
      fullName: 'Omar Alaa',
      username: 'omaralaa',
      statusMessage: 'Reviewing auth edge cases.',
      isOnline: false,
      lastSeen: offsetMinutes(-12),
      profileImage: '',
      isFavorite: false,
    },
    {
      id: 'contact-3',
      fullName: 'Laila Hatem',
      username: 'laila',
      statusMessage: 'Polishing settings copy.',
      isOnline: true,
      lastSeen: offsetMinutes(-4),
      profileImage: '',
      isFavorite: true,
    },
    {
      id: 'contact-4',
      fullName: 'Mazen Fawzy',
      username: 'mazenf',
      statusMessage: 'Socket events are looking healthy.',
      isOnline: false,
      lastSeen: offsetMinutes(-31),
      profileImage: '',
      isFavorite: false,
    },
  ];

  const requests = {
    incoming: [
      {
        id: 'request-1',
        counterpart: {
          id: 'person-1',
          fullName: 'Hana Kareem',
          username: 'hanak',
          profileImage: '',
        },
        createdAt: offsetHours(-5),
      },
      {
        id: 'request-2',
        counterpart: {
          id: 'person-2',
          fullName: 'Yousef Adel',
          username: 'yousef',
          profileImage: '',
        },
        createdAt: offsetHours(-18),
      },
    ],
    outgoing: [
      {
        id: 'request-3',
        counterpart: {
          id: 'person-3',
          fullName: 'Nour Samir',
          username: 'noursamir',
          profileImage: '',
        },
        createdAt: offsetHours(-9),
      },
    ],
  };

  const groups = [
    {
      id: 'group-1',
      chatId: 'chat-3',
      name: 'PulseChat Design Crew',
      description: 'Ship the first UI iteration for auth, messaging, contacts, and settings.',
      inviteCode: 'PULSE24',
      image: '',
      onlyAdminsCanMessage: false,
      onlyAdminsCanEditInfo: true,
      onlyAdminsCanAddMembers: true,
      members: [
        { id: user.id, fullName: user.fullName, role: 'owner' },
        { id: 'contact-1', fullName: 'Sara Nasser', role: 'admin' },
        { id: 'contact-2', fullName: 'Omar Alaa', role: 'member' },
        { id: 'contact-3', fullName: 'Laila Hatem', role: 'member' },
        { id: 'contact-4', fullName: 'Mazen Fawzy', role: 'member' },
        { id: 'person-5', fullName: 'Reem Tarek', role: 'member' },
      ],
    },
    {
      id: 'group-2',
      chatId: null,
      name: 'Backend QA Squad',
      description: 'Validation, pagination, and regression checks.',
      inviteCode: 'QA907',
      image: '',
      onlyAdminsCanMessage: true,
      onlyAdminsCanEditInfo: true,
      onlyAdminsCanAddMembers: false,
      members: [
        { id: user.id, fullName: user.fullName, role: 'admin' },
        { id: 'contact-2', fullName: 'Omar Alaa', role: 'owner' },
        { id: 'contact-4', fullName: 'Mazen Fawzy', role: 'member' },
      ],
    },
  ];

  const notifications = [
    {
      id: 'notification-1',
      type: 'contact_request_received',
      title: 'New contact request',
      body: 'Hana Kareem wants to connect with you.',
      isRead: false,
      createdAt: offsetMinutes(-14),
    },
    {
      id: 'notification-2',
      type: 'group_message',
      title: 'Design Crew',
      body: 'Sara: the requests screen now has accept and reject states.',
      isRead: false,
      createdAt: offsetMinutes(-39),
    },
    {
      id: 'notification-3',
      type: 'private_message',
      title: 'New message',
      body: 'Omar sent the chat service response shape.',
      isRead: true,
      createdAt: offsetHours(-3),
    },
  ];

  const messagesByChat = {
    'chat-1': [
      {
        id: 'message-1',
        chatId: 'chat-1',
        senderId: 'contact-1',
        senderName: 'Sara Nasser',
        text: 'The layout feels much calmer with the right rail keeping profile actions nearby.',
        createdAt: offsetMinutes(-55),
        replyText: '',
        mine: false,
        editedAt: null,
        seenCount: 1,
      },
      {
        id: 'message-2',
        chatId: 'chat-1',
        senderId: user.id,
        senderName: user.fullName,
        text: 'Nice. I also want the auth screen to feel more intentional than a generic card in the middle.',
        createdAt: offsetMinutes(-48),
        replyText: '',
        mine: true,
        editedAt: null,
        seenCount: 1,
      },
      {
        id: 'message-3',
        chatId: 'chat-1',
        senderId: 'contact-1',
        senderName: 'Sara Nasser',
        text: 'I kept the warm palette but balanced it with teal and blue so it still feels like a product, not a moodboard.',
        createdAt: offsetMinutes(-33),
        replyText: 'Nice. I also want the auth screen to feel more intentional than a generic card in the middle.',
        mine: false,
        editedAt: null,
        seenCount: 0,
      },
      {
        id: 'message-4',
        chatId: 'chat-1',
        senderId: user.id,
        senderName: user.fullName,
        text: 'Perfect. Next I’m connecting the live auth flow and leaving the rest of the screens demo-friendly until the backend endpoints catch up.',
        createdAt: offsetMinutes(-6),
        replyText: '',
        mine: true,
        editedAt: null,
        seenCount: 0,
      },
      {
        id: 'message-4b',
        chatId: 'chat-1',
        senderId: 'contact-1',
        senderName: 'Sara Nasser',
        text: '',
        type: 'image',
        mediaUrl: 'data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1200\" height=\"700\"><rect width=\"1200\" height=\"700\" fill=\"%23111827\"/><circle cx=\"250\" cy=\"180\" r=\"140\" fill=\"%233B82F6\" opacity=\"0.7\"/><circle cx=\"920\" cy=\"420\" r=\"190\" fill=\"%238B5CF6\" opacity=\"0.6\"/><text x=\"70\" y=\"620\" fill=\"white\" font-size=\"64\" font-family=\"Arial\">PulseChat concept board</text></svg>',
        fileName: 'pulsechat-concept-board.svg',
        mimeType: 'image/svg+xml',
        fileSize: 32000,
        createdAt: offsetMinutes(-4),
        replyText: '',
        mine: false,
        editedAt: null,
        seenCount: 0,
      },
    ],
    'chat-2': [
      {
        id: 'message-5',
        chatId: 'chat-2',
        senderId: 'contact-2',
        senderName: 'Omar Alaa',
        text: 'Your user /me endpoint already returns privacy, so the settings screen can save directly against the real API.',
        createdAt: offsetMinutes(-28),
        replyText: '',
        mine: false,
        editedAt: null,
        seenCount: 1,
      },
    ],
    'chat-3': [
      {
        id: 'message-6',
        chatId: 'chat-3',
        senderId: 'contact-3',
        senderName: 'Laila Hatem',
        text: 'The requests view should make incoming and outgoing feel distinct without needing a page reload.',
        createdAt: offsetMinutes(-80),
        replyText: '',
        mine: false,
        editedAt: null,
        seenCount: 4,
      },
      {
        id: 'message-7',
        chatId: 'chat-3',
        senderId: user.id,
        senderName: user.fullName,
        text: 'Agreed. I’m making that switch instant, and the toast system will surface the action result.',
        createdAt: offsetMinutes(-58),
        replyText: '',
        mine: true,
        editedAt: null,
        seenCount: 5,
      },
      {
        id: 'message-8',
        chatId: 'chat-3',
        senderId: 'contact-3',
        senderName: 'Laila Hatem',
        text: '',
        type: 'file',
        mediaUrl: 'data:text/plain;charset=utf-8,Phase%202%20launch%20checklist%0A-%20Auth%20QA%0A-%20Socket%20pass%0A-%20UI%20handoff',
        fileName: 'phase-2-launch-checklist.txt',
        mimeType: 'text/plain',
        fileSize: 2048,
        createdAt: offsetMinutes(-22),
        replyText: '',
        mine: false,
        editedAt: null,
        seenCount: 3,
      },
    ],
  };

  const privacy = {
    messagePermission: 'contacts',
    profilePhotoVisibility: 'everyone',
    lastSeenVisibility: 'contacts',
    onlineStatusVisibility: 'contacts',
    groupInvitePermission: 'contacts',
    readReceiptsEnabled: true,
    typingIndicatorEnabled: true,
  };

  return {
    user,
    privacy,
    chats,
    contacts,
    requests,
    groups,
    notifications,
    messagesByChat,
  };
}

function offsetMinutes(value) {
  return new Date(Date.now() + value * 60 * 1000).toISOString();
}

function offsetHours(value) {
  return new Date(Date.now() + value * 60 * 60 * 1000).toISOString();
}

function readSession() {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY) || 'null');
  } catch (error) {
    return null;
  }
}

function writeSession(session) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

let refreshRequestPromise = null;

function readTheme() {
  return window.localStorage.getItem(THEME_KEY) || 'light';
}

function applyTheme() {
  if (document.documentElement) {
    document.documentElement.dataset.theme = state.theme;
  }
}

function disconnectSocket() {
  if (state.socket) {
    state.socket.disconnect();
  }

  state.socket = null;
  state.connectedChatId = null;
  joinedSocketRooms = new Set();
  state.liveConnectionState = 'idle';
}

function joinSelectedChatRoom(chatId = state.selectedChatId) {
  if (!state.socket || !chatId) {
    return;
  }
  state.connectedChatId = chatId;
  syncSocketChatRooms();
}

function upsertChat(chatPatch) {
  const existingIndex = state.chats.findIndex((item) => item.id === chatPatch.id);

  if (existingIndex >= 0) {
    state.chats[existingIndex] = { ...state.chats[existingIndex], ...chatPatch };
    return state.chats[existingIndex];
  }

  state.chats.unshift(chatPatch);
  return chatPatch;
}

function syncChatReceipts(chatId) {
  if (!chatId || state.dataSource !== 'api') {
    return;
  }

  const messages = state.messagesByChat[chatId] || [];
  for (const message of messages) {
    if (message.mine) {
      continue;
    }

    emitSocketCommand('message:delivered', { messageId: message.id });
    if (state.selectedChatId === chatId) {
      emitSocketCommand('message:seen', { messageId: message.id });
    }
  }
}

function connectLiveSocket() {
  if (state.dataSource !== 'api' || !state.token || typeof window.io !== 'function') {
    return;
  }

  if (!isRealtimeLeader()) {
    disconnectSocket();
    state.liveConnectionState = 'standby';
    render();
    return;
  }

  if (state.socket?.connected) {
    syncSocketChatRooms();
    return;
  }

  disconnectSocket();

  const socket = window.io({
    auth: {
      token: state.token,
    },
  });

  socket.on('connect', () => {
    state.liveConnectionState = 'connected';
    state.offline.isOnline = true;
    syncSocketChatRooms();
    syncChatReceipts(state.selectedChatId);
    flushPendingOutbox();
    reconcileRealtimeState({ refreshActiveChat: false }).catch(() => null);
    render();
  });

  socket.on('disconnect', () => {
    state.liveConnectionState = 'disconnected';
    render();
  });

  socket.on('connect_error', () => {
    state.liveConnectionState = 'disconnected';
    render();
  });

  socket.on('presence:update', (payload) => {
    applyRealtimeEvent('presence:update', payload, { broadcast: true }).catch(() => null);
  });

  socket.on('chat:updated', (payload) => {
    applyRealtimeEvent('chat:updated', payload, { broadcast: true }).catch(() => null);
  });

  socket.on('message:new', (payload) => {
    applyRealtimeEvent('message:new', payload, { broadcast: true }).catch(() => null);
  });

  socket.on('message:updated', (payload) => {
    applyRealtimeEvent('message:updated', payload, { broadcast: true }).catch(() => null);
  });

  socket.on('message:deleted', (payload) => {
    applyRealtimeEvent('message:deleted', payload, { broadcast: true }).catch(() => null);
  });

  socket.on('message:seen', (payload) => {
    applyRealtimeEvent('message:seen', payload, { broadcast: true }).catch(() => null);
  });

  socket.on('message:reactions', (payload) => {
    applyRealtimeEvent('message:reactions', payload, { broadcast: true }).catch(() => null);
  });

  socket.on('message:typing', (payload) => {
    applyRealtimeEvent('message:typing', payload, { broadcast: true }).catch(() => null);
  });

  socket.on('message:stop-typing', (payload) => {
    applyRealtimeEvent('message:stop-typing', payload, { broadcast: true }).catch(() => null);
  });

  socket.on('notification:new', (payload) => {
    applyRealtimeEvent('notification:new', payload, { broadcast: true }).catch(() => null);
  });

  socket.on('notification:read', (payload) => {
    applyRealtimeEvent('notification:read', payload, { broadcast: true }).catch(() => null);
  });

  socket.on('notification:count', (payload) => {
    applyRealtimeEvent('notification:count', payload, { broadcast: true }).catch(() => null);
  });

  state.socket = socket;
  state.liveConnectionState = 'connecting';
}

function syncDemoState() {
  disconnectSocket();
  state.dataSource = 'demo';
  state.liveConnectionState = 'idle';
  state.user = structuredClone(demoWorkspace.user);
  state.privacy = structuredClone(demoWorkspace.privacy);
  state.chats = structuredClone(demoWorkspace.chats);
  state.contacts = structuredClone(demoWorkspace.contacts);
  state.requests = structuredClone(demoWorkspace.requests);
  state.groups = structuredClone(demoWorkspace.groups);
  state.notifications = structuredClone(demoWorkspace.notifications);
  state.unreadNotificationCount = state.notifications.filter((item) => !item.isRead).length;
  state.messagesByChat = structuredClone(demoWorkspace.messagesByChat);
  state.filesHub.items = buildFilesHubFromMessages(state.messagesByChat, state.chats);
  state.filesHub.error = '';
  state.filesHub.isLoading = false;
  state.admin.summary = null;
  state.typingByChat = {};
  discardVoiceDraft({ silent: true });
  resetVoiceRecorderState();
  state.selectedChatId = state.chats.some((item) => item.id === state.selectedChatId)
    ? state.selectedChatId
    : state.chats[0]?.id || null;
  state.selectedContactId = state.contacts.some((item) => item.id === state.selectedContactId)
    ? state.selectedContactId
    : state.contacts[0]?.id || null;
  state.selectedGroupId = state.groups.some((item) => item.id === state.selectedGroupId)
    ? state.selectedGroupId
    : state.groups[0]?.id || null;
}

async function loadLiveWorkspace() {
  let profileRes;

  try {
    state.isLoading = true;
    render();

    profileRes = await apiFetch('/api/v1/users/me');
    const [chatsRes, contactsRes, incomingRes, outgoingRes, notificationsRes, groupsRes, adminRes] = await Promise.allSettled([
      apiFetch('/api/v1/chats?limit=20'),
      apiFetch('/api/v1/contacts?limit=20'),
      apiFetch('/api/v1/contact-requests/incoming?limit=20'),
      apiFetch('/api/v1/contact-requests/outgoing?limit=20'),
      apiFetch('/api/v1/notifications?limit=20'),
      apiFetch('/api/v1/groups?limit=20'),
      profileRes.data?.user?.role === 'admin'
        ? apiFetch('/api/v1/admin/dashboard')
        : Promise.resolve({ data: null }),
    ]);

    const profileData = profileRes.data || {};
    state.dataSource = 'api';
    state.user = normalizeUser(profileData.user);
    state.privacy = normalizePrivacy(profileData.privacy);
    state.chats = chatsRes.status === 'fulfilled'
      ? (chatsRes.value.data || []).map((item) => normalizeChat(item, state.user))
      : [];
    state.contacts = contactsRes.status === 'fulfilled'
      ? (contactsRes.value.data || []).map(normalizeContact)
      : [];
    state.requests = {
      incoming: incomingRes.status === 'fulfilled'
        ? (incomingRes.value.data || []).map((item) => normalizeRequest(item, 'incoming'))
        : [],
      outgoing: outgoingRes.status === 'fulfilled'
        ? (outgoingRes.value.data || []).map((item) => normalizeRequest(item, 'outgoing'))
        : [],
    };
    state.notifications = notificationsRes.status === 'fulfilled'
      ? (notificationsRes.value.data || []).map(normalizeNotification)
      : [];
    state.unreadNotificationCount = state.notifications.filter((item) => !item.isRead).length;
    state.groups = groupsRes.status === 'fulfilled'
      ? (groupsRes.value.data || []).map(normalizeGroup)
      : buildGroupsFromChats(state.chats);
    state.admin.summary = adminRes.status === 'fulfilled' ? adminRes.value.data || null : null;
    applyGroupDetailsToChats();
    state.messagesByChat = {};
    state.typingByChat = {};
    discardVoiceDraft({ silent: true });
    resetVoiceRecorderState();
    await ensureE2EESetup().catch(() => null);
    state.selectedChatId = state.chats[0]?.id || null;
    state.selectedContactId = state.contacts[0]?.id || null;
    state.selectedGroupId = state.groups[0]?.id || null;

    if (state.selectedChatId) {
      await loadChatMessages(state.selectedChatId);
    }

    await loadFilesHub({ silent: true });
    await hydratePendingOutbox();
    state.offline.usingCachedWorkspace = false;
    state.offline.isOnline = window.navigator?.onLine ?? true;
    await persistWorkspaceCache();

    await refreshLeadership();
    connectLiveSocket();

    const failedSections = [
      ['chats', chatsRes],
      ['contacts', contactsRes],
      ['incoming requests', incomingRes],
      ['outgoing requests', outgoingRes],
      ['notifications', notificationsRes],
      ['groups', groupsRes],
      ['admin dashboard', adminRes],
    ]
      .filter(([, result]) => result.status === 'rejected')
      .map(([label]) => label);

    if (failedSections.length) {
      pushToast(
        'Partial live data',
        `Loaded your session, but these sections fell back to empty state: ${failedSections.join(', ')}.`,
        'info',
      );
    }

    state.isLoading = false;
    return true;
  } catch (error) {
    disconnectSocket();
    if (error.status === 401) {
      clearSession();
      state.token = null;
      state.refreshToken = null;
    } else if (await loadCachedWorkspace()) {
      state.isLoading = false;
      state.offline.isOnline = false;
      pushToast(
        'Offline workspace',
        error.message || 'Cached chats and pending messages are available until the connection returns.',
        'info',
      );
      return true;
    }

    syncDemoState();
    state.isLoading = false;
    pushToast(
      error.status === 401 ? 'Session expired' : 'Live data unavailable',
      error.message || 'Live data could not be loaded. Demo mode is ready instead.',
      'info',
    );
    return false;
  }
}

function normalizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user._id || user.id,
    fullName: user.fullName || 'Unknown user',
    username: user.username || 'user',
    email: user.email || '',
    bio: user.bio || '',
    location: user.location || '',
    statusMessage: user.statusMessage || '',
    isOnline: Boolean(user.isOnline),
    lastSeen: user.lastSeen || null,
    profileImage: user.profileImage || '',
    role: user.role || 'user',
    encryptionEnabled: Boolean(user.encryptionEnabled),
    encryptionPublicKey: user.encryptionPublicKey || '',
    encryptionKeyVersion: Number(user.encryptionKeyVersion || 0),
  };
}

function normalizePrivacy(privacy) {
  return {
    messagePermission: privacy?.messagePermission || 'contacts',
    profilePhotoVisibility: privacy?.profilePhotoVisibility || 'everyone',
    lastSeenVisibility: privacy?.lastSeenVisibility || 'contacts',
    onlineStatusVisibility: privacy?.onlineStatusVisibility || 'contacts',
    groupInvitePermission: privacy?.groupInvitePermission || 'contacts',
    readReceiptsEnabled: privacy?.readReceiptsEnabled ?? true,
    typingIndicatorEnabled: privacy?.typingIndicatorEnabled ?? true,
  };
}

function normalizeChat(chat, currentUser) {
  const members = Array.isArray(chat.memberIds) ? chat.memberIds : [];
  const partner = members.find((member) => String(member._id || member.id || member) !== String(currentUser?.id));
  const isGroup = chat.type === 'group';
  const title = isGroup
    ? `Group chat ${String(chat._id || '').slice(-4) || ''}`.trim()
    : partner?.fullName || 'New conversation';

  return {
    id: chat._id || chat.id,
    type: chat.type,
    title,
    subtitle: isGroup
      ? `${members.length || 0} members`
      : partner?.isOnline
        ? 'Online now'
        : partner?.lastSeen
          ? `Last seen ${relativeTime(partner.lastSeen)}`
          : 'Private conversation',
    partnerId: isGroup ? null : partner?._id || partner?.id || null,
    partnerName: partner?.fullName || '',
    partnerStatus: partner?.statusMessage || '',
    avatarText: initials(title),
    avatarImage: partner?.profileImage || '',
    partnerPublicKey: partner?.encryptionPublicKey || '',
    partnerKeyVersion: Number(partner?.encryptionKeyVersion || 0),
    e2eeCapable: Boolean(!isGroup && partner?.encryptionEnabled),
    unreadCount: Number(chat.unreadCount || 0),
    pinned: Boolean(chat.participantSettings?.pinnedAt || chat.pinned),
    muted: Boolean(chat.participantSettings?.mutedUntil || chat.muted),
    lastMessagePreview: chat.lastMessagePreview || 'No messages yet',
    lastMessageAt: chat.lastMessageAt || chat.updatedAt || chat.createdAt || new Date().toISOString(),
    memberCount: members.length || 0,
  };
}

function normalizeContact(contact) {
  const user = contact.contactUserId || {};
  return {
    id: user._id || user.id || contact.id,
    fullName: user.fullName || 'Unknown contact',
    username: user.username || 'user',
    statusMessage: user.statusMessage || '',
    isOnline: Boolean(user.isOnline),
    lastSeen: user.lastSeen || null,
    profileImage: user.profileImage || '',
    isFavorite: Boolean(contact.isFavorite),
  };
}

function normalizeRequest(item, direction) {
  const counterpart = direction === 'incoming' ? item.senderId : item.receiverId;
  return {
    id: item._id || item.id,
    createdAt: item.createdAt,
    counterpart: {
      id: counterpart?._id || counterpart?.id,
      fullName: counterpart?.fullName || 'Unknown user',
      username: counterpart?.username || 'user',
      profileImage: counterpart?.profileImage || '',
    },
  };
}

function normalizeNotification(item) {
  return {
    id: item._id || item.id,
    type: item.type,
    title: item.title,
    body: item.body,
    isRead: Boolean(item.isRead),
    createdAt: item.createdAt,
  };
}

function classifyFileKind(mimeType, fallbackType = 'other') {
  if ((mimeType || '').startsWith('image/')) {
    return 'image';
  }
  if ((mimeType || '').startsWith('video/')) {
    return 'video';
  }
  if ((mimeType || '').startsWith('audio/')) {
    return 'audio';
  }
  if ((mimeType || '').includes('pdf')
    || (mimeType || '').includes('document')
    || (mimeType || '').includes('sheet')
    || (mimeType || '').includes('presentation')
    || (mimeType || '').startsWith('text/')) {
    return 'document';
  }
  if (['image', 'video', 'audio', 'document', 'other'].includes(fallbackType)) {
    return fallbackType;
  }

  return 'other';
}

function normalizeGroup(group) {
  return {
    id: group._id || group.id,
    chatId: group.chatId?._id || group.chatId || null,
    name: group.name || 'Untitled group',
    description: group.description || '',
    inviteCode: group.inviteCode || '',
    image: group.image || '',
    onlyAdminsCanMessage: Boolean(group.onlyAdminsCanMessage),
    onlyAdminsCanEditInfo: Boolean(group.onlyAdminsCanEditInfo),
    onlyAdminsCanAddMembers: Boolean(group.onlyAdminsCanAddMembers),
    memberCount: Number(group.memberCount || 0),
    currentUserRole: group.currentUserRole || 'member',
    members: [],
  };
}

function normalizeMessage(item) {
  const sender = item.senderId || {};
  const senderId = sender._id || sender.id || item.senderId;
  const replySource = item.replyToMessageId || {};
  return {
    id: item._id || item.id,
    chatId: item.chatId?._id || item.chatId || null,
    clientMessageId: item.clientMessageId || '',
    senderId,
    senderName: sender.fullName || 'Unknown user',
    text: item.text || '',
    type: item.type || 'text',
    mediaUrl: item.mediaUrl || '',
    thumbnailUrl: item.thumbnailUrl || '',
    mimeType: item.mimeType || '',
    fileName: item.fileName || '',
    fileSize: Number(item.fileSize || 0),
    duration: Number(item.duration || 0),
    isEncrypted: Boolean(item.isEncrypted),
    ciphertext: item.ciphertext || '',
    ciphertextIv: item.ciphertextIv || '',
    encryptionVersion: Number(item.encryptionVersion || 0),
    encryptedKeys: Array.isArray(item.encryptedKeys) ? item.encryptedKeys : [],
    reactions: normalizeReactions(item.reactions || []),
    replyText: replySource.isEncrypted ? getUndecryptableMessageLabel(replySource) : (replySource.text || ''),
    createdAt: item.createdAt,
    editedAt: item.editedAt || null,
    pinnedAt: item.pinnedAt || null,
    seenCount: item.seenBy?.length || 0,
    deliveryState: item.deliveryState || 'sent',
    mine: String(senderId) === String(state.user?.id),
    decryptedText: item.decryptedText || '',
    decryptionFailed: Boolean(item.decryptionFailed),
    decryptionError: item.decryptionError || '',
  };
}

function normalizeFileItem(item) {
  const sender = item.senderId || {};
  const rawType = item.mediaKind || item.type || 'file';
  const type = rawType === 'voice' ? 'audio' : rawType === 'file' ? classifyFileKind(item.mimeType, rawType) : rawType;
  return {
    id: item._id || item.id,
    messageId: item._id || item.id,
    chatId: item.chatId?._id || item.chatId || null,
    senderId: sender._id || sender.id || item.senderId || '',
    senderName: sender.fullName || item.senderName || 'Unknown user',
    fileName: item.fileName || item.text || 'Attachment',
    mediaUrl: item.mediaUrl || '',
    thumbnailUrl: item.thumbnailUrl || '',
    mimeType: item.mimeType || '',
    fileSize: Number(item.fileSize || 0),
    duration: Number(item.duration || 0),
    type,
    createdAt: item.createdAt || new Date().toISOString(),
  };
}

function buildFilesHubFromMessages(messagesByChat, chats) {
  const chatMap = new Map((chats || []).map((chat) => [String(chat.id), chat]));

  return Object.values(messagesByChat || {})
    .flat()
    .filter((message) => message.mediaUrl)
    .map((message) => {
      const chat = chatMap.get(String(message.chatId));
      return {
        ...normalizeFileItem(message),
        sourceTitle: chat?.title || 'Conversation',
      };
    })
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function syncFilesHubFromMessage(message) {
  if (!message?.mediaUrl) {
    return;
  }

  const chat = state.chats.find((item) => item.id === message.chatId);
  const fileItem = {
    ...normalizeFileItem(message),
    sourceTitle: chat?.title || 'Conversation',
  };

  state.filesHub.items = [
    fileItem,
    ...state.filesHub.items.filter((item) => item.messageId !== fileItem.messageId),
  ];
}

function buildGroupsFromChats(chats) {
  return chats
    .filter((chat) => chat.type === 'group')
    .map((chat) => ({
      id: `group-${chat.id}`,
      chatId: chat.id,
      name: chat.title,
      description: 'Connected from the chat list. Group metadata can be enriched as more list endpoints are added.',
      inviteCode: 'LIVE',
      image: '',
      onlyAdminsCanMessage: false,
      onlyAdminsCanEditInfo: false,
      onlyAdminsCanAddMembers: false,
      members: Array.from({ length: chat.memberCount || 0 }, (_, index) => ({
        id: `${chat.id}-${index}`,
        fullName: `Member ${index + 1}`,
        role: index === 0 ? 'owner' : 'member',
      })),
    }));
}

function applyGroupDetailsToChats() {
  const groupsByChatId = new Map(
    state.groups
      .filter((group) => group.chatId)
      .map((group) => [String(group.chatId), group]),
  );

  state.chats = state.chats.map((chat) => {
    if (chat.type !== 'group') {
      return chat;
    }

    const group = groupsByChatId.get(String(chat.id));
    if (!group) {
      return chat;
    }

    return {
      ...chat,
      title: group.name,
      subtitle: `${group.memberCount || chat.memberCount || 0} members`,
      avatarImage: group.image || chat.avatarImage,
      memberCount: group.memberCount || chat.memberCount,
    };
  });
}

async function loadChatMessages(chatId) {
  if (!chatId) {
    return;
  }

  if (state.dataSource === 'demo') {
    render();
    return;
  }

  try {
    const messagesRes = await apiFetch(`/api/v1/messages/chat/${chatId}?limit=50`);
    state.messagesByChat[chatId] = (messagesRes.data || []).map(normalizeMessage).reverse();
    await persistChatMessagesCache(chatId);
    await decryptChatMessages(chatId);
    const chat = state.chats.find((item) => item.id === chatId);
    if (chat) {
      chat.unreadCount = 0;
      if (chat.type === 'private' && chat.partnerId) {
        const partnerKey = await fetchPartnerEncryptionKey(chat.partnerId).catch(() => null);
        if (partnerKey?.publicKey) {
          chat.partnerPublicKey = partnerKey.publicKey;
          chat.partnerKeyVersion = partnerKey.keyVersion || 1;
          chat.e2eeCapable = true;
        }
      }
    }
    joinSelectedChatRoom(chatId);
    syncChatReceipts(chatId);
  } catch (error) {
    const cachedMessages = await dbGet('kv', `messages:${chatId}`);
    if (cachedMessages?.value?.length) {
      state.messagesByChat[chatId] = cachedMessages.value;
      pushToast('Offline messages', 'Showing the most recent cached conversation history.', 'info');
    } else {
      pushToast('Messages unavailable', error.message, 'info');
      state.messagesByChat[chatId] = [];
    }
  }

  render();
}

async function loadFilesHub({ silent = false } = {}) {
  if (state.dataSource === 'demo') {
    state.filesHub.items = buildFilesHubFromMessages(state.messagesByChat, state.chats);
    state.filesHub.error = '';
    state.filesHub.isLoading = false;
    if (!silent) {
      render();
    }
    return;
  }

  try {
    state.filesHub.isLoading = true;
    state.filesHub.error = '';
    if (!silent) {
      render();
    }

    const params = new URLSearchParams();
    const filters = state.filesHub.filters;
    if (filters.kind && filters.kind !== 'all') {
      params.set('kind', filters.kind);
    }
    if (filters.chatId) {
      params.set('chatId', filters.chatId);
    }
    if (filters.senderId) {
      params.set('senderId', filters.senderId);
    }
    if (filters.q) {
      params.set('q', filters.q);
    }
    if (filters.from) {
      params.set('from', filters.from);
    }
    params.set('limit', '100');

    const response = await apiFetch(`/api/v1/messages/files?${params.toString()}`);
    state.filesHub.items = (response.data || []).map((item) => {
      const normalized = normalizeFileItem(item);
      const source = state.chats.find((chat) => chat.id === normalized.chatId);
      return {
        ...normalized,
        sourceTitle: source?.title || 'Conversation',
      };
    });
    state.filesHub.error = '';
  } catch (error) {
    state.filesHub.error = error.message || 'Files could not be loaded.';
  } finally {
    state.filesHub.isLoading = false;
    if (!silent) {
      render();
    }
  }
}

async function refreshAccessToken() {
  if (!state.refreshToken) {
    throw new Error('No refresh token available');
  }

  if (!refreshRequestPromise) {
    refreshRequestPromise = fetch('/api/v1/auth/refresh-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refreshToken: state.refreshToken,
      }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(payload.message || 'Session refresh failed');
          error.status = response.status;
          throw error;
        }

        state.token = payload.data?.tokens?.accessToken || null;
        state.refreshToken = payload.data?.tokens?.refreshToken || state.refreshToken;
        writeSession({
          token: state.token,
          refreshToken: state.refreshToken,
        });
      })
      .finally(() => {
        refreshRequestPromise = null;
      });
  }

  return refreshRequestPromise;
}

async function apiFetch(path, options = {}, retry = { attemptedRefresh: false }) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
    });
  } catch (error) {
    const networkError = new Error('Network request failed');
    networkError.cause = error;
    throw networkError;
  }

  const payload = await response.json().catch(() => ({}));

  if (
    response.status === 401
    && state.refreshToken
    && !retry.attemptedRefresh
    && path !== '/api/v1/auth/refresh-token'
    && path !== '/api/v1/auth/login'
    && path !== '/api/v1/auth/register'
  ) {
    try {
      await refreshAccessToken();
      return apiFetch(path, options, { attemptedRefresh: true });
    } catch (error) {
      clearSession();
      state.token = null;
      state.refreshToken = null;
      disconnectSocket();
      releaseLeadership();
      setRealtimeFollower('');
    }
  }

  if (!response.ok) {
    const error = new Error(payload.message || 'Request failed');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function uploadChatMediaFile(file) {
  const headers = new Headers();
  if (state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  const formData = new FormData();
  formData.set('file', file, file.name || `upload-${Date.now()}`);

  const response = await fetch('/api/v1/uploads/chat-media', {
    method: 'POST',
    headers,
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || 'Upload failed');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

let voiceDurationTimer = null;

function supportsVoiceRecording() {
  return Boolean(
    window.MediaRecorder
      && window.navigator?.mediaDevices?.getUserMedia,
  );
}

function getPreferredVoiceMimeType() {
  if (!window.MediaRecorder?.isTypeSupported) {
    return '';
  }

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg',
  ];

  return candidates.find((type) => window.MediaRecorder.isTypeSupported(type)) || '';
}

function guessAudioExtension(mimeType) {
  if (mimeType.includes('ogg')) {
    return '.ogg';
  }
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) {
    return '.m4a';
  }
  if (mimeType.includes('wav')) {
    return '.wav';
  }

  return '.webm';
}

function resetVoiceRecorderState() {
  cleanupVoiceRecorderResources();
  state.voiceRecorder = createInitialVoiceRecorderState();
}

function discardVoiceDraft({ silent = false } = {}) {
  revokeTrackedObjectUrl(state.voiceDraft?.previewUrl);

  state.voiceDraft = null;

  if (!silent) {
    render();
  }
}

function teardownVoiceLifecycle({ preserveQueuedDraft = false, silent = false } = {}) {
  const shouldDiscardDraft = state.voiceDraft && (!preserveQueuedDraft || !['queued', 'sending'].includes(state.voiceDraft.status));

  if (state.voiceRecorder?.recorder && state.voiceRecorder.recorder.state !== 'inactive') {
    state.voiceRecorder.shouldCreateDraft = false;
    try {
      state.voiceRecorder.recorder.stop();
    } catch (error) {
      // Ignore recorder stop races from browser teardown paths.
    }
  }

  resetVoiceRecorderState();

  if (shouldDiscardDraft) {
    discardVoiceDraft({ silent: true });
  }

  if (!silent) {
    render();
  }
}

function cleanupVoiceOnContextChange(nextChatId = null) {
  if (
    state.voiceRecorder.status === 'recording'
    || state.voiceRecorder.status === 'requesting_permission'
    || state.voiceRecorder.status === 'recorded'
    || state.voiceRecorder.status === 'failed'
    || state.voiceDraft?.status === 'recorded'
    || state.voiceDraft?.status === 'failed'
  ) {
    if (!nextChatId || String(nextChatId) !== String(state.selectedChatId)) {
      teardownVoiceLifecycle();
      pushToast('Voice draft cleared', 'Voice recording was reset because you changed context.', 'info');
    }
  }
}

async function startVoiceRecording() {
  if (!supportsVoiceRecording()) {
    setVoiceRecorderStatus('unsupported', {
      error: 'This browser does not support microphone recording.',
    });
    pushToast('Voice unavailable', 'This browser does not support microphone recording in the current environment.', 'info');
    render();
    return;
  }

  if (['requesting_permission', 'recording', 'sending'].includes(getActiveVoiceState())) {
    return;
  }

  teardownVoiceLifecycle({ preserveQueuedDraft: true, silent: true });

  try {
    const sessionId = crypto.randomUUID();
    setVoiceRecorderStatus('requesting_permission', {
      durationMs: 0,
      error: '',
      sessionId,
      shouldCreateDraft: false,
    });
    render();

    const stream = await window.navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getPreferredVoiceMimeType();
    const recorder = mimeType ? new window.MediaRecorder(stream, { mimeType }) : new window.MediaRecorder(stream);
    const startedAt = Date.now();
    const chunks = [];

    recorder.onerror = (event) => {
      const message = describeVoiceSupportIssue(event?.error);
      teardownVoiceLifecycle({ preserveQueuedDraft: true, silent: true });
      state.voiceDraft = {
        status: 'failed',
        chatId: state.selectedChatId,
        error: message,
      };
      pushToast('Recording failed', message, 'error');
      render();
    };

    recorder.ondataavailable = (event) => {
      if (event.data?.size) {
        chunks.push(event.data);
      }
    };

    recorder.onstop = () => {
      const shouldCreateDraft = state.voiceRecorder.sessionId === sessionId && state.voiceRecorder.shouldCreateDraft;
      const durationMs = Math.max(1000, Date.now() - startedAt);
      const blobType = recorder.mimeType || mimeType || 'audio/webm';
      cleanupVoiceRecorderResources();
      state.voiceRecorder = createInitialVoiceRecorderState();

      if (!shouldCreateDraft) {
        render();
        return;
      }

      if (!chunks.length) {
        state.voiceDraft = {
          status: 'failed',
          error: 'No audio was captured. Please try recording again.',
          chatId: state.selectedChatId,
        };
        render();
        return;
      }

      const blob = new Blob(chunks, { type: blobType });
      const file = new File(
        [blob],
        `voice-${Date.now()}${guessAudioExtension(blobType)}`,
        { type: blobType },
      );

      discardVoiceDraft({ silent: true });
      state.voiceDraft = {
        status: 'recorded',
        chatId: state.selectedChatId,
        blob,
        file,
        previewUrl: createTrackedObjectUrl(blob),
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        duration: Math.max(1, Math.round(durationMs / 1000)),
        error: '',
      };
      resetVoiceRecorderState();
      render();
    };

    state.voiceRecorder = {
      ...createInitialVoiceRecorderState(),
      status: 'recording',
      durationMs: 0,
      error: '',
      stream,
      recorder,
      startedAt,
      sessionId,
      shouldCreateDraft: true,
    };

    clearVoiceDurationTimer();
    voiceDurationTimer = window.setInterval(() => {
      state.voiceRecorder.durationMs = Date.now() - startedAt;
      render();
    }, 250);

    recorder.start();
    render();
  } catch (error) {
    const message = describeVoiceSupportIssue(error);
    resetVoiceRecorderState();
    state.voiceDraft = {
      status: 'failed',
      error: message,
      chatId: state.selectedChatId,
    };
    pushToast('Microphone unavailable', message, 'error');
    render();
  }
}

function stopVoiceRecording() {
  if (state.voiceRecorder?.status !== 'recording' || !state.voiceRecorder.recorder) {
    return;
  }

  clearVoiceDurationTimer();
  setVoiceRecorderStatus('recorded', {
    shouldCreateDraft: true,
  });
  try {
    state.voiceRecorder.recorder.stop();
  } catch (error) {
    teardownVoiceLifecycle({ preserveQueuedDraft: true, silent: true });
    state.voiceDraft = {
      status: 'failed',
      error: 'Recording could not be stopped cleanly. Please try again.',
      chatId: state.selectedChatId,
    };
  }
  render();
}

async function sendVoiceDraft(chatId) {
  if (!chatId || !state.voiceDraft) {
    return;
  }

  const chat = state.chats.find((item) => String(item.id) === String(chatId));
  if (requiresPrivateEncryption(chat)) {
    state.voiceDraft = {
      ...state.voiceDraft,
      status: 'failed',
      error: 'Voice notes are not end-to-end encrypted in private chats yet.',
    };
    pushToast('Encrypted chat only supports secure text for now', state.voiceDraft.error, 'info');
    render();
    return;
  }

  if (state.voiceDraft.chatId && String(state.voiceDraft.chatId) !== String(chatId)) {
    pushToast('Voice draft moved', 'This voice note belongs to a different chat context and was cleared.', 'info');
    discardVoiceDraft();
    return;
  }

  if (['sending', 'queued'].includes(state.voiceDraft.status)) {
    return;
  }

  if (!state.voiceDraft.file) {
    state.voiceDraft = {
      ...state.voiceDraft,
      status: 'failed',
      error: 'The recorded audio is no longer available. Please record it again.',
    };
    pushToast('Voice unavailable', state.voiceDraft.error, 'error');
    render();
    return;
  }

  const currentDraft = { ...state.voiceDraft };
  const clientMessageId = crypto.randomUUID();
  const queueEntry = {
    id: clientMessageId,
    localId: `local-${clientMessageId}`,
    clientMessageId,
    chatId,
    kind: 'voice',
    replyText: state.replyDraft?.text || '',
    createdAt: new Date().toISOString(),
    deliveryState: 'queued',
    fileBlob: currentDraft.file,
    payload: {
      chatId,
      clientMessageId,
      type: 'voice',
      text: '',
      mimeType: currentDraft.mimeType,
      fileName: currentDraft.fileName,
      fileSize: currentDraft.fileSize,
      duration: currentDraft.duration,
      replyToMessageId: state.replyDraft?.id || null,
    },
  };

  if (state.dataSource === 'demo') {
    const message = {
      id: `voice-${Date.now()}`,
      chatId,
      senderId: state.user.id,
      senderName: state.user.fullName,
      text: '',
      type: 'voice',
      mediaUrl: currentDraft.previewUrl,
      fileName: currentDraft.fileName,
      fileSize: currentDraft.fileSize,
      mimeType: currentDraft.mimeType,
      duration: currentDraft.duration,
      replyText: '',
      createdAt: new Date().toISOString(),
      editedAt: null,
      seenCount: 0,
      deliveryState: 'sent',
      mine: true,
    };
    state.messagesByChat[chatId] = [...(state.messagesByChat[chatId] || []), message];
    syncFilesHubFromMessage(message);
    const chat = state.chats.find((item) => item.id === chatId);
    if (chat) {
      chat.lastMessagePreview = 'Voice message';
      chat.lastMessageAt = message.createdAt;
    }
    state.replyDraft = null;
    discardVoiceDraft({ silent: true });
    pushToast('Voice message ready', 'The demo conversation now includes your recorded note.', 'success');
    render();
    return;
  }

  if (!state.offline.isOnline) {
    state.voiceDraft = {
      ...state.voiceDraft,
      status: 'queued',
    };
    queueEntry.previewUrl = createTrackedObjectUrl(currentDraft.blob || currentDraft.file);
    await queueOutboundMessage(queueEntry);
    state.replyDraft = null;
    discardVoiceDraft({ silent: true });
    pushToast('Voice queued', 'The voice message will upload automatically when the connection returns.', 'info');
    render();
    return;
  }

  try {
    state.isSubmitting = true;
    state.voiceDraft = {
      ...state.voiceDraft,
      status: 'sending',
      error: '',
    };
    render();
    const upload = await uploadChatMediaFile(currentDraft.file);
    const response = await apiFetch('/api/v1/messages', {
      method: 'POST',
      headers: {},
      body: JSON.stringify({
        chatId,
        clientMessageId,
        type: 'voice',
        text: '',
        mediaUrl: upload.data?.url,
        mimeType: upload.data?.mimeType || currentDraft.mimeType,
        fileName: upload.data?.fileName || currentDraft.fileName,
        fileSize: upload.data?.fileSize || currentDraft.fileSize,
        duration: currentDraft.duration,
        replyToMessageId: state.replyDraft?.id || null,
      }),
    });
    const message = normalizeMessage(response.data);
    const existingMessages = state.messagesByChat[chatId] || [];
    state.messagesByChat[chatId] = existingMessages.some((item) => item.id === message.id)
      ? existingMessages.map((item) => (item.id === message.id ? message : item))
      : [...existingMessages, message];
    syncFilesHubFromMessage(message);
    const chat = state.chats.find((item) => item.id === chatId);
    if (chat) {
      chat.lastMessagePreview = 'Voice message';
      chat.lastMessageAt = message.createdAt;
    }
    discardVoiceDraft({ silent: true });
    state.replyDraft = null;
    await persistChatMessagesCache(chatId);
    await persistWorkspaceCache();
    pushToast('Voice sent', 'Your voice message is now part of the conversation.', 'success');
  } catch (error) {
    if (!error.status) {
      state.voiceDraft = {
        ...state.voiceDraft,
        status: 'queued',
        error: '',
      };
      queueEntry.previewUrl = createTrackedObjectUrl(currentDraft.blob || currentDraft.file);
      await queueOutboundMessage(queueEntry);
      state.replyDraft = null;
      discardVoiceDraft({ silent: true });
      pushToast('Voice queued', 'The network dropped, so the voice note was queued locally.', 'info');
    } else {
      state.voiceDraft = {
        ...state.voiceDraft,
        status: 'failed',
        error: error.message,
      };
      pushToast('Voice send failed', error.message, 'error');
    }
  } finally {
    state.isSubmitting = false;
    render();
  }
}

function render() {
  if (state.isLoading) {
    appRoot.innerHTML = renderLoading();
    return;
  }

  if (state.screen === 'auth') {
    appRoot.innerHTML = renderAuth();
  } else {
    appRoot.innerHTML = renderWorkspace();
  }
}

function renderLoading() {
  return `
    <div class="loading-shell">
      <div class="loading-workspace">
        <div class="loading-rail skeleton-card">
          <div class="skeleton skeleton-pill"></div>
          <div class="skeleton skeleton-avatar"></div>
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line short"></div>
          <div class="skeleton-nav">
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line"></div>
          </div>
        </div>
        <div class="loading-list skeleton-card">
          <div class="skeleton skeleton-pill wide"></div>
          <div class="skeleton-list">
            ${Array.from({ length: 6 }, () => `
              <div class="skeleton-row">
                <div class="skeleton skeleton-avatar small"></div>
                <div class="skeleton-copy">
                  <div class="skeleton skeleton-line"></div>
                  <div class="skeleton skeleton-line short"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="loading-chat skeleton-card">
          <div class="skeleton skeleton-pill wide"></div>
          <div class="skeleton-messages">
            ${Array.from({ length: 5 }, (_, index) => `
              <div class="skeleton-message ${index % 2 ? 'mine' : ''}">
                <div class="skeleton skeleton-bubble ${index % 2 ? 'wide' : ''}"></div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="loading-info skeleton-card">
          <div class="skeleton skeleton-pill"></div>
          <div class="skeleton skeleton-avatar"></div>
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line short"></div>
          <div class="skeleton skeleton-line short"></div>
        </div>
      </div>
      ${renderToasts()}
    </div>
  `;
}

function renderAuth() {
  return `
    <div class="app-shell auth-shell">
      <section class="brand-panel">
        <div class="brand-mark">
          <span class="brand-dot"></span>
          <span>PulseChat</span>
        </div>
        <div class="hero-copy">
          <div class="eyebrow">Messaging Workspace</div>
          <h1>Chat UI that feels ready to ship.</h1>
          <p>
            The frontend now lives inside this backend project, with a polished multi-screen interface for auth,
            chats, contacts, requests, groups, profile, notifications, and privacy settings.
          </p>
        </div>
        <div class="hero-grid">
          <div class="spotlight-card">
            <strong>Live auth ready</strong>
            <span>Login and register forms use your real <code>/api/v1/auth</code> endpoints when the backend is running.</span>
          </div>
          <div class="spotlight-card">
            <strong>Demo workspace</strong>
            <span>Preview the whole dashboard immediately, even before seeding chats and contacts.</span>
          </div>
          <div class="spotlight-card">
            <strong>Single repo</strong>
            <span>No extra frontend toolchain needed. Express serves the UI directly from this project.</span>
          </div>
        </div>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          <div class="auth-toggle" role="tablist" aria-label="Auth views">
            ${authToggleButton('login', 'Login')}
            ${authToggleButton('register', 'Register')}
            ${authToggleButton('forgot', 'Reset')}
          </div>
          <h2>${state.authView === 'register' ? 'Create your account' : state.authView === 'forgot' ? 'Reset your password' : 'Welcome back'}</h2>
          <p>${renderAuthDescription()}</p>
          ${renderAuthForm()}
          <div class="helper-text">
            Want to see the product shell first? You can open the full interface with seeded sample data.
          </div>
          <div class="button-row" style="margin-top: 16px;">
            <button class="secondary-button" type="button" data-action="open-demo">Explore Demo Workspace</button>
            <a class="ghost-button" href="/api/docs" target="_blank" rel="noreferrer">Open API Docs</a>
          </div>
        </div>
      </section>
      ${renderToasts()}
    </div>
  `;
}

function authToggleButton(view, label) {
  return `
    <button
      type="button"
      data-action="switch-auth"
      data-view="${view}"
      class="${state.authView === view ? 'is-active' : ''}"
    >${label}</button>
  `;
}

function renderAuthDescription() {
  if (state.authView === 'register') {
    return 'Create a real account against your backend, or use the demo workspace while the database is still empty.';
  }

  if (state.authView === 'forgot') {
    return 'Request a reset token through the real forgot-password endpoint. In development, the token comes back in the API response.';
  }

  return 'Sign in with your API credentials. If you have not created a user yet, register first or jump into the demo workspace.';
}

function renderAuthForm() {
  if (state.authView === 'register') {
    return `
      <form id="register-form" class="form-stack">
        <div class="field">
          <label for="register-fullName">Full name</label>
          <input id="register-fullName" name="fullName" placeholder="Ahmed Helal" required />
        </div>
        <div class="inline-fields">
          <div class="field">
            <label for="register-username">Username</label>
            <input id="register-username" name="username" placeholder="ahelal" required />
          </div>
          <div class="field">
            <label for="register-email">Email</label>
            <input id="register-email" name="email" type="email" placeholder="ahmed@example.com" required />
          </div>
        </div>
        <div class="field">
          <label for="register-password">Password</label>
          <input id="register-password" name="password" type="password" minlength="8" placeholder="Minimum 8 characters" required />
        </div>
        <button class="primary-button" type="submit">Create account</button>
      </form>
    `;
  }

  if (state.authView === 'forgot') {
    return `
      <form id="forgot-form" class="form-stack">
        <div class="field">
          <label for="forgot-email">Email</label>
          <input id="forgot-email" name="email" type="email" placeholder="ahmed@example.com" required />
        </div>
        <button class="primary-button" type="submit">Send reset request</button>
      </form>
    `;
  }

  return `
    <form id="login-form" class="form-stack">
      <div class="field">
        <label for="login-email">Email</label>
        <input id="login-email" name="email" type="email" placeholder="ahmed@example.com" required />
      </div>
      <div class="field">
        <label for="login-password">Password</label>
        <input id="login-password" name="password" type="password" placeholder="Your password" required />
      </div>
      <button class="primary-button" type="submit">Login</button>
    </form>
  `;
}

function renderWorkspace() {
  const unreadCount = state.unreadNotificationCount;
  const pendingCount = state.requests.incoming.length + state.requests.outgoing.length;
  const selectedChat = getSelectedChat();
  const sectionMeta = getSectionMeta();
  const compactChatView = state.activeSection === 'chats' && !state.mobileChatListVisible;

  return `
    <div class="app-shell workspace-shell">
      <header class="workspace-topbar">
        <div class="topbar-left">
          <div class="brand-mark workspace-brand-mark">
            <span class="brand-dot"></span>
            <span>PulseChat</span>
          </div>
          <div class="workspace-title-block">
            <strong>${sectionMeta.title}</strong>
            <span>${sectionMeta.subtitle}</span>
          </div>
          <div class="mode-pill compact ${state.dataSource === 'api' ? '' : 'warning'}">
            <span>${state.dataSource === 'api' ? 'Live' : 'Demo'}</span>
          </div>
          ${state.dataSource === 'api'
            ? `<div class="status-pill neutral compact"><span>${state.liveConnectionState === 'connected' ? 'Realtime connected' : state.liveConnectionState === 'connecting' ? 'Connecting realtime' : 'Realtime paused'}</span></div>`
            : ''}
        </div>
        <div class="topbar-right">
          ${canToggleDetailsRail()
            ? `<button class="ghost-button" type="button" data-action="toggle-details">${shouldShowDetailRail() ? 'Hide details' : 'Details'}</button>`
            : ''}
          <button class="ghost-button" type="button" data-action="toggle-theme">${state.theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
          <a class="ghost-button" href="/api/docs" target="_blank" rel="noreferrer">API docs</a>
          <button class="ghost-button" type="button" data-action="logout">Log out</button>
        </div>
      </header>
      ${renderConnectionBanner()}
      <div class="workspace-grid workspace-grid-quad workspace-grid-triple ${compactChatView ? 'show-chat-detail' : 'show-chat-list'}">
        <aside class="sidebar side-panel">
          <div class="sidebar-brand">
            <div class="brand-mark compact">
              <span class="brand-dot"></span>
              <span>PulseChat</span>
            </div>
            <p>${state.dataSource === 'api' ? 'Realtime workspace' : 'Preview workspace'}</p>
          </div>
          <div class="nav-stack">
            ${renderNavButton('chats', 'Chats', state.chats.length)}
            ${renderNavButton('files', 'Files', state.filesHub.items.length)}
            ${renderNavButton('contacts', 'Contacts', state.contacts.length)}
            ${renderNavButton('requests', 'Requests', pendingCount)}
            ${renderNavButton('groups', 'Groups', state.groups.length)}
            ${renderNavButton('notifications', 'Notifications', unreadCount)}
            ${state.user?.role === 'admin' ? renderNavButton('admin', 'Admin') : ''}
            ${renderNavButton('profile', 'Profile')}
            ${renderNavButton('settings', 'Settings')}
          </div>
          <button class="profile-card sidebar-account-card" type="button" data-action="switch-section" data-section="profile">
            <div class="row-head">
              ${renderAvatar(state.user?.fullName || 'You', state.user?.profileImage)}
              <div class="row-body" style="flex: 1;">
                <h3 class="row-title">${escapeHtml(state.user?.fullName || 'Guest')}</h3>
                <p class="row-subtitle">@${escapeHtml(state.user?.username || 'demo')}</p>
              </div>
              <span class="mini-pill">${escapeHtml(state.user?.role || 'user')}</span>
            </div>
            <div class="sidebar-account-meta">
              <span class="caption">${state.user?.isOnline ? 'Online now' : 'Workspace available'}</span>
              <span class="caption">${state.offline.pendingCount ? `${state.offline.pendingCount} queued` : 'Open profile'}</span>
            </div>
          </button>
        </aside>
        <section class="chat-list side-panel">
          <div class="panel-header compact workspace-list-header">
            <div class="workspace-list-title">
              <span class="eyebrow workspace-eyebrow">${sectionMeta.eyebrow}</span>
              <h2>${sectionMeta.sidebarTitle}</h2>
            </div>
            ${state.activeSection === 'chats'
              ? `
                <div class="segmented-control compact">
                  ${['all', 'unread', 'pinned'].map((filter) => `
                    <button
                      type="button"
                      class="${state.chatListFilter === filter ? 'is-active' : ''}"
                      data-action="set-chat-filter"
                      data-filter="${filter}"
                    >${capitalize(filter)}</button>
                  `).join('')}
                </div>
              `
              : ''}
          </div>
          <div class="workspace-search">
            <input
              class="workspace-search-input"
              type="search"
              data-role="workspace-search"
              value="${escapeAttribute(state.workspaceQuery)}"
              placeholder="${escapeAttribute(sectionMeta.searchPlaceholder)}"
            />
          </div>
          ${renderSidebarContent(selectedChat)}
        </section>
        <main class="chat-window main-panel">
          ${renderMainPanel()}
        </main>
      </div>
      ${renderDetailsDrawer()}
      ${renderMobileDock(unreadCount, pendingCount)}
      ${renderModal()}
      ${renderToasts()}
    </div>
  `;
}

function renderConnectionBanner() {
  if (state.dataSource === 'demo') {
    return '';
  }

  if (state.offline.isOnline && !state.offline.usingCachedWorkspace && !state.offline.pendingCount && !state.offline.isSyncing) {
    return '';
  }

  const tone = !state.offline.isOnline ? 'warning' : state.offline.pendingCount ? 'info' : 'success';
  const message = !state.offline.isOnline
    ? 'You are offline. Recent conversations stay available and new messages will queue locally.'
    : state.offline.isSyncing
      ? 'Connection restored. Queued messages are syncing now.'
      : state.offline.pendingCount
        ? `${state.offline.pendingCount} queued message${state.offline.pendingCount === 1 ? '' : 's'} waiting to sync.`
        : 'You are back online and the workspace is fully synced.';

  return `
    <div class="connection-banner ${tone}">
      <strong>${!state.offline.isOnline ? 'Offline' : 'Syncing'}</strong>
      <span>${message}</span>
    </div>
  `;
}

function renderNavButton(section, label, count = 0) {
  return `
    <button
      type="button"
      class="section-button ${state.activeSection === section ? 'is-active' : ''}"
      data-action="switch-section"
      data-section="${section}"
    >
      <div class="row-body">
        <strong>${label}</strong>
      </div>
      ${count ? `<span class="count-badge ${section === 'notifications' ? 'blue' : ''}">${count}</span>` : ''}
    </button>
  `;
}

function renderMobileDock(unreadCount, pendingCount) {
  const items = [
    ['chats', 'Chats', state.chats.length],
    ['files', 'Files', state.filesHub.items.length],
    ['contacts', 'Contacts', state.contacts.length],
    ['notifications', 'Alerts', unreadCount],
  ];

  return `
    <nav class="mobile-dock" aria-label="Mobile navigation">
      ${items.map(([section, label, count]) => `
        <button
          type="button"
          class="mobile-dock-item ${state.activeSection === section ? 'is-active' : ''}"
          data-action="switch-section"
          data-section="${section}"
        >
          <span>${label}</span>
          ${count ? `<span class="count-badge ${section === 'notifications' ? 'blue' : ''}">${count}</span>` : ''}
        </button>
      `).join('')}
    </nav>
  `;
}

function navHint(section) {
  const map = {
    chats: 'Recent conversations',
    files: 'Shared media and docs',
    contacts: 'People you can reach',
    requests: 'Incoming and outgoing',
    groups: 'Rooms and membership',
    notifications: 'Realtime updates',
    admin: 'Platform overview',
    profile: 'Identity and bio',
    settings: 'Privacy and app rules',
  };
  return map[section] || '';
}

function renderSidebarContent(selectedChat) {
  if (state.isLoading) {
    return renderListSkeleton(5);
  }

  const query = state.workspaceQuery.trim().toLowerCase();

  if (state.activeSection === 'files') {
    const items = state.filesHub.items.filter((item) => {
      if (!query) {
        return true;
      }
      return [item.fileName, item.sourceTitle, item.senderName, item.type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    }).slice(0, 8);

    return `
      <div class="list-stack">
        <div class="title-row">
          <strong>Recent files</strong>
          <span class="mini-pill">${items.length}</span>
        </div>
        ${items.length
          ? items.map(renderMiniFileCard).join('')
          : '<div class="mini-card"><span class="muted-text">No file matches your search.</span></div>'}
      </div>
    `;
  }

  if (state.activeSection === 'contacts') {
    const favorites = state.contacts.filter((item) => {
      if (!item.isFavorite) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [item.fullName, item.username, item.statusMessage]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
    return `
      <div class="list-stack">
        <div class="title-row">
          <strong>Favorites</strong>
          <span class="mini-pill">${favorites.length}</span>
        </div>
        ${favorites.length
          ? favorites.map((contact) => renderMiniPersonCard(contact, 'select-contact')).join('')
          : '<div class="mini-card"><span class="muted-text">No favorites yet.</span></div>'}
      </div>
    `;
  }

  if (state.activeSection === 'requests') {
    const items = (state.requests[state.requestTab] || []).filter((item) => {
      if (!query) {
        return true;
      }
      return [item.counterpart?.fullName, item.counterpart?.username]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });

    return `
      <div class="list-stack">
        <div class="title-row">
          <strong>${state.requestTab === 'incoming' ? 'Incoming' : 'Outgoing'}</strong>
          <span class="mini-pill">${items.length}</span>
        </div>
        ${items.length
          ? items.map((item) => renderMiniPersonCard(item.counterpart, 'select-contact')).join('')
          : '<div class="mini-card"><span class="muted-text">No requests match your search.</span></div>'}
      </div>
    `;
  }

  if (state.activeSection === 'groups') {
    const groups = state.groups.filter((group) => {
      if (!query) {
        return true;
      }
      return [group.name, group.description, group.inviteCode]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
    return `
      <div class="list-stack">
        <div class="title-row">
          <strong>Groups</strong>
          <span class="mini-pill">${groups.length}</span>
        </div>
        ${groups.length
          ? groups.map((group) => renderMiniGroupCard(group)).join('')
          : '<div class="mini-card"><span class="muted-text">No groups match your search.</span></div>'}
      </div>
    `;
  }

  if (state.activeSection === 'notifications') {
    const unread = state.notifications.filter((item) => {
      if (item.isRead) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [item.title, item.body]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
    return `
      <div class="list-stack">
        <div class="title-row">
          <strong>Unread now</strong>
          <span class="mini-pill">${unread.length}</span>
        </div>
        ${unread.length
          ? unread.slice(0, 3).map((item) => renderMiniNotification(item)).join('')
          : '<div class="mini-card"><span class="muted-text">Everything is caught up.</span></div>'}
      </div>
    `;
  }

  const chats = getVisibleSidebarChats();
  return `
    <div class="list-stack conversation-stack">
      <div class="title-row compact">
        <strong>${state.chatListFilter === 'all' ? 'Recent chats' : capitalize(state.chatListFilter)}</strong>
        <span class="mini-pill">${chats.length}</span>
      </div>
      ${chats.length
        ? chats.map((chat) => renderChatRow(chat, chat.id === selectedChat?.id)).join('')
        : '<div class="empty-card compact empty-inline"><h3>No chats found</h3><p>Try another search or filter to surface the right conversation.</p></div>'}
    </div>
  `;
}

function renderListSkeleton(count = 4) {
  return `
    <div class="list-stack">
      ${Array.from({ length: count }, () => `
        <div class="mini-card skeleton-row-card">
          <div class="skeleton skeleton-avatar small"></div>
          <div class="skeleton-copy">
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line short"></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderMiniPersonCard(contact, action) {
  return `
    <button class="mini-card" type="button" data-action="${action}" data-contact-id="${contact.id}">
      <div class="row-head">
        ${renderAvatar(contact.fullName, contact.profileImage, 'small')}
        <div class="row-body" style="flex: 1;">
          <strong>${escapeHtml(contact.fullName)}</strong>
          <span class="caption">@${escapeHtml(contact.username)}</span>
        </div>
      </div>
    </button>
  `;
}

function renderMiniGroupCard(group) {
  return `
    <button class="mini-card" type="button" data-action="select-group" data-group-id="${group.id}">
      <div class="row-head">
        ${renderAvatar(group.name, group.image, 'small')}
        <div class="row-body" style="flex: 1;">
          <strong>${escapeHtml(group.name)}</strong>
          <span class="caption">${group.memberCount || group.members?.length || 0} members</span>
        </div>
      </div>
    </button>
  `;
}

function renderMiniNotification(item) {
  return `
    <div class="mini-card">
      <strong>${escapeHtml(item.title)}</strong>
      <div class="caption">${escapeHtml(item.body)}</div>
    </div>
  `;
}

function renderMiniFileCard(item) {
  return `
    <button class="mini-card" type="button" data-action="open-file-chat" data-chat-id="${item.chatId}">
      <div class="row-head">
        <div class="avatar-shell small">${fileTypeIcon(item.type)}</div>
        <div class="row-body" style="flex: 1;">
          <strong>${escapeHtml(item.fileName)}</strong>
          <span class="caption">${escapeHtml(item.sourceTitle || 'Conversation')}</span>
        </div>
      </div>
    </button>
  `;
}

function renderChatRow(chat, isActive) {
  const preview = getChatPreviewText(chat);

  return `
    <button
      type="button"
      class="chat-row ${isActive ? 'is-active' : ''}"
      data-action="select-chat"
      data-chat-id="${chat.id}"
    >
      <div class="chat-row-main">
        ${renderAvatar(chat.title, chat.avatarImage)}
        <div class="row-body chat-row-copy" style="flex: 1;">
          <div class="split-row chat-row-top">
            <strong>${escapeHtml(chat.title)}</strong>
            <span class="caption">${relativeTime(chat.lastMessageAt)}</span>
          </div>
          <div class="chat-row-bottom">
            <span class="row-subtitle chat-preview ${preview.isTyping ? 'is-typing-text' : ''}">${escapeHtml(preview.text)}</span>
            <div class="chat-row-indicators">
              ${chat.pinned ? '<span class="mini-pill subtle">Pinned</span>' : ''}
              ${chat.muted ? '<span class="mini-pill subtle">Muted</span>' : ''}
              ${chat.unreadCount ? `<span class="count-badge">${chat.unreadCount}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
      <div class="chat-row-meta">
        <span class="mini-pill subtle">${chat.type === 'private' ? 'Direct' : 'Group'}</span>
      </div>
    </button>
  `;
}

function getChatPreviewText(chat) {
  const typingText = state.typingByChat[chat.id];
  if (typingText) {
    return {
      text: typingText,
      isTyping: true,
    };
  }

  const latestMessage = (state.messagesByChat[chat.id] || []).slice(-1)[0];
  const latestText = latestMessage ? getMessagePreviewText(latestMessage) : '';
  if (latestMessage?.mine && latestText) {
    return {
      text: `You: ${latestText}`,
      isTyping: false,
    };
  }

  return {
    text: chat.lastMessagePreview || 'No messages yet',
    isTyping: false,
  };
}

function renderMainPanel() {
  switch (state.activeSection) {
    case 'files':
      return renderFilesPanel();
    case 'contacts':
      return renderContactsPanel();
    case 'requests':
      return renderRequestsPanel();
    case 'groups':
      return renderGroupsPanel();
    case 'notifications':
      return renderNotificationsPanel();
    case 'admin':
      return renderAdminPanel();
    case 'profile':
      return renderProfilePanel();
    case 'settings':
      return renderSettingsPanel();
    case 'chats':
    default:
      return renderChatsPanel();
  }
}

function renderFilesPanel() {
  const filteredItems = getFilteredFilesHubItems();
  const senderOptions = Array.from(
    new Map(filteredItems.map((item) => [item.senderId, item.senderName])).entries(),
  );

  return `
    <div class="panel-header">
      <div>
        <h2>Shared files hub</h2>
        <p>Browse documents, voice notes, and media across your conversations without leaving the workspace.</p>
      </div>
      <div class="segmented-control">
        ${['all', 'image', 'video', 'audio', 'document', 'other'].map((kind) => `
          <button
            type="button"
            class="${state.filesHub.filters.kind === kind ? 'is-active' : ''}"
            data-action="set-files-kind"
            data-kind="${kind}"
          >${capitalize(kind)}</button>
        `).join('')}
      </div>
    </div>
    <div class="files-toolbar">
      <label class="field-group">
        <span>Search</span>
        <input type="search" value="${escapeAttribute(state.filesHub.filters.q)}" placeholder="Filename or type" data-action="noop" data-role="files-search" />
      </label>
      <label class="field-group">
        <span>Conversation</span>
        <select data-role="files-chat-filter">
          <option value="">All chats</option>
          ${state.chats.map((chat) => `<option value="${chat.id}" ${state.filesHub.filters.chatId === chat.id ? 'selected' : ''}>${escapeHtml(chat.title)}</option>`).join('')}
        </select>
      </label>
      <label class="field-group">
        <span>Sender</span>
        <select data-role="files-sender-filter">
          <option value="">Anyone</option>
          ${senderOptions.map(([id, name]) => `<option value="${id}" ${state.filesHub.filters.senderId === id ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
        </select>
      </label>
      <label class="field-group">
        <span>From</span>
        <input type="date" value="${escapeAttribute(state.filesHub.filters.from)}" data-role="files-date-filter" />
      </label>
      <div class="files-toolbar-actions">
        <button class="ghost-button" type="button" data-action="apply-files-filters">Apply</button>
        <button class="ghost-button" type="button" data-action="reset-files-filters">Reset</button>
      </div>
    </div>
    ${state.filesHub.isLoading
      ? renderFilesHubSkeleton()
      : state.filesHub.error
        ? `<div class="empty-card"><h3>Files unavailable</h3><p>${escapeHtml(state.filesHub.error)}</p><button class="primary-button" type="button" data-action="apply-files-filters">Retry</button></div>`
        : filteredItems.length
          ? `<div class="files-grid">${filteredItems.map(renderFileCard).join('')}</div>`
          : '<div class="empty-card"><h3>No shared files yet</h3><p>Voice notes, uploads, and media will collect here once they are sent.</p></div>'}
  `;
}

function renderChatsPanel() {
  const selectedChat = getSelectedChat();
  const messages = selectedChat ? state.messagesByChat[selectedChat.id] || [] : [];
  const typingText = selectedChat ? state.typingByChat[selectedChat.id] : '';
  const e2eeActive = isE2EEActiveForChat(selectedChat);
  const voiceState = getActiveVoiceState();

  if (!selectedChat) {
    return `
      <div class="empty-card">
        <h3>No chat selected</h3>
        <p>Once your conversation list is populated, this area becomes the live messaging workspace.</p>
      </div>
    `;
  }

  return `
    <section class="chat-layout chat-layout-focused">
      <div class="chat-header">
        <div class="row-head">
          ${isMobileViewport() ? '<button class="ghost-button icon-button mobile-chat-back" type="button" data-action="open-chat-list" title="Back to chats">←</button>' : ''}
          ${renderAvatar(selectedChat.title, selectedChat.avatarImage, 'large')}
          <div class="row-body">
            <h3 class="chat-title">${escapeHtml(selectedChat.title)}</h3>
            <span class="row-subtitle">${escapeHtml(
              e2eeActive
                ? `Encrypted private chat${selectedChat.partnerStatus ? ` • ${selectedChat.partnerStatus}` : ''}`
                : selectedChat.subtitle || selectedChat.partnerStatus || '',
            )}</span>
          </div>
        </div>
        <div class="chat-header-actions">
          ${canToggleDetailsRail() ? `<button class="ghost-button" type="button" data-action="toggle-details">${shouldShowDetailRail() ? 'Hide details' : 'View details'}</button>` : ''}
          <button class="ghost-button icon-button" type="button" data-action="composer-emoji" title="Emoji">☺</button>
          <button class="ghost-button icon-button" type="button" data-action="composer-attach" title="Attach">+</button>
        </div>
      </div>
      <div class="messages-stream">
        ${messages.length
          ? messages.map(renderMessage).join('')
          : '<div class="empty-card"><h3>No chats yet</h3><p>Start the first message to create a conversation timeline for this workspace.</p><button class="primary-button" type="button" data-action="focus-composer">Start typing</button></div>'}
      </div>
      ${typingText ? renderTypingIndicator(typingText) : ''}
      <div class="composer-card">
        <form id="message-form">
          <input type="hidden" name="chatId" value="${selectedChat.id}" />
          ${state.replyDraft
            ? `
              <div class="reply-chip reply-draft">
                <span>Replying to: ${escapeHtml(state.replyDraft.text || 'Attachment')}</span>
                <button class="ghost-button" type="button" data-action="cancel-reply" style="padding: 8px 10px;">Cancel</button>
              </div>
            `
            : ''}
          ${renderVoiceDraftPreview()}
          <div class="composer-shell">
            <button class="ghost-button icon-button" type="button" data-action="composer-emoji" title="Open emoji picker">☺</button>
            <label class="sr-only" for="message-text">Message</label>
            <textarea id="message-text" class="composer-input" name="text" placeholder="Message ${escapeAttribute(selectedChat.title)}" rows="3"></textarea>
            <button class="ghost-button icon-button" type="button" data-action="composer-attach" title="Add attachment">+</button>
            <button
              class="ghost-button icon-button ${voiceState === 'recording' ? 'is-recording' : ''} ${voiceState === 'unsupported' ? 'is-disabled' : ''}"
              type="button"
              data-action="toggle-recording"
              title="${voiceState === 'recording' ? 'Stop recording' : voiceState === 'unsupported' ? 'Voice recording unavailable' : 'Record voice note'}"
              ${voiceState === 'unsupported' ? 'disabled' : ''}
            >${voiceState === 'recording' ? '■' : '🎙'}</button>
          </div>
          <div class="composer-actions composer-footer">
            <div class="composer-context">
              <span class="caption">${getComposerStatusText(voiceState)}</span>
              ${state.offline.pendingCount ? `<span class="mini-pill subtle">${state.offline.pendingCount} queued</span>` : ''}
            </div>
            <button class="primary-button" type="submit" ${voiceState === 'recording' || voiceState === 'requesting_permission' || voiceState === 'sending' || state.isSubmitting ? 'disabled' : ''}>Send message</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderVoiceDraftPreview() {
  if (state.voiceRecorder.status === 'unsupported') {
    return `
      <div class="voice-draft-card is-warning">
        <div class="voice-draft-copy">
          <strong>Voice recording unavailable</strong>
          <span class="caption">${escapeHtml(state.voiceRecorder.error || 'This browser does not currently support microphone recording.')}</span>
        </div>
      </div>
    `;
  }

  if (state.voiceRecorder.status === 'requesting_permission') {
    return `
      <div class="voice-draft-card">
        <div class="voice-draft-copy">
          <strong>Requesting microphone permission</strong>
          <span class="caption">Allow microphone access in the browser prompt to start recording.</span>
        </div>
      </div>
    `;
  }

  if (state.voiceRecorder.status === 'recording') {
    return `
      <div class="voice-draft-card is-recording">
        <div class="voice-draft-copy">
          <span class="recording-indicator"></span>
          <strong>Recording voice note</strong>
          <span class="caption">${formatDuration(Math.ceil(state.voiceRecorder.durationMs / 1000))}</span>
        </div>
        <div class="request-actions">
          <button class="ghost-button" type="button" data-action="toggle-recording">Stop</button>
        </div>
      </div>
    `;
  }

  if (!state.voiceDraft) {
    return '';
  }

  return `
    <div class="voice-draft-card ${state.voiceDraft.status === 'failed' ? 'is-error' : state.voiceDraft.status === 'queued' ? 'is-warning' : ''}">
      <div class="voice-draft-copy">
        <strong>${state.voiceDraft.status === 'failed' ? 'Voice note failed' : state.voiceDraft.status === 'queued' ? 'Voice note queued' : state.voiceDraft.status === 'sending' ? 'Sending voice note' : 'Voice note ready'}</strong>
        <span class="caption">${formatDuration(state.voiceDraft.duration || 0)} • ${formatFileSize(state.voiceDraft.fileSize || 0)}${state.voiceDraft.error ? ` • ${escapeHtml(state.voiceDraft.error)}` : ''}</span>
      </div>
      ${state.voiceDraft.previewUrl
        ? `<audio class="voice-preview-player" controls preload="metadata" src="${escapeAttribute(state.voiceDraft.previewUrl)}"></audio>`
        : ''}
      <div class="request-actions">
        <button class="ghost-button" type="button" data-action="discard-voice">Discard</button>
        <button class="primary-button" type="button" data-action="send-voice" ${['sending', 'queued'].includes(state.voiceDraft.status) ? 'disabled' : ''}>${state.voiceDraft.status === 'failed' ? 'Retry send' : 'Send voice'}</button>
      </div>
    </div>
  `;
}

function renderTypingIndicator(text) {
  return `
    <div class="typing-indicator" aria-live="polite">
      <div class="typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <span>${escapeHtml(text)}</span>
    </div>
  `;
}

function getFilteredFilesHubItems() {
  const { kind, chatId, senderId, q, from } = state.filesHub.filters;
  return state.filesHub.items.filter((item) => {
    if (kind !== 'all' && item.type !== kind) {
      return false;
    }
    if (chatId && item.chatId !== chatId) {
      return false;
    }
    if (senderId && item.senderId !== senderId) {
      return false;
    }
    if (from && new Date(item.createdAt) < new Date(from)) {
      return false;
    }
    if (q && !`${item.fileName} ${item.type}`.toLowerCase().includes(q.toLowerCase())) {
      return false;
    }
    return true;
  });
}

function renderFilesHubSkeleton() {
  return `
    <div class="files-grid">
      ${Array.from({ length: 6 }, () => `
        <div class="skeleton-card">
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line short"></div>
          <div class="skeleton skeleton-bubble wide"></div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderFileCard(item) {
  const isImage = item.type === 'image';
  const isVideo = item.type === 'video';
  const isAudio = item.type === 'audio';

  return `
    <article class="file-card">
      <div class="file-card-preview ${isImage || isVideo ? 'has-media' : ''}">
        ${isImage
          ? `<img src="${escapeAttribute(item.mediaUrl)}" alt="${escapeAttribute(item.fileName)}" />`
          : isVideo
            ? `<video src="${escapeAttribute(item.mediaUrl)}" controls preload="metadata"></video>`
            : isAudio
              ? `<audio src="${escapeAttribute(item.mediaUrl)}" controls preload="metadata"></audio>`
              : `<div class="file-card-icon">${fileTypeIcon(item.type)}</div>`}
      </div>
      <div class="file-card-copy">
        <div class="split-row">
          <strong>${escapeHtml(item.fileName)}</strong>
          <span class="tag">${escapeHtml(item.type)}</span>
        </div>
        <p class="caption">${escapeHtml(item.sourceTitle || 'Conversation')} • ${escapeHtml(item.senderName)} • ${relativeTime(item.createdAt)}</p>
        <div class="tag-row">
          ${item.duration ? `<span class="tag">${formatDuration(item.duration)}</span>` : ''}
          ${item.fileSize ? `<span class="tag">${formatFileSize(item.fileSize)}</span>` : ''}
        </div>
      </div>
      <div class="request-actions">
        <a class="ghost-button" href="${escapeAttribute(item.mediaUrl)}" target="_blank" rel="noreferrer">Open</a>
        <button class="primary-button" type="button" data-action="open-file-chat" data-chat-id="${item.chatId}">Open in chat</button>
      </div>
    </article>
  `;
}

function fileTypeIcon(type) {
  const icons = {
    image: '◻',
    video: '▶',
    audio: '♪',
    document: '▤',
    other: '⬢',
  };

  return icons[type] || '⬢';
}

function renderMessage(message) {
  const isImage = isImageAttachment(message);
  const isVoice = message.type === 'voice';
  const isPending = ['queued', 'sending', 'failed'].includes(message.deliveryState);
  const visibleText = message.isEncrypted ? (message.decryptedText || getUndecryptableMessageLabel(message)) : message.text;
  const reactions = aggregateReactions(message.reactions || []);

  return `
    <article class="message-row ${message.mine ? 'mine' : ''}">
      ${message.mine ? '' : renderAvatar(message.senderName, '', 'small')}
      <div class="message-bubble ${message.mine ? 'sent' : 'received'} ${isPending ? `is-${message.deliveryState}` : ''}">
        ${message.replyText ? `<div class="reply-chip">${escapeHtml(message.replyText)}</div>` : ''}
        ${message.pinnedAt ? '<div class="reply-chip">Pinned message</div>' : ''}
        ${message.isEncrypted ? '<div class="reply-chip">End-to-end encrypted</div>' : ''}
        ${message.mine ? '' : `<strong>${escapeHtml(message.senderName)}</strong>`}
        ${visibleText ? `<p class="message-text">${escapeHtml(visibleText)}</p>` : ''}
        ${message.mediaUrl
          ? isVoice
            ? `
              <div class="message-voice-card">
                <div class="voice-badge-row">
                  <span class="tag">Voice</span>
                  <span class="caption">${formatDuration(message.duration || 0)}</span>
                </div>
                <audio class="voice-message-player" controls preload="metadata" src="${escapeAttribute(message.mediaUrl)}"></audio>
              </div>
            `
            : isImage
            ? `<a class="message-attachment-preview" href="${escapeAttribute(message.mediaUrl)}" target="_blank" rel="noreferrer"><img src="${escapeAttribute(message.mediaUrl)}" alt="${escapeAttribute(message.fileName || 'Attachment')}" /></a>`
            : `<a class="message-file-card" href="${escapeAttribute(message.mediaUrl)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(message.fileName || 'Attachment')}</strong><span class="caption">${escapeHtml(message.type || 'file')} • ${formatFileSize(message.fileSize || 0)}</span></a>`
          : ''}
        ${reactions.length
          ? `<div class="message-reactions">${reactions.map((item) => `<span class="reaction-chip">${escapeHtml(item.emoji)} ${item.count}</span>`).join('')}</div>`
          : ''}
        <div class="request-actions message-actions-row">
          <button class="chip-button compact" type="button" data-action="reply-message" data-message-id="${message.id}">Reply</button>
          <button class="chip-button compact" type="button" data-action="react-message" data-message-id="${message.id}">React</button>
          ${message.mine && message.type === 'text' && !message.isEncrypted
            ? `<button class="chip-button compact" type="button" data-action="edit-message" data-message-id="${message.id}">Edit</button>`
            : ''}
          <button class="chip-button compact" type="button" data-action="delete-message" data-message-id="${message.id}">Delete</button>
          ${message.deliveryState === 'failed'
            ? `<button class="chip-button compact" type="button" data-action="retry-message" data-message-id="${message.id}">Retry</button>`
            : ''}
        </div>
        <div class="message-meta">
          <span>${formatTime(message.createdAt)}</span>
          ${message.editedAt ? '<span>edited</span>' : ''}
          ${message.mine ? `<span class="message-status">${message.deliveryState === 'queued' ? 'Queued' : message.deliveryState === 'sending' ? 'Sending…' : message.deliveryState === 'failed' ? 'Failed' : message.seenCount ? `✓✓ seen by ${message.seenCount}` : '✓ sent'}</span>` : ''}
        </div>
      </div>
    </article>
  `;
}

function isImageAttachment(message) {
  const candidate = `${message.fileName || ''} ${message.mediaUrl || ''}`.toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', 'image/'].some((token) => candidate.includes(token));
}

function renderContactsPanel() {
  const contacts = state.contacts;
  const favoriteCount = contacts.filter((item) => item.isFavorite).length;

  return `
    <div class="panel-header">
      <div>
        <h2>Contacts</h2>
        <p>Keep high-signal people nearby, mark favorites, and jump into private conversations instantly.</p>
      </div>
      <div class="panel-actions">
        <div class="status-pill neutral">${favoriteCount} favorites</div>
        <div class="segmented-control">
          <button type="button" class="is-active">All</button>
          <button type="button" data-action="switch-section" data-section="requests">Requests</button>
        </div>
      </div>
    </div>
    <div class="cards-grid">
      ${contacts.length
        ? contacts.map((contact) => renderContactCard(contact)).join('')
        : '<div class="empty-card"><h3>No contacts yet</h3><p>Accepted requests will show up here when your backend data grows.</p></div>'}
    </div>
  `;
}

function renderContactCard(contact) {
  return `
    <div class="contact-card ${state.selectedContactId === contact.id ? 'is-active' : ''}">
      <div class="row-head">
        ${renderAvatar(contact.fullName, contact.profileImage)}
        <div class="row-body" style="flex: 1;">
          <strong>${escapeHtml(contact.fullName)}</strong>
          <span class="row-subtitle">@${escapeHtml(contact.username)}</span>
        </div>
        ${contact.isOnline ? '<span class="online-dot" aria-label="Online"></span>' : ''}
      </div>
      <div class="row-body">
        <span class="row-subtitle">${escapeHtml(contact.statusMessage || 'No status message yet')}</span>
        <span class="caption">${contact.isOnline ? 'Online now' : `Last seen ${relativeTime(contact.lastSeen)}`}</span>
      </div>
      <div class="contact-actions">
        <button class="ghost-button" type="button" data-action="select-contact" data-contact-id="${contact.id}">View</button>
        <button class="ghost-button" type="button" data-action="open-chat-with-contact" data-contact-id="${contact.id}">Open chat</button>
        <button class="chip-button" type="button" data-action="toggle-favorite" data-contact-id="${contact.id}">
          ${contact.isFavorite ? 'Unfavorite' : 'Favorite'}
        </button>
      </div>
    </div>
  `;
}

function renderRequestsPanel() {
  const items = state.requests[state.requestTab] || [];
  const heading = state.requestTab === 'incoming' ? 'Incoming requests' : 'Outgoing requests';

  return `
    <div class="panel-header">
      <div>
        <h2>Contact requests</h2>
        <p>Track every pending connection request and handle it without leaving the workspace.</p>
      </div>
      <div class="segmented-control">
        <button type="button" data-action="switch-request-tab" data-tab="incoming" class="${state.requestTab === 'incoming' ? 'is-active' : ''}">Incoming</button>
        <button type="button" data-action="switch-request-tab" data-tab="outgoing" class="${state.requestTab === 'outgoing' ? 'is-active' : ''}">Outgoing</button>
      </div>
    </div>
    <div class="title-row">
      <strong>${heading}</strong>
      <span class="mini-pill">${items.length}</span>
    </div>
    <div class="list-stack">
      ${items.length
        ? items.map((item) => renderRequestCard(item)).join('')
        : `<div class="empty-card"><h3>No ${state.requestTab} requests</h3><p>When requests arrive, they will appear here with the right actions for the current state.</p></div>`}
    </div>
  `;
}

function renderRequestCard(item) {
  return `
    <div class="request-card">
      <div class="row-head">
        ${renderAvatar(item.counterpart.fullName, item.counterpart.profileImage)}
        <div class="row-body" style="flex: 1;">
          <strong>${escapeHtml(item.counterpart.fullName)}</strong>
          <span class="row-subtitle">@${escapeHtml(item.counterpart.username)}</span>
        </div>
        <span class="caption">${relativeTime(item.createdAt)}</span>
      </div>
      <div class="request-actions">
        ${state.requestTab === 'incoming'
          ? `
            <button class="secondary-button" type="button" data-action="request-action" data-kind="accept" data-request-id="${item.id}">Accept</button>
            <button class="ghost-button" type="button" data-action="request-action" data-kind="reject" data-request-id="${item.id}">Reject</button>
          `
          : `<button class="ghost-button" type="button" data-action="request-action" data-kind="cancel" data-request-id="${item.id}">Cancel request</button>`}
      </div>
    </div>
  `;
}

function renderGroupsPanel() {
  const selectedGroup = getSelectedGroup();

  return `
    <div class="panel-header">
      <div>
        <h2>Groups</h2>
        <p>Create a new room, review permissions, and keep member management visible without burying it in modals.</p>
      </div>
      <div class="status-pill neutral">${state.groups.length} active groups</div>
    </div>
    <div class="cards-grid">
      ${state.groups.length
        ? state.groups.map((group) => renderGroupCard(group)).join('')
        : '<div class="empty-card"><h3>No groups yet</h3><p>Create one below and it will appear here immediately.</p></div>'}
    </div>
    <div class="divider"></div>
    <div class="cards-grid">
      <div class="profile-card">
        <strong>Create group</strong>
        <p class="helper-text">Use your contacts as the first member set. This works in demo mode and will also post to the live group endpoint when authenticated.</p>
        <form id="group-form" class="form-stack">
          <div class="field">
            <label for="group-name">Group name</label>
            <input id="group-name" name="name" placeholder="Product Launch Circle" required />
          </div>
          <div class="field">
            <label for="group-description">Description</label>
            <textarea id="group-description" name="description" placeholder="Short purpose for the group"></textarea>
          </div>
          <div class="field">
            <label for="group-members">Members</label>
            <select id="group-members" name="memberIds" multiple size="5">
              ${state.contacts.map((contact) => `<option value="${contact.id}">${escapeHtml(contact.fullName)}</option>`).join('')}
            </select>
          </div>
          <button class="primary-button" type="submit">Create group</button>
        </form>
      </div>
      <div class="profile-card">
        <strong>${selectedGroup ? escapeHtml(selectedGroup.name) : 'Group details'}</strong>
        ${selectedGroup
          ? `
            <p class="helper-text">${escapeHtml(selectedGroup.description || 'No description yet.')}</p>
            <div class="tag-row">
              <span class="tag">${selectedGroup.memberCount || selectedGroup.members?.length || 0} members</span>
              ${selectedGroup.onlyAdminsCanMessage ? '<span class="tag">Admins message only</span>' : '<span class="tag">Open messaging</span>'}
              ${selectedGroup.onlyAdminsCanAddMembers ? '<span class="tag">Admin invites</span>' : '<span class="tag">Members can invite</span>'}
              ${selectedGroup.currentUserRole ? `<span class="tag">Role: ${escapeHtml(selectedGroup.currentUserRole)}</span>` : ''}
            </div>
            <div class="member-strip" style="margin-top: 14px;">
              ${selectedGroup.members?.map((member) => `<span class="member-pill">${escapeHtml(member.fullName)} · ${member.role}</span>`).join('') || ''}
            </div>
          `
          : '<p class="helper-text">Select a group to inspect the current membership and permission state.</p>'}
      </div>
    </div>
  `;
}

function renderGroupCard(group) {
  return `
    <button
      type="button"
      class="group-card ${state.selectedGroupId === group.id ? 'is-active' : ''}"
      data-action="select-group"
      data-group-id="${group.id}"
    >
      <div class="row-head">
        ${renderAvatar(group.name, group.image)}
        <div class="row-body" style="flex: 1;">
          <strong>${escapeHtml(group.name)}</strong>
          <span class="row-subtitle">${escapeHtml(group.description || 'No description')}</span>
        </div>
        ${group.currentUserRole ? `<span class="count-badge blue">${escapeHtml(group.currentUserRole)}</span>` : ''}
      </div>
      <div class="row-meta">
        <span class="mini-pill">${group.memberCount || group.members?.length || 0} members</span>
        <span class="caption">Invite code: ${escapeHtml(group.inviteCode || 'n/a')}</span>
      </div>
      <div class="group-actions">
        <button class="ghost-button" type="button" data-action="open-group-invite" data-group-id="${group.id}">Invite</button>
      </div>
    </button>
  `;
}

function renderNotificationsPanel() {
  const unread = state.unreadNotificationCount;

  return `
    <div class="panel-header">
      <div>
        <h2>Notifications</h2>
        <p>Keep every alert, request, and message ping in one timeline with fast read-state controls.</p>
      </div>
      <div class="panel-actions">
        <div class="status-pill neutral">${unread} unread</div>
        <button class="ghost-button" type="button" data-action="mark-all-read">Mark all read</button>
      </div>
    </div>
    <div class="list-stack">
      ${state.notifications.length
        ? state.notifications.map((item) => renderNotificationCard(item)).join('')
        : '<div class="empty-card"><h3>No notifications yet</h3><p>When new messages and requests come in, they will land here.</p></div>'}
    </div>
  `;
}

function renderAdminPanel() {
  const summary = state.admin.summary;

  if (!summary) {
    return `
      <div class="empty-card">
        <h3>Admin dashboard unavailable</h3>
        <p>Once the live admin endpoint responds, system metrics and moderation-ready user data will appear here.</p>
      </div>
    `;
  }

  return `
    <div class="panel-header">
      <div>
        <h2>Admin dashboard</h2>
        <p>Review system health, moderation context, and recent registrations from one operational surface.</p>
      </div>
      <div class="status-pill neutral">${summary.totals.activeUsers} active now</div>
    </div>
    <div class="metrics-grid">
      <div class="metric-card"><span>Total users</span><strong>${summary.totals.users}</strong></div>
      <div class="metric-card"><span>Total chats</span><strong>${summary.totals.chats}</strong></div>
      <div class="metric-card"><span>Total groups</span><strong>${summary.totals.groups}</strong></div>
      <div class="metric-card"><span>Total messages</span><strong>${summary.totals.messages}</strong></div>
      <div class="metric-card"><span>Suspended users</span><strong>${summary.totals.suspendedUsers}</strong></div>
      <div class="metric-card"><span>Reports</span><strong>${summary.totals.reports}</strong></div>
    </div>
    <div class="profile-card">
      <strong>Message activity</strong>
      <div class="chart-bars" style="margin-top: 16px;">
        ${renderActivityBars(summary.dailyMessages)}
      </div>
    </div>
    <div class="cards-grid">
      <div class="profile-card">
        <strong>Recent registrations</strong>
        <div class="list-stack" style="margin-top: 16px;">
          ${summary.recentRegistrations.length
            ? summary.recentRegistrations.map((user) => `
              <div class="mini-card">
                <strong>${escapeHtml(user.fullName)}</strong>
                <div class="caption">@${escapeHtml(user.username)} · ${relativeTime(user.createdAt)}</div>
              </div>
            `).join('')
            : '<div class="mini-card"><span class="muted-text">No recent registrations found.</span></div>'}
        </div>
      </div>
      <div class="profile-card">
        <strong>Moderation queue</strong>
        <div class="list-stack" style="margin-top: 16px;">
          ${summary.moderationUsers.length
            ? summary.moderationUsers.slice(0, 8).map((user) => `
              <div class="mini-card">
                <strong>${escapeHtml(user.fullName)}</strong>
                <div class="caption">@${escapeHtml(user.username)} · ${user.isActive ? 'active' : 'suspended'} · ${user.isOnline ? 'online' : 'offline'}</div>
              </div>
            `).join('')
            : '<div class="mini-card"><span class="muted-text">No users available for moderation.</span></div>'}
        </div>
      </div>
    </div>
  `;
}

function renderActivityBars(items) {
  if (!items?.length) {
    return '<div class="empty-card compact"><p>No activity points yet.</p></div>';
  }

  const peak = Math.max(...items.map((item) => item.count), 1);
  return items.map((item) => `
    <div class="chart-bar-card">
      <span class="caption">${escapeHtml(item.date.slice(5))}</span>
      <div class="chart-bar-track">
        <div class="chart-bar-fill" style="height: ${Math.max(18, Math.round((item.count / peak) * 120))}px"></div>
      </div>
      <strong>${item.count}</strong>
    </div>
  `).join('');
}

function renderNotificationCard(item) {
  return `
    <div class="notification-card">
      <div class="row-head align-start">
        <div class="row-body" style="flex: 1;">
          <strong>${escapeHtml(item.title)}</strong>
          <span class="row-subtitle">${escapeHtml(item.body)}</span>
        </div>
        ${item.isRead ? '<span class="mini-pill">Read</span>' : '<span class="count-badge blue">New</span>'}
      </div>
      <div class="notification-actions">
        <span class="caption">${relativeTime(item.createdAt)}</span>
        ${item.isRead ? '' : `<button class="ghost-button" type="button" data-action="mark-read" data-notification-id="${item.id}">Mark read</button>`}
      </div>
    </div>
  `;
}

function renderProfilePanel() {
  const user = state.user || demoWorkspace.user;

  return `
    <div class="panel-header">
      <div>
        <h2>Profile</h2>
        <p>Edit the public-facing details that appear across chats, contacts, and group membership lists.</p>
      </div>
    </div>
    <div class="cards-grid">
      <div class="profile-card">
        <div class="row-head">
          ${renderAvatar(user.fullName, user.profileImage, 'large')}
          <div class="row-body">
            <strong>${escapeHtml(user.fullName)}</strong>
            <span class="row-subtitle">@${escapeHtml(user.username)}</span>
            <span class="caption">${escapeHtml(user.email || '')}</span>
          </div>
        </div>
        <div class="helper-text">
          Changes here use the real <code>/api/v1/users/me</code> endpoint when you are authenticated, or stay local while previewing in demo mode.
        </div>
      </div>
      <div class="profile-card">
        <form id="profile-form" class="form-stack">
          <div class="field">
            <label for="profile-fullName">Full name</label>
            <input id="profile-fullName" name="fullName" value="${escapeAttribute(user.fullName)}" required />
          </div>
          <div class="inline-fields">
            <div class="field">
              <label for="profile-location">Location</label>
              <input id="profile-location" name="location" value="${escapeAttribute(user.location || '')}" />
            </div>
            <div class="field">
              <label for="profile-statusMessage">Status</label>
              <input id="profile-statusMessage" name="statusMessage" value="${escapeAttribute(user.statusMessage || '')}" />
            </div>
          </div>
          <div class="field">
            <label for="profile-bio">Bio</label>
            <textarea id="profile-bio" name="bio">${escapeHtml(user.bio || '')}</textarea>
          </div>
          <button class="primary-button" type="submit">Save profile</button>
        </form>
      </div>
    </div>
  `;
}

function renderSettingsPanel() {
  const privacy = state.privacy || demoWorkspace.privacy;

  return `
    <div class="panel-header">
      <div>
        <h2>Privacy settings</h2>
        <p>Surface the same privacy controls your backend already supports, with sensible defaults and clear labels.</p>
      </div>
    </div>
    <div class="settings-grid">
      <div class="profile-card">
        <form id="privacy-form" class="form-stack">
          <div class="inline-fields">
            <div class="field">
              <label for="messagePermission">Who can message you</label>
              <select id="messagePermission" name="messagePermission">
                ${privacyOptions(['everyone', 'contacts'], privacy.messagePermission)}
              </select>
            </div>
            <div class="field">
              <label for="groupInvitePermission">Who can invite you to groups</label>
              <select id="groupInvitePermission" name="groupInvitePermission">
                ${privacyOptions(['everyone', 'contacts'], privacy.groupInvitePermission)}
              </select>
            </div>
          </div>
          <div class="inline-fields">
            <div class="field">
              <label for="profilePhotoVisibility">Profile photo visibility</label>
              <select id="profilePhotoVisibility" name="profilePhotoVisibility">
                ${privacyOptions(['everyone', 'contacts', 'nobody'], privacy.profilePhotoVisibility)}
              </select>
            </div>
            <div class="field">
              <label for="lastSeenVisibility">Last seen visibility</label>
              <select id="lastSeenVisibility" name="lastSeenVisibility">
                ${privacyOptions(['everyone', 'contacts', 'nobody'], privacy.lastSeenVisibility)}
              </select>
            </div>
          </div>
          <div class="inline-fields">
            <div class="field">
              <label for="onlineStatusVisibility">Online status visibility</label>
              <select id="onlineStatusVisibility" name="onlineStatusVisibility">
                ${privacyOptions(['everyone', 'contacts', 'nobody'], privacy.onlineStatusVisibility)}
              </select>
            </div>
            <div class="field">
              <label for="readReceiptsEnabled">Read receipts</label>
              <select id="readReceiptsEnabled" name="readReceiptsEnabled">
                ${privacyOptions(['true', 'false'], String(privacy.readReceiptsEnabled))}
              </select>
            </div>
          </div>
          <div class="field">
            <label for="typingIndicatorEnabled">Typing indicators</label>
            <select id="typingIndicatorEnabled" name="typingIndicatorEnabled">
              ${privacyOptions(['true', 'false'], String(privacy.typingIndicatorEnabled))}
            </select>
          </div>
          <button class="primary-button" type="submit">Save settings</button>
        </form>
      </div>
    </div>
  `;
}

function privacyOptions(values, selected) {
  return values
    .map((value) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${value}</option>`)
    .join('');
}

function renderDetailRail() {
  if (state.activeSection === 'contacts') {
    const contact = getSelectedContact();
    return `
      <div class="detail-panel">
        <div class="profile-card">
          <strong>Contact spotlight</strong>
          ${contact ? renderRailPerson(contact) : '<p class="helper-text">Choose a contact to inspect their details here.</p>'}
        </div>
        ${renderSummaryRail()}
      </div>
    `;
  }

  if (state.activeSection === 'files') {
    const recentFiles = state.filesHub.items.slice(0, 6);
    return `
      <div class="list-stack">
        <div class="title-row">
          <strong>Recent files</strong>
          <span class="mini-pill">${state.filesHub.items.length}</span>
        </div>
        ${recentFiles.length
          ? recentFiles.map(renderMiniFileCard).join('')
          : '<div class="mini-card"><span class="muted-text">No shared files yet.</span></div>'}
      </div>
    `;
  }

  if (state.activeSection === 'groups') {
    const group = getSelectedGroup();
    return `
      <div class="detail-panel">
        <div class="profile-card">
          <strong>Group context</strong>
          ${group ? renderRailGroup(group) : '<p class="helper-text">Select a group card to see invite and member details.</p>'}
        </div>
        ${renderSummaryRail()}
      </div>
    `;
  }

  if (state.activeSection === 'notifications') {
    return `
      <div class="detail-panel">
        <div class="profile-card">
          <strong>Notification health</strong>
          <div class="metrics-grid" style="grid-template-columns: 1fr;">
            <div class="metric-card"><span>Unread</span><strong>${state.unreadNotificationCount}</strong></div>
            <div class="metric-card"><span>Total</span><strong>${state.notifications.length}</strong></div>
          </div>
        </div>
        ${renderSummaryRail()}
      </div>
    `;
  }

  if (state.activeSection === 'admin') {
    return `
      <div class="detail-panel">
        <div class="profile-card">
          <strong>Admin context</strong>
          <p class="helper-text">This section is only visible to admin users and stays empty in demo mode or if the dashboard endpoint is unavailable.</p>
          <div class="tag-row">
            <span class="tag">${state.dataSource === 'api' ? 'Live admin data' : 'Demo mode'}</span>
            <span class="tag">${state.admin.summary ? 'Metrics loaded' : 'Waiting on dashboard'}</span>
          </div>
        </div>
        ${renderSummaryRail()}
      </div>
    `;
  }

  if (state.activeSection === 'profile' || state.activeSection === 'settings') {
    return `
      <div class="detail-panel">
        <div class="profile-card">
          <strong>Workspace health</strong>
          <p class="helper-text">This rail stays available for system-level context while you edit your identity and privacy data.</p>
          <div class="tag-row">
            <span class="tag">${state.dataSource === 'api' ? 'Saved against backend' : 'Local demo editing'}</span>
            <span class="tag">${state.user?.isOnline ? 'Currently online' : 'Currently away'}</span>
          </div>
        </div>
        ${renderSummaryRail()}
      </div>
    `;
  }

  const chat = getSelectedChat();
  return `
    <div class="detail-panel">
      <div class="detail-rail-header">
        <div>
          <strong>Details</strong>
          <span class="caption">Context for the active workspace item</span>
        </div>
        <button class="ghost-button" type="button" data-action="toggle-details">Hide</button>
      </div>
      <div class="profile-card">
        <strong>Conversation details</strong>
        ${chat ? renderRailChat(chat) : '<p class="helper-text">Select a chat to see participant details and activity summary.</p>'}
      </div>
      ${renderSummaryRail()}
    </div>
  `;
}

function renderDetailsDrawer() {
  if (!shouldShowDetailRail()) {
    return '';
  }

  return `
    <div class="details-drawer-overlay" data-action="close-details">
      <aside class="details-drawer" role="complementary" aria-label="Details panel">
        ${renderDetailRail()}
      </aside>
    </div>
  `;
}

function renderRailPerson(contact) {
  return `
    <div class="list-stack" style="margin-top: 16px;">
      <div class="row-head">
        ${renderAvatar(contact.fullName, contact.profileImage, 'large')}
        <div class="row-body">
          <strong>${escapeHtml(contact.fullName)}</strong>
          <span class="row-subtitle">@${escapeHtml(contact.username)}</span>
        </div>
      </div>
      <div class="tag-row">
        <span class="tag">${contact.isOnline ? 'Online' : 'Offline'}</span>
        ${contact.isFavorite ? '<span class="tag">Favorite</span>' : ''}
      </div>
      <p class="helper-text">${escapeHtml(contact.statusMessage || 'No status message available.')}</p>
    </div>
  `;
}

function renderRailGroup(group) {
  return `
    <div class="list-stack" style="margin-top: 16px;">
      <div class="row-head">
        ${renderAvatar(group.name, group.image, 'large')}
        <div class="row-body">
          <strong>${escapeHtml(group.name)}</strong>
          <span class="row-subtitle">${group.memberCount || group.members?.length || 0} members</span>
        </div>
      </div>
      <div class="tag-row">
        <span class="tag">Invite code ${escapeHtml(group.inviteCode || 'n/a')}</span>
      </div>
      <p class="helper-text">${escapeHtml(group.description || 'No description yet.')}</p>
    </div>
  `;
}

function renderRailChat(chat) {
  return `
    <div class="list-stack" style="margin-top: 16px;">
      <div class="row-head">
        ${renderAvatar(chat.title, chat.avatarImage, 'large')}
        <div class="row-body">
          <strong>${escapeHtml(chat.title)}</strong>
          <span class="row-subtitle">${escapeHtml(chat.subtitle || '')}</span>
        </div>
      </div>
      <div class="tag-row">
        <span class="tag">${chat.type}</span>
        ${chat.muted ? '<span class="tag">Muted</span>' : ''}
        ${chat.pinned ? '<span class="tag">Pinned</span>' : ''}
      </div>
      <p class="helper-text">${escapeHtml(chat.lastMessagePreview || 'No message preview')}</p>
    </div>
  `;
}

function renderSummaryRail() {
  const unreadChats = state.chats.filter((item) => item.unreadCount > 0).length;
  const unreadNotifications = state.unreadNotificationCount;

  return `
    <div class="profile-card">
      <strong>Quick summary</strong>
      <div class="metrics-grid" style="margin-top: 16px; grid-template-columns: 1fr;">
        <div class="metric-card">
          <span>Unread chats</span>
          <strong>${unreadChats}</strong>
        </div>
        <div class="metric-card">
          <span>Pending requests</span>
          <strong>${state.requests.incoming.length + state.requests.outgoing.length}</strong>
        </div>
        <div class="metric-card">
          <span>Unread notifications</span>
          <strong>${unreadNotifications}</strong>
        </div>
      </div>
    </div>
  `;
}

function renderAvatar(name, image, sizeClass = '') {
  const content = image
    ? `<img src="${image}" alt="${escapeAttribute(name)}" />`
    : `<span>${escapeHtml(initials(name))}</span>`;
  return `<div class="avatar ${sizeClass}">${content}</div>`;
}

function getSectionMeta() {
  const map = {
    chats: {
      title: 'Inbox',
      subtitle: 'Focused conversations and quick triage.',
      sidebarTitle: 'Conversations',
      eyebrow: 'Workspace',
      searchPlaceholder: 'Search chats or people',
    },
    files: {
      title: 'Files hub',
      subtitle: 'Shared media and documents across chats.',
      sidebarTitle: 'Files',
      eyebrow: 'Library',
      searchPlaceholder: 'Search files or media',
    },
    contacts: {
      title: 'Contacts',
      subtitle: 'People, favorites, and direct access.',
      sidebarTitle: 'People',
      eyebrow: 'Directory',
      searchPlaceholder: 'Search contacts',
    },
    requests: {
      title: 'Requests',
      subtitle: 'Pending connection requests and actions.',
      sidebarTitle: 'Requests',
      eyebrow: 'Queue',
      searchPlaceholder: 'Search requests',
    },
    groups: {
      title: 'Groups',
      subtitle: 'Rooms, members, and invites.',
      sidebarTitle: 'Groups',
      eyebrow: 'Collaboration',
      searchPlaceholder: 'Search groups',
    },
    notifications: {
      title: 'Notifications',
      subtitle: 'Recent updates and alerts.',
      sidebarTitle: 'Notifications',
      eyebrow: 'Activity',
      searchPlaceholder: 'Search notifications',
    },
    admin: {
      title: 'Admin',
      subtitle: 'Operational overview and moderation.',
      sidebarTitle: 'Admin',
      eyebrow: 'Control',
      searchPlaceholder: 'Search admin data',
    },
    profile: {
      title: 'Profile',
      subtitle: 'Identity and public details.',
      sidebarTitle: 'Profile',
      eyebrow: 'Account',
      searchPlaceholder: 'Search profile settings',
    },
    settings: {
      title: 'Settings',
      subtitle: 'Privacy and workspace preferences.',
      sidebarTitle: 'Settings',
      eyebrow: 'Preferences',
      searchPlaceholder: 'Search settings',
    },
  };

  return map[state.activeSection] || map.chats;
}

function getVisibleSidebarChats() {
  const chats = (state.chats.length ? state.chats : demoWorkspace.chats).slice();
  const query = state.workspaceQuery.trim().toLowerCase();

  const filtered = chats.filter((chat) => {
    if (state.chatListFilter === 'unread' && !chat.unreadCount) {
      return false;
    }
    if (state.chatListFilter === 'pinned' && !chat.pinned) {
      return false;
    }
    if (!query) {
      return true;
    }
    const preview = getChatPreviewText(chat).text.toLowerCase();
    return [chat.title, chat.subtitle, chat.partnerName, preview]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  return filtered.sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }
    if (Boolean(left.unreadCount) !== Boolean(right.unreadCount)) {
      return left.unreadCount ? -1 : 1;
    }
    return new Date(right.lastMessageAt || 0).getTime() - new Date(left.lastMessageAt || 0).getTime();
  });
}

function getComposerStatusText(voiceState) {
  if (voiceState === 'recording') {
    return `Recording ${formatDuration(Math.ceil(state.voiceRecorder.durationMs / 1000))}`;
  }
  if (voiceState === 'queued') {
    return 'Voice note queued for delivery';
  }
  if (voiceState === 'failed') {
    return 'Voice note failed. Retry when ready.';
  }
  if (voiceState === 'unsupported') {
    return 'Voice recording is unavailable in this browser';
  }
  if (state.replyDraft) {
    return 'Reply ready';
  }
  if (state.voiceDraft) {
    return 'Voice preview ready';
  }
  return state.offline.isOnline ? 'Live conversation' : 'Offline mode enabled';
}

function canToggleDetailsRail() {
  return ['chats', 'files', 'contacts', 'groups', 'notifications', 'admin', 'profile', 'settings'].includes(state.activeSection);
}

function shouldShowDetailRail() {
  if (!canToggleDetailsRail()) {
    return false;
  }
  return state.detailRailOpen;
}

function isMobileViewport() {
  return window.innerWidth <= 960;
}

function handleViewportChange() {
  if (isMobileViewport()) {
    state.detailRailOpen = false;
  }

  if (!isMobileViewport()) {
    state.mobileChatListVisible = true;
  }

  render();
}

function renderToasts() {
  if (!state.toasts.length) {
    return '';
  }

  return `
    <div class="floating-toasts">
      ${state.toasts.map((toast) => `
        <div class="floating-toast is-${toast.type}">
          <strong>${escapeHtml(toast.title)}</strong>
          <p>${escapeHtml(toast.message)}</p>
        </div>
      `).join('')}
    </div>
  `;
}

function renderModal() {
  if (!state.modal) {
    return '';
  }

  let content = state.modal.content || '';

  if (state.modal.type === 'reaction-picker') {
    const emojiOptions = ['👍', '❤️', '😂', '🔥', '👏', '😮'];
    content = `
      <div class="reaction-picker">
        ${emojiOptions.map((emoji) => `
          <button class="chip-button reaction-option" type="button" data-action="choose-reaction" data-emoji="${emoji}" data-message-id="${state.modal.messageId}">${emoji}</button>
        `).join('')}
      </div>
    `;
  }

  if (state.modal.type === 'edit-message') {
    content = `
      <form id="edit-message-form" class="form-stack">
        <input type="hidden" name="messageId" value="${escapeAttribute(state.modal.messageId)}" />
        <div class="field">
          <label for="edit-message-text">Message</label>
          <textarea id="edit-message-text" name="text" rows="4" required>${escapeHtml(state.modal.value || '')}</textarea>
        </div>
        <div class="request-actions">
          <button class="ghost-button" type="button" data-action="close-modal">Cancel</button>
          <button class="primary-button" type="submit">Save changes</button>
        </div>
      </form>
    `;
  }

  if (state.modal.type === 'confirm-delete') {
    content = `
      <div class="form-stack">
        <p>${escapeHtml(state.modal.description || 'This action cannot be undone.')}</p>
        <div class="request-actions">
          <button class="ghost-button" type="button" data-action="close-modal">Cancel</button>
          <button class="primary-button" type="button" data-action="confirm-delete-message" data-message-id="${state.modal.messageId}" data-delete-mode="${state.modal.deleteMode}">Delete</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="modal-overlay">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeAttribute(state.modal.title)}">
        <div class="row-head">
          <div class="row-body">
            <strong>${escapeHtml(state.modal.title)}</strong>
            <span class="row-subtitle">${escapeHtml(state.modal.description || '')}</span>
          </div>
          <button class="ghost-button icon-button" type="button" data-action="close-modal">×</button>
        </div>
        <div class="modal-body">
          ${content}
        </div>
      </div>
    </div>
  `;
}

async function handleClick(event) {
  if (event.target.closest('.details-drawer') && !event.target.closest('[data-action]')) {
    return;
  }

  if (event.target.classList?.contains('modal-overlay')) {
    state.modal = null;
    render();
    return;
  }

  const target = event.target.closest('[data-action]');
  if (!target) {
    return;
  }

  const { action } = target.dataset;

  if (action === 'switch-auth') {
    state.authView = target.dataset.view;
    render();
    return;
  }

  if (action === 'close-modal') {
    state.modal = null;
    render();
    return;
  }

  if (action === 'close-details') {
    state.detailRailOpen = false;
    render();
    return;
  }

  if (action === 'open-demo') {
    syncDemoState();
    state.replyDraft = null;
    state.screen = 'workspace';
    render();
    return;
  }

  if (action === 'toggle-theme') {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    window.localStorage.setItem(THEME_KEY, state.theme);
    applyTheme();
    render();
    return;
  }

  if (action === 'logout') {
    disconnectSocket();
    releaseLeadership();
    setRealtimeFollower('');
    teardownVoiceLifecycle({ silent: true });
    revokeAllTrackedObjectUrls();
    clearSession();
    state.token = null;
    state.refreshToken = null;
    state.admin.summary = null;
    state.replyDraft = null;
    state.screen = 'auth';
    state.authView = 'login';
    pushToast('Logged out', 'Your session has been cleared.', 'success');
    render();
    return;
  }

  if (action === 'switch-section') {
    if (target.dataset.section !== 'chats') {
      cleanupVoiceOnContextChange(null);
    }
    state.activeSection = target.dataset.section;
    state.workspaceQuery = '';
    if (state.activeSection === 'chats') {
      state.mobileChatListVisible = true;
    }
    if (state.activeSection === 'files') {
      await loadFilesHub({ silent: true });
    }
    render();
    return;
  }

  if (action === 'toggle-details') {
    state.detailRailOpen = !state.detailRailOpen;
    render();
    return;
  }

  if (action === 'set-chat-filter') {
    state.chatListFilter = target.dataset.filter || 'all';
    render();
    return;
  }

  if (action === 'switch-request-tab') {
    state.requestTab = target.dataset.tab;
    render();
    return;
  }

  if (action === 'reply-message') {
    const selectedChat = getSelectedChat();
    const message = (state.messagesByChat[selectedChat?.id] || []).find((item) => item.id === target.dataset.messageId);
    if (message) {
      state.replyDraft = { id: message.id, text: message.text || message.fileName || 'Attachment' };
      render();
    }
    return;
  }

  if (action === 'cancel-reply') {
    state.replyDraft = null;
    render();
    return;
  }

  if (action === 'composer-attach') {
    pushToast('Attachment UI', 'File picker wiring can be connected next without changing the shell.', 'info');
    return;
  }

  if (action === 'toggle-recording') {
    if (state.voiceRecorder.status === 'recording') {
      stopVoiceRecording();
    } else {
      await startVoiceRecording();
    }
    return;
  }

  if (action === 'discard-voice') {
    discardVoiceDraft();
    return;
  }

  if (action === 'send-voice') {
    await sendVoiceDraft(state.selectedChatId);
    return;
  }

  if (action === 'composer-emoji') {
    pushToast('Emoji UI', 'Emoji reactions and picker are ready for the next interaction pass.', 'info');
    return;
  }

  if (action === 'focus-composer') {
    window.setTimeout(() => {
      document.getElementById('message-text')?.focus();
    }, 0);
    return;
  }

  if (action === 'open-chat-list') {
    state.mobileChatListVisible = true;
    render();
    return;
  }

  if (action === 'react-message') {
    state.modal = {
      type: 'reaction-picker',
      title: 'Add reaction',
      description: 'Pick a quick reaction for this message.',
      messageId: target.dataset.messageId,
    };
    render();
    return;
  }

  if (action === 'choose-reaction') {
    await saveReaction(target.dataset.messageId, target.dataset.emoji);
    return;
  }

  if (action === 'retry-message') {
    await retryPendingMessage(target.dataset.messageId);
    return;
  }

  if (action === 'edit-message') {
    const selectedChat = getSelectedChat();
    const message = (state.messagesByChat[selectedChat?.id] || []).find((item) => item.id === target.dataset.messageId);
    if (message) {
      state.modal = {
        type: 'edit-message',
        title: 'Edit message',
        description: 'Update the text and save it back into the conversation.',
        messageId: message.id,
        value: message.text || '',
      };
      render();
    }
    return;
  }

  if (action === 'delete-message') {
    const selectedChat = getSelectedChat();
    const message = (state.messagesByChat[selectedChat?.id] || []).find((item) => item.id === target.dataset.messageId);
    if (message) {
      state.modal = {
        type: 'confirm-delete',
        title: message.mine ? 'Delete message for everyone' : 'Delete message for you',
        description: message.mine
          ? 'This will remove the message for everyone in the conversation.'
          : 'This will remove the message only from your workspace.',
        messageId: message.id,
        deleteMode: message.mine ? 'everyone' : 'me',
      };
      render();
    }
    return;
  }

  if (action === 'confirm-delete-message') {
    await deleteMessageAction(target.dataset.messageId, target.dataset.deleteMode);
    return;
  }

  if (action === 'open-group-invite') {
    await openGroupInvite(target.dataset.groupId);
    return;
  }

  if (action === 'set-files-kind') {
    state.filesHub.filters.kind = target.dataset.kind || 'all';
    await loadFilesHub({ silent: true });
    render();
    return;
  }

  if (action === 'apply-files-filters') {
    const searchInput = document.querySelector('[data-role="files-search"]');
    const chatFilter = document.querySelector('[data-role="files-chat-filter"]');
    const senderFilter = document.querySelector('[data-role="files-sender-filter"]');
    const dateFilter = document.querySelector('[data-role="files-date-filter"]');
    state.filesHub.filters.q = String(searchInput?.value || '').trim();
    state.filesHub.filters.chatId = String(chatFilter?.value || '');
    state.filesHub.filters.senderId = String(senderFilter?.value || '');
    state.filesHub.filters.from = String(dateFilter?.value || '');
    await loadFilesHub();
    return;
  }

  if (action === 'reset-files-filters') {
    state.filesHub.filters = {
      kind: 'all',
      chatId: '',
      senderId: '',
      q: '',
      from: '',
    };
    await loadFilesHub();
    return;
  }

  if (action === 'open-file-chat') {
    cleanupVoiceOnContextChange(target.dataset.chatId || null);
    state.activeSection = 'chats';
    state.selectedChatId = target.dataset.chatId || state.selectedChatId;
    if (isMobileViewport()) {
      state.mobileChatListVisible = false;
    }
    await loadChatMessages(state.selectedChatId);
    render();
    return;
  }

  if (action === 'select-chat') {
    cleanupVoiceOnContextChange(target.dataset.chatId || null);
    state.activeSection = 'chats';
    state.replyDraft = null;
    state.selectedChatId = target.dataset.chatId;
    if (isMobileViewport()) {
      state.mobileChatListVisible = false;
    }
    await loadChatMessages(state.selectedChatId);
    render();
    return;
  }

  if (action === 'select-contact') {
    cleanupVoiceOnContextChange(null);
    state.activeSection = 'contacts';
    state.selectedContactId = target.dataset.contactId;
    render();
    return;
  }

  if (action === 'select-group') {
    cleanupVoiceOnContextChange(null);
    state.activeSection = 'groups';
    state.selectedGroupId = target.dataset.groupId;
    render();
    return;
  }

  if (action === 'toggle-favorite') {
    await toggleFavorite(target.dataset.contactId);
    return;
  }

  if (action === 'open-chat-with-contact') {
    await openChatWithContact(target.dataset.contactId);
    return;
  }

  if (action === 'request-action') {
    await handleRequestAction(target.dataset.requestId, target.dataset.kind);
    return;
  }

  if (action === 'mark-read') {
    await markNotificationRead(target.dataset.notificationId);
    return;
  }

  if (action === 'mark-all-read') {
    await markAllNotificationsRead();
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;

  if (form.id === 'login-form') {
    await handleLogin(new FormData(form));
    return;
  }

  if (form.id === 'register-form') {
    await handleRegister(new FormData(form));
    return;
  }

  if (form.id === 'forgot-form') {
    await handleForgotPassword(new FormData(form));
    return;
  }

  if (form.id === 'message-form') {
    await handleMessageSubmit(new FormData(form), form);
    return;
  }

  if (form.id === 'edit-message-form') {
    await handleEditMessageSave(new FormData(form));
    return;
  }

  if (form.id === 'profile-form') {
    await handleProfileSave(new FormData(form));
    return;
  }

  if (form.id === 'privacy-form') {
    await handlePrivacySave(new FormData(form));
    return;
  }

  if (form.id === 'group-form') {
    await handleGroupCreate(new FormData(form), form);
  }
}

let typingTimer = null;

function handleInput(event) {
  const target = event.target;

  if (target.dataset.role === 'workspace-search') {
    const nextValue = String(target.value || '');
    state.workspaceQuery = nextValue;
    render();
    window.requestAnimationFrame(() => {
      const searchInput = document.querySelector('[data-role="workspace-search"]');
      if (searchInput) {
        searchInput.focus();
        searchInput.setSelectionRange(nextValue.length, nextValue.length);
      }
    });
    return;
  }

  if (target.id !== 'message-text' || !state.selectedChatId || state.dataSource !== 'api') {
    return;
  }

  if (!typingEmitAt || (nowMs() - typingEmitAt) > 900) {
    emitSocketCommand('message:typing', { chatId: state.selectedChatId });
    typingEmitAt = nowMs();
  }

  if (typingTimer) {
    window.clearTimeout(typingTimer);
  }

  typingTimer = window.setTimeout(() => {
    emitSocketCommand('message:stop-typing', { chatId: state.selectedChatId });
    typingEmitAt = 0;
  }, 1200);
}

async function handleLogin(formData) {
  try {
    const payload = {
      email: String(formData.get('email') || '').trim(),
      password: String(formData.get('password') || ''),
    };
    const response = await apiFetch('/api/v1/auth/login', {
      method: 'POST',
      headers: {},
      body: JSON.stringify(payload),
    });

    setSessionFromAuth(response.data);
    const loaded = await loadLiveWorkspace();
    state.screen = 'workspace';
    pushToast(
      'Logged in',
      loaded ? 'Your live workspace is ready.' : 'Live data was unavailable, so the demo workspace is open instead.',
      'success',
    );
    render();
  } catch (error) {
    pushToast('Login failed', error.message, 'error');
    render();
  }
}

async function handleRegister(formData) {
  try {
    const payload = {
      fullName: String(formData.get('fullName') || '').trim(),
      username: String(formData.get('username') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      password: String(formData.get('password') || ''),
    };
    const response = await apiFetch('/api/v1/auth/register', {
      method: 'POST',
      headers: {},
      body: JSON.stringify(payload),
    });

    setSessionFromAuth(response.data);
    const loaded = await loadLiveWorkspace();
    state.screen = 'workspace';
    pushToast(
      'Account created',
      loaded ? 'Registration worked and the workspace is now live.' : 'Registration worked, but the UI fell back to demo mode while live data loads are unavailable.',
      'success',
    );
    render();
  } catch (error) {
    pushToast('Registration failed', error.message, 'error');
    render();
  }
}

async function handleForgotPassword(formData) {
  try {
    const payload = {
      email: String(formData.get('email') || '').trim(),
    };
    const response = await apiFetch('/api/v1/auth/forgot-password', {
      method: 'POST',
      headers: {},
      body: JSON.stringify(payload),
    });

    const token = response.data?.resetToken || response.data?.devOnly?.resetToken;
    pushToast(
      'Reset prepared',
      token ? `Development reset token: ${token}` : response.message || 'Check the API response for the prepared link.',
      'success',
    );
    render();
  } catch (error) {
    pushToast('Reset failed', error.message, 'error');
    render();
  }
}

async function handleEditMessageSave(formData) {
  const messageId = String(formData.get('messageId') || '');
  const text = String(formData.get('text') || '').trim();
  if (!messageId || !text) {
    pushToast('Edit failed', 'Message text is required.', 'error');
    return;
  }

  const selectedChat = getSelectedChat();
  if (!selectedChat) {
    return;
  }

  if (state.dataSource === 'demo') {
    state.messagesByChat[selectedChat.id] = (state.messagesByChat[selectedChat.id] || []).map((item) => (
      item.id === messageId ? { ...item, text, editedAt: new Date().toISOString() } : item
    ));
    recalculateChatFromMessages(selectedChat.id);
    state.modal = null;
    render();
    return;
  }

  try {
    const response = await apiFetch(`/api/v1/messages/${messageId}`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
    });
    let message = normalizeMessage(response.data);
    if (message.isEncrypted) {
      message = await decryptMessageContent(message);
    }
    upsertMessageForChat(selectedChat.id, message);
    recalculateChatFromMessages(selectedChat.id);
    await persistChatMessagesCache(selectedChat.id);
    state.modal = null;
    pushToast('Message updated', 'The message has been edited.', 'success');
    render();
  } catch (error) {
    pushToast('Edit failed', error.message, 'error');
    render();
  }
}

async function deleteMessageAction(messageId, deleteMode = 'everyone') {
  const selectedChat = getSelectedChat();
  if (!selectedChat || !messageId) {
    return;
  }

  if (state.dataSource === 'demo') {
    state.messagesByChat[selectedChat.id] = (state.messagesByChat[selectedChat.id] || []).filter((item) => item.id !== messageId);
    recalculateChatFromMessages(selectedChat.id);
    state.modal = null;
    render();
    return;
  }

  try {
    await apiFetch(
      deleteMode === 'me' ? `/api/v1/messages/${messageId}/for-me` : `/api/v1/messages/${messageId}`,
      { method: 'DELETE' },
    );
    state.messagesByChat[selectedChat.id] = (state.messagesByChat[selectedChat.id] || []).filter((item) => item.id !== messageId);
    state.filesHub.items = state.filesHub.items.filter((item) => item.messageId !== messageId);
    recalculateChatFromMessages(selectedChat.id);
    await persistChatMessagesCache(selectedChat.id);
    state.modal = null;
    pushToast('Message deleted', deleteMode === 'me' ? 'The message was removed from your view.' : 'The message was deleted for everyone.', 'success');
    render();
  } catch (error) {
    pushToast('Delete failed', error.message, 'error');
    render();
  }
}

async function saveReaction(messageId, emoji) {
  const selectedChat = getSelectedChat();
  if (!selectedChat || !messageId || !emoji) {
    return;
  }

  const currentMessage = (state.messagesByChat[selectedChat.id] || []).find((item) => item.id === messageId);
  if (!currentMessage) {
    return;
  }

  const myReaction = (currentMessage.reactions || []).find((item) => String(item.userId) === String(state.user?.id));

  if (state.dataSource === 'demo') {
    const nextReactions = myReaction?.emoji === emoji
      ? (currentMessage.reactions || []).filter((item) => String(item.userId) !== String(state.user?.id))
      : [
        ...(currentMessage.reactions || []).filter((item) => String(item.userId) !== String(state.user?.id)),
        { userId: state.user.id, emoji },
      ];
    upsertMessageForChat(selectedChat.id, { ...currentMessage, reactions: nextReactions });
    state.modal = null;
    render();
    return;
  }

  try {
    const response = myReaction?.emoji === emoji
      ? await apiFetch(`/api/v1/messages/${messageId}/reactions`, { method: 'DELETE' })
      : await apiFetch(`/api/v1/messages/${messageId}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
    upsertMessageForChat(selectedChat.id, {
      ...currentMessage,
      reactions: normalizeReactions(response.data || []),
    });
    await persistChatMessagesCache(selectedChat.id);
    state.modal = null;
    render();
  } catch (error) {
    pushToast('Reaction failed', error.message, 'error');
    render();
  }
}

function setSessionFromAuth(data) {
  state.token = data?.tokens?.accessToken || null;
  state.refreshToken = data?.tokens?.refreshToken || null;

  writeSession({
    token: state.token,
    refreshToken: state.refreshToken,
  });
}

async function handleMessageSubmit(formData, form) {
  const chatId = String(formData.get('chatId') || '');
  const text = String(formData.get('text') || '').trim();
  if (!chatId) {
    return;
  }

  if (!text && state.voiceDraft) {
    await sendVoiceDraft(chatId);
    return;
  }

  if (!text) {
    return;
  }

  const selectedChat = state.chats.find((item) => item.id === chatId);
  const clientMessageId = crypto.randomUUID();
  let outgoingPayload;
  try {
    outgoingPayload = await buildOutgoingTextPayload(selectedChat, text);
  } catch (error) {
    pushToast('Secure send unavailable', error.message, 'error');
    render();
    return;
  }

  const queueEntry = {
    id: clientMessageId,
    localId: `local-${clientMessageId}`,
    clientMessageId,
    chatId,
    replyText: state.replyDraft?.text || '',
    createdAt: new Date().toISOString(),
    deliveryState: 'queued',
    payload: {
      chatId,
      clientMessageId,
      ...outgoingPayload,
      replyToMessageId: state.replyDraft?.id || null,
    },
  };

  if (state.dataSource === 'demo') {
    const message = {
      id: `message-${Date.now()}`,
      chatId,
      senderId: state.user.id,
      senderName: state.user.fullName,
      text,
      replyText: state.replyDraft?.text || '',
      createdAt: new Date().toISOString(),
      editedAt: null,
      seenCount: 0,
      mine: true,
    };
    state.messagesByChat[chatId] = [...(state.messagesByChat[chatId] || []), message];
    const chat = state.chats.find((item) => item.id === chatId);
    if (chat) {
      chat.lastMessagePreview = text;
      chat.lastMessageAt = message.createdAt;
    }
    state.replyDraft = null;
    form.reset();
    pushToast('Message sent', 'The demo conversation was updated locally.', 'success');
    render();
    return;
  }

  if (!state.offline.isOnline) {
    await queueOutboundMessage(queueEntry);
    state.replyDraft = null;
    form.reset();
    pushToast('Message queued', 'The message will send automatically when the connection returns.', 'info');
    return;
  }

  try {
    emitSocketCommand('message:stop-typing', { chatId });
    typingEmitAt = 0;
    const response = await apiFetch('/api/v1/messages', {
      method: 'POST',
      headers: {},
      body: JSON.stringify(queueEntry.payload),
    });
    let message = normalizeMessage(response.data);
    if (message.isEncrypted) {
      message = await decryptMessageContent(message);
    }
    const existingMessages = state.messagesByChat[chatId] || [];
    state.messagesByChat[chatId] = existingMessages.some((item) => item.id === message.id)
      ? existingMessages.map((item) => (item.id === message.id ? message : item))
      : [...existingMessages, message];
    const chat = state.chats.find((item) => item.id === chatId);
    if (chat) {
      chat.lastMessagePreview = getMessagePreviewText(message);
      chat.lastMessageAt = message.createdAt;
    }
    state.replyDraft = null;
    form.reset();
    await persistChatMessagesCache(chatId);
    await persistWorkspaceCache();
    pushToast('Message sent', 'The conversation was updated against the live API.', 'success');
    render();
  } catch (error) {
    if (!error.status) {
      await queueOutboundMessage(queueEntry);
      state.replyDraft = null;
      form.reset();
      pushToast('Message queued', 'The network dropped, so the message was safely queued locally.', 'info');
    } else {
      pushToast('Send failed', error.message, 'error');
    }
    render();
  }
}

async function toggleFavorite(contactId) {
  const contact = state.contacts.find((item) => item.id === contactId);
  if (!contact) {
    return;
  }

  if (state.dataSource === 'demo') {
    contact.isFavorite = !contact.isFavorite;
    pushToast('Favorite updated', `${contact.fullName} was ${contact.isFavorite ? 'added to' : 'removed from'} favorites.`, 'success');
    render();
    return;
  }

  try {
    await apiFetch(`/api/v1/contacts/${contactId}/favorite`, {
      method: contact.isFavorite ? 'DELETE' : 'POST',
      headers: {},
    });
    contact.isFavorite = !contact.isFavorite;
    pushToast('Favorite updated', `${contact.fullName} was ${contact.isFavorite ? 'added to' : 'removed from'} favorites.`, 'success');
    render();
  } catch (error) {
    pushToast('Update failed', error.message, 'error');
    render();
  }
}

async function openChatWithContact(contactId) {
  const contact = state.contacts.find((item) => item.id === contactId);
  if (!contact) {
    return;
  }

  let chat = state.chats.find((item) => item.partnerId === contactId);

  if (state.dataSource === 'demo') {
    if (!chat) {
      chat = {
        id: `chat-${Date.now()}`,
        type: 'private',
        title: contact.fullName,
        subtitle: contact.isOnline ? 'Online now' : `Last seen ${relativeTime(contact.lastSeen)}`,
        partnerId: contact.id,
        partnerName: contact.fullName,
        partnerStatus: contact.statusMessage,
        avatarText: initials(contact.fullName),
        avatarImage: contact.profileImage,
        unreadCount: 0,
        pinned: false,
        muted: false,
        lastMessagePreview: 'Start the conversation',
        lastMessageAt: new Date().toISOString(),
        memberCount: 2,
      };
      state.chats.unshift(chat);
      state.messagesByChat[chat.id] = [];
    }
  } else {
    try {
      const response = await apiFetch(`/api/v1/chats/private/${contactId}`, {
        method: 'POST',
        headers: {},
      });
      chat = normalizeChat(response.data, state.user);
      const existingIndex = state.chats.findIndex((item) => item.id === chat.id);
      if (existingIndex >= 0) {
        state.chats[existingIndex] = chat;
      } else {
        state.chats.unshift(chat);
      }
      state.selectedChatId = chat.id;
      await loadChatMessages(chat.id);
    } catch (error) {
      pushToast('Could not open chat', error.message, 'error');
      render();
      return;
    }
  }

  cleanupVoiceOnContextChange(chat.id);
  state.selectedChatId = chat.id;
  state.activeSection = 'chats';
  if (isMobileViewport()) {
    state.mobileChatListVisible = false;
  }
  pushToast('Chat ready', `Opened a conversation with ${contact.fullName}.`, 'success');
  render();
}

async function handleRequestAction(requestId, kind) {
  const activeList = state.requests[state.requestTab];
  const request = activeList.find((item) => item.id === requestId);
  if (!request) {
    return;
  }

  if (state.dataSource === 'demo') {
    state.requests[state.requestTab] = activeList.filter((item) => item.id !== requestId);
    if (kind === 'accept') {
      state.contacts.unshift({
        id: request.counterpart.id,
        fullName: request.counterpart.fullName,
        username: request.counterpart.username,
        statusMessage: 'New contact',
        isOnline: false,
        lastSeen: new Date().toISOString(),
        profileImage: request.counterpart.profileImage,
        isFavorite: false,
      });
    }
    pushToast('Request updated', `${pastTense(kind)} ${request.counterpart.fullName}.`, 'success');
    render();
    return;
  }

  try {
    await apiFetch(`/api/v1/contact-requests/${requestId}/${kind}`, {
      method: 'PUT',
      headers: {},
    });
    state.requests[state.requestTab] = activeList.filter((item) => item.id !== requestId);
    if (kind === 'accept') {
      await refreshContacts();
    }
    pushToast('Request updated', `${pastTense(kind)} ${request.counterpart.fullName}.`, 'success');
    render();
  } catch (error) {
    pushToast('Request failed', error.message, 'error');
    render();
  }
}

async function refreshContacts() {
  if (state.dataSource !== 'api') {
    return;
  }

  try {
    const response = await apiFetch('/api/v1/contacts?limit=20');
    state.contacts = (response.data || []).map(normalizeContact);
  } catch (error) {
    pushToast('Contacts refresh failed', error.message, 'info');
  }
}

async function markNotificationRead(notificationId) {
  const notification = state.notifications.find((item) => item.id === notificationId);
  if (!notification || notification.isRead) {
    return;
  }

  if (state.dataSource === 'demo') {
    notification.isRead = true;
    state.unreadNotificationCount = Math.max(0, state.unreadNotificationCount - 1);
    pushToast('Notification updated', 'Marked as read.', 'success');
    render();
    return;
  }

  try {
    await apiFetch(`/api/v1/notifications/${notificationId}/read`, {
      method: 'PUT',
      headers: {},
    });
    notification.isRead = true;
    state.unreadNotificationCount = Math.max(0, state.unreadNotificationCount - 1);
    pushToast('Notification updated', 'Marked as read.', 'success');
    render();
  } catch (error) {
    pushToast('Update failed', error.message, 'error');
    render();
  }
}

async function markAllNotificationsRead() {
  if (!state.notifications.some((item) => !item.isRead)) {
    pushToast('All caught up', 'There are no unread notifications right now.', 'info');
    render();
    return;
  }

  if (state.dataSource === 'demo') {
    state.notifications = state.notifications.map((item) => ({ ...item, isRead: true }));
    state.unreadNotificationCount = 0;
    pushToast('Notifications cleared', 'Every notification is now marked as read.', 'success');
    render();
    return;
  }

  try {
    await apiFetch('/api/v1/notifications/read-all', {
      method: 'PUT',
      headers: {},
    });
    state.notifications = state.notifications.map((item) => ({ ...item, isRead: true }));
    state.unreadNotificationCount = 0;
    pushToast('Notifications cleared', 'Every notification is now marked as read.', 'success');
    render();
  } catch (error) {
    pushToast('Update failed', error.message, 'error');
    render();
  }
}

async function handleProfileSave(formData) {
  const payload = {
    fullName: String(formData.get('fullName') || '').trim(),
    location: String(formData.get('location') || '').trim(),
    statusMessage: String(formData.get('statusMessage') || '').trim(),
    bio: String(formData.get('bio') || '').trim(),
  };

  if (state.dataSource === 'demo') {
    Object.assign(state.user, payload);
    pushToast('Profile saved', 'Profile details were updated locally in demo mode.', 'success');
    render();
    return;
  }

  try {
    const response = await apiFetch('/api/v1/users/me', {
      method: 'PUT',
      headers: {},
      body: JSON.stringify(payload),
    });
    state.user = normalizeUser({ ...state.user, ...response.data, email: state.user.email });
    pushToast('Profile saved', 'Your profile has been updated.', 'success');
    render();
  } catch (error) {
    pushToast('Save failed', error.message, 'error');
    render();
  }
}

async function handlePrivacySave(formData) {
  const payload = {
    messagePermission: String(formData.get('messagePermission')),
    groupInvitePermission: String(formData.get('groupInvitePermission')),
    profilePhotoVisibility: String(formData.get('profilePhotoVisibility')),
    lastSeenVisibility: String(formData.get('lastSeenVisibility')),
    onlineStatusVisibility: String(formData.get('onlineStatusVisibility')),
    readReceiptsEnabled: String(formData.get('readReceiptsEnabled')) === 'true',
    typingIndicatorEnabled: String(formData.get('typingIndicatorEnabled')) === 'true',
  };

  if (state.dataSource === 'demo') {
    state.privacy = payload;
    pushToast('Settings saved', 'Privacy settings were updated locally in demo mode.', 'success');
    render();
    return;
  }

  try {
    const response = await apiFetch('/api/v1/privacy', {
      method: 'PUT',
      headers: {},
      body: JSON.stringify(payload),
    });
    state.privacy = normalizePrivacy(response.data);
    pushToast('Settings saved', 'Privacy settings have been updated.', 'success');
    render();
  } catch (error) {
    pushToast('Save failed', error.message, 'error');
    render();
  }
}

async function handleGroupCreate(formData, form) {
  const selectedOptions = Array.from(form.querySelector('#group-members')?.selectedOptions || []).map((option) => option.value);
  const payload = {
    name: String(formData.get('name') || '').trim(),
    description: String(formData.get('description') || '').trim(),
    memberIds: selectedOptions,
  };

  if (!payload.name) {
    pushToast('Group name required', 'Please add a name before creating the group.', 'error');
    render();
    return;
  }

  if (state.dataSource === 'demo') {
    const newGroup = {
      id: `group-${Date.now()}`,
      chatId: `chat-${Date.now()}`,
      name: payload.name,
      description: payload.description,
      inviteCode: `DEMO${String(Date.now()).slice(-4)}`,
      image: '',
      onlyAdminsCanMessage: false,
      onlyAdminsCanEditInfo: false,
      onlyAdminsCanAddMembers: false,
      members: [
        { id: state.user.id, fullName: state.user.fullName, role: 'owner' },
        ...state.contacts
          .filter((contact) => payload.memberIds.includes(contact.id))
          .map((contact) => ({ id: contact.id, fullName: contact.fullName, role: 'member' })),
      ],
    };
    state.groups.unshift(newGroup);
    state.selectedGroupId = newGroup.id;
    form.reset();
    pushToast('Group created', `${payload.name} was added to the demo workspace.`, 'success');
    render();
    return;
  }

  try {
    const response = await apiFetch('/api/v1/groups', {
      method: 'POST',
      headers: {},
      body: JSON.stringify(payload),
    });

    const newGroup = {
      id: response.data._id || response.data.id,
      chatId: response.data.chatId?._id || response.data.chatId,
      name: response.data.name,
      description: response.data.description || '',
      inviteCode: response.data.inviteCode || 'LIVE',
      image: response.data.image || '',
      onlyAdminsCanMessage: Boolean(response.data.onlyAdminsCanMessage),
      onlyAdminsCanEditInfo: Boolean(response.data.onlyAdminsCanEditInfo),
      onlyAdminsCanAddMembers: Boolean(response.data.onlyAdminsCanAddMembers),
      members: [
        { id: state.user.id, fullName: state.user.fullName, role: 'owner' },
        ...state.contacts
          .filter((contact) => payload.memberIds.includes(contact.id))
          .map((contact) => ({ id: contact.id, fullName: contact.fullName, role: 'member' })),
      ],
    };

    state.groups.unshift(newGroup);
    state.selectedGroupId = newGroup.id;
    form.reset();
    pushToast('Group created', `${payload.name} was created through the live API.`, 'success');
    render();
  } catch (error) {
    pushToast('Group creation failed', error.message, 'error');
    render();
  }
}

async function openGroupInvite(groupId) {
  const group = state.groups.find((item) => item.id === groupId) || getSelectedGroup();
  if (!group) {
    return;
  }

  if (state.dataSource === 'demo') {
    state.modal = {
      title: `${group.name} invite`,
      description: 'Share this demo invite code with collaborators.',
      content: `<div class="invite-code-card"><strong>${escapeHtml(group.inviteCode || 'DEMO')}</strong><p class="helper-text">Use this invite code in the group join flow.</p></div>`,
    };
    render();
    return;
  }

  try {
    const response = await apiFetch(`/api/v1/groups/${group.id}/invite-code`, {
      method: 'POST',
      headers: {},
    });
    const inviteCode = response.data?.inviteCode || group.inviteCode || 'LIVE';
    state.modal = {
      title: `${group.name} invite`,
      description: 'A fresh invite code has been generated for this group.',
      content: `<div class="invite-code-card"><strong>${escapeHtml(inviteCode)}</strong><p class="helper-text">Copy this code and share it with invited members.</p></div>`,
    };
    render();
  } catch (error) {
    pushToast('Invite failed', error.message, 'error');
    render();
  }
}

function getSelectedChat() {
  return state.chats.find((item) => item.id === state.selectedChatId) || null;
}

function getSelectedContact() {
  return state.contacts.find((item) => item.id === state.selectedContactId) || null;
}

function getSelectedGroup() {
  return state.groups.find((item) => item.id === state.selectedGroupId) || null;
}

function isE2EEActiveForChat(chat) {
  return Boolean(
    chat
      && chat.type === 'private'
      && state.e2ee.ready
      && (chat.e2eeCapable || chat.partnerPublicKey),
  );
}

function recalculateChatFromMessages(chatId) {
  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat) {
    return;
  }

  const latest = (state.messagesByChat[chatId] || []).slice(-1)[0];
  if (!latest) {
    chat.lastMessagePreview = 'No messages yet';
    chat.lastMessageAt = new Date().toISOString();
    return;
  }

  chat.lastMessagePreview = getMessagePreviewText(latest);
  chat.lastMessageAt = latest.createdAt;
}

function normalizeReactions(items = []) {
  return items.map((item) => ({
    emoji: item.emoji,
    userId: item.userId?._id || item.userId?.id || item.userId,
  }));
}

function aggregateReactions(items = []) {
  const grouped = new Map();
  for (const item of items) {
    const current = grouped.get(item.emoji) || 0;
    grouped.set(item.emoji, current + 1);
  }
  return Array.from(grouped.entries()).map(([emoji, count]) => ({ emoji, count }));
}

function pushToast(title, message, type = 'info') {
  state.toasts = [...state.toasts, { id: crypto.randomUUID(), title, message, type }].slice(-3);
  render();
  window.setTimeout(() => {
    state.toasts = state.toasts.slice(1);
    render();
  }, 3600);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function initials(value) {
  return String(value || 'PC')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

function formatTime(value) {
  return new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function relativeTime(value) {
  if (!value) {
    return 'just now';
  }

  const diff = Date.now() - new Date(value).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return 'just now';
  }
  if (diff < hour) {
    return `${Math.round(diff / minute)}m ago`;
  }
  if (diff < day) {
    return `${Math.round(diff / hour)}h ago`;
  }

  return `${Math.round(diff / day)}d ago`;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds || 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);

  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) {
    return '0 KB';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  const formatted = size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1);
  return `${formatted} ${units[index]}`;
}

function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : '';
}

function pastTense(value) {
  const map = {
    accept: 'Accepted',
    reject: 'Rejected',
    cancel: 'Cancelled',
  };

  return map[value] || `${capitalize(value)}ed`;
}
