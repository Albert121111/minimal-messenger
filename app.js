// Set these two values from Supabase → Project Settings → API before publishing.
const SUPABASE_URL = 'https://smngjqnkfbelxdxxqfhr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1hwKdToUcCqVt-2hbWU65A_hxyhx3zd';

const configured = !SUPABASE_URL.startsWith('PASTE_') && !SUPABASE_ANON_KEY.startsWith('PASTE_');
const db = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = (id) => document.getElementById(id);
const state = { user: null, profile: null, conversations: [], active: null, channel: null, signingUp: true };

function showMessage(message = '', error = false) { const target = $('auth-message'); target.textContent = message; target.style.color = error ? '#b42318' : '#3b7a4c'; }
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function initials(username) { return username.slice(0, 2).toUpperCase(); }
function formatTime(date) { return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(date)); }

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
  if (error) throw error;
  state.profile = data;
  $('my-username').textContent = '@' + data.username;
}

async function loadConversations() {
  const { data: memberships, error } = await db.from('conversation_members').select('conversation_id').eq('user_id', state.user.id);
  if (error) throw error;
  const ids = memberships.map((item) => item.conversation_id);
  if (!ids.length) { state.conversations = []; renderConversations(); return; }
  const { data: members, error: membersError } = await db.from('conversation_members').select('conversation_id, user_id, profiles(username)').in('conversation_id', ids).neq('user_id', state.user.id);
  if (membersError) throw membersError;
  const { data: messages, error: messagesError } = await db.from('messages').select('conversation_id, body, created_at').in('conversation_id', ids).order('created_at', { ascending: false });
  if (messagesError) throw messagesError;
  state.conversations = ids.map((id) => ({ id, person: members.find((m) => m.conversation_id === id)?.profiles, last: messages.find((m) => m.conversation_id === id) })).filter((c) => c.person).sort((a, b) => new Date(b.last?.created_at || 0) - new Date(a.last?.created_at || 0));
  renderConversations();
}

function renderConversations() {
  $('conversation-list').innerHTML = state.conversations.length ? state.conversations.map((chat) => \`<button class="conversation \${state.active?.id === chat.id ? 'active' : ''}" data-id="\${chat.id}"><span class="avatar">\${initials(chat.person.username)}</span><div><strong>@\${escapeHtml(chat.person.username)}</strong><small>\${escapeHtml(chat.last?.body || 'Начните разговор')}</small></div></button>\`).join('') : '<p class="notice">Диалогов пока нет.</p>';
  document.querySelectorAll('.conversation').forEach((button) => button.addEventListener('click', () => openConversation(state.conversations.find((chat) => chat.id === button.dataset.id))));
}

async function searchUsers() {
  const query = $('user-search').value.trim().toLowerCase();
  if (query.length < 2) { $('search-results').innerHTML = ''; return; }
  const { data, error } = await db.from('profiles').select('id, username').ilike('username', \`%\${query}%\`).neq('id', state.user.id).limit(8);
  if (error) return;
  $('search-results').innerHTML = data.length ? data.map((person) => \`<button class="person" data-id="\${person.id}" data-name="\${escapeHtml(person.username)}"><span class="avatar">\${initials(person.username)}</span><div><strong>@\${escapeHtml(person.username)}</strong><small>Начать диалог</small></div></button>\`).join('') : '<p class="notice">Никого не найдено.</p>';
  document.querySelectorAll('.person').forEach((button) => button.addEventListener('click', () => startConversation(button.dataset.id, button.dataset.name)));
}

async function startConversation(userId, username) {
  const { data: id, error } = await db.rpc('open_direct_conversation', { other_user_id: userId });
  if (error) return alert('Не удалось открыть чат: ' + error.message);
  $('user-search').value = ''; $('search-results').innerHTML = '';
  await loadConversations();
  await openConversation(state.conversations.find((chat) => chat.id === id) || { id, person: { username } });
}

async function openConversation(chat) {
  state.active = chat;
  $('chat-title').textContent = '@' + chat.person.username;
  $('empty-state').hidden = true; $('chat').hidden = false; $('app-view').classList.add('chat-open');
  renderConversations();
  const { data, error } = await db.from('messages').select('*').eq('conversation_id', chat.id).order('created_at');
  if (error) return;
  renderMessages(data);
  state.channel?.unsubscribe();
  state.channel = db.channel('chat-' + chat.id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + chat.id }, (payload) => appendMessage(payload.new)).subscribe();
}

function renderMessages(messages) { $('message-list').innerHTML = messages.map(messageMarkup).join(''); scrollMessages(); }
function messageMarkup(message) { return \`<article class="message \${message.sender_id === state.user.id ? 'mine' : ''}">\${escapeHtml(message.body)}<time>\${formatTime(message.created_at)}</time></article>\`; }
function appendMessage(message) { if (state.active?.id !== message.conversation_id) return; $('message-list').insertAdjacentHTML('beforeend', messageMarkup(message)); scrollMessages(); loadConversations(); }
function scrollMessages() { const list = $('message-list'); requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; }); }

async function sendMessage(event) {
  event.preventDefault(); const input = $('message-input'); const body = input.value.trim(); if (!body || !state.active) return;
  input.value = '';
  const { error } = await db.from('messages').insert({ conversation_id: state.active.id, sender_id: state.user.id, body });
  if (error) { input.value = body; alert('Сообщение не отправлено: ' + error.message); }
}

async function enterApp(user) {
  state.user = user; await getProfile();
  $('auth-view').hidden = true; $('app-view').hidden = false;
  await loadConversations();
}

async function init() {
  if (!configured) { showMessage('Добавьте URL и anon key Supabase в app.js перед запуском.', true); return; }
  const { data: { session } } = await db.auth.getSession();
  if (session) enterApp(session.user).catch((error) => showMessage(error.message, true));
  db.auth.onAuthStateChange((_event, session) => { if (!session) { state.channel?.unsubscribe(); state.active = null; $('app-view').hidden = true; $('auth-view').hidden = false; } });
}

$('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!configured) return;
  const email = $('email').value.trim(), password = $('password').value, username = $('username').value.trim().toLowerCase();
  $('auth-submit').disabled = true; showMessage();
  try {
    if (state.signingUp) {
      if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('Юзернейм: 3–24 символа — латиница, цифры и _.');
      const { data, error } = await db.auth.signUp({ email, password }); if (error) throw error;
      if (!data.user) throw new Error('Не удалось создать аккаунт.');
      const { error: profileError } = await db.from('profiles').insert({ id: data.user.id, username }); if (profileError) throw profileError;
      if (data.session) await enterApp(data.user); else showMessage('Проверьте почту и подтвердите регистрацию, затем войдите.');
    } else { const { data, error } = await db.auth.signInWithPassword({ email, password }); if (error) throw error; await enterApp(data.user); }
  } catch (error) { showMessage(error.message, true); }
  finally { $('auth-submit').disabled = false; }
});
$('switch-auth').addEventListener('click', () => setAuthMode(!state.signingUp));
$('user-search').addEventListener('input', () => { clearTimeout(window.searchTimer); window.searchTimer = setTimeout(searchUsers, 250); });
$('message-form').addEventListener('submit', sendMessage);
$('sign-out').addEventListener('click', () => db.auth.signOut());
document.querySelector('.chat-header').addEventListener('click', (event) => { if (event.target === event.currentTarget && innerWidth <= 700) $('app-view').classList.remove('chat-open'); });
init();
