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
  where,
  deleteField,
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
  computeSlots, validateSettings, DEFAULT_SETTINGS, filterInvites,
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
  const isOwner = admin.role === 'owner';
  const roleLabel = isOwner ? 'オーナー' : '移民管理者';
  const header = h('p', { class: 'muted who' }, `${admin.displayName ?? ''}さん（${roleLabel}）`);

  // タブごとの中身。選んでいないタブは隠すだけで、作り直さない（入力途中の内容が消えない）
  const tabs = [
    { id: 'work', label: '作業', render: (el) => renderWorkPanel(el, uid) },
    { id: 'invites', label: '招待', render: (el) => renderInvitePanel(el, uid) },
    { id: 'slots', label: '枠', render: (el) => renderSlotsPanel(el, isOwner) },
  ];
  if (isOwner) tabs.push({ id: 'admins', label: '管理者', render: (el) => renderOwnerPanel(el, uid) });

  let saved = null;
  try {
    saved = localStorage.getItem('adminTab');
  } catch {
    // 保存できなくても、先頭のタブで開くだけ
  }
  let activeId = tabs.some((t) => t.id === saved) ? saved : tabs[0].id;

  const bar = h('div', { class: 'tabs', role: 'tablist' });
  for (const t of tabs) {
    t.panel = h('div', { role: 'tabpanel' });
    t.button = h('button', { type: 'button', role: 'tab', class: 'tab' }, t.label);
    t.button.addEventListener('click', () => select(t.id));
    bar.append(t.button);
    t.render(t.panel);
  }
  function select(id) {
    activeId = id;
    for (const t of tabs) {
      const on = t.id === id;
      t.panel.hidden = !on;
      t.button.classList.toggle('active', on);
      t.button.setAttribute('aria-selected', String(on));
    }
    try {
      localStorage.setItem('adminTab', id);
    } catch {
      // 保存できなくても動作に影響はない
    }
  }
  select(activeId);
  show(header, bar, ...tabs.map((t) => t.panel), logoutButton());
}

const DAY_MS = 24 * 60 * 60 * 1000;

// 招待が変わったときに、月ごとの枠を読み直す（枠の画面が作られたら差し替わる）
let refreshSlots = () => {};
let refreshWork = () => {};

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

  // 一覧と絞り込み。絞り込みの条件は作り直さず、読み直しても保たれる
  const FETCH_LIMIT = 300;
  let all = [];
  let truncated = false;
  let loadError = false;

  const sel = (id, label, options) => {
    const el = h('select', { id, 'aria-label': label }, ...options.map(([v, t]) => h('option', { value: v }, t)));
    return el;
  };
  const stateSel = sel('f-state', '状態', [['', '状態：すべて'], ...['招待済み', '登録済み', '確定', '取消', '失効'].map((v) => [v, v])]);
  const nowD = new Date();
  const monthSel = sel('f-month', '予定月', [['', '予定月：すべて'], ...monthOptions(new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1), 14).map((m) => [m, formatMonth(m)])]);
  const typeSel = sel('f-type', '種別', [['', '種別：すべて'], ['未定', '未定'], ['普通', '普通'], ['特別', '特別']]);
  const keyword = h('input', { id: 'f-keyword', type: 'search', placeholder: '名前・ID・国番号・同盟・メモ', autocomplete: 'off', 'aria-label': 'キーワード' });
  const clear = h('button', { type: 'button', class: 'secondary small' }, '条件をクリア');
  const count = h('p', { class: 'muted' });
  const listBody = h('div');
  const filterBox = h('div', { class: 'filters' }, keyword, stateSel, monthSel, typeSel, clear);

  function render() {
    if (loadError) {
      listBody.replaceChildren(h('p', {}, '読み込めませんでした。'));
      count.textContent = '';
      return;
    }
    const cond = { state: stateSel.value, month: monthSel.value, type: typeSel.value, keyword: keyword.value };
    const shown = filterInvites(all, cond, Date.now());
    const filtered = Object.values(cond).some(Boolean);
    count.textContent = `${filtered ? `${shown.length}件（全${all.length}件）` : `${all.length}件`}${truncated ? `　※新しい${FETCH_LIMIT}件までを表示しています` : ''}`;
    const rows = shown.map(({ token, data }) => {
      const state = judgeState(data, Date.now());
      const summary = [formatMonth(data.scheduledMonth) ?? '', data.name ?? '', state, data.inviteType ?? ''].filter(Boolean).join('　');
      const detail = h('div');
      const toggle = h('button', { type: 'button', class: 'secondary' }, '詳細');
      toggle.addEventListener('click', () => {
        if (detail.childNodes.length) detail.replaceChildren();
        else renderInviteDetail(detail, token, data, state, uid, loadList);
      });
      return h('li', { class: 'row' }, h('span', {}, summary), toggle, detail);
    });
    listBody.replaceChildren(rows.length ? h('ul', { class: 'list' }, ...rows) : h('p', { class: 'muted' }, all.length ? '条件に合う招待はありません。' : 'まだ招待はありません。'));
  }
  for (const el of [stateSel, monthSel, typeSel]) el.addEventListener('change', render);
  keyword.addEventListener('input', render);
  clear.addEventListener('click', () => {
    stateSel.value = monthSel.value = typeSel.value = keyword.value = '';
    render();
  });

  const list = card('招待の一覧', filterBox, count, listBody);
  async function loadList() {
    refreshSlots();
    refreshWork();
    try {
      // 招待と、管理者だけが読めるメモ（送付先メモ・管理者メモ）をあわせて読み、キーワードで探せるようにする
      const [snap, notes] = await Promise.all([
        getDocs(query(collection(db, 'invites'), orderBy('createdAt', 'desc'), limit(FETCH_LIMIT))),
        getDocs(collection(db, 'invite_notes')).catch(() => null),
      ]);
      const noteMap = new Map(notes ? notes.docs.map((d) => [d.id, d.data()]) : []);
      all = snap.docs.map((d) => ({ token: d.id, data: d.data(), note: noteMap.get(d.id) }));
      truncated = snap.size >= FETCH_LIMIT;
      loadError = false;
    } catch {
      loadError = true;
    }
    render();
  }

  holder.replaceChildren(card('招待を作る', form), result, list);
  await loadList();
}

// 移民作業：確定した人のIDを一覧にして、コピーしたらその印を残す。
// 印は招待の文書ではなく、管理者だけが読める invite_notes に保存する（別の管理者の画面にも引き継がれる）
async function renderWorkPanel(holder, uid) {
  const now = new Date();
  const months = monthOptions(new Date(now.getFullYear(), now.getMonth() - 1, 1), 8);
  const current = monthOptions(now, 1)[0];
  const monthSelect = h('select', { id: 'workMonth', 'aria-label': '作業する月' }, ...months.map((m) => h('option', { value: m }, formatMonth(m))));
  monthSelect.value = current;
  const body = h('div');
  holder.replaceChildren(card('移民作業（確定した人のID）', h('div', { class: 'field' }, monthSelect), body));

  let seq = 0;
  async function load() {
    const mySeq = ++seq;
    let rows;
    try {
      const snap = await getDocs(
        query(collection(db, 'invites'), where('status', '==', '確定'), where('scheduledMonth', '==', monthSelect.value)),
      );
      rows = await Promise.all(
        snap.docs.map(async (d) => {
          let copied = false;
          let sendNote = '';
          let adminMemo = '';
          try {
            const n = await getDoc(doc(db, 'invite_notes', d.id));
            if (n.exists()) {
              copied = !!n.data().copiedAt;
              sendNote = n.data().sendNote ?? '';
              adminMemo = n.data().adminMemo ?? '';
            }
          } catch {
            // 読めなければ、未コピー・メモなしとして扱う
          }
          return { token: d.id, data: d.data(), copied, sendNote, adminMemo };
        }),
      );
    } catch {
      if (mySeq === seq) body.replaceChildren(h('p', {}, '読み込めませんでした。時間をおいて、もう一度お試しください。'));
      return;
    }
    if (mySeq !== seq) return; // 月を切り替えた場合は、古い結果を捨てる
    const ms = (r) => (r.data.confirmedAt && typeof r.data.confirmedAt.toMillis === 'function' ? r.data.confirmedAt.toMillis() : 0);
    rows.sort((a, b) => ms(a) - ms(b) || String(a.data.name).localeCompare(String(b.data.name), 'ja'));
    if (!rows.length) {
      body.replaceChildren(h('p', { class: 'muted' }, `${formatMonth(monthSelect.value)}の確定者はいません。`));
      return;
    }

    const progress = h('p', { class: 'muted' });
    const updateProgress = () => {
      const done = rows.filter((r) => r.copied).length;
      progress.textContent = `コピー済み ${done} / ${rows.length} 人`;
    };
    const message = h('p', { class: 'error' });

    const items = rows.map((r) => {
      // 種別｜国番号｜名前｜同盟（同盟は未入力なら出さない）
      const parts = [
        h('span', { class: 'badge' }, r.data.inviteType ?? '未定'),
        h('span', { class: 'work-country' }, r.data.countryNo ?? ''),
        h('span', {}, r.data.name ?? ''),
      ];
      if (r.data.alliance) parts.push(h('span', { class: 'work-alliance' }, r.data.alliance));
      const label = h('span', { class: 'work-name' });
      parts.forEach((part, i) => {
        if (i > 0) label.append(h('span', { class: 'sep' }, '｜'));
        label.append(part);
      });
      const idText = h('span', { class: 'work-id' }, r.data.gameId ?? '');
      const copyBtn = h('button', { type: 'button' }, 'IDをコピー');
      const undoBtn = h('button', { type: 'button', class: 'secondary small' }, '未コピーに戻す');
      const infoLines = [
        r.adminMemo ? h('span', { class: 'work-info' }, `メモ：${r.adminMemo}`) : null,
        r.sendNote ? h('span', { class: 'work-info' }, `送付先メモ：${r.sendNote}`) : null,
      ].filter(Boolean);
      const li = h('li', { class: 'row work' }, label, idText, ...infoLines, copyBtn, undoBtn);
      const paint = () => {
        li.classList.toggle('done', r.copied);
        copyBtn.textContent = r.copied ? '✓ コピー済み（もう一度コピー）' : 'IDをコピー';
        undoBtn.hidden = !r.copied;
        updateProgress();
      };
      copyBtn.addEventListener('click', async () => {
        message.textContent = '';
        try {
          // クリップボードへの書き込みは、押した直後に行う（ブラウザの制限）
          await navigator.clipboard.writeText(String(r.data.gameId));
        } catch {
          message.textContent = 'コピーできませんでした。IDを長押しして、手でコピーしてください。';
          return;
        }
        r.copied = true;
        paint();
        try {
          await setDoc(doc(db, 'invite_notes', r.token), { copiedAt: serverTimestamp(), copiedBy: uid }, { merge: true });
        } catch {
          r.copied = false;
          paint();
          message.textContent = 'コピーはできましたが、印を保存できませんでした。通信を確認してください。';
        }
      });
      undoBtn.addEventListener('click', async () => {
        message.textContent = '';
        r.copied = false;
        paint();
        try {
          await setDoc(doc(db, 'invite_notes', r.token), { copiedAt: deleteField(), copiedBy: deleteField() }, { merge: true });
        } catch {
          r.copied = true;
          paint();
          message.textContent = '戻せませんでした。時間をおいて、もう一度お試しください。';
        }
      });
      paint();
      return li;
    });
    body.replaceChildren(progress, h('ul', { class: 'list' }, ...items), message);
  }

  monthSelect.addEventListener('change', load);
  refreshWork = load;
  await load();
}

// 月ごとの枠の表示。オーナーだけ、設定を変えられる
async function renderSlotsPanel(holder, isOwner) {
  const body = h('div');
  holder.replaceChildren(card('月ごとの枠', body));
  async function load() {
    let settings = null;
    let invites;
    try {
      const [sSnap, iSnap] = await Promise.all([getDoc(doc(db, 'settings', 'slots')), getDocs(collection(db, 'invites'))]);
      settings = sSnap.exists() ? sSnap.data() : null;
      invites = iSnap.docs.map((d) => d.data());
    } catch {
      body.replaceChildren(h('p', {}, '読み込めませんでした。'));
      return;
    }
    const nodes = [];
    if (!settings || !settings.specialBaseMonth) {
      nodes.push(h('p', { class: 'muted' }, isOwner ? '枠の設定がまだありません。下の「枠の設定」で基準月を決めてください。' : '枠の設定がまだありません。オーナーが設定すると表示されます。'));
    }
    const rows = computeSlots(invites, settings ?? {}, monthOptions(new Date(), 6), Date.now()).map((r) => {
      const sp = r.special ? `特別 残り${r.special.left}/${r.special.total}` : '特別 未設定';
      return h(
        'li',
        { class: 'row' },
        h('span', {}, `${formatMonth(r.month)}　普通 残り${r.normal.left}/${r.normal.total}　${sp}　未定 ${r.undecided}件`),
      );
    });
    nodes.push(h('ul', { class: 'list' }, ...rows));
    nodes.push(h('p', { class: 'muted' }, '使った枠は、種別を決めた「登録済み」「確定」の招待です。取消すると戻ります。未定は、種別がまだ決まっていない招待の件数です。'));
    if (isOwner) nodes.push(settingsForm(settings));
    body.replaceChildren(...nodes);
  }

  function settingsForm(settings) {
    const cur = { ...DEFAULT_SETTINGS, specialBaseMonth: monthOptions(new Date(), 1)[0], ...(settings ?? {}) };
    const defs = [
      ['normalPerMonth', '普通の枠（月ごと）'],
      ['specialCap', '特別の上限'],
      ['specialMonthlyGain', '特別の毎月の増加'],
      ['specialBaseAvailable', '基準月の特別枠'],
      ['inviteExpiryDays', '招待の有効日数'],
    ];
    const f = {};
    const nodes = defs.map(([key, label]) => {
      f[key] = field(key, label, '', { inputmode: 'numeric', maxlength: '3' });
      f[key].input.value = String(cur[key]);
      return f[key].node;
    });
    const baseSelect = h('select', { id: 'specialBaseMonth' }, ...monthOptions(new Date(), 12).map((m) => h('option', { value: m }, formatMonth(m))));
    if (![...baseSelect.options].some((o) => o.value === cur.specialBaseMonth)) {
      baseSelect.prepend(h('option', { value: cur.specialBaseMonth }, formatMonth(cur.specialBaseMonth) ?? cur.specialBaseMonth));
    }
    baseSelect.value = cur.specialBaseMonth;
    const baseError = h('p', { class: 'error' });
    const msg = h('p', { class: 'error' });
    const save = h('button', { type: 'submit' }, '枠の設定を保存');
    const form = h(
      'form',
      { novalidate: '' },
      h('h2', {}, '枠の設定（オーナーのみ）'),
      ...nodes,
      h('div', { class: 'field' }, h('label', { for: 'specialBaseMonth' }, '特別枠の基準月 ', h('span', { class: 'hint' }, 'この月の特別枠を「基準月の特別枠」とし、翌月から繰り越して計算します')), baseSelect, baseError),
      msg,
      save,
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const r = validateSettings({ ...Object.fromEntries(defs.map(([k]) => [k, f[k].input.value])), specialBaseMonth: baseSelect.value });
      for (const [k] of defs) f[k].error.textContent = r.errors[k] ?? '';
      baseError.textContent = r.errors.specialBaseMonth ?? '';
      if (!r.ok) return;
      save.disabled = true;
      msg.textContent = '';
      try {
        await setDoc(doc(db, 'settings', 'slots'), r.values);
        await load();
      } catch {
        msg.textContent = '保存できませんでした。時間をおいて、もう一度お試しください。';
        save.disabled = false;
      }
    });
    return form;
  }

  refreshSlots = load;
  await load();
}

// 変更先の月の枠が足りないときの警告文。足りていれば空文字
// type：枠を確かめる種別。counted：この招待がすでにその種別の枠に数えられているか（数えられていれば、超過したときだけ警告）
async function roomWarning(data, targetMonth, type = data.inviteType, counted = false) {
  try {
    const [sSnap, iSnap] = await Promise.all([getDoc(doc(db, 'settings', 'slots')), getDocs(collection(db, 'invites'))]);
    const row = computeSlots(iSnap.docs.map((d) => d.data()), sSnap.exists() ? sSnap.data() : {}, [targetMonth], Date.now())[0];
    const label = formatMonth(targetMonth);
    const full = (left) => (counted ? left < 0 : left <= 0);
    if (type === '特別') {
      if (!row.special) return `${label}の特別枠が未設定です。`;
      if (full(row.special.left)) return `${label}の特別枠は${counted ? '超過しています' : '満員です'}（残り${row.special.left}/${row.special.total}）。`;
    } else if (full(row.normal.left)) {
      return `${label}の普通枠は${counted ? '超過しています' : '満員です'}（残り${row.normal.left}/${row.normal.total}）。`;
    }
    return '';
  } catch {
    return '枠の状況を確認できませんでした。';
  }
}

// 招待1件の詳細と操作。ボタンは「保存」「確定」「取消」「戻る」の4つ
//  保存：画面で変えた項目（種別・予定月・管理者メモ）を保存する。状態は変えない
//  確定：保存してから、確定にする
//  取消：移民の取りやめ。理由が必要
//  戻る：入力を捨てて、詳細を閉じる
async function renderInviteDetail(box, token, data, state, uid, reload) {
  box.style.flex = '1 1 100%';
  const message = h('p', { class: 'error' });
  const dl = (label, value) => h('p', { class: 'muted' }, `${label}：${value || '（なし）'}`);
  const memoInput = h('input', { type: 'text', autocomplete: 'off', maxlength: String(NOTE_MAX), 'aria-label': '管理者メモ' });
  let sendNote = '';
  let cancelReason = '';
  let originalMemo = '';
  try {
    const n = await getDoc(doc(db, 'invite_notes', token));
    if (n.exists()) {
      sendNote = n.data().sendNote ?? '';
      cancelReason = n.data().cancelReason ?? '';
      originalMemo = n.data().adminMemo ?? '';
      memoInput.value = originalMemo;
    }
  } catch {
    message.textContent = 'メモを読み込めませんでした。';
  }

  async function run(buttons, fn) {
    buttons.forEach((b) => (b.disabled = true));
    message.textContent = '';
    try {
      await fn();
      await reload();
    } catch (err) {
      // 確認ダイアログでやめた場合は、エラー表示を出さない
      message.textContent = err && err.message === 'cancelled' ? '' : err && err.userMessage ? err.userMessage : '操作できませんでした。時間をおいて、もう一度お試しください。';
      buttons.forEach((b) => (b.disabled = false));
    }
  }
  const stop = (text) => Object.assign(new Error('invalid'), { userMessage: text });
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
  if (state === '取消') children.push(dl('取消の理由', cancelReason));

  // 招待済み・失効：URLの表示と、期限の延長
  if (state === '招待済み' || state === '失効') {
    if (state === '招待済み') children.push(urlBox(token));
    const extend = btn('期限を延ばす', 'secondary', (b) => {
      if (!confirm('今から有効期限を延ばし直しますか？')) return;
      run([b], async () => {
        let days = 3;
        try {
          const snap = await getDoc(doc(db, 'settings', 'slots'));
          const v = snap.exists() ? snap.data().inviteExpiryDays : null;
          if (Number.isInteger(v) && v >= 1 && v <= 30) days = v;
        } catch {
          // 既定の3日
        }
        await updateDoc(doc(db, 'invites', token), { expiresAt: Timestamp.fromMillis(Date.now() + days * DAY_MS), updatedAt: serverTimestamp() });
      });
    });
    children.push(extend);
  }

  // 予定月（取消・失効以外）。枠が満員でも、管理者の判断で変更できる（警告は出す）
  let monthSelect = null;
  if (state === '招待済み' || state === '登録済み' || state === '確定') {
    const now = new Date();
    const options = monthOptions(new Date(now.getFullYear(), now.getMonth() - 1, 1), 14);
    if (!options.includes(data.scheduledMonth)) options.unshift(data.scheduledMonth);
    monthSelect = h('select', { id: `m-${token}`, 'aria-label': '移民予定月' }, ...options.map((m) => h('option', { value: m }, formatMonth(m) ?? m)));
    monthSelect.value = data.scheduledMonth;
    children.push(h('div', { class: 'field' }, h('label', { for: `m-${token}` }, '移民予定月 ', h('span', { class: 'hint' }, '変えると登録者の画面の表示も変わります')), monthSelect));
  }

  // 種別（登録済み・確定）
  let typeSelect = null;
  if (state === '登録済み' || state === '確定') {
    typeSelect = h('select', { id: `t-${token}`, 'aria-label': '招待の種別' }, ...['未定', '普通', '特別'].map((t) => h('option', { value: t }, t)));
    typeSelect.value = data.inviteType ?? '未定';
    children.push(h('div', { class: 'field' }, h('label', { for: `t-${token}` }, '種別 ', h('span', { class: 'hint' }, 'ゲーム内でIDを照会して決めます')), typeSelect));
  }

  children.push(h('div', { class: 'field' }, h('label', {}, '管理者メモ'), memoInput));

  // 取消の理由欄。「取消」を押すと現れる
  const reasonInput = h('input', { type: 'text', autocomplete: 'off', maxlength: String(NOTE_MAX), 'aria-label': '取消の理由' });
  const reasonBox = h(
    'div',
    { class: 'field' },
    h('label', {}, '取消の理由 ', h('span', { class: 'hint' }, `必須。${NOTE_MAX}文字まで。管理者だけが見られます`)),
    reasonInput,
  );
  reasonBox.hidden = true;
  children.push(reasonBox, message);

  // 画面で変えた内容を集めて、書き込みの準備をする。確認ダイアログで止める場合は例外を投げる
  async function collect(confirming) {
    const memo = validateNote(memoInput.value);
    if (!memo.ok) throw stop(memo.error);
    const newType = typeSelect ? typeSelect.value : data.inviteType;
    const newMonth = monthSelect ? monthSelect.value : data.scheduledMonth;
    const typeChanged = !!typeSelect && newType !== (data.inviteType ?? '未定');
    const monthChanged = newMonth !== data.scheduledMonth;
    const memoChanged = memo.value !== originalMemo;

    // 枠の確認（足りなくても、確認のうえ進める）
    const notes = [];
    if ((typeChanged && newType !== '未定') || monthChanged) {
      const w = await roomWarning(data, newMonth, newType);
      if (w) notes.push(w);
    } else if (confirming && state === '登録済み' && (newType === '普通' || newType === '特別')) {
      const w = await roomWarning(data, newMonth, newType, true); // すでに数えられている分が超過していないか
      if (w) notes.push(w);
    }
    if (confirming && (newType ?? '未定') === '未定') notes.push('種別がまだ「未定」です。');
    const lines = [];
    if (monthChanged) lines.push(`予定月を${formatMonth(data.scheduledMonth) ?? data.scheduledMonth}から${formatMonth(newMonth)}に変更します。`);
    if (typeChanged) lines.push(`種別を「${newType}」にします。`);
    if (confirming) lines.push('確定します。');
    const text = [...lines, ...notes.map((n) => `注意：${n}`)].join('\n');
    // 変更も警告もない保存は、確認なしで進める。確定、予定月の変更、警告があるときは確認する
    if (text && (confirming || monthChanged || notes.length) && !confirm(`${text}\n\nよろしいですか？`)) throw new Error('cancelled');
    return { memo, newType, newMonth, typeChanged, monthChanged, memoChanged };
  }

  async function write(c, confirming) {
    const batch = writeBatch(db);
    const fields = { updatedAt: serverTimestamp() };
    if (c.typeChanged) fields.inviteType = c.newType;
    if (c.monthChanged) fields.scheduledMonth = c.newMonth;
    if (confirming) Object.assign(fields, { status: '確定', confirmedAt: serverTimestamp() });
    batch.update(doc(db, 'invites', token), fields);
    const noteFields = {};
    if (c.memoChanged) Object.assign(noteFields, { adminMemo: c.memo.value, updatedBy: uid });
    // 月が変わると作業をやり直すので、コピー済みの印は外す
    if (c.monthChanged) Object.assign(noteFields, { copiedAt: deleteField(), copiedBy: deleteField() });
    if (Object.keys(noteFields).length) batch.set(doc(db, 'invite_notes', token), noteFields, { merge: true });
    await batch.commit();
  }

  const buttons = [];
  const saveBtn = btn('保存', 'secondary', (b) =>
    run(buttons, async () => {
      const c = await collect(false);
      if (!c.typeChanged && !c.monthChanged && !c.memoChanged) throw stop('変更はありません。');
      await write(c, false);
    }),
  );
  const confirmBtn = btn('確定', '', (b) =>
    run(buttons, async () => {
      const c = await collect(true);
      await write(c, true);
    }),
  );
  const cancelBtn = btn('取消', 'secondary danger', () => {
    // 1回目：理由の入力欄を出す。2回目：理由が入っていれば取り消す
    if (reasonBox.hidden) {
      reasonBox.hidden = false;
      reasonInput.focus();
      message.textContent = '取消の理由を入力して、もう一度「取消」を押してください。';
      return;
    }
    const r = validateNote(reasonInput.value);
    if (!r.ok) {
      message.textContent = r.error;
      return;
    }
    if (!r.value) {
      message.textContent = '取消の理由を入力してください。';
      return;
    }
    if (!confirm('この招待を取り消しますか？')) return;
    run(buttons, () => {
      const batch = writeBatch(db);
      batch.update(doc(db, 'invites', token), { status: '取消', cancelledAt: serverTimestamp(), updatedAt: serverTimestamp() });
      batch.set(doc(db, 'invite_notes', token), { cancelReason: r.value, cancelledBy: uid }, { merge: true });
      return batch.commit();
    });
  });
  const backBtn = btn('戻る', 'secondary', () => box.replaceChildren());

  // 状態によって使えるものだけを並べる：保存は常に、確定は登録済みだけ、取消は取消済み以外
  const actions = [saveBtn];
  if (state === '登録済み') actions.push(confirmBtn);
  if (state !== '取消') actions.push(cancelBtn);
  actions.push(backBtn);
  buttons.push(...actions);
  children.push(h('div', { class: 'actions' }, ...actions));
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
