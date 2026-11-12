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
  updateDoc,
  getDocs,
  collection,
  writeBatch,
  Timestamp,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import {
  adminIdToEmail, validateAdminLogin, validateAdminSignup, ADMIN_NAME_MAX,
  generateToken, monthOptions, validateNote, formatMonth, judgeState, NOTE_MAX,
} from './logic.js';

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
  const invitesHolder = h('div');
  nodes.push(invitesHolder);
  renderInvitePanel(invitesHolder, uid);
  if (admin.role === 'owner') {
    const holder = h('div');
    nodes.push(holder);
    renderOwnerPanel(holder, uid);
  }
  nodes.push(logoutButton());
  show(...nodes);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// 招待URL。管理画面と同じフォルダの index.html に、#トークン を付ける
function inviteUrl(token) {
  return new URL(`./#${token}`, location.href).href;
}

// URLの表示欄とコピーボタン
function urlBox(token) {
  const url = inviteUrl(token);
  const input = h('input', { type: 'text', readonly: '', value: url, 'aria-label': '招待URL' });
  input.addEventListener('focus', () => input.select());
  const copy = h('button', { type: 'button', class: 'secondary' }, 'URLをコピー');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      copy.textContent = 'コピーしました';
    } catch {
      input.select();
      copy.textContent = '長押しでコピーしてください';
    }
  });
  return h('div', { class: 'field' }, input, copy);
}

// 招待の作成と、最近の招待の一覧。月ごとの枠・種別・確定・取消は、このあと順に作る
async function renderInvitePanel(holder, uid) {
  const result = h('div');
  const month = h('select', { id: 'month' }, ...monthOptions(new Date()).map((m) => h('option', { value: m }, formatMonth(m))));
  const note = h('input', { id: 'note', type: 'text', autocomplete: 'off', maxlength: String(NOTE_MAX) });
  const noteError = h('p', { class: 'error' });
  const button = h('button', { type: 'submit' }, '招待を作る');
  const form = h(
    'form',
    { novalidate: '' },
    h('div', { class: 'field' }, h('label', { for: 'month' }, '移民予定月'), month),
    h('div', { class: 'field' }, h('label', { for: 'note' }, '送付先メモ ', h('span', { class: 'hint' }, '任意。誰に送るかの目印（管理者だけが見られます）')), note, noteError),
    button,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const n = validateNote(note.value);
    noteError.textContent = n.error;
    if (!n.ok) return;
    button.disabled = true;
    try {
      let days = 3;
      try {
        const snap = await getDoc(doc(db, 'settings', 'slots'));
        const v = snap.exists() ? snap.data().inviteExpiryDays : null;
        if (Number.isInteger(v) && v >= 1 && v <= 30) days = v;
      } catch {
        // 設定を読めなければ、既定の3日
      }
      const token = generateToken();
      const batch = writeBatch(db);
      batch.set(doc(db, 'invites', token), {
        scheduledMonth: month.value,
        inviteType: '未定',
        status: '招待済み',
        expiresAt: Timestamp.fromMillis(Date.now() + days * DAY_MS),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'invite_notes', token), { sendNote: n.value, createdBy: uid, createdAt: serverTimestamp() });
      await batch.commit();
      note.value = '';
      result.replaceChildren(
        card('招待を作りました', `${formatMonth(month.value)}の招待です。有効期限は${days}日間です。このURLをゲーム内の個人チャットで送ってください。`, urlBox(token)),
      );
      await loadList();
    } catch {
      result.replaceChildren(h('p', { class: 'error' }, '招待を作れませんでした。時間をおいて、もう一度お試しください。'));
    }
    button.disabled = false;
  });

  const list = h('div');
  async function loadList() {
    try {
      const snap = await getDocs(query(collection(db, 'invites'), orderBy('createdAt', 'desc'), limit(20)));
      const rows = snap.docs.map((d) => {
        const data = d.data();
        const state = judgeState(data, Date.now());
        const summary = [formatMonth(data.scheduledMonth) ?? '', data.name ?? '', state, data.inviteType ?? ''].filter(Boolean).join('　');
        const detail = h('div');
        const toggle = h('button', { type: 'button', class: 'secondary' }, '詳細');
        toggle.addEventListener('click', () => {
          if (detail.childNodes.length) detail.replaceChildren();
          else renderInviteDetail(detail, d.id, data, state, uid, loadList);
        });
        return h('li', { class: 'row' }, h('span', {}, summary), toggle, detail);
      });
      list.replaceChildren(card('最近の招待', rows.length ? h('ul', { class: 'list' }, ...rows) : 'まだ招待はありません。'));
    } catch {
      list.replaceChildren(card('最近の招待', '読み込めませんでした。'));
    }
  }

  holder.replaceChildren(card('招待を作る', form), result, list);
  await loadList();
}

// 招待1件の詳細と操作：種別の決定、確定、取消、期限の延長、メモ
async function renderInviteDetail(box, token, data, state, uid, reload) {
  box.style.flex = '1 1 100%';
  const message = h('p', { class: 'error' });
  const dl = (label, value) => h('p', { class: 'muted' }, `${label}：${value || '（なし）'}`);
  const memoInput = h('input', { type: 'text', autocomplete: 'off', maxlength: String(NOTE_MAX), 'aria-label': '管理者メモ' });
  let sendNote = '';
  try {
    const n = await getDoc(doc(db, 'invite_notes', token));
    if (n.exists()) {
      sendNote = n.data().sendNote ?? '';
      memoInput.value = n.data().adminMemo ?? '';
    }
  } catch {
    message.textContent = 'メモを読み込めませんでした。';
  }

  async function run(button, fn) {
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
  const update = (fields) => updateDoc(doc(db, 'invites', token), { ...fields, updatedAt: serverTimestamp() });
  const btn = (label, cls, onClick) => {
    const b = h('button', { type: 'button', class: cls }, label);
    b.addEventListener('click', () => onClick(b));
    return b;
  };

  const children = [
    dl('状態', state),
    dl('予定月', formatMonth(data.scheduledMonth)),
    dl('名前', data.name),
    dl('ID', data.gameId),
    dl('国番号', data.countryNo),
    dl('同盟', data.alliance),
    dl('送付先メモ', sendNote),
  ];

  if (state === '招待済み' || state === '失効') {
    if (state === '招待済み') children.push(urlBox(token));
    children.push(
      btn('期限を延ばす', 'secondary', (b) => {
        if (!confirm('今から有効期限を延ばし直しますか？')) return;
        run(b, async () => {
          let days = 3;
          try {
            const snap = await getDoc(doc(db, 'settings', 'slots'));
            const v = snap.exists() ? snap.data().inviteExpiryDays : null;
            if (Number.isInteger(v) && v >= 1 && v <= 30) days = v;
          } catch {
            // 既定の3日
          }
          await update({ expiresAt: Timestamp.fromMillis(Date.now() + days * DAY_MS) });
        });
      }),
    );
  }

  if (state === '登録済み' || state === '確定') {
    const type = h('select', { 'aria-label': '招待の種別' }, ...['未定', '普通', '特別'].map((t) => h('option', { value: t }, t)));
    type.value = data.inviteType ?? '未定';
    children.push(
      h('div', { class: 'field' }, h('label', {}, '種別 ', h('span', { class: 'hint' }, 'ゲーム内でIDを照会して決めます')), type),
      btn('種別を保存', 'secondary', (b) => run(b, () => update({ inviteType: type.value }))),
    );
    if (state === '登録済み') {
      children.push(
        btn('確定する', '', (b) => {
          const warn = (data.inviteType ?? '未定') === '未定' ? '種別がまだ「未定」です。このまま確定しますか？' : '確定しますか？';
          if (!confirm(warn)) return;
          run(b, () => update({ status: '確定', confirmedAt: serverTimestamp() }));
        }),
      );
    }
  }

  if (state !== '取消') {
    children.push(
      btn('取り消す', 'secondary', (b) => {
        if (!confirm('この招待を取り消しますか？')) return;
        run(b, () => update({ status: '取消', cancelledAt: serverTimestamp() }));
      }),
    );
  }

  children.push(
    h('div', { class: 'field' }, h('label', {}, '管理者メモ'), memoInput),
    btn('メモを保存', 'secondary', (b) => {
      const n = validateNote(memoInput.value);
      if (!n.ok) {
        message.textContent = n.error;
        return;
      }
      run(b, () => setDoc(doc(db, 'invite_notes', token), { adminMemo: n.value, updatedBy: uid }, { merge: true }));
    }),
    message,
  );
  box.replaceChildren(...children);
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
