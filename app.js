const SUPABASE_URL = 'https://smngjqnkfbelxdxxqfhr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1hwKdToUcCqVt-2hbWU65A_hxyhx3zd';

const configured = !SUPABASE_URL.startsWith('PASTE_') && !SUPABASE_ANON_KEY.startsWith('PASTE_');
const db = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = (id) => document.getElementById(id);
const state = {
  user: null,
  profile: null,
  conversations: [],
  active: null,
  channel: null,
  signingUp: true,
  openingConversation: false,
  enteringApp: false,
  searchRequest: 0,
  messageIds: new Set(),
  messages: [],
  reactions: [],
  reactionLoading: false,
  replyTo: null,
  editingMessage: null,
  pendingFile: null,
  messageQuery: '',
  reactionPickerFor: null,
  remoteTyping: null,
  remoteTypingTimer: null,
  typingTimer: null,
  attachmentUrls: new Map(),
  mediaRecorder: null,
  recordingStream: null,
  voiceChunks: [],
  voiceTimer: null,
  voiceStartedAt: null,
  discardVoice: false,
  membershipRefreshTimer: null,
  forwardingMessage: null,
  forwardingBusy: false,
};

function showMessage(message = '', error = false) {
  const target = $('auth-message');
  target.textContent = message;
  target.style.color = error ? '#b42318' : '#3b7a4c';
}

function showAppMessage(message = '', error = false) {
  const target = $('app-message');
  target.textContent = message;
  target.hidden = !message;
  target.dataset.error = String(error);
}

function finishBoot() {
  $('boot-screen').hidden = true;
}

function resetChatUi() {
  $('chat-title').textContent = '';
  $('chat-status').textContent = 'личный чат';
  $('chat').hidden = true;
  $('empty-state').hidden = false;
  $('message-list').innerHTML = '';
  $('message-search-wrap').hidden = true;
  $('message-search').value = '';
  $('pinned-message').hidden = true;
  $('group-member-form').hidden = true;
  $('forward-panel').hidden = true;
  $('add-member-button').hidden = true;
  $('group-manage-button').hidden = true;
  $('composer-context').hidden = true;
  $('attachment-preview').hidden = true;
  $('emoji-strip').hidden = true;
  $('message-input').value = '';
  $('attachment-input').value = '';
  $('voice-recording').hidden = true;
  $('voice-button').classList.remove('recording');
  $('voice-button').textContent = '⌁';
}

function showAuth(message = '', error = false) {
  state.channel?.unsubscribe();
  stopVoiceRecording(true);
  state.channel = null;
  clearTimeout(state.typingTimer);
  clearTimeout(state.remoteTypingTimer);
  state.user = null;
  state.profile = null;
  state.conversations = [];
  state.active = null;
  state.messages = [];
  state.reactions = [];
  state.messageIds = new Set();
  state.replyTo = null;
  state.editingMessage = null;
  state.pendingFile = null;
  state.messageQuery = '';
  state.remoteTyping = null;
  state.attachmentUrls = new Map();
  state.forwardingMessage = null;
  state.forwardingBusy = false;
  clearTimeout(state.membershipRefreshTimer);
  state.searchRequest += 1;
  resetChatUi();
  $('conversation-list').innerHTML = '';
  $('user-search').value = '';
  $('search-results').innerHTML = '';
  $('profile-form').hidden = true;
  $('profile-about').value = '';
  $('profile-avatar').value = '';
  $('group-create-form').hidden = true;
  $('group-title').value = '';
  $('group-members').value = '';
  $('my-username').textContent = '';
  $('my-about').textContent = '';
  $('my-avatar').textContent = '';
  showAppMessage();
  $('app-view').hidden = true;
  $('app-view').classList.remove('chat-open');
  $('auth-view').hidden = false;
  if (message) showMessage(message, error);
}

function humanError(error, fallback = 'Попробуйте ещё раз.') {
  const message = String(error?.message || error || '');
  if (/duplicate key|unique/i.test(message)) return 'Такой юзернейм уже занят.';
  if (/invalid login credentials/i.test(message)) return 'Неверная почта или пароль.';
  if (/email not confirmed/i.test(message)) return 'Подтвердите почту, затем войдите.';
  if (/rate limit|too many requests/i.test(message)) return 'Слишком много попыток. Подождите немного и повторите.';
  if (/invalid recipient/i.test(message)) return 'Нельзя открыть чат с самим собой.';
  if (/user not found/i.test(message)) return 'Пользователь не найден.';
  if (/only group admins/i.test(message)) return 'Добавлять участников может только администратор группы.';
  if (/only group admins can rename/i.test(message)) return 'Переименовывать группу может только администратор.';
  if (/only group admins can manage roles/i.test(message)) return 'Менять роли может только администратор.';
  if (/only group admins can remove/i.test(message)) return 'Исключать участников может только администратор.';
  if (/assign another admin/i.test(message)) return 'Сначала назначьте другого администратора.';
  if (/user is not a group member/i.test(message)) return 'Пользователь уже не состоит в этой группе.';
  if (/choose at least one participant/i.test(message)) return 'Добавьте хотя бы одного участника.';
  if (/message cannot be edited/i.test(message)) return 'Это сообщение уже нельзя изменить.';
  if (/message cannot be deleted/i.test(message)) return 'Это сообщение уже нельзя удалить.';
  if (/message is unavailable for forwarding|deleted messages cannot be forwarded/i.test(message)) return 'Это сообщение больше нельзя переслать.';
  if (/attachment copy is required/i.test(message)) return 'Не удалось перенести вложение. Попробуйте ещё раз.';
  if (/message must contain/i.test(message)) return 'Сообщение должно содержать от 1 до 2000 символов.';
  if (/network|fetch/i.test(message)) return 'Нет соединения с сервером. Проверьте интернет и повторите.';
  return message || fallback;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value || '';
  return div.innerHTML;
}

function encodeData(value) { return encodeURIComponent(String(value || '')); }
function decodeData(value) { return decodeURIComponent(value || ''); }
function initials(username) { return String(username || '?').slice(0, 2).toUpperCase(); }
function formatTime(date) { return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(date)); }
function validUsername(username) { return /^[a-z0-9_]{3,24}$/.test(username); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function profileFromRelation(profile) { return Array.isArray(profile) ? profile[0] : profile; }

function avatarContent(person) {
  if (person?.kind === 'group') return '👥';
  return person?.avatar_emoji || initials(person?.username || person?.title);
}

function avatarMarkup(person, className = 'avatar') {
  return `<span class="${className}">${escapeHtml(avatarContent(person))}</span>`;
}

function profileForUser(userId) {
  if (userId === state.user?.id) return state.profile;
  return state.active?.members?.find((member) => member.id === userId) || null;
}

function conversationName(chat) {
  if (!chat) return '';
  return chat.kind === 'group' ? (chat.title || 'Группа') : `@${chat.person?.username || 'пользователь'}`;
}

function conversationAvatar(chat) {
  return chat?.kind === 'group' ? { kind: 'group' } : chat?.person;
}

function conversationStatus(chat) {
  if (!chat) return 'личный чат';
  if (state.remoteTyping && state.active?.id === chat.id) return `${state.remoteTyping} печатает…`;
  if (chat.kind === 'group') {
    const count = chat.members?.length || 0;
    return `${count} ${count === 1 ? 'участник' : count < 5 ? 'участника' : 'участников'}`;
  }
  return chat.person?.about || 'личный чат';
}

function messagePreview(message) {
  if (!message) return 'Начните разговор';
  if (message.deleted_at) return 'Сообщение удалено';
  if (String(message.attachment_type || '').startsWith('audio/')) return '🎤 Голосовое сообщение';
  if (message.attachment_name && (!message.body || message.body === `📎 ${message.attachment_name}`)) return `📎 ${message.attachment_name}`;
  return message.body || 'Вложение';
}

function renderOwnProfile() {
  $('my-username').textContent = '@' + state.profile.username;
  $('my-about').textContent = state.profile.about || 'Добавьте короткий статус';
  $('my-avatar').textContent = avatarContent(state.profile);
  $('profile-about').value = state.profile.about || '';
  $('profile-avatar').value = state.profile.avatar_emoji || '🙂';
}

function setAuthMode(signingUp) {
  state.signingUp = signingUp;
  $('username-label').hidden = !signingUp;
  $('username').required = signingUp;
  $('auth-submit').textContent = signingUp ? 'Создать аккаунт' : 'Войти';
  $('switch-auth').textContent = signingUp ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться';
  $('password').autocomplete = signingUp ? 'new-password' : 'current-password';
  showMessage();
}

async function getProfile() {
  const { data, error } = await db.from('profiles').select('*').eq('id', state.user.id).single();
  if (error) throw new Error('Не удалось загрузить профиль. Выйдите и войдите снова.');
  state.profile = data;
  renderOwnProfile();
}

async function touchPresence() {
  if (!state.user) return;
  await db.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', state.user.id);
}

function normalizeMember(row) {
  const profile = profileFromRelation(row.profiles) || {};
  return {
    id: row.user_id,
    username: profile.username || 'пользователь',
    about: profile.about || '',
    avatar_emoji: profile.avatar_emoji || '🙂',
    role: row.role || 'member',
    last_read_at: row.last_read_at,
  };
}

async function loadConversations() {
  const { data: memberships, error } = await db
    .from('conversation_members')
    .select('conversation_id, joined_at, role, last_read_at')
    .eq('user_id', state.user.id);
  if (error) throw error;

  const ids = memberships.map((item) => item.conversation_id);
  if (!ids.length) {
    state.conversations = [];
    renderConversations();
    return;
  }

  const [{ data: rows, error: rowsError }, { data: memberRows, error: membersError }, { data: messages, error: messagesError }] = await Promise.all([
    db.from('conversations').select('id, kind, title, pinned_message_id, pinned_at').in('id', ids),
    db.from('conversation_members').select('conversation_id, user_id, role, last_read_at, profiles(id, username, about, avatar_emoji)').in('conversation_id', ids),
    db.from('messages').select('conversation_id, sender_id, body, created_at, deleted_at, attachment_name, attachment_type').in('conversation_id', ids).order('created_at', { ascending: false }),
  ]);
  if (rowsError) throw rowsError;
  if (membersError) throw membersError;
  if (messagesError) throw messagesError;

  const activeId = state.active?.id;
  state.conversations = (rows || []).map((row) => {
    const members = (memberRows || []).filter((item) => item.conversation_id === row.id).map(normalizeMember);
    const own = members.find((member) => member.id === state.user.id);
    const person = members.find((member) => member.id !== state.user.id);
    const last = (messages || []).find((item) => item.conversation_id === row.id);
    const unread = Boolean(last && last.sender_id !== state.user.id && new Date(last.created_at) > new Date(own?.last_read_at || 0));
    return {
      id: row.id,
      kind: row.kind || 'direct',
      title: row.title,
      pinned_message_id: row.pinned_message_id,
      pinned_at: row.pinned_at,
      person,
      members,
      role: own?.role || 'member',
      last,
      unread,
      joinedAt: memberships.find((item) => item.conversation_id === row.id)?.joined_at,
    };
  }).filter((chat) => chat.kind === 'group' || chat.person?.username)
    .sort((a, b) => new Date(b.last?.created_at || b.joinedAt || 0) - new Date(a.last?.created_at || a.joinedAt || 0));

  if (activeId) {
    const refreshedActive = state.conversations.find((chat) => chat.id === activeId);
    if (refreshedActive) state.active = refreshedActive;
    else {
      state.active = null;
      resetChatUi();
    }
  }
  renderConversations();
}

function renderConversations() {
  $('conversation-list').innerHTML = state.conversations.length
    ? state.conversations.map((chat) => `
      <button class="conversation ${state.active?.id === chat.id ? 'active' : ''}" data-id="${chat.id}">
        ${avatarMarkup(conversationAvatar(chat))}
        <div><strong>${escapeHtml(conversationName(chat))}</strong><small>${escapeHtml(messagePreview(chat.last))}</small></div>
        ${chat.unread ? '<span class="unread-dot" aria-label="Новые сообщения"></span>' : ''}
      </button>`).join('')
    : '<p class="notice">Диалогов пока нет.</p>';

  document.querySelectorAll('.conversation').forEach((button) => {
    button.addEventListener('click', () => {
      const chat = state.conversations.find((item) => item.id === button.dataset.id);
      if (chat) openConversation(chat).catch((error) => showAppMessage(humanError(error), true));
    });
  });
}

async function searchUsers() {
  const query = $('user-search').value.trim().toLowerCase();
  const request = ++state.searchRequest;
  if (query.length < 2) {
    $('search-results').innerHTML = '';
    return;
  }

  const { data, error } = await db
    .from('profiles')
    .select('id, username, about, avatar_emoji')
    .ilike('username', `%${query}%`)
    .neq('id', state.user.id)
    .limit(8);

  if (request !== state.searchRequest) return;
  if (error) {
    $('search-results').innerHTML = '<p class="notice">Не удалось выполнить поиск. Попробуйте ещё раз.</p>';
    return;
  }

  $('search-results').innerHTML = data.length
    ? data.map((person) => `
      <button class="person" data-id="${person.id}">
        ${avatarMarkup(person)}
        <div><strong>@${escapeHtml(person.username)}</strong><small>${escapeHtml(person.about || 'Начать диалог')}</small></div>
      </button>`).join('')
    : '<p class="notice">Никого не найдено.</p>';

  document.querySelectorAll('.person').forEach((button) => {
    button.addEventListener('click', () => {
      const person = data.find((item) => item.id === button.dataset.id);
      if (person) startConversation(person);
    });
  });
}

async function startConversation(person) {
  if (state.openingConversation) return;
  state.openingConversation = true;
  showAppMessage('Открываем чат…');
  try {
    const { data: id, error } = await db.rpc('open_direct_conversation', { other_user_id: person.id });
    if (error) throw error;
    if (!id) throw new Error('Сервер не вернул идентификатор диалога.');
    try {
      await loadConversations();
    } catch (refreshError) {
      showAppMessage('Чат создан. Список диалогов обновится после перезагрузки.', true);
    }
    $('user-search').value = '';
    $('search-results').innerHTML = '';
    const fallback = { id, kind: 'direct', person, members: [person], role: 'member' };
    await openConversation(state.conversations.find((chat) => chat.id === id) || fallback);
    showAppMessage();
  } catch (error) {
    showAppMessage('Не удалось открыть чат: ' + humanError(error), true);
  } finally {
    state.openingConversation = false;
  }
}

async function createGroup(event) {
  event.preventDefault();
  const title = $('group-title').value.trim();
  const names = [...new Set($('group-members').value.toLowerCase().split(/[\s,]+/).map((name) => name.replace(/^@/, '')).filter(Boolean))];
  const button = $('group-create-form').querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    if (title.length < 2 || title.length > 60) throw new Error('Название группы: от 2 до 60 символов.');
    if (!names.length) throw new Error('Добавьте хотя бы одного участника по юзернейму.');
    const { data: people, error: peopleError } = await db.from('profiles').select('id, username').in('username', names);
    if (peopleError) throw peopleError;
    const found = new Set((people || []).map((person) => person.username));
    const missing = names.filter((name) => !found.has(name));
    if (missing.length) throw new Error('Не найдены: @' + missing.join(', @'));
    const { data: id, error } = await db.rpc('create_group_conversation', {
      group_title: title,
      invited_user_ids: people.map((person) => person.id),
    });
    if (error) throw error;
    try {
      await loadConversations();
    } catch (reloadError) {
      console.warn('Could not reload conversations after group creation', reloadError);
    }
    $('group-create-form').reset();
    $('group-create-form').hidden = true;
    const chat = state.conversations.find((item) => item.id === id);
    if (chat) await openConversation(chat);
  } catch (error) {
    showAppMessage(humanError(error), true);
  } finally {
    button.disabled = false;
  }
}

async function addGroupMember() {
  if (!state.active || state.active.kind !== 'group') return;
  const rawUsername = window.prompt('Юзернейм нового участника');
  if (!rawUsername) return;
  const username = rawUsername.trim().replace(/^@/, '').toLowerCase();
  if (!username) return;
  try {
    const { data: person, error: personError } = await db.from('profiles').select('id').eq('username', username).single();
    if (personError) throw new Error('Пользователь не найден.');
    const { error } = await db.rpc('add_group_member', {
      target_conversation_id: state.active.id,
      target_user_id: person.id,
    });
    if (error) throw error;
    await loadConversations();
    updateChatHeader();
    showAppMessage(`@${username} добавлен в группу.`);
  } catch (error) {
    showAppMessage(humanError(error), true);
  }
}

function isGroupAdmin() {
  return state.active?.kind === 'group' && state.active.role === 'admin';
}

function renderGroupPanel() {
  const panel = $('group-member-form');
  if (!state.active || state.active.kind !== 'group') {
    panel.hidden = true;
    return;
  }
  const canManage = isGroupAdmin();
  const members = [...(state.active.members || [])].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
    return a.username.localeCompare(b.username);
  });
  panel.innerHTML = `
    <div class="group-panel-head"><b>${members.length} участников</b><button type="button" data-group-action="close" aria-label="Закрыть">×</button></div>
    ${canManage ? `<div class="group-rename"><input id="group-rename-input" maxlength="60" value="${escapeHtml(state.active.title || '')}" aria-label="Название группы" /><button type="button" data-group-action="rename">Сохранить</button></div>` : ''}
    <div class="group-members-list">${members.map((member) => {
      const mine = member.id === state.user.id;
      const role = member.role === 'admin' ? 'администратор' : 'участник';
      return `<div class="group-member-row">
        ${avatarMarkup(member)}
        <div class="group-member-copy"><b>${escapeHtml(mine ? 'Вы' : '@' + member.username)}</b><small>${role}</small></div>
        ${canManage && !mine ? `<div class="group-member-actions">
          ${member.role === 'member' ? `<button type="button" data-group-action="promote" data-member-id="${member.id}" title="Сделать администратором">↑</button>` : `<button type="button" data-group-action="demote" data-member-id="${member.id}" title="Сделать участником">↓</button>`}
          <button class="danger" type="button" data-group-action="remove" data-member-id="${member.id}" title="Исключить">×</button>
        </div>` : ''}
      </div>`;
    }).join('')}</div>
    <button class="group-leave" type="button" data-group-action="leave">Покинуть группу</button>`;
}

function toggleGroupPanel() {
  if (!state.active || state.active.kind !== 'group') return;
  const panel = $('group-member-form');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderGroupPanel();
}

async function refreshConversationState() {
  const panelOpen = !$('group-member-form').hidden;
  await loadConversations();
  if (state.active) {
    updateChatHeader();
    if (panelOpen) renderGroupPanel();
  }
}

async function renameGroup() {
  const title = $('group-rename-input')?.value.trim() || '';
  try {
    const { error } = await db.rpc('rename_group_conversation', { target_conversation_id: state.active.id, new_title: title });
    if (error) throw error;
    state.active.title = title;
    await refreshConversationState();
    showAppMessage('Название группы изменено.');
  } catch (error) {
    showAppMessage(humanError(error), true);
  }
}

async function changeGroupRole(memberId, role) {
  try {
    const { error } = await db.rpc('set_group_member_role', {
      target_conversation_id: state.active.id,
      target_user_id: memberId,
      new_role: role,
    });
    if (error) throw error;
    await refreshConversationState();
  } catch (error) {
    showAppMessage(humanError(error), true);
  }
}

async function removeGroupMember(memberId) {
  const member = state.active.members?.find((item) => item.id === memberId);
  if (!member || !window.confirm(`Исключить @${member.username} из группы?`)) return;
  try {
    const { error } = await db.rpc('remove_group_member', {
      target_conversation_id: state.active.id,
      target_user_id: memberId,
    });
    if (error) throw error;
    await refreshConversationState();
    showAppMessage(`@${member.username} исключён из группы.`);
  } catch (error) {
    showAppMessage(humanError(error), true);
  }
}

async function leaveGroup() {
  if (!state.active || !window.confirm(`Покинуть группу «${conversationName(state.active)}»?`)) return;
  const conversationId = state.active.id;
  try {
    const { error } = await db.rpc('leave_group_conversation', { target_conversation_id: conversationId });
    if (error) throw error;
    state.active = null;
    resetChatUi();
    await loadConversations();
    showAppMessage('Вы покинули группу.');
  } catch (error) {
    showAppMessage(humanError(error), true);
  }
}

async function handleGroupPanelClick(event) {
  const button = event.target.closest('[data-group-action]');
  if (!button || !state.active) return;
  const action = button.dataset.groupAction;
  if (action === 'close') $('group-member-form').hidden = true;
  if (action === 'rename') await renameGroup();
  if (action === 'promote') await changeGroupRole(button.dataset.memberId, 'admin');
  if (action === 'demote') await changeGroupRole(button.dataset.memberId, 'member');
  if (action === 'remove') await removeGroupMember(button.dataset.memberId);
  if (action === 'leave') await leaveGroup();
}

function forwardLabel(message) {
  if (message.deleted_at || !message.forwarded_from_username) return '';
  return `<div class="forward-label">↪ Переслано от @${escapeHtml(message.forwarded_from_username)}</div>`;
}

function renderForwardPanel() {
  const panel = $('forward-panel');
  const source = state.forwardingMessage;
  if (!source || !state.active) {
    panel.hidden = true;
    return;
  }
  const targets = state.conversations.filter((chat) => chat.id !== state.active.id);
  panel.innerHTML = `
    <div class="forward-panel-head"><div><small>ПЕРЕСЛАТЬ</small><b>${escapeHtml(messagePreview(source)).slice(0, 85)}</b></div><button type="button" data-forward-action="close" aria-label="Закрыть">×</button></div>
    ${targets.length ? `<div class="forward-targets">${targets.map((chat) => `<button type="button" data-forward-action="send" data-conversation-id="${chat.id}">
      ${avatarMarkup(conversationAvatar(chat), 'avatar forward-avatar')}
      <span><b>${escapeHtml(conversationName(chat))}</b><small>${escapeHtml(conversationStatus(chat))}</small></span><i>›</i>
    </button>`).join('')}</div>` : '<p class="notice">Создайте ещё один диалог или группу, чтобы переслать сообщение.</p>'}`;
  panel.hidden = false;
}

function openForwardPanel(message) {
  if (!message || message.deleted_at) return;
  state.forwardingMessage = message;
  $('group-member-form').hidden = true;
  renderForwardPanel();
}

async function forwardMessage(targetConversationId) {
  const source = state.forwardingMessage;
  const target = state.conversations.find((chat) => chat.id === targetConversationId);
  if (!source || !target || state.forwardingBusy) return;
  state.forwardingBusy = true;
  let copiedPath = null;
  try {
    let attachment = {};
    if (source.attachment_path) {
      const { data: file, error: downloadError } = await db.storage.from('message-files').download(source.attachment_path);
      if (downloadError || !file) throw downloadError || new Error('Не удалось загрузить вложение.');
      copiedPath = `${target.id}/${crypto.randomUUID()}/${safeFileName(source.attachment_name || 'attachment')}`;
      const { error: uploadError } = await db.storage.from('message-files').upload(copiedPath, file, {
        upsert: false,
        contentType: source.attachment_type || file.type || 'application/octet-stream',
      });
      if (uploadError) throw uploadError;
      attachment = {
        forwarded_attachment_path: copiedPath,
        forwarded_attachment_name: (source.attachment_name || 'Вложение').slice(0, 180),
        forwarded_attachment_type: source.attachment_type || file.type || 'application/octet-stream',
      };
    }
    const { error } = await db.rpc('forward_message', {
      source_message_id: source.id,
      target_conversation_id: target.id,
      ...attachment,
    });
    if (error) throw error;
    state.forwardingMessage = null;
    $('forward-panel').hidden = true;
    await loadConversations();
    showAppMessage(`Сообщение переслано в ${conversationName(target)}.`);
  } catch (error) {
    if (copiedPath) db.storage.from('message-files').remove([copiedPath]).catch(() => {});
    showAppMessage('Не удалось переслать сообщение: ' + humanError(error), true);
  } finally {
    state.forwardingBusy = false;
  }
}

async function handleForwardPanelClick(event) {
  const button = event.target.closest('[data-forward-action]');
  if (!button) return;
  if (button.dataset.forwardAction === 'close') {
    state.forwardingMessage = null;
    $('forward-panel').hidden = true;
  }
  if (button.dataset.forwardAction === 'send') await forwardMessage(button.dataset.conversationId);
}

function updateChatHeader() {
  if (!state.active) return;
  $('chat-title').textContent = conversationName(state.active);
  $('chat-status').textContent = conversationStatus(state.active);
  $('add-member-button').hidden = !(state.active.kind === 'group' && state.active.role === 'admin');
  $('group-manage-button').hidden = state.active.kind !== 'group';
}

async function openConversation(chat) {
  stopVoiceRecording(true);
  state.active = chat;
  state.messageIds = new Set();
  state.messages = [];
  state.reactions = [];
  state.replyTo = null;
  state.editingMessage = null;
  state.pendingFile = null;
  state.messageQuery = '';
  state.remoteTyping = null;
  state.attachmentUrls = new Map();
  state.forwardingMessage = null;
  $('message-search').value = '';
  $('message-search-wrap').hidden = true;
  $('group-member-form').hidden = true;
  $('forward-panel').hidden = true;
  $('emoji-strip').hidden = true;
  updateChatHeader();
  renderComposerState();
  $('empty-state').hidden = true;
  $('chat').hidden = false;
  $('app-view').classList.add('chat-open');
  renderConversations();
  await loadMessages();
  subscribeToConversation(chat.id);
}

async function loadMessages() {
  if (!state.active) return;
  const { data, error } = await db
    .from('messages')
    .select('id, conversation_id, sender_id, body, created_at, edited_at, deleted_at, reply_to, attachment_path, attachment_name, attachment_type, forwarded_from_username, forwarded_from_message_id')
    .eq('conversation_id', state.active.id)
    .order('created_at');
  if (error) throw error;
  state.messages = data || [];
  state.messageIds = new Set(state.messages.map((message) => message.id));
  await loadReactions();
  renderMessages();
  renderPinnedMessage();
  markConversationRead();
}

async function loadReactions() {
  const ids = state.messages.map((message) => message.id);
  if (!ids.length) {
    state.reactions = [];
    return;
  }
  const { data, error } = await db.from('message_reactions').select('message_id, user_id, emoji').in('message_id', ids);
  if (error) throw error;
  state.reactions = data || [];
}

function refreshReactions() {
  if (state.reactionLoading || !state.active) return;
  state.reactionLoading = true;
  loadReactions().then(() => renderMessages(false)).catch(() => {}).finally(() => { state.reactionLoading = false; });
}

function replyMarkup(message) {
  if (!message) return '<div class="reply-quote muted">Исходное сообщение недоступно</div>';
  const author = profileForUser(message.sender_id);
  return `<div class="reply-quote"><b>${escapeHtml(author ? '@' + author.username : 'Сообщение')}</b><span>${escapeHtml(messagePreview(message)).slice(0, 110)}</span></div>`;
}

function reactionMarkup(message) {
  const grouped = new Map();
  state.reactions.filter((reaction) => reaction.message_id === message.id).forEach((reaction) => {
    const current = grouped.get(reaction.emoji) || [];
    current.push(reaction.user_id);
    grouped.set(reaction.emoji, current);
  });
  if (!grouped.size) return '';
  return `<div class="reaction-list">${[...grouped.entries()].map(([emoji, users]) => `
    <button class="reaction-chip ${users.includes(state.user.id) ? 'mine' : ''}" type="button" data-reaction="${encodeData(emoji)}" data-message-id="${message.id}">${escapeHtml(emoji)} <span>${users.length}</span></button>`).join('')}</div>`;
}

function seenMarkup(message) {
  if (message.sender_id !== state.user?.id) return '';
  const read = state.active?.members?.some((member) => member.id !== state.user.id && new Date(member.last_read_at || 0) >= new Date(message.created_at));
  return `<span class="read-mark" title="${read ? 'Прочитано' : 'Отправлено'}">${read ? '✓✓' : '✓'}</span>`;
}

function attachmentMarkup(message) {
  if (!message.attachment_path || message.deleted_at) return '';
  const type = String(message.attachment_type || '');
  if (type.startsWith('audio/')) {
    return `<div class="voice-message" data-attachment-path="${encodeData(message.attachment_path)}" data-attachment-type="${encodeData(type)}"><span>🎤</span><div><b>Голосовое сообщение</b><audio controls preload="metadata"></audio></div></div>`;
  }
  return `<a class="attachment" data-attachment-path="${encodeData(message.attachment_path)}" data-attachment-type="${encodeData(message.attachment_type || '')}" target="_blank" rel="noopener"><span>📎</span><b>${escapeHtml(message.attachment_name || 'Файл')}</b></a>`;
}

function messageMarkup(message) {
  const mine = message.sender_id === state.user?.id;
  const deleted = Boolean(message.deleted_at);
  const reply = message.reply_to ? state.messages.find((item) => item.id === message.reply_to) : null;
  const picker = state.reactionPickerFor === message.id && !deleted
    ? `<div class="reaction-picker">${['👍', '❤️', '😂', '😮', '🎉'].map((emoji) => `<button type="button" data-reaction="${encodeData(emoji)}" data-message-id="${message.id}">${emoji}</button>`).join('')}</div>` : '';
  const actions = deleted ? '' : `<div class="message-actions">
    <button type="button" data-message-action="reply" data-message-id="${message.id}" title="Ответить">↩</button>
    <button type="button" data-message-action="forward" data-message-id="${message.id}" title="Переслать">↪</button>
    <button type="button" data-message-action="reaction-picker" data-message-id="${message.id}" title="Реакция">☺</button>
    <button type="button" data-message-action="pin" data-message-id="${message.id}" title="Закрепить">⌖</button>
    ${mine ? `<button type="button" data-message-action="edit" data-message-id="${message.id}" title="Изменить">✎</button><button type="button" data-message-action="delete" data-message-id="${message.id}" title="Удалить">⌫</button>` : ''}
  </div>`;
  return `<article class="message-row ${mine ? 'mine' : ''}" id="message-${message.id}">
    <div class="message-wrap">
      <div class="message ${deleted ? 'deleted' : ''}">
        ${forwardLabel(message)}
        ${message.reply_to ? replyMarkup(reply) : ''}
        ${deleted ? '<em>Сообщение удалено</em>' : `<div class="message-body">${escapeHtml(message.body).replace(/\n/g, '<br />')}</div>${attachmentMarkup(message)}`}
        <div class="message-meta"><time>${formatTime(message.created_at)}</time>${message.edited_at ? '<span>изменено</span>' : ''}${seenMarkup(message)}</div>
      </div>
      ${actions}
      ${picker}
      ${reactionMarkup(message)}
    </div>
  </article>`;
}

function renderMessages(scroll = true) {
  const query = state.messageQuery.trim().toLowerCase();
  const visible = query ? state.messages.filter((message) => `${message.body || ''} ${message.attachment_name || ''}`.toLowerCase().includes(query)) : state.messages;
  $('message-list').innerHTML = visible.length
    ? visible.map(messageMarkup).join('')
    : `<p class="notice">${query ? 'Ничего не найдено.' : 'Сообщений пока нет. Начните разговор.'}</p>`;
  if (scroll) scrollMessages();
  hydrateAttachments();
}

function renderPinnedMessage() {
  const pin = $('pinned-message');
  const message = state.messages.find((item) => item.id === state.active?.pinned_message_id);
  if (!message || message.deleted_at) {
    pin.hidden = true;
    return;
  }
  pin.hidden = false;
  $('pinned-copy').textContent = messagePreview(message);
  pin.dataset.messageId = message.id;
}

async function hydrateAttachments() {
  const links = [...document.querySelectorAll('[data-attachment-path]')];
  for (const link of links) {
    const path = decodeData(link.dataset.attachmentPath);
    let url = state.attachmentUrls.get(path);
    if (!url) {
      const { data, error } = await db.storage.from('message-files').createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) continue;
      url = data.signedUrl;
      state.attachmentUrls.set(path, url);
    }
    if (!link.isConnected) continue;
    if (link.tagName === 'A') link.href = url;
    const type = decodeData(link.dataset.attachmentType || '');
    if (type.startsWith('image/') && !link.querySelector('img')) {
      const image = document.createElement('img');
      image.src = url;
      image.alt = 'Изображение';
      image.loading = 'lazy';
      link.prepend(image);
    }
    const audio = link.querySelector('audio');
    if (audio && !audio.src) audio.src = url;
  }
}

function scrollMessages() {
  const list = $('message-list');
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

async function markConversationRead() {
  if (!state.active) return;
  const { error } = await db.rpc('mark_conversation_read', { target_conversation_id: state.active.id });
  if (!error) {
    const own = state.active.members?.find((member) => member.id === state.user.id);
    if (own) own.last_read_at = new Date().toISOString();
    state.active.unread = false;
    renderConversations();
  }
}

function maybeNotify(message) {
  if (message.sender_id === state.user?.id || !('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  const sender = profileForUser(message.sender_id);
  new Notification(sender ? '@' + sender.username : conversationName(state.active), { body: messagePreview(message) });
}

function appendMessage(message) {
  if (!message || state.active?.id !== message.conversation_id || state.messageIds.has(message.id)) return;
  state.messages.push(message);
  state.messageIds.add(message.id);
  state.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  renderMessages();
  renderPinnedMessage();
  if (message.sender_id !== state.user.id) {
    maybeNotify(message);
    markConversationRead();
  }
  loadConversations().catch(() => {});
}

function updateMessage(message) {
  if (!message || state.active?.id !== message.conversation_id) return;
  const index = state.messages.findIndex((item) => item.id === message.id);
  if (index === -1) return;
  state.messages[index] = message;
  renderMessages(false);
  renderPinnedMessage();
  loadConversations().catch(() => {});
}

function subscribeToConversation(conversationId) {
  state.channel?.unsubscribe();
  state.channel = db
    .channel('chat-' + conversationId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + conversationId }, (payload) => appendMessage(payload.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + conversationId }, (payload) => updateMessage(payload.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, () => refreshReactions())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members', filter: 'conversation_id=eq.' + conversationId }, () => {
      clearTimeout(state.membershipRefreshTimer);
      state.membershipRefreshTimer = setTimeout(() => refreshConversationState().catch(() => {}), 120);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: 'id=eq.' + conversationId }, () => {
      refreshConversationState().catch(() => {});
    })
    .on('broadcast', { event: 'typing' }, (event) => receiveTyping(event?.payload || event))
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') showAppMessage('Новые сообщения будут загружены при следующем открытии чата.', true);
    });
}

function receiveTyping(payload) {
  if (!payload || payload.userId === state.user?.id || !state.active) return;
  state.remoteTyping = payload.typing === false ? null : ('@' + (payload.username || 'собеседник'));
  updateChatHeader();
  clearTimeout(state.remoteTypingTimer);
  if (payload.typing !== false) {
    state.remoteTypingTimer = setTimeout(() => {
      state.remoteTyping = null;
      updateChatHeader();
    }, 1600);
  }
}

function sendTyping(typing = true) {
  if (!state.channel || !state.active || !state.user) return;
  state.channel.send({ type: 'broadcast', event: 'typing', payload: { userId: state.user.id, username: state.profile?.username, typing } });
  clearTimeout(state.typingTimer);
  if (typing) state.typingTimer = setTimeout(() => sendTyping(false), 1400);
}

function renderComposerState() {
  const context = $('composer-context');
  const input = $('message-input');
  if (state.editingMessage) {
    $('attachment-preview').hidden = true;
    context.hidden = false;
    $('composer-context-copy').textContent = 'Редактирование сообщения';
    $('composer-cancel').textContent = 'Отмена';
    $('send-message').textContent = '✓';
    $('attach-button').disabled = true;
    $('voice-button').disabled = true;
    return;
  }
  if (state.replyTo) {
    context.hidden = false;
    $('composer-context-copy').textContent = `Ответ @${profileForUser(state.replyTo.sender_id)?.username || 'пользователю'}: ${messagePreview(state.replyTo).slice(0, 55)}`;
    $('composer-cancel').textContent = '×';
  } else {
    context.hidden = true;
  }
  $('send-message').textContent = '↑';
  $('attach-button').disabled = Boolean(state.mediaRecorder);
  $('voice-button').disabled = Boolean(state.mediaRecorder);
  $('attachment-preview').hidden = !state.pendingFile;
  if (state.pendingFile) $('attachment-name').textContent = state.pendingFile.name;
  if (!state.editingMessage && !input.value) input.placeholder = 'Напишите сообщение';
}

function clearComposerState(clearText = false) {
  if (state.mediaRecorder) stopVoiceRecording(true);
  state.replyTo = null;
  state.editingMessage = null;
  state.pendingFile = null;
  state.reactionPickerFor = null;
  $('attachment-input').value = '';
  if (clearText) $('message-input').value = '';
  renderComposerState();
}

function safeFileName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._()-]+/g, '_').slice(-120) || 'file';
}

function updateVoiceRecordingUi() {
  const recording = Boolean(state.mediaRecorder && state.mediaRecorder.state !== 'inactive');
  $('voice-recording').hidden = !recording;
  $('voice-button').classList.toggle('recording', recording);
  $('voice-button').textContent = recording ? '■' : '⌁';
  $('voice-button').setAttribute('aria-label', recording ? 'Остановить запись' : 'Записать голосовое сообщение');
  $('attach-button').disabled = recording || Boolean(state.editingMessage);
  if (!recording) return;
  const seconds = Math.max(0, Math.floor((Date.now() - state.voiceStartedAt) / 1000));
  $('voice-recording-time').textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function resetVoiceRecording() {
  clearInterval(state.voiceTimer);
  state.voiceTimer = null;
  state.recordingStream?.getTracks().forEach((track) => track.stop());
  state.mediaRecorder = null;
  state.recordingStream = null;
  state.voiceChunks = [];
  state.voiceStartedAt = null;
  state.discardVoice = false;
  updateVoiceRecordingUi();
  renderComposerState();
}

async function startVoiceRecording() {
  if (!state.active || state.editingMessage) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showAppMessage('Голосовые сообщения не поддерживаются этим браузером.', true);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
    state.recordingStream = stream;
    state.mediaRecorder = recorder;
    state.voiceChunks = [];
    state.discardVoice = false;
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) state.voiceChunks.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      const chunks = state.voiceChunks;
      const discard = state.discardVoice;
      const type = recorder.mimeType || 'audio/webm';
      resetVoiceRecording();
      if (discard || !chunks.length) return;
      const blob = new Blob(chunks, { type });
      if (blob.size > 15 * 1024 * 1024) {
        showAppMessage('Голосовое сообщение больше 15 МБ.', true);
        return;
      }
      const extension = type.includes('ogg') ? 'ogg' : 'webm';
      state.pendingFile = new File([blob], 'voice-message-' + new Date().toISOString().slice(11, 19).replace(/:/g, '-') + '.' + extension, { type });
      renderComposerState();
      showAppMessage('Голосовое сообщение готово к отправке.');
    });
    recorder.start(250);
    state.voiceStartedAt = Date.now();
    state.voiceTimer = setInterval(updateVoiceRecordingUi, 250);
    updateVoiceRecordingUi();
  } catch (error) {
    showAppMessage('Не удалось включить микрофон: ' + humanError(error), true);
  }
}

function stopVoiceRecording(discard = false) {
  if (!state.mediaRecorder) return;
  state.discardVoice = state.discardVoice || discard;
  if (state.mediaRecorder.state !== 'inactive') state.mediaRecorder.stop();
  else resetVoiceRecording();
}

function toggleVoiceRecording() {
  if (state.mediaRecorder) stopVoiceRecording();
  else startVoiceRecording();
}

async function sendMessage(event) {
  event.preventDefault();
  const input = $('message-input');
  const body = input.value.trim();
  if (state.mediaRecorder) {
    showAppMessage('Сначала остановите запись голосового сообщения.', true);
    return;
  }
  if (!state.active || (!body && !state.pendingFile)) return;
  const button = $('send-message');
  button.disabled = true;
  try {
    if (state.editingMessage) {
      const { error } = await db.rpc('edit_message', { target_message_id: state.editingMessage.id, replacement_body: body });
      if (error) throw error;
      clearComposerState(true);
      await loadMessages();
      return;
    }

    const messageId = crypto.randomUUID();
    let attachment = {};
    if (state.pendingFile) {
      if (state.pendingFile.size > 15 * 1024 * 1024) throw new Error('Файл больше 15 МБ.');
      const path = `${state.active.id}/${messageId}/${safeFileName(state.pendingFile.name)}`;
      const { error: uploadError } = await db.storage.from('message-files').upload(path, state.pendingFile, {
        upsert: false,
        contentType: state.pendingFile.type || 'application/octet-stream',
      });
      if (uploadError) throw uploadError;
      attachment = {
        attachment_path: path,
        attachment_name: state.pendingFile.name.slice(0, 180),
        attachment_type: state.pendingFile.type || 'application/octet-stream',
      };
    }

    const { data, error } = await db
      .from('messages')
      .insert({
        id: messageId,
        conversation_id: state.active.id,
        sender_id: state.user.id,
        body: body || (String(attachment.attachment_type || '').startsWith('audio/') ? '🎤 Голосовое сообщение' : `📎 ${attachment.attachment_name || 'Файл'}`),
        reply_to: state.replyTo?.id || null,
        ...attachment,
      })
      .select()
      .single();
    if (error) throw error;
    clearComposerState(true);
    appendMessage(data);
    sendTyping(false);
  } catch (error) {
    showAppMessage('Сообщение не отправлено: ' + humanError(error), true);
  } finally {
    button.disabled = false;
  }
}

async function toggleReaction(messageId, emoji) {
  const hasReaction = state.reactions.some((reaction) => reaction.message_id === messageId && reaction.user_id === state.user.id && reaction.emoji === emoji);
  try {
    const response = hasReaction
      ? await db.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', state.user.id).eq('emoji', emoji)
      : await db.from('message_reactions').insert({ message_id: messageId, user_id: state.user.id, emoji });
    if (response.error) throw response.error;
    state.reactionPickerFor = null;
    await loadReactions();
    renderMessages(false);
  } catch (error) {
    showAppMessage('Не удалось поставить реакцию: ' + humanError(error), true);
  }
}

async function pinMessage(messageId) {
  if (!state.active) return;
  try {
    const { error } = await db.rpc('set_pinned_message', {
      target_conversation_id: state.active.id,
      target_message_id: messageId,
    });
    if (error) throw error;
    state.active.pinned_message_id = messageId;
    renderPinnedMessage();
    showAppMessage('Сообщение закреплено.');
  } catch (error) {
    showAppMessage('Не удалось закрепить сообщение: ' + humanError(error), true);
  }
}

async function clearPinnedMessage() {
  if (!state.active) return;
  const { error } = await db.rpc('set_pinned_message', { target_conversation_id: state.active.id, target_message_id: null });
  if (error) {
    showAppMessage('Не удалось открепить сообщение: ' + humanError(error), true);
    return;
  }
  state.active.pinned_message_id = null;
  renderPinnedMessage();
}

async function handleMessageClick(event) {
  const actionButton = event.target.closest('[data-message-action]');
  const reactionButton = event.target.closest('[data-reaction]');
  if (reactionButton) {
    await toggleReaction(reactionButton.dataset.messageId, decodeData(reactionButton.dataset.reaction));
    return;
  }
  if (!actionButton) return;
  const message = state.messages.find((item) => item.id === actionButton.dataset.messageId);
  if (!message) return;
  const action = actionButton.dataset.messageAction;
  if (action === 'reply') {
    state.replyTo = message;
    state.editingMessage = null;
    $('message-input').value = '';
    renderComposerState();
    $('message-input').focus();
  }
  if (action === 'forward') openForwardPanel(message);
  if (action === 'reaction-picker') {
    state.reactionPickerFor = state.reactionPickerFor === message.id ? null : message.id;
    renderMessages(false);
  }
  if (action === 'pin') await pinMessage(message.id);
  if (action === 'edit' && message.sender_id === state.user.id) {
    state.editingMessage = message;
    state.replyTo = null;
    state.pendingFile = null;
    $('attachment-input').value = '';
    $('message-input').value = message.body;
    renderComposerState();
    $('message-input').focus();
  }
  if (action === 'delete' && message.sender_id === state.user.id && window.confirm('Удалить это сообщение?')) {
    const { error } = await db.rpc('delete_message', { target_message_id: message.id });
    if (error) showAppMessage('Не удалось удалить сообщение: ' + humanError(error), true);
  }
}

function pickAttachment() {
  if (!state.editingMessage && !state.mediaRecorder) $('attachment-input').click();
}

function selectAttachment() {
  const file = $('attachment-input').files?.[0];
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) {
    showAppMessage('Файл больше 15 МБ.', true);
    $('attachment-input').value = '';
    return;
  }
  state.pendingFile = file;
  renderComposerState();
}

async function updateProfile(event) {
  event.preventDefault();
  const about = $('profile-about').value.trim();
  const avatar = $('profile-avatar').value.trim() || '🙂';
  const button = $('profile-form').querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    if (avatar.length > 12) throw new Error('Аватар должен быть короче 12 символов.');
    const { data, error } = await db
      .from('profiles')
      .update({ about, avatar_emoji: avatar, last_seen_at: new Date().toISOString() })
      .eq('id', state.user.id)
      .select()
      .single();
    if (error) throw error;
    state.profile = data;
    renderOwnProfile();
    $('profile-form').hidden = true;
    showAppMessage('Профиль сохранён.');
  } catch (error) {
    showAppMessage('Не удалось сохранить профиль: ' + humanError(error), true);
  } finally {
    button.disabled = false;
  }
}

async function enableNotifications() {
  if (!('Notification' in window)) {
    showAppMessage('Браузер не поддерживает уведомления.', true);
    return;
  }
  if (Notification.permission === 'granted') {
    showAppMessage('Уведомления уже включены.');
    return;
  }
  const permission = await Notification.requestPermission();
  showAppMessage(permission === 'granted' ? 'Уведомления включены.' : 'Разрешение на уведомления не выдано.', permission !== 'granted');
}

async function enterApp(user) {
  if (state.enteringApp || (state.user?.id === user.id && !$('app-view').hidden)) return;
  state.enteringApp = true;
  try {
    state.user = user;
    await getProfile();
    await loadConversations();
    $('auth-view').hidden = true;
    $('app-view').hidden = false;
    showAppMessage();
    touchPresence().catch(() => {});
  } finally {
    state.enteringApp = false;
  }
}

async function init() {
  try {
    if (!configured) throw new Error('Добавьте URL и публичный ключ Supabase в app.js перед запуском.');
    const { data: { session } } = await db.auth.getSession();
    if (session) await enterApp(session.user);
    else showAuth();

    db.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        showAuth();
        return;
      }
      if (event === 'SIGNED_IN' && !state.user) {
        enterApp(session.user).catch((error) => showAuth(humanError(error, 'Не удалось открыть аккаунт.'), true));
      }
    });
  } catch (error) {
    showAuth(humanError(error, 'Не удалось открыть аккаунт.'), true);
  } finally {
    finishBoot();
  }
}

$('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!configured) return;
  const email = $('email').value.trim().toLowerCase();
  const password = $('password').value;
  const username = $('username').value.trim().toLowerCase();
  $('auth-submit').disabled = true;
  showMessage();
  try {
    if (!validEmail(email)) throw new Error('Введите корректный email.');
    if (password.length < 6) throw new Error('Пароль должен содержать минимум 6 символов.');
    if (state.signingUp) {
      if (!validUsername(username)) throw new Error('Юзернейм: 3–24 символа — латиница, цифры и _.');
      const { data, error } = await db.auth.signUp({ email, password, options: { data: { username } } });
      if (error) throw error;
      if (!data.user) throw new Error('Не удалось создать аккаунт.');
      if (data.session) await enterApp(data.user);
      else showMessage('Проверьте почту и подтвердите регистрацию, затем войдите.');
    } else {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await enterApp(data.user);
    }
  } catch (error) {
    showMessage(humanError(error), true);
  } finally {
    $('auth-submit').disabled = false;
  }
});

$('switch-auth').addEventListener('click', () => setAuthMode(!state.signingUp));
$('user-search').addEventListener('input', () => {
  clearTimeout(window.searchTimer);
  window.searchTimer = setTimeout(() => searchUsers().catch((error) => showAppMessage(humanError(error), true)), 250);
});
$('group-create-toggle').addEventListener('click', () => {
  const form = $('group-create-form');
  form.hidden = !form.hidden;
  if (!form.hidden) $('group-title').focus();
});
$('group-create-form').addEventListener('submit', createGroup);
$('message-form').addEventListener('submit', sendMessage);
$('message-list').addEventListener('click', handleMessageClick);
$('message-input').addEventListener('input', () => sendTyping(true));
$('profile-form').addEventListener('submit', updateProfile);
$('profile-settings').addEventListener('click', () => {
  const form = $('profile-form');
  form.hidden = !form.hidden;
  if (!form.hidden) $('profile-about').focus();
});
$('sign-out').addEventListener('click', () => db.auth.signOut().catch((error) => showAppMessage(humanError(error), true)));
$('mobile-back').addEventListener('click', () => $('app-view').classList.remove('chat-open'));
$('message-search-toggle').addEventListener('click', () => {
  const wrap = $('message-search-wrap');
  wrap.hidden = !wrap.hidden;
  if (!wrap.hidden) $('message-search').focus();
});
$('message-search').addEventListener('input', () => {
  state.messageQuery = $('message-search').value;
  renderMessages(false);
});
$('add-member-button').addEventListener('click', addGroupMember);
$('group-manage-button').addEventListener('click', toggleGroupPanel);
$('group-member-form').addEventListener('click', handleGroupPanelClick);
$('notification-toggle').addEventListener('click', enableNotifications);
$('pinned-message').addEventListener('click', (event) => {
  if (event.target.closest('#unpin-message')) return clearPinnedMessage();
  const id = $('pinned-message').dataset.messageId;
  document.getElementById('message-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
$('composer-cancel').addEventListener('click', () => clearComposerState(true));
$('attach-button').addEventListener('click', pickAttachment);
$('voice-button').addEventListener('click', toggleVoiceRecording);
$('voice-cancel').addEventListener('click', () => stopVoiceRecording(true));
$('attachment-input').addEventListener('change', selectAttachment);
$('attachment-remove').addEventListener('click', () => clearComposerState(false));
$('emoji-toggle').addEventListener('click', () => { $('emoji-strip').hidden = !$('emoji-strip').hidden; });
document.querySelectorAll('[data-compose-emoji]').forEach((button) => button.addEventListener('click', () => {
  const input = $('message-input');
  input.value += button.dataset.composeEmoji;
  input.focus();
  sendTyping(true);
}));

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}
