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
  computeSlots, validateSettings, DEFAULT_SETTINGS,
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
  const slotsHolder = h('div');
  nodes.push(slotsHolder);
  renderSlotsPanel(slotsHolder, admin.role === 'owner');
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

// 招待が変わったときに、月ごとの枠を読み直す（枠の画面が作られたら差し替わる）
let refreshSlots = () => {};

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
    refreshSlots();
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

// 招待1件の詳細と操作：種別の決定、確定、取消、期限の延長、メモ
async function renderInviteDetail(box, token, data, state, uid, reload) {
  box.style.flex = '1 1 100%';
  const message = h('p', { class: 'error' });
  const dl = (label, value) => h('p', { class: 'muted' }, `${label}：${value || '（なし）'}`);
  const memoInput = h('input', { type: 'text', autocomplete: 'off', maxlength: String(NOTE_MAX), 'aria-label': '管理者メモ' });
  let sendNote = '';
  let cancelReason = '';
  try {
    const n = await getDoc(doc(db, 'invite_notes', token));
    if (n.exists()) {
      sendNote = n.data().sendNote ?? '';
      cancelReason = n.data().cancelReason ?? '';
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
  if (state === '取消') children.push(dl('取消の理由', cancelReason));

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
    // 取消には理由が必要。理由は管理者だけが読める invite_notes に入れる（招待の文書は登録者にも読めるため）
    const reasonInput = h('input', { type: 'text', autocomplete: 'off', maxlength: String(NOTE_MAX), 'aria-label': '取消の理由' });
    const reasonError = h('p', { class: 'error' });
    const reasonBox = h(
      'div',
      { class: 'field' },
      h('label', {}, '取消の理由 ', h('span', { class: 'hint' }, `必須。${NOTE_MAX}文字まで。管理者だけが見られます`)),
      reasonInput,
      reasonError,
    );
    reasonBox.hidden = true;
    const doCancel = btn('取消を実行する', '', (b) => {
      const r = validateNote(reasonInput.value);
      if (r.ok && !r.value) {
        reasonError.textContent = '理由を入力してください';
        return;
      }
      reasonError.textContent = r.error;
      if (!r.ok) return;
      if (!confirm('この招待を取り消しますか？')) return;
      run(b, () => {
        const batch = writeBatch(db);
        batch.update(doc(db, 'invites', token), { status: '取消', cancelledAt: serverTimestamp(), updatedAt: serverTimestamp() });
        batch.set(doc(db, 'invite_notes', token), { cancelReason: r.value, cancelledBy: uid }, { merge: true });
        return batch.commit();
      });
    });
    doCancel.hidden = true;
    const openCancel = btn('取り消す', 'secondary', () => {
      reasonBox.hidden = false;
      doCancel.hidden = false;
      openCancel.hidden = true;
      reasonInput.focus();
    });
    children.push(openCancel, reasonBox, doCancel);
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
