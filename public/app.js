const appState = {
  route: null,
  loading: false,
  toast: null,
  invite: null,
  inviteError: '',
  socket: null,
  forms: {},
  mobileMessagesView: 'list',
  unreadCount: 0,
  typingByChat: {},
  presenceByUser: {},
  composerAttachment: null,
  session: loadSession(),
  data: {
    me: null,
    chats: [],
    activeChat: null,
    messagesByChat: {},
    contacts: [],
    recentContacts: [],
    requests: {
      incoming: [],
      outgoing: [],
    },
    groups: [],
    activeGroup: null,
    files: [],
    notifications: [],
    profile: null,
    privacy: null,
    sessions: [],
    adminDashboard: null,
    adminAnalytics: null,
    adminReports: [],
    adminUsers: [],
  },
};

const root = document.getElementById('app');
const SESSION_KEY = 'pulsechat.session';
const TOAST_TIMEOUT_MS = 3200;
let toastTimer = null;

document.addEventListener('click', onDocumentClick);
document.addEventListener('submit', onDocumentSubmit);
document.addEventListener('input', onDocumentInput);
document.addEventListener('change', onDocumentChange);
window.addEventListener('popstate', () => handleRouteChange(false));

start();

async function start() {
  await handleRouteChange(true);
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) {
      return {
        accessToken: '',
        refreshToken: '',
      };
    }
    return JSON.parse(raw);
  } catch (error) {
    return {
      accessToken: '',
      refreshToken: '',
    };
  }
}

function persistSession() {
  if (!appState.session?.accessToken) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(appState.session));
}

function clearSession() {
  appState.session = {
    accessToken: '',
    refreshToken: '',
  };
  appState.data.me = null;
  disconnectSocket();
  persistSession();
}

function parseRoute() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const segments = path.split('/').filter(Boolean);

  if (!segments.length) {
    return {
      name: appState.session?.accessToken ? 'app' : 'login',
      section: appState.session?.accessToken ? 'messages' : null,
      params: {},
    };
  }

  if (segments[0] === 'login') {
    return { name: 'login', params: {} };
  }
  if (segments[0] === 'register') {
    return { name: 'register', params: {} };
  }
  if (segments[0] === 'forgot-password') {
    return { name: 'forgot-password', params: {} };
  }
  if (segments[0] === 'reset-password') {
    return { name: 'reset-password', params: {} };
  }
  if (segments[0] === 'verify-email') {
    return { name: 'verify-email', params: {} };
  }
  if (segments[0] === 'invites' && segments[1]) {
    return {
      name: 'invite',
      params: {
        token: segments[1],
      },
    };
  }
  if (segments[0] === 'app') {
    return {
      name: 'app',
      section: segments[1] || 'messages',
      params: {
        id: segments[2] || '',
      },
    };
  }

  return {
    name: appState.session?.accessToken ? 'app' : 'login',
    section: appState.session?.accessToken ? 'messages' : null,
    params: {},
  };
}

function navigate(path, replace = false) {
  if (replace) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  handleRouteChange(false);
}

async function handleRouteChange(initial = false) {
  appState.route = parseRoute();

  if (appState.route.name === 'app') {
    const okay = await ensureAuthenticated();
    if (!okay) {
      navigate('/login', !initial);
      return;
    }
    appState.mobileMessagesView = appState.route.section === 'messages' && appState.route.params.id ? 'chat' : 'list';
    await loadAppSection(appState.route.section, appState.route.params.id);
    connectSocket();
  } else if (appState.route.name === 'invite') {
    disconnectSocket();
    await loadInviteLanding(appState.route.params.token);
  } else if (appState.session?.accessToken) {
    const okay = await ensureAuthenticated();
    if (okay) {
      navigate('/app/messages', true);
      return;
    }
  }

  render();
}

async function ensureAuthenticated() {
  if (!appState.session?.accessToken) {
    return false;
  }
  if (appState.data.me) {
    return true;
  }

  try {
    appState.loading = true;
    render();
    const me = await api('/auth/me');
    appState.data.me = me;
    appState.unreadCount = Array.isArray(appState.data.notifications)
      ? appState.data.notifications.filter((item) => !item.isRead).length
      : 0;
    return true;
  } catch (error) {
    clearSession();
    showToast(error.message || 'Your session has expired.');
    return false;
  } finally {
    appState.loading = false;
  }
}

async function loadAppSection(section, id) {
  appState.loading = true;
  render();

  try {
    if (!appState.data.chats.length) {
      await Promise.all([loadChats(), loadNotifications()]);
    }

    switch (section) {
      case 'messages':
        await loadMessageSection(id);
        break;
      case 'contacts':
        await Promise.all([loadContacts(), loadRecentContacts()]);
        break;
      case 'requests':
        await loadRequests();
        break;
      case 'groups':
        await loadGroups(id);
        break;
      case 'files':
        await loadFiles();
        break;
      case 'notifications':
        await loadNotifications(true);
        break;
      case 'profile':
        await loadProfile();
        break;
      case 'privacy':
        await loadPrivacy();
        break;
      case 'security':
        await loadSecurity();
        break;
      case 'admin':
        if (appState.data.me?.role === 'admin') {
          await loadAdmin();
        }
        break;
      default:
        navigate('/app/messages', true);
        return;
    }
  } catch (error) {
    showToast(error.message || 'Unable to load this section right now.');
  } finally {
    appState.loading = false;
  }
}

async function loadInviteLanding(token) {
  appState.loading = true;
  appState.invite = null;
  appState.inviteError = '';
  render();

  try {
    appState.invite = await api(`/invites/public/${encodeURIComponent(token)}`, {
      auth: false,
    });
  } catch (error) {
    appState.inviteError = error.message || 'Unable to load invite.';
  } finally {
    appState.loading = false;
  }
}

async function loadChats() {
  const result = await api('/chats?limit=50');
  appState.data.chats = Array.isArray(result) ? result : [];
}

async function loadMessageSection(chatId) {
  if (!appState.data.chats.length) {
    appState.data.activeChat = null;
    return;
  }

  const targetChatId = chatId || appState.data.chats[0]?.id || appState.data.chats[0]?._id || '';
  if (!targetChatId) {
    appState.data.activeChat = null;
    return;
  }

  const normalizedChatId = String(targetChatId);
  const [chatDetails, messagesResponse] = await Promise.all([
    api(`/chats/${normalizedChatId}`),
    api(`/messages/chat/${normalizedChatId}?limit=80`),
  ]);

  appState.data.activeChat = chatDetails;
  appState.data.messagesByChat[normalizedChatId] = Array.isArray(messagesResponse) ? messagesResponse : [];

  if (appState.socket) {
    appState.socket.emit('chat:join', {
      chatId: normalizedChatId,
    });
  }
}

async function loadContacts() {
  const contacts = await api('/contacts?limit=100');
  appState.data.contacts = Array.isArray(contacts) ? contacts : [];
}

async function loadRecentContacts() {
  const recent = await api('/contacts/recent?limit=10');
  appState.data.recentContacts = Array.isArray(recent) ? recent : [];
}

async function loadRequests() {
  const [incoming, outgoing] = await Promise.all([
    api('/contact-requests/incoming?limit=50'),
    api('/contact-requests/outgoing?limit=50'),
  ]);
  appState.data.requests.incoming = Array.isArray(incoming) ? incoming : [];
  appState.data.requests.outgoing = Array.isArray(outgoing) ? outgoing : [];
}

async function loadGroups(groupId) {
  const groups = await api('/groups?limit=50');
  appState.data.groups = Array.isArray(groups) ? groups : [];

  const chosenGroupId = groupId || appState.data.groups[0]?.group?._id || appState.data.groups[0]?._id || '';
  if (!chosenGroupId) {
    appState.data.activeGroup = null;
    return;
  }

  appState.data.activeGroup = await api(`/groups/${chosenGroupId}`);
}

async function loadFiles() {
  const kind = encodeURIComponent(appState.forms.files?.kind || 'all');
  const q = encodeURIComponent(appState.forms.files?.q || '');
  const path = `/messages/files?limit=60&kind=${kind}${q ? `&q=${q}` : ''}`;
  const files = await api(path);
  appState.data.files = Array.isArray(files) ? files : [];
}

async function loadNotifications(force = false) {
  if (!force && appState.data.notifications.length) {
    appState.unreadCount = appState.data.notifications.filter((item) => !item.isRead).length;
    return;
  }
  const notifications = await api('/notifications?limit=60');
  appState.data.notifications = Array.isArray(notifications) ? notifications : [];
  appState.unreadCount = appState.data.notifications.filter((item) => !item.isRead).length;
}

async function loadProfile() {
  appState.data.profile = await api('/users/me');
}

async function loadPrivacy() {
  appState.data.privacy = await api('/privacy');
}

async function loadSecurity() {
  appState.data.sessions = await api('/auth/sessions');
}

async function loadAdmin() {
  const [dashboard, analytics, reports, users] = await Promise.all([
    api('/admin/dashboard'),
    api('/admin/analytics'),
    api('/admin/reports?limit=10'),
    api('/admin/users?limit=10'),
  ]);
  appState.data.adminDashboard = dashboard;
  appState.data.adminAnalytics = analytics;
  appState.data.adminReports = Array.isArray(reports) ? reports : [];
  appState.data.adminUsers = Array.isArray(users) ? users : [];
}

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const auth = options.auth !== false;
  const headers = {};
  let body;

  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  if (auth && appState.session?.accessToken) {
    headers.Authorization = `Bearer ${appState.session.accessToken}`;
  }

  const response = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body,
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }

  if (response.status === 401 && auth && options.allowRefresh !== false && appState.session?.refreshToken) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return api(path, {
        ...options,
        allowRefresh: false,
      });
    }
  }

  if (!response.ok) {
    throw new Error(extractErrorMessage(payload) || 'Request failed');
  }

  return payload.data !== undefined ? payload.data : payload;
}

async function refreshSession() {
  if (!appState.session?.refreshToken) {
    return false;
  }

  try {
    const response = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refreshToken: appState.session.refreshToken,
      }),
    });

    const payload = await response.json();
    if (!response.ok || !payload?.data?.tokens) {
      clearSession();
      return false;
    }

    appState.session.accessToken = payload.data.tokens.accessToken;
    appState.session.refreshToken = payload.data.tokens.refreshToken;
    if (payload.data.user) {
      appState.data.me = payload.data.user;
    }
    persistSession();
    connectSocket();
    return true;
  } catch (error) {
    clearSession();
    return false;
  }
}

function connectSocket() {
  if (!window.io || !appState.session?.accessToken || appState.socket) {
    return;
  }

  const socket = window.io({
    auth: {
      token: appState.session.accessToken,
    },
  });

  socket.on('connection:init', () => {
    socket.emit('presence:online');
    if (appState.data.activeChat?.id || appState.data.activeChat?._id) {
      socket.emit('chat:join', {
        chatId: String(appState.data.activeChat.id || appState.data.activeChat._id),
      });
    }
  });

  socket.on('message:new', (message) => {
    const chatId = String(message.chatId);
    const list = appState.data.messagesByChat[chatId] || [];
    if (!list.some((item) => String(item._id || item.id) === String(message._id || message.id))) {
      appState.data.messagesByChat[chatId] = [...list, message];
    }
    refreshChatPreview(chatId, message);
    render();
  });

  socket.on('message:updated', (message) => {
    const chatId = String(message.chatId);
    const list = appState.data.messagesByChat[chatId] || [];
    appState.data.messagesByChat[chatId] = list.map((item) => (
      String(item._id || item.id) === String(message._id || message.id) ? message : item
    ));
    render();
  });

  socket.on('message:deleted', ({ chatId, messageId }) => {
    const key = String(chatId);
    const list = appState.data.messagesByChat[key] || [];
    appState.data.messagesByChat[key] = list.filter((item) => String(item._id || item.id) !== String(messageId));
    render();
  });

  socket.on('message:reactions', ({ messageId, reactions }) => {
    const key = String(appState.data.activeChat?.id || appState.data.activeChat?._id || '');
    const list = appState.data.messagesByChat[key] || [];
    appState.data.messagesByChat[key] = list.map((item) => (
      String(item._id || item.id) === String(messageId) ? { ...item, reactions } : item
    ));
    render();
  });

  socket.on('message:typing', ({ chatId, fullName }) => {
    appState.typingByChat[String(chatId)] = fullName || 'Someone';
    render();
  });

  socket.on('message:stop-typing', ({ chatId }) => {
    delete appState.typingByChat[String(chatId)];
    render();
  });

  socket.on('notification:new', (notification) => {
    appState.data.notifications = [notification, ...appState.data.notifications];
    appState.unreadCount += 1;
    render();
  });

  socket.on('notification:count', ({ unreadCount }) => {
    appState.unreadCount = unreadCount;
    render();
  });

  socket.on('notification:read', ({ notificationId, all }) => {
    if (all) {
      appState.data.notifications = appState.data.notifications.map((item) => ({ ...item, isRead: true }));
      appState.unreadCount = 0;
    } else {
      appState.data.notifications = appState.data.notifications.map((item) => (
        String(item._id || item.id) === String(notificationId) ? { ...item, isRead: true } : item
      ));
      appState.unreadCount = appState.data.notifications.filter((item) => !item.isRead).length;
    }
    render();
  });

  socket.on('presence:update', (payload) => {
    if (payload?.userId) {
      appState.presenceByUser[String(payload.userId)] = payload;
      render();
    }
  });

  socket.on('socket:error', ({ message }) => {
    showToast(message || 'A realtime action failed.');
  });

  appState.socket = socket;
}

function disconnectSocket() {
  if (!appState.socket) {
    return;
  }
  appState.socket.disconnect();
  appState.socket = null;
}

function onDocumentClick(event) {
  const actionTarget = event.target.closest('[data-action]');
  if (!actionTarget) {
    return;
  }

  const { action, value } = actionTarget.dataset;

  if (action === 'navigate') {
    event.preventDefault();
    navigate(value);
    return;
  }

  if (action === 'section') {
    event.preventDefault();
    navigate(`/app/${value}`);
    return;
  }

  if (action === 'open-chat') {
    event.preventDefault();
    navigate(`/app/messages/${value}`);
    return;
  }

  if (action === 'back-chat-list') {
    event.preventDefault();
    appState.mobileMessagesView = 'list';
    render();
    return;
  }

  if (action === 'open-group') {
    event.preventDefault();
    navigate(`/app/groups/${value}`);
    return;
  }

  if (action === 'open-contact-chat') {
    event.preventDefault();
    openPrivateChat(value);
    return;
  }

  if (action === 'toggle-password') {
    event.preventDefault();
    const input = actionTarget.closest('.field, .auth-form, .form')?.querySelector('input[type="password"], input[type="text"]');
    if (input) {
      input.type = input.type === 'password' ? 'text' : 'password';
      actionTarget.querySelector('.material-symbols-outlined').textContent = input.type === 'password' ? 'visibility' : 'visibility_off';
    }
    return;
  }

  if (action === 'logout') {
    event.preventDefault();
    logout();
    return;
  }

  if (action === 'invite-accept') {
    event.preventDefault();
    acceptInvite(value);
    return;
  }

  if (action === 'mark-all-read') {
    event.preventDefault();
    markAllNotificationsRead();
    return;
  }

  if (action === 'open-notification') {
    event.preventDefault();
    openNotification(value);
    return;
  }

  if (action === 'attach-file') {
    event.preventDefault();
    document.getElementById('composer-file-input')?.click();
    return;
  }

  if (action === 'clear-attachment') {
    event.preventDefault();
    appState.composerAttachment = null;
    render();
    return;
  }

  if (action === 'favorite-contact') {
    event.preventDefault();
    toggleContactFavorite(value, actionTarget.dataset.favorited === 'true');
    return;
  }

  if (action === 'mute-contact') {
    event.preventDefault();
    toggleContactMute(value, actionTarget.dataset.muted === 'true');
    return;
  }

  if (action === 'request-action') {
    event.preventDefault();
    runRequestAction(actionTarget.dataset.kind, value);
    return;
  }

  if (action === 'group-invite-code') {
    event.preventDefault();
    generateGroupInvite(value);
    return;
  }

  if (action === 'leave-group') {
    event.preventDefault();
    leaveGroup(value);
    return;
  }

  if (action === 'revoke-session') {
    event.preventDefault();
    revokeSession(value);
    return;
  }

  if (action === 'admin-user-status') {
    event.preventDefault();
    updateAdminUserStatus(value, actionTarget.dataset.enabled === 'true');
    return;
  }
}

function onDocumentInput(event) {
  const nearestForm = event.target.closest('[data-form]');
  const form = nearestForm || (event.target.form?.dataset?.form ? event.target.form : null);
  if (!form || !event.target.name) {
    if (event.target.matches('[data-composer-input]') && appState.socket && appState.data.activeChat) {
      const chatId = String(appState.data.activeChat.id || appState.data.activeChat._id);
      if (event.target.value.trim()) {
        appState.socket.emit('message:typing', { chatId });
      } else {
        appState.socket.emit('message:stop-typing', { chatId });
      }
    }
    return;
  }

  const formName = form.dataset.form;
  appState.forms[formName] = appState.forms[formName] || {};
  appState.forms[formName][event.target.name] = event.target.type === 'checkbox'
    ? event.target.checked
    : event.target.value;
}

function onDocumentChange(event) {
  if (event.target.id === 'composer-file-input' && event.target.files?.[0]) {
    const file = event.target.files[0];
    appState.composerAttachment = {
      file,
      name: file.name,
      size: file.size,
      type: file.type,
    };
    render();
    return;
  }

  if (event.target.matches('[data-files-filter]')) {
    const formName = 'files';
    appState.forms[formName] = appState.forms[formName] || {};
    appState.forms[formName][event.target.name] = event.target.value;
  }
}

async function onDocumentSubmit(event) {
  const form = event.target.closest('[data-form]');
  if (!form) {
    return;
  }
  event.preventDefault();
  const formName = form.dataset.form;
  const data = new FormData(form);

  try {
    appState.loading = true;
    render();

    switch (formName) {
      case 'login':
        await submitLogin(data);
        break;
      case 'register':
        await submitRegister(data);
        break;
      case 'forgot-password':
        await submitForgotPassword(data);
        break;
      case 'reset-password':
        await submitResetPassword(data);
        break;
      case 'verify-email':
        await submitVerifyEmail(data);
        break;
      case 'message':
        await submitMessage(data);
        break;
      case 'profile':
        await submitProfile(data);
        break;
      case 'privacy':
        await submitPrivacy(data);
        break;
      case 'change-password':
        await submitPasswordChange(data);
        break;
      case 'create-group':
        await submitCreateGroup(data);
        break;
      case 'join-group':
        await submitJoinGroup(data);
        break;
      case 'search-files':
        await loadFiles();
        break;
      case 'invite-register':
        await submitInviteRegister(data);
        break;
      case 'invite-login':
        await submitInviteLogin(data);
        break;
      default:
        break;
    }
  } catch (error) {
    showToast(error.message || 'Something went wrong.');
  } finally {
    appState.loading = false;
    render();
  }
}

async function submitLogin(formData) {
  const payload = formDataToObject(formData);
  const result = await api('/auth/login', {
    method: 'POST',
    auth: false,
    body: {
      email: payload.email || '',
      password: payload.password || '',
      rememberMe: payload.rememberMe === 'on',
    },
  });

  completeLogin(result);
}

async function submitRegister(formData) {
  const payload = formDataToObject(formData);
  const result = await api('/auth/register', {
    method: 'POST',
    auth: false,
    body: {
      fullName: payload.fullName || '',
      username: payload.username || '',
      email: payload.email || '',
      password: payload.password || '',
      confirmPassword: payload.confirmPassword || '',
    },
  });

  appState.forms['verify-email'] = {
    email: payload.email || '',
  };
  showToast(result?.message || 'Account created. Verify your email to continue.');
  navigate('/verify-email');
}

async function submitForgotPassword(formData) {
  const payload = formDataToObject(formData);
  const result = await api('/auth/forgot-password', {
    method: 'POST',
    auth: false,
    body: {
      email: payload.email || '',
    },
  });

  showToast(result?.resetToken ? `Development reset token: ${result.resetToken}` : 'If the email exists, reset instructions were sent.');
}

async function submitResetPassword(formData) {
  const payload = formDataToObject(formData);
  await api('/auth/reset-password', {
    method: 'POST',
    auth: false,
    body: {
      token: payload.token || '',
      password: payload.password || '',
      confirmPassword: payload.confirmPassword || '',
    },
  });

  showToast('Password reset successfully. You can log in now.');
  navigate('/login');
}

async function submitVerifyEmail(formData) {
  const payload = formDataToObject(formData);
  const result = await api('/auth/verify-email', {
    method: 'POST',
    auth: false,
    body: {
      token: payload.token || '',
    },
  });

  if (result?.tokens) {
    completeLogin(result);
  } else {
    showToast('Email verified successfully.');
    navigate('/login');
  }
}

async function submitMessage(formData) {
  if (!appState.data.activeChat) {
    return;
  }

  const chatId = String(appState.data.activeChat.id || appState.data.activeChat._id);
  const text = String(formData.get('text') || '').trim();
  let payload = {
    chatId,
    type: 'text',
    text,
    clientMessageId: crypto.randomUUID(),
  };

  if (!text && !appState.composerAttachment) {
    return;
  }

  if (appState.composerAttachment?.file) {
    const uploadData = new FormData();
    uploadData.append('file', appState.composerAttachment.file);
    const asset = await api('/uploads/chat-media', {
      method: 'POST',
      formData: uploadData,
    });
    payload = {
      ...payload,
      type: inferMessageTypeFromMedia(asset),
      mediaUrl: asset.url,
      thumbnailUrl: asset.thumbnailUrl,
      mimeType: asset.mimeType,
      fileName: asset.fileName,
      fileSize: asset.fileSize,
      duration: asset.duration,
      width: asset.width,
      height: asset.height,
      aspectRatio: asset.aspectRatio,
      pages: asset.pages,
      extension: asset.extension,
      metadataProcessingStatus: asset.metadataProcessingStatus,
      text,
    };
  }

  const message = await api('/messages', {
    method: 'POST',
    body: payload,
  });

  const list = appState.data.messagesByChat[chatId] || [];
  appState.data.messagesByChat[chatId] = [...list, message];
  refreshChatPreview(chatId, message);
  appState.composerAttachment = null;
  appState.forms.message = {};
  render();
}

async function submitProfile(formData) {
  const payload = formDataToObject(formData);
  const updated = await api('/users/me', {
    method: 'PUT',
    body: {
      fullName: payload.fullName || '',
      username: payload.username || '',
      bio: payload.bio || '',
      location: payload.location || '',
      statusMessage: payload.statusMessage || '',
    },
  });
  appState.data.profile = updated;
  appState.data.me = updated;
  showToast('Profile updated successfully.');
}

async function submitPrivacy(formData) {
  const payload = formDataToObject(formData);
  const updated = await api('/privacy', {
    method: 'PUT',
    body: {
      messagePermission: payload.messagePermission,
      profilePhotoVisibility: payload.profilePhotoVisibility,
      lastSeenVisibility: payload.lastSeenVisibility,
      onlineStatusVisibility: payload.onlineStatusVisibility,
      groupInvitePermission: payload.groupInvitePermission,
      readReceiptsEnabled: payload.readReceiptsEnabled === 'on',
      typingIndicatorEnabled: payload.typingIndicatorEnabled === 'on',
    },
  });
  appState.data.privacy = updated;
  showToast('Privacy settings saved.');
}

async function submitPasswordChange(formData) {
  const payload = formDataToObject(formData);
  await api('/auth/change-password', {
    method: 'PUT',
    body: {
      currentPassword: payload.currentPassword || '',
      newPassword: payload.newPassword || '',
      confirmNewPassword: payload.confirmNewPassword || '',
    },
  });
  showToast('Password changed successfully.');
}

async function submitCreateGroup(formData) {
  const payload = formDataToObject(formData);
  const group = await api('/groups', {
    method: 'POST',
    body: {
      name: payload.name || '',
      description: payload.description || '',
      onlyAdminsCanMessage: payload.onlyAdminsCanMessage === 'on',
      onlyAdminsCanEditInfo: payload.onlyAdminsCanEditInfo === 'on',
      onlyAdminsCanAddMembers: payload.onlyAdminsCanAddMembers === 'on',
    },
  });
  showToast('Group created successfully.');
  navigate(`/app/groups/${group.group?._id || group._id || ''}`);
}

async function submitJoinGroup(formData) {
  const payload = formDataToObject(formData);
  const group = await api(`/groups/join/${encodeURIComponent(payload.inviteCode || '')}`, {
    method: 'POST',
  });
  showToast('Joined group successfully.');
  navigate(`/app/groups/${group.group?._id || group._id || ''}`);
}

async function submitInviteRegister(formData) {
  const token = appState.route.params.token;
  const payload = formDataToObject(formData);
  const result = await api(`/invites/public/${encodeURIComponent(token)}/register`, {
    method: 'POST',
    auth: false,
    body: {
      fullName: payload.fullName || '',
      username: payload.username || '',
      password: payload.password || '',
      confirmPassword: payload.confirmPassword || '',
    },
  });
  completeLogin(result.auth || result);
}

async function submitInviteLogin(formData) {
  const token = appState.route.params.token;
  const payload = formDataToObject(formData);
  const result = await api(`/invites/public/${encodeURIComponent(token)}/login`, {
    method: 'POST',
    auth: false,
    body: {
      email: payload.email || '',
      password: payload.password || '',
      rememberMe: payload.rememberMe === 'on',
    },
  });
  completeLogin(result.auth || result);
}

async function completeLogin(result) {
  appState.session.accessToken = result.tokens.accessToken;
  appState.session.refreshToken = result.tokens.refreshToken;
  appState.data.me = result.user;
  persistSession();
  showToast('Welcome back.');
  navigate('/app/messages');
}

async function logout() {
  try {
    await api('/auth/logout', {
      method: 'POST',
      auth: false,
      body: {
        refreshToken: appState.session?.refreshToken || '',
      },
    });
  } catch (error) {
    // Ignore logout transport errors and clear local state anyway.
  }
  clearSession();
  navigate('/login');
}

async function openPrivateChat(userId) {
  const chat = await api(`/chats/private/${userId}`, {
    method: 'POST',
  });
  await loadChats();
  navigate(`/app/messages/${chat.id || chat._id}`);
}

async function acceptInvite(token) {
  const result = await api(`/invites/public/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
  });
  if (result?.authRequired) {
    showToast('Sign in with the invited account to accept this invite.');
    return;
  }
  showToast('Invite accepted successfully.');
  navigate('/app/messages');
}

async function markAllNotificationsRead() {
  await api('/notifications/read-all', {
    method: 'PUT',
  });
  appState.data.notifications = appState.data.notifications.map((item) => ({ ...item, isRead: true }));
  appState.unreadCount = 0;
  showToast('All notifications marked as read.');
  render();
}

async function openNotification(notificationId) {
  const detail = await api(`/notifications/${notificationId}`);
  if (!detail.isRead) {
    await api(`/notifications/${notificationId}/read`, {
      method: 'PUT',
    });
  }

  const routeHint = detail.route || detail.routeHint;
  if (routeHint?.section === 'chats' && routeHint.params?.chatId) {
    navigate(`/app/messages/${routeHint.params.chatId}`);
    return;
  }
  if (routeHint?.section === 'requests') {
    navigate('/app/requests');
    return;
  }
  if (routeHint?.section === 'groups' && routeHint.params?.groupId) {
    navigate(`/app/groups/${routeHint.params.groupId}`);
    return;
  }
  navigate('/app/notifications');
}

async function toggleContactFavorite(userId, isFavorite) {
  await api(`/contacts/${userId}/favorite`, {
    method: isFavorite ? 'DELETE' : 'POST',
  });
  await loadContacts();
  render();
}

async function toggleContactMute(userId, isMuted) {
  await api(`/contacts/${userId}/mute`, {
    method: isMuted ? 'DELETE' : 'POST',
    body: isMuted ? undefined : {},
  });
  await loadContacts();
  render();
}

async function runRequestAction(kind, requestId) {
  const method = 'PUT';
  await api(`/contact-requests/${requestId}/${kind}`, { method });
  await loadRequests();
  render();
}

async function generateGroupInvite(groupId) {
  const result = await api(`/groups/${groupId}/invite-code`, {
    method: 'POST',
  });
  showToast(`Invite code: ${result.inviteCode}`);
}

async function leaveGroup(groupId) {
  await api(`/groups/${groupId}/leave`, {
    method: 'POST',
  });
  showToast('You left the group.');
  await loadGroups();
  navigate('/app/groups');
}

async function revokeSession(sessionId) {
  await api(`/auth/sessions/${sessionId}`, {
    method: 'DELETE',
  });
  await loadSecurity();
  showToast('Session revoked.');
  render();
}

async function updateAdminUserStatus(userId, enabled) {
  await api(`/admin/users/${userId}/${enabled ? 'suspend' : 'activate'}`, {
    method: 'PUT',
  });
  await loadAdmin();
  showToast(enabled ? 'User suspended.' : 'User activated.');
  render();
}

function refreshChatPreview(chatId, message) {
  appState.data.chats = appState.data.chats.map((chat) => {
    const id = String(chat.id || chat._id);
    if (id !== String(chatId)) {
      return chat;
    }
    return {
      ...chat,
      lastMessagePreview: message.text || message.fileName || message.type || 'Message',
      lastMessageAt: message.createdAt || new Date().toISOString(),
    };
  });
}

function showToast(message) {
  appState.toast = message;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    appState.toast = null;
    render();
  }, TOAST_TIMEOUT_MS);
  render();
}

function extractErrorMessage(payload) {
  if (!payload) {
    return '';
  }
  if (payload.message) {
    return payload.message;
  }
  if (Array.isArray(payload.errors) && payload.errors.length) {
    return payload.errors[0].msg || payload.errors[0].message || 'Request failed';
  }
  return '';
}

function formDataToObject(formData) {
  return Object.fromEntries(formData.entries());
}

function inferMessageTypeFromMedia(asset) {
  if (asset.mediaKind === 'image') {
    return 'image';
  }
  if (asset.mediaKind === 'video') {
    return 'video';
  }
  if (asset.mediaKind === 'audio') {
    return asset.mimeType?.startsWith('audio/') ? 'voice' : 'audio';
  }
  return 'file';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function initials(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 'PC';
  }
  return text
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function formatTime(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDate(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function isCurrentSection(name) {
  return appState.route?.name === 'app' && appState.route.section === name;
}

function render() {
  root.innerHTML = `
    ${renderCurrentView()}
    ${appState.toast ? `<div class="toast">${escapeHtml(appState.toast)}</div>` : ''}
  `;
}

function renderCurrentView() {
  if (appState.route?.name === 'login') {
    return renderLoginPage();
  }
  if (appState.route?.name === 'register') {
    return renderRegisterPage();
  }
  if (appState.route?.name === 'forgot-password') {
    return renderForgotPasswordPage();
  }
  if (appState.route?.name === 'reset-password') {
    return renderResetPasswordPage();
  }
  if (appState.route?.name === 'verify-email') {
    return renderVerifyEmailPage();
  }
  if (appState.route?.name === 'invite') {
    return renderInvitePage();
  }
  if (appState.route?.name === 'app') {
    return renderWorkspace();
  }
  return renderLoginPage();
}

function renderAuthScaffold({ title, subtitle, form, footer, alert = '' }) {
  return `
    <div class="auth-shell">
      <main class="auth-card">
        ${alert ? `<div class="auth-banner"><span class="material-symbols-outlined">info</span><span>${escapeHtml(alert)}</span></div>` : ''}
        <div class="auth-content">
          <div class="auth-brand">
            <h1 class="auth-brand__title">PulseChat</h1>
            <p class="auth-brand__subtitle">Architecture for communication.</p>
          </div>
          <div class="stack" style="gap: 1.5rem;">
            <div>
              <h2 class="headline" style="font-size:1.5rem;margin:0;">${escapeHtml(title)}</h2>
              <p class="form-note">${escapeHtml(subtitle)}</p>
            </div>
            ${form}
            <div class="auth-footer">${footer}</div>
          </div>
        </div>
      </main>
      <div class="auth-meta">
        <span>Secure TLS</span>
        <span>End-to-end ready</span>
        <span>Realtime workspace</span>
      </div>
    </div>
  `;
}

function renderLoginPage() {
  const values = appState.forms.login || {};
  return renderAuthScaffold({
    title: 'Welcome back',
    subtitle: 'Enter your details to access your workspace.',
    form: `
      <form class="auth-form" data-form="login">
        ${renderField('Email Address', 'email', 'email', values.email || '', 'name@company.com')}
        ${renderPasswordField('Password', 'password', values.password || '')}
        <label class="pill" style="width:fit-content;">
          <input type="checkbox" name="rememberMe" ${values.rememberMe ? 'checked' : ''}/>
          <span>Remember me</span>
        </label>
        <button class="primary-button" type="submit">${appState.loading ? 'Signing in...' : 'Sign in'}</button>
      </form>
    `,
    footer: `Don't have an account? <a class="auth-link" href="/register" data-action="navigate" data-value="/register">Create one</a> · <a class="auth-link" href="/forgot-password" data-action="navigate" data-value="/forgot-password">Forgot password</a>`,
  });
}

function renderRegisterPage() {
  const values = appState.forms.register || {};
  return renderAuthScaffold({
    title: 'Create an account',
    subtitle: 'Join PulseChat with a premium, structured workspace experience.',
    form: `
      <form class="auth-form" data-form="register">
        ${renderField('Full name', 'fullName', 'text', values.fullName || '', 'Alex Rivera')}
        ${renderField('Username', 'username', 'text', values.username || '', 'alex_rivera')}
        ${renderField('Email', 'email', 'email', values.email || '', 'alex@company.com')}
        <div class="split">
          ${renderPasswordField('Password', 'password', values.password || '')}
          ${renderPasswordField('Confirm password', 'confirmPassword', values.confirmPassword || '')}
        </div>
        <button class="primary-button" type="submit">${appState.loading ? 'Creating account...' : 'Create account'}</button>
      </form>
    `,
    footer: `Already have an account? <a class="auth-link" href="/login" data-action="navigate" data-value="/login">Log in</a>`,
  });
}

function renderForgotPasswordPage() {
  const values = appState.forms['forgot-password'] || {};
  return renderAuthScaffold({
    title: 'Reset your password',
    subtitle: 'Enter your email and we will send reset instructions if the account exists.',
    form: `
      <form class="auth-form" data-form="forgot-password">
        ${renderField('Email', 'email', 'email', values.email || '', 'name@company.com')}
        <button class="primary-button" type="submit">${appState.loading ? 'Sending...' : 'Send reset link'}</button>
      </form>
    `,
    footer: `<a class="auth-link" href="/login" data-action="navigate" data-value="/login">Back to login</a>`,
  });
}

function renderResetPasswordPage() {
  const values = appState.forms['reset-password'] || {};
  return renderAuthScaffold({
    title: 'Choose a new password',
    subtitle: 'Use the reset token from email, then set a fresh password.',
    form: `
      <form class="auth-form" data-form="reset-password">
        ${renderField('Reset token', 'token', 'text', values.token || '', 'paste your token')}
        ${renderPasswordField('New password', 'password', values.password || '')}
        ${renderPasswordField('Confirm password', 'confirmPassword', values.confirmPassword || '')}
        <button class="primary-button" type="submit">${appState.loading ? 'Resetting...' : 'Reset password'}</button>
      </form>
    `,
    footer: `<a class="auth-link" href="/login" data-action="navigate" data-value="/login">Back to login</a>`,
  });
}

function renderVerifyEmailPage() {
  const values = appState.forms['verify-email'] || {};
  return renderAuthScaffold({
    title: 'Verify your email',
    subtitle: 'Paste the verification token from your inbox to activate your account.',
    form: `
      <form class="auth-form" data-form="verify-email">
        ${renderField('Verification token', 'token', 'text', values.token || '', 'paste your token')}
        <button class="primary-button" type="submit">${appState.loading ? 'Verifying...' : 'Verify email'}</button>
      </form>
    `,
    footer: `Need a new token? Use the resend flow from your account session or contact support.`,
  });
}

function renderInvitePage() {
  const invite = appState.invite;
  const inviteToken = appState.route.params.token;
  const registerValues = appState.forms['invite-register'] || {};
  const loginValues = appState.forms['invite-login'] || {};

  if (appState.loading && !invite) {
    return renderAuthScaffold({
      title: 'Loading invite',
      subtitle: 'Checking this invite link.',
      form: '<div class="loading-state">Preparing your onboarding flow…</div>',
      footer: '',
    });
  }

  if (appState.inviteError || !invite) {
    return renderAuthScaffold({
      title: 'Invite unavailable',
      subtitle: appState.inviteError || 'This invite could not be loaded.',
      form: '<div class="error-state">The invite may be invalid, expired, or revoked.</div>',
      footer: '<a class="auth-link" href="/login" data-action="navigate" data-value="/login">Go to login</a>',
    });
  }

  const statusPillClass = invite.status === 'pending' ? 'pill--primary' : invite.status === 'accepted' ? '' : 'pill--danger';

  return renderAuthScaffold({
    title: 'You were invited to PulseChat',
    subtitle: invite.workspace?.name ? `Join ${invite.workspace.name} as ${invite.role || 'member'}.` : 'Complete onboarding to join this workspace.',
    form: `
      <div class="stack">
        <div class="card card--soft">
          <div class="stack" style="gap:0.55rem;">
            <div class="pill ${statusPillClass}">${escapeHtml(invite.status)}</div>
            <div><strong>${escapeHtml(invite.email || '')}</strong></div>
            <div class="muted">Invited by ${escapeHtml(invite.inviter?.fullName || 'PulseChat')}</div>
          </div>
        </div>
        ${invite.canRegister ? `
          <form class="auth-form" data-form="invite-register">
            ${renderField('Full name', 'fullName', 'text', registerValues.fullName || '', 'Alex Rivera')}
            ${renderField('Username', 'username', 'text', registerValues.username || '', 'alex_rivera')}
            ${renderPasswordField('Password', 'password', registerValues.password || '')}
            ${renderPasswordField('Confirm password', 'confirmPassword', registerValues.confirmPassword || '')}
            <button class="primary-button" type="submit">${appState.loading ? 'Creating account...' : 'Create account and join'}</button>
          </form>
        ` : ''}
        ${invite.canLogin || invite.nextAction === 'sign_in' ? `
          <form class="auth-form" data-form="invite-login">
            ${renderField('Email', 'email', 'email', loginValues.email || invite.email || '', 'name@company.com')}
            ${renderPasswordField('Password', 'password', loginValues.password || '')}
            <label class="pill" style="width:fit-content;">
              <input type="checkbox" name="rememberMe" ${loginValues.rememberMe ? 'checked' : ''}/>
              <span>Remember me</span>
            </label>
            <button class="primary-button" type="submit">${appState.loading ? 'Signing in...' : 'Sign in and accept invite'}</button>
          </form>
        ` : ''}
        ${invite.canAccept ? `<button class="primary-button" type="button" data-action="invite-accept" data-value="${escapeHtml(inviteToken)}">Accept invite</button>` : ''}
      </div>
    `,
    footer: `<a class="auth-link" href="/login" data-action="navigate" data-value="/login">Back to login</a>`,
  });
}

function renderField(label, name, type, value, placeholder) {
  return `
    <label class="field">
      <span class="field__label">${escapeHtml(label)}</span>
      <input class="input" type="${escapeHtml(type)}" name="${escapeHtml(name)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder || '')}" />
    </label>
  `;
}

function renderPasswordField(label, name, value) {
  return `
    <label class="field">
      <span class="field__label">${escapeHtml(label)}</span>
      <div style="position:relative;">
        <input class="input" type="password" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />
        <button class="icon-button" style="position:absolute;right:0.35rem;top:0.35rem;" type="button" data-action="toggle-password">
          <span class="material-symbols-outlined">visibility</span>
        </button>
      </div>
    </label>
  `;
}

function renderWorkspace() {
  return `
    <div class="app-shell">
      ${renderSidebar()}
      <div class="workspace" data-section="${escapeHtml(appState.route.section || 'messages')}" data-mobile-view="${escapeHtml(appState.mobileMessagesView)}">
        ${renderRail()}
        ${renderPanel()}
      </div>
    </div>
    ${renderMobileTabs()}
  `;
}

function renderSidebar() {
  const navItems = [
    ['messages', 'chat_bubble', 'Messages'],
    ['contacts', 'group', 'Contacts'],
    ['requests', 'person_add', 'Requests'],
    ['groups', 'forum', 'Groups'],
    ['files', 'folder_open', 'Files'],
    ['notifications', 'notifications', 'Notifications'],
    ['profile', 'account_circle', 'Profile'],
    ['privacy', 'shield', 'Privacy'],
    ['security', 'security', 'Security'],
  ];

  if (appState.data.me?.role === 'admin') {
    navItems.push(['admin', 'monitoring', 'Admin']);
  }

  return `
    <aside class="sidebar">
      <div class="sidebar__brand">
        <div class="sidebar__brand-badge"><span class="material-symbols-outlined">pulse_alert</span></div>
        <div class="sidebar__brand-text">Pulse</div>
      </div>
      <nav class="sidebar__nav">
        ${navItems.map(([section, icon, label]) => `
          <button class="sidebar__button ${isCurrentSection(section) ? 'is-active' : ''}" title="${escapeHtml(label)}" data-action="section" data-value="${escapeHtml(section)}">
            <span class="material-symbols-outlined">${icon}</span>
          </button>
        `).join('')}
      </nav>
      <div class="sidebar__footer">
        <button class="sidebar__button" data-action="logout" title="Log out">
          <span class="material-symbols-outlined">logout</span>
        </button>
        <div class="sidebar__avatar" title="${escapeHtml(appState.data.me?.fullName || '')}">${escapeHtml(initials(appState.data.me?.fullName || 'PC'))}</div>
      </div>
    </aside>
  `;
}

function renderRail() {
  switch (appState.route.section) {
    case 'messages':
      return renderMessagesRail();
    case 'contacts':
      return renderContactsRail();
    case 'requests':
      return renderRequestsRail();
    case 'groups':
      return renderGroupsRail();
    default:
      return `
        <aside class="rail">
          <div class="rail__header">
            <div class="rail__heading">
              <h1 class="headline">${escapeHtml(sectionLabel(appState.route.section))}</h1>
            </div>
          </div>
          <div class="rail__body"></div>
        </aside>
      `;
  }
}

function renderMessagesRail() {
  const searchValue = appState.forms['messages-search']?.q || '';
  const filtered = appState.data.chats.filter((chat) => {
    const query = searchValue.trim().toLowerCase();
    if (!query) {
      return true;
    }
    return [chat.title, chat.lastMessagePreview, chat.subtitle]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  return `
    <aside class="rail">
      <div class="rail__header">
        <div class="rail__heading">
          <h1 class="headline">Messages</h1>
          <button class="surface-button" type="button" data-action="section" data-value="contacts">New chat</button>
        </div>
        <div class="rail__search-wrap">
          <span class="material-symbols-outlined rail__search-icon">search</span>
          <input class="rail__search" type="search" name="q" form="messages-search-form" value="${escapeHtml(searchValue)}" placeholder="Search conversations" />
        </div>
      </div>
      <div class="rail__body">
        <form id="messages-search-form" data-form="messages-search"></form>
        <div class="list">
          ${filtered.length ? filtered.map((chat) => renderChatRow(chat)).join('') : '<div class="empty-state">No conversations yet.</div>'}
        </div>
      </div>
    </aside>
  `;
}

function renderChatRow(chat) {
  const id = String(chat.id || chat._id);
  const active = String(appState.data.activeChat?.id || appState.data.activeChat?._id || '') === id;
  const image = chat.image || '';
  const presence = chat.otherUserId ? appState.presenceByUser[String(chat.otherUserId)] : null;
  const isOnline = Boolean(presence?.isOnline);

  return `
    <button class="chat-row ${active ? 'is-active' : ''}" data-action="open-chat" data-value="${escapeHtml(id)}">
      <div style="position:relative;">
        <div class="avatar ${chat.type === 'group' ? 'avatar--square' : ''}">
          ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(chat.title || 'chat')}" />` : escapeHtml(initials(chat.title || 'GC'))}
        </div>
        ${chat.type === 'private' ? `<span class="avatar__presence ${isOnline ? 'is-online' : ''}"></span>` : ''}
      </div>
      <div class="list__meta">
        <div class="list__title-row">
          <h3 class="list__title">${escapeHtml(chat.title || 'Conversation')}</h3>
          <span class="list__time">${escapeHtml(formatTime(chat.lastMessageAt) || formatDate(chat.lastMessageAt))}</span>
        </div>
        <div class="list__preview">${escapeHtml(appState.typingByChat[id] ? `${appState.typingByChat[id]} is typing…` : (chat.lastMessagePreview || chat.subtitle || 'No messages yet'))}</div>
      </div>
      ${chat.unreadCount ? `<span class="badge">${escapeHtml(chat.unreadCount)}</span>` : ''}
    </button>
  `;
}

function renderContactsRail() {
  return `
    <aside class="rail">
      <div class="rail__header">
        <div class="rail__heading">
          <h1 class="headline">Contacts</h1>
          <button class="surface-button" type="button" data-action="section" data-value="requests">Requests</button>
        </div>
      </div>
      <div class="rail__body">
        <div class="stack">
          ${appState.data.recentContacts.length ? `
            <div class="card card--soft">
              <h3 class="card__title">Recent</h3>
              <div class="list">${appState.data.recentContacts.slice(0, 4).map((contact) => renderContactRow(contact, true)).join('')}</div>
            </div>
          ` : ''}
          <div class="list">
            ${appState.data.contacts.length ? appState.data.contacts.map((contact) => renderContactRow(contact)).join('') : '<div class="empty-state">No contacts yet.</div>'}
          </div>
        </div>
      </div>
    </aside>
  `;
}

function renderContactRow(contact, compact = false) {
  const user = contact.contactUserId || contact.userId || contact;
  const muted = Boolean(contact.mutedUntil && new Date(contact.mutedUntil) > new Date());
  const favorite = Boolean(contact.isFavorite);
  const presence = user?._id ? appState.presenceByUser[String(user._id)] : null;

  return `
    <div class="person-row">
      <div style="position:relative;">
        <div class="avatar">${user?.profileImage ? `<img src="${escapeHtml(user.profileImage)}" alt="${escapeHtml(user.fullName || 'contact')}" />` : escapeHtml(initials(user?.fullName || 'CT'))}</div>
        <span class="avatar__presence ${presence?.isOnline ? 'is-online' : ''}"></span>
      </div>
      <div class="list__meta">
        <div class="list__title-row">
          <h3 class="list__title">${escapeHtml(user?.fullName || 'Contact')}</h3>
          ${favorite ? '<span class="pill pill--primary">Fav</span>' : ''}
        </div>
        <div class="list__preview">${escapeHtml(user?.username ? `@${user.username}` : (user?.email || 'Contact'))}</div>
      </div>
      ${compact ? '' : `
        <div class="topbar__actions">
          <button class="icon-button" data-action="open-contact-chat" data-value="${escapeHtml(user?._id || '')}" title="Chat"><span class="material-symbols-outlined">chat</span></button>
          <button class="icon-button" data-action="favorite-contact" data-value="${escapeHtml(user?._id || '')}" data-favorited="${favorite}" title="Favorite"><span class="material-symbols-outlined">${favorite ? 'star' : 'star_outline'}</span></button>
          <button class="icon-button" data-action="mute-contact" data-value="${escapeHtml(user?._id || '')}" data-muted="${muted}" title="Mute"><span class="material-symbols-outlined">${muted ? 'notifications_off' : 'notifications'}</span></button>
        </div>
      `}
    </div>
  `;
}

function renderRequestsRail() {
  return `
    <aside class="rail">
      <div class="rail__header">
        <div class="rail__heading">
          <h1 class="headline">Requests</h1>
        </div>
      </div>
      <div class="rail__body">
        <div class="stack">
          <div class="card card--soft">
            <h3 class="card__title">Incoming</h3>
            <div class="list">
              ${appState.data.requests.incoming.length ? appState.data.requests.incoming.map((request) => renderRequestRow(request, false)).join('') : '<div class="muted">No incoming requests.</div>'}
            </div>
          </div>
          <div class="card card--soft">
            <h3 class="card__title">Outgoing</h3>
            <div class="list">
              ${appState.data.requests.outgoing.length ? appState.data.requests.outgoing.map((request) => renderRequestRow(request, true)).join('') : '<div class="muted">No outgoing requests.</div>'}
            </div>
          </div>
        </div>
      </div>
    </aside>
  `;
}

function renderRequestRow(request, outgoing) {
  const user = outgoing ? request.receiverId : request.senderId;
  return `
    <div class="person-row">
      <div class="avatar">${user?.profileImage ? `<img src="${escapeHtml(user.profileImage)}" alt="${escapeHtml(user.fullName || 'user')}" />` : escapeHtml(initials(user?.fullName || 'RQ'))}</div>
      <div class="list__meta">
        <div class="list__title">${escapeHtml(user?.fullName || 'User')}</div>
        <div class="list__preview">${escapeHtml(outgoing ? 'Outgoing request' : 'Incoming request')}</div>
      </div>
      <div class="topbar__actions">
        ${outgoing
          ? `<button class="ghost-button" data-action="request-action" data-kind="cancel" data-value="${escapeHtml(request._id || request.id || '')}">Cancel</button>`
          : `<button class="surface-button" data-action="request-action" data-kind="accept" data-value="${escapeHtml(request._id || request.id || '')}">Accept</button>
             <button class="ghost-button" data-action="request-action" data-kind="reject" data-value="${escapeHtml(request._id || request.id || '')}">Reject</button>`}
      </div>
    </div>
  `;
}

function renderGroupsRail() {
  return `
    <aside class="rail">
      <div class="rail__header">
        <div class="rail__heading">
          <h1 class="headline">Groups</h1>
          <button class="surface-button" type="button" data-action="section" data-value="groups">Manage</button>
        </div>
      </div>
      <div class="rail__body">
        <form class="card card--soft form" data-form="create-group">
          <h3 class="card__title">Create group</h3>
          ${renderField('Name', 'name', 'text', appState.forms['create-group']?.name || '', 'Design reviews')}
          ${renderField('Description', 'description', 'text', appState.forms['create-group']?.description || '', 'Short group summary')}
          <label class="pill"><input type="checkbox" name="onlyAdminsCanMessage" ${appState.forms['create-group']?.onlyAdminsCanMessage ? 'checked' : ''}/><span>Admins only can message</span></label>
          <button class="primary-button" type="submit">${appState.loading ? 'Creating...' : 'Create group'}</button>
        </form>
        <div class="list">
          ${appState.data.groups.length ? appState.data.groups.map((item) => renderGroupRow(item)).join('') : '<div class="empty-state">No groups yet.</div>'}
        </div>
      </div>
    </aside>
  `;
}

function renderGroupRow(item) {
  const group = item.group || item;
  const active = String(appState.data.activeGroup?.group?._id || appState.data.activeGroup?.group?.id || '') === String(group._id || group.id || '');
  return `
    <button class="group-row ${active ? 'is-active' : ''}" data-action="open-group" data-value="${escapeHtml(group._id || group.id || '')}">
      <div class="avatar avatar--square">${group.image ? `<img src="${escapeHtml(group.image)}" alt="${escapeHtml(group.name || 'group')}" />` : escapeHtml(initials(group.name || 'GR'))}</div>
      <div class="list__meta">
        <div class="list__title">${escapeHtml(group.name || 'Group')}</div>
        <div class="list__preview">${escapeHtml(group.description || 'Shared workspace group')}</div>
      </div>
    </button>
  `;
}

function renderPanel() {
  switch (appState.route.section) {
    case 'messages':
      return renderMessagesPanel();
    case 'contacts':
      return renderContactsPanel();
    case 'requests':
      return renderRequestsPanel();
    case 'groups':
      return renderGroupsPanel();
    case 'files':
      return renderFilesPanel();
    case 'notifications':
      return renderNotificationsPanel();
    case 'profile':
      return renderProfilePanel();
    case 'privacy':
      return renderPrivacyPanel();
    case 'security':
      return renderSecurityPanel();
    case 'admin':
      return renderAdminPanel();
    default:
      return `<section class="panel"><div class="panel__body"><div class="empty-state">Select a section.</div></div></section>`;
  }
}

function renderMessagesPanel() {
  const chat = appState.data.activeChat;
  const chatId = String(chat?.id || chat?._id || '');
  const messages = appState.data.messagesByChat[chatId] || [];

  if (!chat) {
    return `
      <section class="panel">
        <div class="panel__body"><div class="empty-state">Choose a conversation to start messaging.</div></div>
      </section>
    `;
  }

  return `
    <section class="panel">
      <header class="panel__header">
        <div class="panel__header-main">
          <button class="icon-button" data-action="back-chat-list"><span class="material-symbols-outlined">arrow_back</span></button>
          <div class="avatar ${chat.type === 'group' ? 'avatar--square' : ''}">${chat.image ? `<img src="${escapeHtml(chat.image)}" alt="${escapeHtml(chat.title || 'chat')}" />` : escapeHtml(initials(chat.title || 'CH'))}</div>
          <div>
            <h2 class="headline" style="font-size:1.2rem;margin:0;">${escapeHtml(chat.title || 'Conversation')}</h2>
            <div class="muted">${escapeHtml(chat.type === 'group' ? chat.subtitle || 'Group conversation' : (appState.typingByChat[chatId] ? `${appState.typingByChat[chatId]} is typing…` : 'Private conversation'))}</div>
          </div>
        </div>
        <div class="panel__header-actions">
          <button class="icon-button" data-action="section" data-value="files" title="Files"><span class="material-symbols-outlined">folder_open</span></button>
          <button class="icon-button" data-action="section" data-value="notifications" title="Notifications"><span class="material-symbols-outlined">notifications</span></button>
        </div>
      </header>
      <div class="panel__body panel__body--messages">
        <div class="thread">
          <div class="thread__separator">${escapeHtml(formatDate(new Date()))}</div>
          ${messages.length ? messages.map((message) => renderMessage(message)).join('') : '<div class="empty-state">No messages yet. Say hello.</div>'}
        </div>
      </div>
      <div class="composer-wrap">
        <form class="composer" data-form="message">
          ${appState.composerAttachment ? `
            <div class="card card--soft" style="padding:0.8rem;margin-bottom:0.6rem;">
              <div class="topbar">
                <div>
                  <div class="list__title">${escapeHtml(appState.composerAttachment.name)}</div>
                  <div class="muted">${escapeHtml(formatFileSize(appState.composerAttachment.size))}</div>
                </div>
                <button class="ghost-button" type="button" data-action="clear-attachment">Remove</button>
              </div>
            </div>
          ` : ''}
          <textarea class="composer__input" name="text" data-composer-input placeholder="Message ${escapeHtml(chat.title || '')}">${escapeHtml(appState.forms.message?.text || '')}</textarea>
          <div class="toolbar">
            <div class="toolbar__left">
              <button class="icon-button" type="button" data-action="attach-file"><span class="material-symbols-outlined">attach_file</span></button>
              <input id="composer-file-input" class="hidden" type="file" />
            </div>
            <div class="toolbar__right">
              <button class="primary-button" type="submit">${appState.loading ? 'Sending...' : 'Send'}</button>
            </div>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderMessage(message) {
  const currentUserId = String(appState.data.me?._id || appState.data.me?.id || '');
  const senderId = String(message.senderId?._id || message.senderId?.id || message.senderId || '');
  const outgoing = senderId === currentUserId;
  const isFile = Boolean(message.mediaUrl);
  const reply = message.replyToMessageId;

  return `
    <div class="message ${outgoing ? 'message--outgoing' : ''}">
      ${outgoing ? '' : `<div class="avatar">${message.senderId?.profileImage ? `<img src="${escapeHtml(message.senderId.profileImage)}" alt="${escapeHtml(message.senderId.fullName || 'sender')}" />` : escapeHtml(initials(message.senderId?.fullName || 'U'))}</div>`}
      <div class="message__stack">
        <div class="message__meta">
          ${outgoing ? '' : `<span class="message__author">${escapeHtml(message.senderId?.fullName || 'Teammate')}</span>`}
          <span>${escapeHtml(formatTime(message.createdAt))}</span>
          ${message.editedAt ? '<span>edited</span>' : ''}
        </div>
        <div class="message__bubble">
          ${reply ? `<div class="pill" style="margin-bottom:0.5rem;">Replying to ${escapeHtml(reply.senderId?.fullName || 'message')}</div>` : ''}
          ${message.text ? `<p>${escapeHtml(message.text)}</p>` : ''}
          ${isFile ? renderMessageFile(message, outgoing) : ''}
        </div>
        <div class="message__status">
          ${outgoing ? '<span class="material-symbols-outlined" style="font-size:1rem;">check_circle</span><span>Delivered</span>' : ''}
        </div>
      </div>
    </div>
  `;
}

function renderMessageFile(message, outgoing) {
  return `
    <div class="message__file" style="${message.text ? 'margin-top:0.75rem;' : ''}">
      <span class="material-symbols-outlined">${message.type === 'image' ? 'image' : message.type === 'video' ? 'videocam' : message.type === 'voice' ? 'mic' : 'description'}</span>
      <div style="min-width:0;flex:1;">
        <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(message.fileName || message.type || 'Attachment')}</div>
        <div style="font-size:0.78rem;color:${outgoing ? 'rgba(255,255,255,0.78)' : 'var(--text-muted)'};">${escapeHtml(message.mimeType || formatFileSize(message.fileSize || 0))}</div>
      </div>
      ${message.mediaUrl ? `<a class="surface-button" style="padding:0.55rem 0.8rem;" href="${escapeHtml(message.mediaUrl)}" target="_blank" rel="noreferrer">Open</a>` : ''}
    </div>
  `;
}

function renderContactsPanel() {
  return `
    <section class="panel">
      <div class="panel__header">
        <div class="panel__header-main">
          <div>
            <h2 class="headline" style="font-size:1.25rem;margin:0;">People</h2>
            <div class="muted">Search, review, and message your network.</div>
          </div>
        </div>
      </div>
      <div class="panel__body">
        <div class="page">
          <div class="card card--soft">
            <div class="topbar">
              <div>
                <h3 class="card__title">Contacts</h3>
                <div class="muted">${appState.data.contacts.length} saved contact${appState.data.contacts.length === 1 ? '' : 's'}</div>
              </div>
            </div>
            <div class="stack">
              ${appState.data.contacts.length ? appState.data.contacts.map((contact) => renderContactRow(contact)).join('') : '<div class="empty-state">Start by sending a contact request.</div>'}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderRequestsPanel() {
  return `
    <section class="panel">
      <div class="panel__header">
        <div class="panel__header-main">
          <div>
            <h2 class="headline" style="font-size:1.25rem;margin:0;">Contact requests</h2>
            <div class="muted">Manage incoming and outgoing requests.</div>
          </div>
        </div>
      </div>
      <div class="panel__body">
        <div class="split">
          <div class="card">
            <h3 class="card__title">Incoming</h3>
            <div class="stack">
              ${appState.data.requests.incoming.length ? appState.data.requests.incoming.map((request) => renderRequestRow(request, false)).join('') : '<div class="muted">No incoming requests.</div>'}
            </div>
          </div>
          <div class="card">
            <h3 class="card__title">Outgoing</h3>
            <div class="stack">
              ${appState.data.requests.outgoing.length ? appState.data.requests.outgoing.map((request) => renderRequestRow(request, true)).join('') : '<div class="muted">No outgoing requests.</div>'}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderGroupsPanel() {
  const groupData = appState.data.activeGroup;
  const group = groupData?.group;
  const members = groupData?.members || [];
  return `
    <section class="panel">
      <div class="panel__header">
        <div class="panel__header-main">
          <div>
            <h2 class="headline" style="font-size:1.25rem;margin:0;">${escapeHtml(group?.name || 'Groups')}</h2>
            <div class="muted">${escapeHtml(group?.description || 'Team channels, permissions, and invite management.')}</div>
          </div>
        </div>
        ${group ? `
          <div class="panel__header-actions">
            <button class="surface-button" type="button" data-action="group-invite-code" data-value="${escapeHtml(group._id || '')}">Invite code</button>
            <button class="ghost-button" type="button" data-action="leave-group" data-value="${escapeHtml(group._id || '')}">Leave</button>
          </div>
        ` : ''}
      </div>
      <div class="panel__body">
        ${group ? `
          <div class="page">
            <div class="stats">
              <div class="stat"><div class="muted">Members</div><div class="stat__value">${members.length}</div></div>
              <div class="stat"><div class="muted">Admins only chat</div><div class="stat__value">${group.onlyAdminsCanMessage ? 'Yes' : 'No'}</div></div>
              <div class="stat"><div class="muted">Admins manage members</div><div class="stat__value">${group.onlyAdminsCanAddMembers ? 'Yes' : 'No'}</div></div>
            </div>
            <div class="card">
              <h3 class="card__title">Members</h3>
              <div class="stack">
                ${members.map((member) => `
                  <div class="person-row">
                    <div class="avatar">${member.userId?.profileImage ? `<img src="${escapeHtml(member.userId.profileImage)}" alt="${escapeHtml(member.userId.fullName || 'member')}" />` : escapeHtml(initials(member.userId?.fullName || 'GM'))}</div>
                    <div class="list__meta">
                      <div class="list__title">${escapeHtml(member.userId?.fullName || 'Member')}</div>
                      <div class="list__preview">${escapeHtml(member.role || 'member')}</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
            <form class="card form" data-form="join-group">
              <h3 class="card__title">Join by invite code</h3>
              ${renderField('Invite code', 'inviteCode', 'text', appState.forms['join-group']?.inviteCode || '', 'paste invite code')}
              <button class="primary-button" type="submit">${appState.loading ? 'Joining...' : 'Join group'}</button>
            </form>
          </div>
        ` : '<div class="empty-state">Select a group to see member details and settings.</div>'}
      </div>
    </section>
  `;
}

function renderFilesPanel() {
  const values = appState.forms.files || {};
  return `
    <section class="panel">
      <div class="panel__header">
        <div class="panel__header-main">
          <div>
            <h2 class="headline" style="font-size:1.25rem;margin:0;">Shared files</h2>
            <div class="muted">Browse attachments, voice notes, and media across your chats.</div>
          </div>
        </div>
      </div>
      <div class="panel__body">
        <div class="page">
          <form class="card form" data-form="search-files">
            <div class="section-toolbar">
              <div class="filters">
                <input class="input" type="search" name="q" value="${escapeHtml(values.q || '')}" placeholder="Search by filename" />
                <select class="select" name="kind" data-files-filter>
                  ${['all', 'image', 'video', 'audio', 'document', 'other'].map((kind) => `<option value="${kind}" ${String(values.kind || 'all') === kind ? 'selected' : ''}>${kind}</option>`).join('')}
                </select>
              </div>
              <button class="primary-button" type="submit">Apply filters</button>
            </div>
          </form>
          <div class="files-grid">
            ${appState.data.files.length ? appState.data.files.map((file) => `
              <article class="file-card">
                <div class="file-card__thumb">
                  ${file.thumbnailUrl ? `<img src="${escapeHtml(file.thumbnailUrl)}" alt="${escapeHtml(file.fileName || 'file')}" />` : `<span class="material-symbols-outlined">${file.mediaKind === 'image' ? 'image' : file.mediaKind === 'video' ? 'videocam' : file.mediaKind === 'audio' ? 'graphic_eq' : 'description'}</span>`}
                </div>
                <div>
                  <div class="list__title">${escapeHtml(file.fileName || 'Shared file')}</div>
                  <div class="list__preview">${escapeHtml(file.mimeType || file.mediaKind || 'file')}</div>
                </div>
                <div class="topbar__actions">
                  ${file.mediaUrl ? `<a class="surface-button" href="${escapeHtml(file.mediaUrl)}" target="_blank" rel="noreferrer">Open</a>` : ''}
                  <button class="ghost-button" type="button" data-action="open-chat" data-value="${escapeHtml(file.chatId || '')}">Open chat</button>
                </div>
              </article>
            `).join('') : '<div class="empty-state">No files match this view.</div>'}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderNotificationsPanel() {
  return `
    <section class="panel">
      <div class="panel__header">
        <div class="panel__header-main">
          <div>
            <h2 class="headline" style="font-size:1.25rem;margin:0;">Notifications</h2>
            <div class="muted">Unread: ${appState.unreadCount}</div>
          </div>
        </div>
        <div class="panel__header-actions">
          <button class="surface-button" type="button" data-action="mark-all-read">Mark all read</button>
        </div>
      </div>
      <div class="panel__body">
        <div class="stack">
          ${appState.data.notifications.length ? appState.data.notifications.map((notification) => `
            <button class="notification-row card ${notification.isRead ? '' : 'card--soft'}" data-action="open-notification" data-value="${escapeHtml(notification._id || notification.id || '')}">
              <div class="list__meta">
                <div class="list__title-row">
                  <h3 class="list__title">${escapeHtml(notification.title || notification.type || 'Notification')}</h3>
                  <span class="list__time">${escapeHtml(formatDate(notification.createdAt))}</span>
                </div>
                <div class="list__preview">${escapeHtml(notification.body || '')}</div>
              </div>
              ${notification.isRead ? '' : '<span class="badge">New</span>'}
            </button>
          `).join('') : '<div class="empty-state">No notifications yet.</div>'}
        </div>
      </div>
    </section>
  `;
}

function renderProfilePanel() {
  const profile = appState.data.profile || appState.data.me || {};
  const values = appState.forms.profile || profile;
  return `
    <section class="panel">
      <div class="panel__header">
        <div class="panel__header-main">
          <div>
            <h2 class="headline" style="font-size:1.25rem;margin:0;">Profile</h2>
            <div class="muted">Manage your personal workspace identity.</div>
          </div>
        </div>
      </div>
      <div class="panel__body">
        <form class="card form" data-form="profile">
          ${renderField('Full name', 'fullName', 'text', values.fullName || '', 'Alex Rivera')}
          ${renderField('Username', 'username', 'text', values.username || '', 'alex_rivera')}
          ${renderField('Location', 'location', 'text', values.location || '', 'Riyadh')}
          ${renderField('Status message', 'statusMessage', 'text', values.statusMessage || '', 'Designing the next release')}
          <label class="field">
            <span class="field__label">Bio</span>
            <textarea class="textarea" name="bio" rows="5">${escapeHtml(values.bio || '')}</textarea>
          </label>
          <button class="primary-button" type="submit">${appState.loading ? 'Saving...' : 'Save profile'}</button>
        </form>
      </div>
    </section>
  `;
}

function renderPrivacyPanel() {
  const privacy = appState.data.privacy || {};
  const values = {
    ...privacy,
    ...(appState.forms.privacy || {}),
  };
  return `
    <section class="panel">
      <div class="panel__header">
        <div class="panel__header-main">
          <div>
            <h2 class="headline" style="font-size:1.25rem;margin:0;">Privacy</h2>
            <div class="muted">Configure messaging, presence, and visibility controls.</div>
          </div>
        </div>
      </div>
      <div class="panel__body">
        <form class="card form" data-form="privacy">
          ${renderSelectField('Who can message me', 'messagePermission', values.messagePermission || 'everyone', ['everyone', 'contacts'])}
          ${renderSelectField('Profile photo visibility', 'profilePhotoVisibility', values.profilePhotoVisibility || 'everyone', ['everyone', 'contacts', 'nobody'])}
          ${renderSelectField('Last seen visibility', 'lastSeenVisibility', values.lastSeenVisibility || 'everyone', ['everyone', 'contacts', 'nobody'])}
          ${renderSelectField('Online visibility', 'onlineStatusVisibility', values.onlineStatusVisibility || 'everyone', ['everyone', 'contacts', 'nobody'])}
          ${renderSelectField('Group invite permission', 'groupInvitePermission', values.groupInvitePermission || 'everyone', ['everyone', 'contacts'])}
          <label class="pill"><input type="checkbox" name="readReceiptsEnabled" ${values.readReceiptsEnabled ? 'checked' : ''} /> <span>Read receipts</span></label>
          <label class="pill"><input type="checkbox" name="typingIndicatorEnabled" ${values.typingIndicatorEnabled ? 'checked' : ''} /> <span>Typing indicators</span></label>
          <button class="primary-button" type="submit">${appState.loading ? 'Saving...' : 'Save privacy settings'}</button>
        </form>
      </div>
    </section>
  `;
}

function renderSecurityPanel() {
  return `
    <section class="panel">
      <div class="panel__header">
        <div class="panel__header-main">
          <div>
            <h2 class="headline" style="font-size:1.25rem;margin:0;">Security & sessions</h2>
            <div class="muted">Review active sessions and change your password.</div>
          </div>
        </div>
      </div>
      <div class="panel__body">
        <div class="split">
          <form class="card form" data-form="change-password">
            <h3 class="card__title">Change password</h3>
            ${renderPasswordField('Current password', 'currentPassword', appState.forms['change-password']?.currentPassword || '')}
            ${renderPasswordField('New password', 'newPassword', appState.forms['change-password']?.newPassword || '')}
            ${renderPasswordField('Confirm new password', 'confirmNewPassword', appState.forms['change-password']?.confirmNewPassword || '')}
            <button class="primary-button" type="submit">${appState.loading ? 'Saving...' : 'Change password'}</button>
          </form>
          <div class="card">
            <div class="topbar">
              <div>
                <h3 class="card__title">Active sessions</h3>
                <div class="muted">${Array.isArray(appState.data.sessions) ? appState.data.sessions.length : 0} sessions</div>
              </div>
              <button class="ghost-button" type="button" data-action="logout">Log out here</button>
            </div>
            <div class="stack">
              ${Array.isArray(appState.data.sessions) && appState.data.sessions.length ? appState.data.sessions.map((session) => `
                <div class="session-row card--soft">
                  <div class="list__meta">
                    <div class="list__title">${escapeHtml(session.userAgent || 'Unknown device')}</div>
                    <div class="list__preview">${escapeHtml(session.lastUsedIp || session.createdIp || 'Unknown IP')} · ${escapeHtml(formatDate(session.lastUsedAt || session.createdAt))}</div>
                  </div>
                  <button class="ghost-button" type="button" data-action="revoke-session" data-value="${escapeHtml(session.id || session._id || '')}">Revoke</button>
                </div>
              `).join('') : '<div class="muted">No other sessions found.</div>'}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderAdminPanel() {
  if (appState.data.me?.role !== 'admin') {
    return `
      <section class="panel">
        <div class="panel__body"><div class="error-state">Admin access is required to view this section.</div></div>
      </section>
    `;
  }

  const dashboard = appState.data.adminDashboard || {};
  return `
    <section class="panel">
      <div class="panel__header">
        <div class="panel__header-main">
          <div>
            <h2 class="headline" style="font-size:1.25rem;margin:0;">Admin dashboard</h2>
            <div class="muted">Operational visibility across the workspace.</div>
          </div>
        </div>
      </div>
      <div class="panel__body">
        <div class="page">
          <div class="stats">
            ${Object.entries(dashboard).slice(0, 4).map(([key, value]) => `
              <div class="stat">
                <div class="muted">${escapeHtml(key)}</div>
                <div class="stat__value">${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : String(value ?? '0'))}</div>
              </div>
            `).join('')}
          </div>
          <div class="split">
            <div class="card">
              <h3 class="card__title">Reports</h3>
              ${renderAdminReportsTable()}
            </div>
            <div class="card">
              <h3 class="card__title">Users</h3>
              ${renderAdminUsersTable()}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderAdminReportsTable() {
  if (!appState.data.adminReports.length) {
    return '<div class="muted">No reports found.</div>';
  }
  return `
    <table class="table">
      <thead><tr><th>Status</th><th>Reason</th><th>Created</th></tr></thead>
      <tbody>
        ${appState.data.adminReports.map((report) => `
          <tr>
            <td>${escapeHtml(report.status || 'open')}</td>
            <td>${escapeHtml(report.reason || '—')}</td>
            <td>${escapeHtml(formatDate(report.createdAt))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderAdminUsersTable() {
  if (!appState.data.adminUsers.length) {
    return '<div class="muted">No users found.</div>';
  }
  return `
    <table class="table">
      <thead><tr><th>User</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>
        ${appState.data.adminUsers.map((user) => `
          <tr>
            <td>${escapeHtml(user.fullName || user.username || 'User')}</td>
            <td>${escapeHtml(user.isActive ? 'active' : 'suspended')}</td>
            <td><button class="ghost-button" type="button" data-action="admin-user-status" data-value="${escapeHtml(user._id || user.id || '')}" data-enabled="${Boolean(user.isActive)}">${user.isActive ? 'Suspend' : 'Activate'}</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderSelectField(label, name, selectedValue, values) {
  return `
    <label class="field">
      <span class="field__label">${escapeHtml(label)}</span>
      <select class="select" name="${escapeHtml(name)}">
        ${values.map((value) => `<option value="${escapeHtml(value)}" ${selectedValue === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
      </select>
    </label>
  `;
}

function renderMobileTabs() {
  const items = [
    ['messages', 'chat_bubble'],
    ['contacts', 'group'],
    ['groups', 'forum'],
    ['files', 'folder_open'],
    ['notifications', 'notifications'],
  ];

  return `
    <nav class="mobile-tabs">
      ${items.map(([section, icon]) => `
        <button class="sidebar__button ${isCurrentSection(section) ? 'is-active' : ''}" data-action="section" data-value="${escapeHtml(section)}">
          <span class="material-symbols-outlined">${icon}</span>
        </button>
      `).join('')}
    </nav>
  `;
}

function sectionLabel(section) {
  const labels = {
    messages: 'Messages',
    contacts: 'Contacts',
    requests: 'Requests',
    groups: 'Groups',
    files: 'Files',
    notifications: 'Notifications',
    profile: 'Profile',
    privacy: 'Privacy',
    security: 'Security',
    admin: 'Admin',
  };
  return labels[section] || 'Workspace';
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}
