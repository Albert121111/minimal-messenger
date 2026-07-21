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

function showAuth(message = '', error = false) {
  state.channel?.unsubscribe();
  state.channel = null;
  state.user = null;
  state.profile = null;
  state.conversations = [];
  state.active = null;
  state.messageIds = new Set();
  state.searchRequest += 1;
  $('chat-title').textContent = '';
  $('chat-status').textContent = 'личный чат';
  $('chat').hidden = true;
  $('empty-state').hidden = false;
  $('message-list').innerHTML = '';
  $('conversation-list').innerHTML = '';
  $('user-search').value = '';
  $('search-results').innerHTML = '';
  $('profile-form').hidden = true;
  $('profile-about').value = '';
  $('my-username').textContent = '';
  $('my-about').textContent = '';
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
  if (/user not found/i.test(message)) return 'Пользователь больше не существует.';
  if (/network|fetch/i.test(message)) return 'Нет соединения с сервером. Проверьте интернет и повторите.';
  return message || fallback;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value || '';
  return div.innerHTML;
}

function initials(username) { return String(username || '?').slice(0, 2).toUpperCase(); }
function formatTime(date) { return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(date)); }
function validUsername(username) { return /^[a-z0-9_]{3,24}$/.test(username); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function profileFromRelation(profile) { return Array.isArray(profile) ? profile[0] : profile; }

function renderOwnProfile() {
  $('my-username').textContent = '@' + state.profile.username;
  $('my-about').textContent = state.profile.about || 'Добавьте короткий статус';
  $('profile-about').value = state.profile.about || '';
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
  if (error) {
    throw new Error('Не удалось загрузить профиль. Выйдите и войдите снова.');
  }
  state.profile = data;
  renderOwnProfile();
}

async function loadConversations() {
  const { data: memberships, error } = await db
    .from('conversation_members')
    .select('conversation_id, joined_at')
    .eq('user_id', state.user.id);
  if (error) throw error;

  const ids = memberships.map((item) => item.conversation_id);
  if (!ids.length) {
    state.conversations = [];
    renderConversations();
    return;
  }

  const { data: members, error: membersError } = await db
    .from('conversation_members')
    .select('conversation_id, user_id, profiles(username, about)')
    .in('conversation_id', ids)
    .neq('user_id', state.user.id);
  if (membersError) throw membersError;

  const { data: messages, error: messagesError } = await db
    .from('messages')
    .select('conversation_id, body, created_at')
    .in('conversation_id', ids)
    .order('created_at', { ascending: false });
  if (messagesError) throw messagesError;

  state.conversations = ids
    .map((id) => {
      const member = members.find((item) => item.conversation_id === id);
      const person = profileFromRelation(member?.profiles);
      return {
        id,
        person,
        last: messages.find((item) => item.conversation_id === id),
        joinedAt: memberships.find((item) => item.conversation_id === id)?.joined_at,
      };
    })
    .filter((conversation) => conversation.person?.username)
    .sort((a, b) => new Date(b.last?.created_at || b.joinedAt || 0) - new Date(a.last?.created_at || a.joinedAt || 0));

  renderConversations();
}

function renderConversations() {
  $('conversation-list').innerHTML = state.conversations.length
    ? state.conversations.map((chat) => `
      <button class="conversation ${state.active?.id === chat.id ? 'active' : ''}" data-id="${chat.id}">
        <span class="avatar">${initials(chat.person.username)}</span>
        <div><strong>@${escapeHtml(chat.person.username)}</strong><small>${escapeHtml(chat.last?.body || 'Начните разговор')}</small></div>
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
    .select('id, username, about')
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
        <span class="avatar">${initials(person.username)}</span>
        <div><strong>@${escapeHtml(person.username)}</strong><small>${escapeHtml(person.about || 'Начать диалог')}</small></div>
      </button>`).join('')
    : '<p class="notice">Никого не найдено.</p>';

  document.querySelectorAll('.person').forEach((button) => {
    button.addEventListener('click', () => {
      const person = data.find((item) => item.id === button.dataset.id);
      if (person) startConversation(person.id, person.username, person.about || '');
    });
  });
}

async function startConversation(userId, username, about = '') {
  if (state.openingConversation) return;
  state.openingConversation = true;
  showAppMessage('Открываем чат…');

  try {
    const { data: id, error } = await db.rpc('open_direct_conversation', { other_user_id: userId });
    if (error) throw error;
    if (!id) throw new Error('Сервер не вернул идентификатор диалога.');

    const fallbackChat = { id, person: { username, about } };
    try {
      await loadConversations();
    } catch (error) {
      // The chat itself is still safe to open; the error remains visible instead of failing silently.
      showAppMessage('Чат открыт, но список диалогов обновится после перезагрузки.', true);
    }

    $('user-search').value = '';
    $('search-results').innerHTML = '';
    await openConversation(state.conversations.find((chat) => chat.id === id) || fallbackChat);
    showAppMessage();
  } catch (error) {
    showAppMessage('Не удалось открыть чат: ' + humanError(error), true);
  } finally {
    state.openingConversation = false;
  }
}

async function openConversation(chat) {
  state.active = chat;
  state.messageIds = new Set();
  $('chat-title').textContent = '@' + chat.person.username;
  $('chat-status').textContent = chat.person.about || 'личный чат';
  $('empty-state').hidden = true;
  $('chat').hidden = false;
  $('app-view').classList.add('chat-open');
  renderConversations();

  const { data, error } = await db
    .from('messages')
    .select('*')
    .eq('conversation_id', chat.id)
    .order('created_at');
  if (error) {
    renderMessages([]);
    throw error;
  }

  renderMessages(data);
  state.channel?.unsubscribe();
  state.channel = db
    .channel('chat-' + chat.id)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + chat.id,
    }, (payload) => appendMessage(payload.new))
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') showAppMessage('Новые сообщения будут загружены при следующем открытии чата.', true);
    });
}

function renderMessages(messages) {
  state.messageIds = new Set(messages.map((message) => message.id));
  $('message-list').innerHTML = messages.map(messageMarkup).join('');
  scrollMessages();
}

function messageMarkup(message) {
  return `<article class="message ${message.sender_id === state.user.id ? 'mine' : ''}">${escapeHtml(message.body)}<time>${formatTime(message.created_at)}</time></article>`;
}

function appendMessage(message) {
  if (!message || state.active?.id !== message.conversation_id || state.messageIds.has(message.id)) return;
  state.messageIds.add(message.id);
  $('message-list').insertAdjacentHTML('beforeend', messageMarkup(message));
  scrollMessages();
  loadConversations().catch((error) => showAppMessage('Не удалось обновить список диалогов: ' + humanError(error), true));
}

function scrollMessages() {
  const list = $('message-list');
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

async function sendMessage(event) {
  event.preventDefault();
  const input = $('message-input');
  const body = input.value.trim();
  if (!body || !state.active) return;

  input.value = '';
  const { data, error } = await db
    .from('messages')
    .insert({ conversation_id: state.active.id, sender_id: state.user.id, body })
    .select()
    .single();

  if (error) {
    input.value = body;
    showAppMessage('Сообщение не отправлено: ' + humanError(error), true);
    return;
  }
  appendMessage(data);
}

async function updateProfile(event) {
  event.preventDefault();
  const about = $('profile-about').value.trim();
  const button = $('profile-form').querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    const { data, error } = await db
      .from('profiles')
      .update({ about })
      .eq('id', state.user.id)
      .select()
      .single();
    if (error) throw error;
    state.profile = data;
    renderOwnProfile();
    $('profile-form').hidden = true;
    showAppMessage('Статус сохранён.');
  } catch (error) {
    showAppMessage('Не удалось сохранить статус: ' + humanError(error), true);
  } finally {
    button.disabled = false;
  }
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
        state.user = null;
        state.profile = null;
        showAuth();
        return;
      }
      if (event === 'SIGNED_IN' && !state.user) {
        enterApp(session.user).catch((error) => {
          state.user = null;
          showAuth(humanError(error, 'Не удалось открыть аккаунт.'), true);
        });
      }
    });
  } catch (error) {
    state.user = null;
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
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: { data: { username } },
      });
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
$('message-form').addEventListener('submit', sendMessage);
$('profile-form').addEventListener('submit', updateProfile);
$('profile-settings').addEventListener('click', () => {
  const form = $('profile-form');
  form.hidden = !form.hidden;
  if (!form.hidden) $('profile-about').focus();
});
$('sign-out').addEventListener('click', () => db.auth.signOut().catch((error) => showAppMessage(humanError(error), true)));
$('mobile-back').addEventListener('click', () => $('app-view').classList.remove('chat-open'));

init();
