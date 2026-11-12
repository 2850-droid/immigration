import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  connectAuthEmulator,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
  writeBatch,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { adminIdToEmail, validateAdminLogin, validateAdminSignup, ADMIN_NAME_MAX } from './logic.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

const root = document.getElementById('app');
let signingUp = false;

// 文字は append（textContent 相当）で入れるので、HTMLとして動くことはない
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}
const show = (...nodes) => root.replaceChildren(...nodes);
const card = (title, ...nodes) =>
  h('section', { class: 'card' }, h('h1', {}, title), ...nodes.map((n) => (typeof n === 'string' ? h('p', {}, n) : n)));

// 入力欄1つ分
function field(name, label, hint, attrs = {}) {
  const input = h('input', { id: name, name, type: 'text', autocomplete: 'off', ...attrs });
  const error = h('p', { class: 'error' });
  const node = h('div', { class: 'field' }, h('label', { for: name }, label, ' ', h('span', { class: 'hint' }, hint)), input, error);
  return { node, input, error };
}

function authErrorMessage(err, mode) {
  switch (err && err.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'IDまたはパスワードが違います。';
    case 'auth/email-already-in-use':
      return 'このIDはすでに使われています。別のIDにするか、ログインしてください。';
    case 'auth/too-many-requests':
      return '試行回数が多すぎます。しばらく待ってからお試しください。';
    case 'auth/network-request-failed':
      return '通信に失敗しました。時間をおいて、もう一度お試しください。';
    default:
      return mode === 'signup' ? '申請できませんでした。時間をおいて、もう一度お試しください。' : 'ログインできませんでした。';
  }
}

function showLogin() {
  const id = field('adminId', '管理者ID', '半角の英小文字・数字・_ で3〜20文字', { autocapitalize: 'none', autocomplete: 'username' });
  const pw = field('password', 'パスワード', '', { type: 'password', autocomplete: 'current-password' });
  const formError = h('p', { class: 'error' });
  const button = h('button', { type: 'submit' }, 'ログイン');
  const form = h('form', { novalidate: '' }, id.node, pw.node, formError, button);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const r = validateAdminLogin({ adminId: id.input.value, password: pw.input.value });
    id.error.textContent = r.errors.adminId ?? '';
    pw.error.textContent = r.errors.password ?? '';
    if (!r.ok) return;
    button.disabled = true;
    formError.textContent = '';
    try {
      await signInWithEmailAndPassword(auth, adminIdToEmail(r.values.adminId), r.values.password);
    } catch (err) {
      formError.textContent = authErrorMessage(err, 'login');
      button.disabled = false;
    }
  });
  const toSignup = h('button', { type: 'button', class: 'link' }, '管理者になりたい方はこちら（申請）');
  toSignup.addEventListener('click', showSignup);
  show(card('管理者ログイン', form), h('p', {}, toSignup));
}

function showSignup() {
  const id = field('adminId', '希望する管理者ID', '半角の英小文字・数字・_ で3〜20文字', { autocapitalize: 'none', autocomplete: 'username' });
  const name = field('displayName', '表示名', `${ADMIN_NAME_MAX}文字まで`);
  const pw = field('password', 'パスワード', '8文字以上', { type: 'password', autocomplete: 'new-password' });
  const pw2 = field('passwordConfirm', 'パスワード（確認）', '', { type: 'password', autocomplete: 'new-password' });
  const formError = h('p', { class: 'error' });
  const button = h('button', { type: 'submit' }, '申請する');
  const form = h('form', { novalidate: '' }, id.node, name.node, pw.node, pw2.node, formError, button);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const r = validateAdminSignup({
      adminId: id.input.value,
      displayName: name.input.value,
      password: pw.input.value,
      passwordConfirm: pw2.input.value,
    });
    id.error.textContent = r.errors.adminId ?? '';
    name.error.textContent = r.errors.displayName ?? '';
    pw.error.textContent = r.errors.password ?? '';
    pw2.error.textContent = r.errors.passwordConfirm ?? '';
    if (!r.ok) return;
    button.disabled = true;
    formError.textContent = '';
    try {
      // アカウントを作ると自動でログイン状態になる。申請を送り終えるまで、状態の判定は待たせる
      signingUp = true;
      const cred = await createUserWithEmailAndPassword(auth, adminIdToEmail(r.values.adminId), r.values.password);
      await sendRequest(cred.user.uid, r.values.displayName);
      signingUp = false;
      await route(cred.user);
    } catch (err) {
      signingUp = false;
      formError.textContent = authErrorMessage(err, 'signup');
      button.disabled = false;
      if (auth.currentUser) route(auth.currentUser);
    }
  });
  const back = h('button', { type: 'button', class: 'link' }, 'ログイン画面に戻る');
  back.addEventListener('click', showLogin);
  show(card('管理者の申請', h('p', { class: 'muted' }, 'オーナーが承認すると、管理画面を使えるようになります。パスワードは自動では再設定できません。'), form), h('p', {}, back));
}

function sendRequest(uid, displayName) {
  return setDoc(doc(db, 'admin_requests', uid), { displayName, createdAt: serverTimestamp() });
}

// ログイン済みだが、承認も申請もまだ（申請の送信が途中で失敗した場合など）
function showRequestOnly(user) {
  const name = field('displayName', '表示名', `${ADMIN_NAME_MAX}文字まで`);
  const formError = h('p', { class: 'error' });
  const button = h('button', { type: 'submit' }, '申請する');
  const form = h('form', { novalidate: '' }, name.node, formError, button);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const r = validateAdminSignup({ adminId: 'xxx', password: 'xxxxxxxx', passwordConfirm: 'xxxxxxxx', displayName: name.input.value });
    name.error.textContent = r.errors.displayName ?? '';
    if (!r.ok) return;
    button.disabled = true;
    try {
      await sendRequest(user.uid, r.values.displayName);
      await route(user);
    } catch {
      formError.textContent = '申請できませんでした。時間をおいて、もう一度お試しください。';
      button.disabled = false;
    }
  });
  show(card('管理者の申請', '申請がまだ届いていません。表示名を入れて申請してください。', form), logoutButton());
}

function logoutButton() {
  const b = h('button', { type: 'button', class: 'secondary' }, 'ログアウト');
  b.addEventListener('click', () => signOut(auth));
  return b;
}

// 承認済みの管理者の画面。招待・一覧などは、このあと順に作る
function showDashboard(uid, admin) {
  const roleLabel = admin.role === 'owner' ? 'オーナー' : '移民管理者';
  const nodes = [card('移民管理', `${admin.displayName ?? ''}さん（${roleLabel}）としてログイン中です。`)];
  if (admin.role === 'owner') {
    const holder = h('div');
    nodes.push(holder);
    renderOwnerPanel(holder, uid);
  }
  nodes.push(logoutButton());
  show(...nodes);
}

// オーナー用：承認待ちの申請と、移民管理者の名簿
async function renderOwnerPanel(holder, ownUid) {
  const message = h('p', { class: 'error' });
  const reload = () => renderOwnerPanel(holder, ownUid);

  async function act(button, fn) {
    button.disabled = true;
    message.textContent = '';
    try {
      await fn();
      await reload();
    } catch {
      message.textContent = '操作できませんでした。時間をおいて、もう一度お試しください。';
      button.disabled = false;
    }
  }

  let requests;
  let admins;
  try {
    [requests, admins] = await Promise.all([getDocs(collection(db, 'admin_requests')), getDocs(collection(db, 'admins'))]);
  } catch {
    holder.replaceChildren(card('管理者の管理', '読み込めませんでした。時間をおいて、もう一度お試しください。'));
    return;
  }

  const requestRows = requests.docs.map((d) => {
    const data = d.data();
    const approve = h('button', { type: 'button' }, '承認');
    approve.addEventListener('click', () => {
      if (!confirm(`「${data.displayName}」さんを移民管理者として承認しますか？`)) return;
      act(approve, () => {
        const batch = writeBatch(db);
        batch.set(doc(db, 'admins', d.id), { role: 'manager', displayName: data.displayName, createdAt: serverTimestamp() });
        batch.delete(doc(db, 'admin_requests', d.id));
        return batch.commit();
      });
    });
    const reject = h('button', { type: 'button', class: 'secondary' }, '却下');
    reject.addEventListener('click', () => {
      if (!confirm(`「${data.displayName}」さんの申請を却下しますか？`)) return;
      act(reject, () => writeBatch(db).delete(doc(db, 'admin_requests', d.id)).commit());
    });
    return h('li', { class: 'row' }, h('span', {}, data.displayName ?? '（名前なし）'), approve, reject);
  });

  const adminRows = admins.docs.map((d) => {
    const data = d.data();
    const row = h('li', { class: 'row' }, h('span', {}, `${data.displayName ?? ''}（${data.role === 'owner' ? 'オーナー' : '移民管理者'}）`));
    if (d.id !== ownUid && data.role !== 'owner') {
      const revoke = h('button', { type: 'button', class: 'secondary' }, '解任');
      revoke.addEventListener('click', () => {
        if (!confirm(`「${data.displayName}」さんを解任しますか？`)) return;
        act(revoke, () => writeBatch(db).delete(doc(db, 'admins', d.id)).commit());
      });
      row.append(revoke);
    }
    return row;
  });

  holder.replaceChildren(
    card('承認待ちの申請', requestRows.length ? h('ul', { class: 'list' }, ...requestRows) : '承認待ちの申請はありません。'),
    card('管理者の名簿', h('ul', { class: 'list' }, ...adminRows)),
    message,
  );
}

async function route(user) {
  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    if (adminSnap.exists()) return showDashboard(user.uid, adminSnap.data());
    const reqSnap = await getDoc(doc(db, 'admin_requests', user.uid));
    if (reqSnap.exists()) {
      return show(card('承認待ち', '申請を受け付けました。オーナーの承認をお待ちください。'), logoutButton());
    }
    showRequestOnly(user);
  } catch {
    show(card('読み込めませんでした', '通信に失敗したか、権限がありません。時間をおいて、もう一度お試しください。'), logoutButton());
  }
}

onAuthStateChanged(auth, (user) => {
  if (signingUp) return;
  if (user) route(user);
  else showLogin();
});
