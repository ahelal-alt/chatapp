const appRoot = document.getElementById('app');
const SESSION_KEY = 'pulsechat-session';

const demoWorkspace = createDemoWorkspace();

const state = {
  screen: 'auth',
  authView: 'login',
  activeSection: 'chats',
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
  admin: {
    summary: null,
  },
  typingByChat: {},
  toasts: [],
  socket: null,
  connectedChatId: null,
};

init();

appRoot.addEventListener('click', handleClick);
appRoot.addEventListener('submit', handleSubmit);
appRoot.addEventListener('input', handleInput);

async function init() {
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

function disconnectSocket() {
  if (state.socket) {
    state.socket.disconnect();
  }

  state.socket = null;
  state.connectedChatId = null;
}

function joinSelectedChatRoom() {
  if (!state.socket || !state.selectedChatId || state.connectedChatId === state.selectedChatId) {
    return;
  }

  if (state.connectedChatId) {
    state.socket.emit('chat:leave', { chatId: state.connectedChatId });
  }

  state.connectedChatId = state.selectedChatId;
  state.socket.emit('chat:join', { chatId: state.selectedChatId });
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

function connectLiveSocket() {
  if (state.dataSource !== 'api' || !state.token || typeof window.io !== 'function') {
    return;
  }

  if (state.socket?.connected) {
    joinSelectedChatRoom();
    return;
  }

  disconnectSocket();

  const socket = window.io({
    auth: {
      token: state.token,
    },
  });

  socket.on('connect', () => {
    joinSelectedChatRoom();
  });

  socket.on('presence:update', ({ userId, isOnline, lastSeen }) => {
    state.contacts = state.contacts.map((contact) => (
      String(contact.id) === String(userId)
        ? { ...contact, isOnline, lastSeen: lastSeen || contact.lastSeen }
        : contact
    ));
    render();
  });

  socket.on('chat:updated', ({ chatId, lastMessagePreview, lastMessageAt }) => {
    const chat = state.chats.find((item) => item.id === String(chatId));
    if (!chat) {
      return;
    }

    chat.lastMessagePreview = lastMessagePreview || chat.lastMessagePreview;
    chat.lastMessageAt = lastMessageAt || chat.lastMessageAt;
    state.chats.sort((left, right) => new Date(right.lastMessageAt) - new Date(left.lastMessageAt));
    render();
  });

  socket.on('message:new', (payload) => {
    const message = normalizeMessage(payload);
    const chatId = message.chatId;
    const current = state.messagesByChat[chatId] || [];
    if (!current.some((item) => item.id === message.id)) {
      state.messagesByChat[chatId] = [...current, message];
    }

    const chat = state.chats.find((item) => item.id === chatId);
    if (chat) {
      chat.lastMessagePreview = message.text || message.fileName || capitalize(message.type || 'message');
      chat.lastMessageAt = message.createdAt;
      if (!message.mine && state.selectedChatId !== chatId) {
        chat.unreadCount = Number(chat.unreadCount || 0) + 1;
      }
    }

    render();
  });

  socket.on('message:updated', (payload) => {
    const message = normalizeMessage(payload);
    state.messagesByChat[message.chatId] = (state.messagesByChat[message.chatId] || []).map((item) => (
      item.id === message.id ? { ...item, ...message } : item
    ));
    render();
  });

  socket.on('message:deleted', ({ chatId, messageId }) => {
    state.messagesByChat[chatId] = (state.messagesByChat[chatId] || []).filter((item) => item.id !== String(messageId));
    render();
  });

  socket.on('message:seen', ({ chatId, messageId }) => {
    state.messagesByChat[chatId] = (state.messagesByChat[chatId] || []).map((item) => (
      item.id === String(messageId)
        ? { ...item, seenCount: Number(item.seenCount || 0) + 1 }
        : item
    ));
    render();
  });

  socket.on('message:typing', ({ chatId, fullName }) => {
    state.typingByChat[chatId] = `${fullName || 'Someone'} is typing...`;
    render();
  });

  socket.on('message:stop-typing', ({ chatId }) => {
    delete state.typingByChat[chatId];
    render();
  });

  socket.on('notification:new', (payload) => {
    const notification = normalizeNotification(payload);
    state.notifications = [notification, ...state.notifications.filter((item) => item.id !== notification.id)];
    render();
  });

  socket.on('notification:read', ({ notificationId, all }) => {
    if (all) {
      state.notifications = state.notifications.map((item) => ({ ...item, isRead: true }));
    } else {
      state.notifications = state.notifications.map((item) => (
        item.id === String(notificationId) ? { ...item, isRead: true } : item
      ));
    }
    render();
  });

  socket.on('notification:count', ({ unreadCount }) => {
    const currentUnread = state.notifications.filter((item) => !item.isRead).length;
    if (unreadCount > currentUnread) {
      pushToast('New activity', 'Your live notifications have been updated.', 'info');
    }
    render();
  });

  state.socket = socket;
}

function syncDemoState() {
  disconnectSocket();
  state.dataSource = 'demo';
  state.user = structuredClone(demoWorkspace.user);
  state.privacy = structuredClone(demoWorkspace.privacy);
  state.chats = structuredClone(demoWorkspace.chats);
  state.contacts = structuredClone(demoWorkspace.contacts);
  state.requests = structuredClone(demoWorkspace.requests);
  state.groups = structuredClone(demoWorkspace.groups);
  state.notifications = structuredClone(demoWorkspace.notifications);
  state.messagesByChat = structuredClone(demoWorkspace.messagesByChat);
  state.admin.summary = null;
  state.typingByChat = {};
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
    const [chatsRes, contactsRes, incomingRes, outgoingRes, notificationsRes, adminRes] = await Promise.allSettled([
      apiFetch('/api/v1/chats?limit=20'),
      apiFetch('/api/v1/contacts?limit=20'),
      apiFetch('/api/v1/contact-requests/incoming?limit=20'),
      apiFetch('/api/v1/contact-requests/outgoing?limit=20'),
      apiFetch('/api/v1/notifications?limit=20'),
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
    state.admin.summary = adminRes.status === 'fulfilled' ? adminRes.value.data || null : null;
    state.groups = buildGroupsFromChats(state.chats);
    state.messagesByChat = {};
    state.typingByChat = {};
    state.selectedChatId = state.chats[0]?.id || null;
    state.selectedContactId = state.contacts[0]?.id || null;
    state.selectedGroupId = state.groups[0]?.id || null;

    if (state.selectedChatId) {
      await loadChatMessages(state.selectedChatId);
    }

    connectLiveSocket();

    const failedSections = [
      ['chats', chatsRes],
      ['contacts', contactsRes],
      ['incoming requests', incomingRes],
      ['outgoing requests', outgoingRes],
      ['notifications', notificationsRes],
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

function normalizeMessage(item) {
  const sender = item.senderId || {};
  const senderId = sender._id || sender.id || item.senderId;
  return {
    id: item._id || item.id,
    chatId: item.chatId?._id || item.chatId || null,
    senderId,
    senderName: sender.fullName || 'Unknown user',
    text: item.text || '',
    type: item.type || 'text',
    mediaUrl: item.mediaUrl || '',
    fileName: item.fileName || '',
    replyText: item.replyToMessageId?.text || '',
    createdAt: item.createdAt,
    editedAt: item.editedAt || null,
    pinnedAt: item.pinnedAt || null,
    seenCount: item.seenBy?.length || 0,
    mine: String(senderId) === String(state.user?.id),
  };
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
    const chat = state.chats.find((item) => item.id === chatId);
    if (chat) {
      chat.unreadCount = 0;
    }
    joinSelectedChatRoom();
  } catch (error) {
    pushToast('Messages unavailable', error.message, 'info');
    state.messagesByChat[chatId] = [];
  }

  render();
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.message || 'Request failed');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
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
      <div class="loading-card">
        <div class="eyebrow">Loading Workspace</div>
        <h1 class="main-heading">Preparing your chat surfaces.</h1>
        <p class="helper-text">Fetching your session, recent conversations, contacts, and notification state.</p>
        <div class="loading-bar" aria-hidden="true"></div>
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
  const unreadCount = state.notifications.filter((item) => !item.isRead).length;
  const pendingCount = state.requests.incoming.length + state.requests.outgoing.length;
  const selectedChat = getSelectedChat();

  return `
    <div class="app-shell workspace-shell">
      <header class="workspace-topbar">
        <div class="topbar-left">
          <div class="brand-mark">
            <span class="brand-dot"></span>
            <span>PulseChat</span>
          </div>
          <div class="mode-pill">
            <span>${state.dataSource === 'api' ? 'Live API' : 'Demo Workspace'}</span>
          </div>
          <div class="status-pill ${state.dataSource === 'api' ? '' : 'warning'}">
            <span>${state.dataSource === 'api' ? 'Using backend data' : 'Using seeded preview data'}</span>
          </div>
        </div>
        <div class="topbar-right">
          <a class="ghost-button" href="/api/docs" target="_blank" rel="noreferrer">API docs</a>
          <button class="ghost-button" type="button" data-action="logout">Log out</button>
        </div>
      </header>
      <div class="workspace-grid">
        <aside class="side-panel">
          <div class="profile-card">
            <div class="row-head">
              ${renderAvatar(state.user?.fullName || 'You', state.user?.profileImage, 'large')}
              <div class="row-body" style="flex: 1;">
                <h3 class="row-title">${escapeHtml(state.user?.fullName || 'Guest')}</h3>
                <p class="row-subtitle">@${escapeHtml(state.user?.username || 'demo')}</p>
                <div class="tag-row">
                  <span class="tag">${state.user?.role || 'user'}</span>
                  <span class="tag">${state.user?.isOnline ? 'Online' : 'Away'}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="nav-stack">
            ${renderNavButton('chats', 'Chats', state.chats.length)}
            ${renderNavButton('contacts', 'Contacts', state.contacts.length)}
            ${renderNavButton('requests', 'Requests', pendingCount)}
            ${renderNavButton('groups', 'Groups', state.groups.length)}
            ${renderNavButton('notifications', 'Notifications', unreadCount)}
            ${state.user?.role === 'admin' ? renderNavButton('admin', 'Admin') : ''}
            ${renderNavButton('profile', 'Profile')}
            ${renderNavButton('settings', 'Settings')}
          </div>
          ${renderSidebarContent(selectedChat)}
        </aside>
        <main class="main-panel">
          ${renderMainPanel()}
        </main>
        <aside class="rail-panel">
          ${renderDetailRail()}
        </aside>
      </div>
      ${renderToasts()}
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
        <span>${navHint(section)}</span>
      </div>
      ${count ? `<span class="count-badge ${section === 'notifications' ? 'blue' : ''}">${count}</span>` : ''}
    </button>
  `;
}

function navHint(section) {
  const map = {
    chats: 'Recent conversations',
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
  if (state.activeSection === 'contacts') {
    const favorites = state.contacts.filter((item) => item.isFavorite);
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

  if (state.activeSection === 'groups') {
    return `
      <div class="list-stack">
        <div class="title-row">
          <strong>Groups</strong>
          <span class="mini-pill">${state.groups.length}</span>
        </div>
        ${state.groups.length
          ? state.groups.map((group) => renderMiniGroupCard(group)).join('')
          : '<div class="mini-card"><span class="muted-text">Your group list will appear here.</span></div>'}
      </div>
    `;
  }

  if (state.activeSection === 'notifications') {
    const unread = state.notifications.filter((item) => !item.isRead);
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

  const chats = state.chats.length ? state.chats : demoWorkspace.chats;
  return `
    <div class="list-stack">
      <div class="title-row">
        <strong>Recent chats</strong>
        <span class="mini-pill">${chats.length}</span>
      </div>
      ${chats.map((chat) => renderChatRow(chat, chat.id === selectedChat?.id)).join('')}
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
          <span class="caption">${group.members?.length || 0} members</span>
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

function renderChatRow(chat, isActive) {
  return `
    <button
      type="button"
      class="chat-row ${isActive ? 'is-active' : ''}"
      data-action="select-chat"
      data-chat-id="${chat.id}"
    >
      <div class="row-head">
        ${renderAvatar(chat.title, chat.avatarImage)}
        <div class="row-body" style="flex: 1;">
          <div class="split-row">
            <strong>${escapeHtml(chat.title)}</strong>
            <span class="caption">${relativeTime(chat.lastMessageAt)}</span>
          </div>
          <span class="row-subtitle">${escapeHtml(chat.lastMessagePreview)}</span>
        </div>
      </div>
      <div class="row-meta">
        <span class="mini-pill">${chat.type}</span>
        <div class="tag-row">
          ${chat.pinned ? '<span class="tag">Pinned</span>' : ''}
          ${chat.muted ? '<span class="tag">Muted</span>' : ''}
          ${chat.unreadCount ? `<span class="count-badge">${chat.unreadCount}</span>` : ''}
        </div>
      </div>
    </button>
  `;
}

function renderMainPanel() {
  switch (state.activeSection) {
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

function renderChatsPanel() {
  const selectedChat = getSelectedChat();
  const messages = selectedChat ? state.messagesByChat[selectedChat.id] || [] : [];
  const typingText = selectedChat ? state.typingByChat[selectedChat.id] : '';

  if (!selectedChat) {
    return `
      <div class="empty-card">
        <h3>No chat selected</h3>
        <p>Once your conversation list is populated, this area becomes the live messaging workspace.</p>
      </div>
    `;
  }

  return `
    <div class="panel-header">
      <div>
        <h2>Conversation workspace</h2>
        <p>Review message history, keep the profile rail nearby, and send the next message from a focused composer.</p>
      </div>
      <div class="segmented-control">
        <button type="button" class="is-active">Messages</button>
        <button type="button">Media</button>
        <button type="button">Files</button>
      </div>
    </div>
    <div class="metrics-grid">
      <div class="metric-card">
        <span>Unread</span>
        <strong>${selectedChat.unreadCount}</strong>
      </div>
      <div class="metric-card">
        <span>Members</span>
        <strong>${selectedChat.memberCount}</strong>
      </div>
      <div class="metric-card">
        <span>Source</span>
        <strong>${state.dataSource === 'api' ? 'Live' : 'Demo'}</strong>
      </div>
    </div>
    <section class="chat-layout">
      <div class="chat-header">
        <div class="row-head">
          ${renderAvatar(selectedChat.title, selectedChat.avatarImage, 'large')}
          <div class="row-body">
            <h3 class="chat-title">${escapeHtml(selectedChat.title)}</h3>
            <span class="row-subtitle">${escapeHtml(selectedChat.subtitle || selectedChat.partnerStatus || '')}</span>
          </div>
        </div>
      </div>
      <div class="messages-stream">
        ${messages.length
          ? messages.map(renderMessage).join('')
          : '<div class="empty-card"><h3>No messages yet</h3><p>Send the first message to create the conversation history.</p></div>'}
      </div>
      ${typingText ? `<div class="helper-text" style="padding: 0 24px 8px;">${escapeHtml(typingText)}</div>` : ''}
      <div class="composer-card">
        <form id="message-form">
          <input type="hidden" name="chatId" value="${selectedChat.id}" />
          <label class="sr-only" for="message-text">Message</label>
          <textarea id="message-text" class="composer-input" name="text" placeholder="Write a message..." rows="4" required></textarea>
          <div class="composer-actions">
            <div class="tag-row">
              <span class="tag">Seen status</span>
              <span class="tag">Typing-ready layout</span>
              <span class="tag">Attachment slot</span>
            </div>
            <button class="primary-button" type="submit">Send message</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderMessage(message) {
  return `
    <article class="message-row ${message.mine ? 'mine' : ''}">
      ${message.mine ? '' : renderAvatar(message.senderName, '', 'small')}
      <div class="message-bubble">
        ${message.replyText ? `<div class="reply-chip">${escapeHtml(message.replyText)}</div>` : ''}
        ${message.pinnedAt ? '<div class="reply-chip">Pinned message</div>' : ''}
        ${message.mine ? '' : `<strong>${escapeHtml(message.senderName)}</strong>`}
        <p class="message-text">${escapeHtml(message.text)}</p>
        ${message.mediaUrl ? `<a class="caption" href="${escapeAttribute(message.mediaUrl)}" target="_blank" rel="noreferrer">${escapeHtml(message.fileName || 'Open attachment')}</a>` : ''}
        <div class="message-meta">
          <span>${formatTime(message.createdAt)}</span>
          ${message.editedAt ? '<span>edited</span>' : ''}
          ${message.mine ? `<span>${message.seenCount ? `seen by ${message.seenCount}` : 'delivered'}</span>` : ''}
        </div>
      </div>
    </article>
  `;
}

function renderContactsPanel() {
  const contacts = state.contacts;
  const favoriteCount = contacts.filter((item) => item.isFavorite).length;

  return `
    <div class="panel-header">
      <div>
        <h2>Contacts</h2>
        <p>Keep your high-signal people nearby, mark favorites, and jump straight into a private chat.</p>
      </div>
      <div class="status-pill neutral">${favoriteCount} favorites</div>
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
              <span class="tag">${selectedGroup.members?.length || 0} members</span>
              ${selectedGroup.onlyAdminsCanMessage ? '<span class="tag">Admins message only</span>' : '<span class="tag">Open messaging</span>'}
              ${selectedGroup.onlyAdminsCanAddMembers ? '<span class="tag">Admin invites</span>' : '<span class="tag">Members can invite</span>'}
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
      </div>
      <div class="row-meta">
        <span class="mini-pill">${group.members?.length || 0} members</span>
        <span class="caption">Invite code: ${escapeHtml(group.inviteCode || 'n/a')}</span>
      </div>
    </button>
  `;
}

function renderNotificationsPanel() {
  const unread = state.notifications.filter((item) => !item.isRead).length;

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
            <div class="metric-card"><span>Unread</span><strong>${state.notifications.filter((item) => !item.isRead).length}</strong></div>
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
      <div class="profile-card">
        <strong>Conversation details</strong>
        ${chat ? renderRailChat(chat) : '<p class="helper-text">Select a chat to see participant details and activity summary.</p>'}
      </div>
      ${renderSummaryRail()}
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
          <span class="row-subtitle">${group.members?.length || 0} members</span>
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
  const unreadNotifications = state.notifications.filter((item) => !item.isRead).length;

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

async function handleClick(event) {
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

  if (action === 'open-demo') {
    syncDemoState();
    state.screen = 'workspace';
    render();
    return;
  }

  if (action === 'logout') {
    disconnectSocket();
    clearSession();
    state.token = null;
    state.refreshToken = null;
    state.admin.summary = null;
    state.screen = 'auth';
    state.authView = 'login';
    pushToast('Logged out', 'Your session has been cleared.', 'success');
    render();
    return;
  }

  if (action === 'switch-section') {
    state.activeSection = target.dataset.section;
    render();
    return;
  }

  if (action === 'switch-request-tab') {
    state.requestTab = target.dataset.tab;
    render();
    return;
  }

  if (action === 'select-chat') {
    state.activeSection = 'chats';
    state.selectedChatId = target.dataset.chatId;
    await loadChatMessages(state.selectedChatId);
    render();
    return;
  }

  if (action === 'select-contact') {
    state.activeSection = 'contacts';
    state.selectedContactId = target.dataset.contactId;
    render();
    return;
  }

  if (action === 'select-group') {
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

  if (target.id !== 'message-text' || !state.socket || !state.selectedChatId || state.dataSource !== 'api') {
    return;
  }

  state.socket.emit('message:typing', { chatId: state.selectedChatId });

  if (typingTimer) {
    window.clearTimeout(typingTimer);
  }

  typingTimer = window.setTimeout(() => {
    state.socket?.emit('message:stop-typing', { chatId: state.selectedChatId });
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
  if (!chatId || !text) {
    return;
  }

  if (state.dataSource === 'demo') {
    const message = {
      id: `message-${Date.now()}`,
      chatId,
      senderId: state.user.id,
      senderName: state.user.fullName,
      text,
      replyText: '',
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
    form.reset();
    pushToast('Message sent', 'The demo conversation was updated locally.', 'success');
    render();
    return;
  }

  try {
    state.socket?.emit('message:stop-typing', { chatId });
    const response = await apiFetch('/api/v1/messages', {
      method: 'POST',
      headers: {},
      body: JSON.stringify({ chatId, text }),
    });
    const message = normalizeMessage(response.data);
    const existingMessages = state.messagesByChat[chatId] || [];
    state.messagesByChat[chatId] = existingMessages.some((item) => item.id === message.id)
      ? existingMessages.map((item) => (item.id === message.id ? message : item))
      : [...existingMessages, message];
    const chat = state.chats.find((item) => item.id === chatId);
    if (chat) {
      chat.lastMessagePreview = message.text;
      chat.lastMessageAt = message.createdAt;
    }
    form.reset();
    pushToast('Message sent', 'The conversation was updated against the live API.', 'success');
    render();
  } catch (error) {
    pushToast('Send failed', error.message, 'error');
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
      await loadChatMessages(chat.id);
    } catch (error) {
      pushToast('Could not open chat', error.message, 'error');
      render();
      return;
    }
  }

  state.selectedChatId = chat.id;
  state.activeSection = 'chats';
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
    pushToast('Request updated', `${capitalize(kind)}ed ${request.counterpart.fullName}.`, 'success');
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
    pushToast('Request updated', `${capitalize(kind)}ed ${request.counterpart.fullName}.`, 'success');
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

function getSelectedChat() {
  return state.chats.find((item) => item.id === state.selectedChatId) || null;
}

function getSelectedContact() {
  return state.contacts.find((item) => item.id === state.selectedContactId) || null;
}

function getSelectedGroup() {
  return state.groups.find((item) => item.id === state.selectedGroupId) || null;
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

function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : '';
}
