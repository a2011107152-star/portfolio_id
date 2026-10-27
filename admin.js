// Supabase 주소와 공개 키 (방문자 화면과 같다)
const SUPABASE_URL = "https://qfgsqjysvrsofyqkjyze.supabase.co";
const SUPABASE_KEY = "sb_publishable_gKTVpImP-kGU4dZ_6pX9xA_FfHinU32";
const REST = SUPABASE_URL + "/rest/v1/";
const AUTH = SUPABASE_URL + "/auth/v1/";
const STORAGE = SUPABASE_URL + "/storage/v1/object/";
const BUCKET = "resume";
const PUBLIC_PREFIX = STORAGE + "public/" + BUCKET + "/";

// 올릴 수 있는 파일
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const FILE_TYPES = Object.assign({ "application/pdf": "pdf" }, IMAGE_TYPES);

// 로그인 정보를 브라우저에 저장해 두는 이름
const SESSION_KEY = "resume_admin_session";

const PROFILE_FIELDS = [
  "name", "title", "career_badge", "email", "phone", "location",
  "headline", "intro", "education", "skills", "experience", "quote"
];

let session = null;        // { access_token, refresh_token, email }
let profilePhotoUrl = null; // 지금 저장된 프로필 사진 주소
let projects = [];         // 카드 목록 (순서대로)
let editing = null;        // 고치는 중인 카드 (새 카드면 null)
let editorThumbUrl = null; // 폼에 담긴 썸네일 주소
let editorFileUrl = null;  // 폼에 담긴 첨부 파일 주소

const $ = id => document.getElementById(id);

// ---------- 화면 도우미 ----------

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function makeButton(text, className, onClick) {
  const b = makeEl("button", "btn small " + (className || ""), text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

// 안내 문구 보여 주기 (kind: "ok" 초록, "error" 빨강)
function say(id, text, kind) {
  const el = $(id);
  el.textContent = text || "";
  el.className = "notice" + (kind ? " " + kind : "");
}

function formatDate(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

// 버튼을 누르는 동안 잠가 두고, 끝나면 풀기
async function withLock(button, work) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    await work();
  } finally {
    button.disabled = false;
  }
}

// ---------- 로그인 정보 저장 ----------

function saveSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) {
    // 저장이 막힌 브라우저면 이 창에서만 로그인이 유지된다
  }
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch (e) {
    return null;
  }
}

function sessionFromAuth(data) {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    email: data.user ? data.user.email : ""
  };
}

// ---------- Supabase 부르기 ----------

// 로그인 토큰이 오래되면 새 토큰 받기
async function refreshSession() {
  if (!session || !session.refresh_token) return false;
  const res = await fetch(AUTH + "token?grant_type=refresh_token", {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  if (!res.ok) return false;
  saveSession(sessionFromAuth(await res.json()));
  return true;
}

// 로그인 토큰을 붙여서 부르기. 토큰이 만료됐으면 한 번 새로 받아 다시 부른다.
async function call(url, options) {
  options = options || {};
  const send = () => fetch(url, Object.assign({}, options, {
    headers: Object.assign({
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + session.access_token
    }, options.headers || {})
  }));

  let res = await send();
  if (res.status === 401 && await refreshSession()) {
    res = await send();
  }
  if (res.status === 401) {
    showLogin("로그인이 끝났어요. 다시 로그인해 주세요.");
    throw new Error("로그인 필요");
  }
  return res;
}

// 표 읽기
async function readTable(path) {
  const res = await call(REST + path);
  if (!res.ok) throw new Error("읽기 실패 (" + res.status + ")");
  return res.json();
}

// 표 바꾸기 (method: POST, PATCH, DELETE). 바뀐 줄을 돌려받는다.
// 규칙에 막히면 오류 없이 0줄이 바뀌므로, 0줄이면 실패로 본다.
async function writeTable(method, path, body, extraPrefer) {
  const res = await call(REST + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation" + (extraPrefer ? "," + extraPrefer : "")
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!res.ok) throw new Error("저장 실패 (" + res.status + ")");
  const rows = await res.json();
  if (rows.length === 0) throw new Error("권한이 없어서 바뀌지 않았어요");
  return rows;
}

// 카드 하나의 좋아요 수
async function countLikes(projectId) {
  const res = await call(REST + "likes?select=id&project_id=eq." + projectId, {
    method: "HEAD",
    headers: { Prefer: "count=exact" }
  });
  const total = Number((res.headers.get("content-range") || "").split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

// ---------- 파일 올리기 ----------

// 파일을 검사해서, 문제가 있으면 안내 문구를, 괜찮으면 null을 돌려준다
function checkFile(file, allowed) {
  if (!allowed[file.type]) {
    return allowed === IMAGE_TYPES
      ? "이미지 파일(png·jpg·webp·gif)만 올릴 수 있어요."
      : "이미지 파일(png·jpg·webp·gif)이나 PDF만 올릴 수 있어요.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return "10MB가 넘는 파일은 올릴 수 없어요. (지금 " + (file.size / 1024 / 1024).toFixed(1) + "MB)";
  }
  return null;
}

// 영어·숫자로 새 파일 이름 짓기. 예: 1730000000000-k3j9x2.png
function newFileName(file) {
  const random = Math.random().toString(36).slice(2, 8);
  return Date.now() + "-" + random + "." + FILE_TYPES[file.type];
}

// resume 보관함의 folder/ 에 올리고 공개 주소를 돌려준다
async function uploadFile(folder, file) {
  const path = folder + "/" + newFileName(file);
  const res = await call(STORAGE + BUCKET + "/" + path, {
    method: "POST",
    headers: { "Content-Type": file.type, "x-upsert": "false" },
    body: file
  });
  if (!res.ok) throw new Error("파일 올리기 실패 (" + res.status + ")");
  return PUBLIC_PREFIX + path;
}

// 우리 보관함에 있는 파일이면 지운다 (실패해도 화면 일은 계속한다)
async function removeStoredFile(url) {
  if (!url || !url.startsWith(PUBLIC_PREFIX)) return;
  try {
    await call(STORAGE + BUCKET + "/" + url.slice(PUBLIC_PREFIX.length), { method: "DELETE" });
  } catch (e) {
    // 파일이 남아도 화면에는 문제없다
  }
}

// 파일 칸에서 고른 파일을 검사.
// 고른 파일이 없으면 null, 문제가 있으면 칸을 비우고 안내한 뒤 false를 돌려준다.
function pickedFile(inputId, allowed, noticeId) {
  const input = $(inputId);
  const file = input.files[0];
  if (!file) return null;
  const problem = checkFile(file, allowed);
  if (problem) {
    input.value = "";
    say(noticeId, problem, "error");
    return false;
  }
  return file;
}

// ---------- 로그인 · 로그아웃 ----------

function showOnly(id) {
  ["login-box", "not-admin-box", "admin-area"].forEach(box => {
    $(box).hidden = box !== id;
  });
}

function showLogin(message) {
  saveSession(null);
  showOnly("login-box");
  say("login-notice", message || "", message ? "error" : "");
}

async function login() {
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  if (!email || !password) {
    say("login-notice", "이메일과 비밀번호를 모두 넣어 주세요.", "error");
    return;
  }
  say("login-notice", "");

  try {
    const res = await fetch(AUTH + "token?grant_type=password", {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      say("login-notice", "이메일이나 비밀번호가 맞지 않아요.", "error");
      return;
    }
    saveSession(sessionFromAuth(await res.json()));
    $("login-password").value = "";
    await enter();
  } catch (e) {
    say("login-notice", "로그인하지 못했어요. 인터넷 연결을 확인해 주세요.", "error");
  }
}

async function logout() {
  if (session) {
    try {
      await fetch(AUTH + "logout", {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token }
      });
    } catch (e) {
      // 서버에 못 알려도 이 브라우저에서는 로그아웃한다
    }
  }
  showLogin();
}

// 로그인한 사람이 관리자인지 확인하고 화면을 연다.
// admins 표의 규칙상 자기 줄만 보이므로, 한 줄이라도 오면 관리자다.
async function enter() {
  const rows = await readTable("admins?select=user_id");
  if (rows.length === 0) {
    $("not-admin-email").textContent = session.email + " 계정은 관리자로 등록되어 있지 않아요.";
    showOnly("not-admin-box");
    return;
  }
  $("admin-email").textContent = session.email;
  showOnly("admin-area");
  await Promise.all([loadProfile(), loadProjects(), loadGuestbook()]);
}

// ---------- 프로필 ----------

function showPhoto(url) {
  const box = $("photo-preview");
  box.textContent = "";
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "프로필 사진";
    box.appendChild(img);
  }
}

async function loadProfile() {
  try {
    const rows = await readTable("profile?select=*&id=eq.1");
    const p = rows[0] || {};
    PROFILE_FIELDS.forEach(key => { $("pf-" + key).value = p[key] || ""; });
    profilePhotoUrl = p.photo_url || null;
    showPhoto(profilePhotoUrl);
  } catch (e) {
    say("profile-notice", "프로필을 불러오지 못했어요.", "error");
  }
}

async function saveProfile() {
  say("profile-notice", "");
  const file = pickedFile("photo-file", IMAGE_TYPES, "profile-notice");
  if (file === false) return;

  const row = { id: 1, updated_at: new Date().toISOString() };
  PROFILE_FIELDS.forEach(key => { row[key] = $("pf-" + key).value.trim(); });

  try {
    const oldPhoto = profilePhotoUrl;
    row.photo_url = oldPhoto;
    if (file) {
      say("profile-notice", "사진을 올리는 중이에요…");
      row.photo_url = await uploadFile("profile", file);
    }
    // 프로필 줄이 없으면 만들고, 있으면 고친다
    await writeTable("POST", "profile?on_conflict=id", row, "resolution=merge-duplicates");
    profilePhotoUrl = row.photo_url;
    showPhoto(profilePhotoUrl);
    $("photo-file").value = "";
    if (file && oldPhoto) await removeStoredFile(oldPhoto);
    say("profile-notice", "저장했어요. 방문자 화면을 새로고침하면 보여요.", "ok");
  } catch (e) {
    say("profile-notice", "저장하지 못했어요. " + e.message, "error");
  }
}

// 사진을 고르면 바로 미리 보기 (저장은 '프로필 저장'을 눌러야 된다)
$("photo-file").addEventListener("change", () => {
  say("profile-notice", "");
  const file = pickedFile("photo-file", IMAGE_TYPES, "profile-notice");
  if (file) {
    showPhoto(URL.createObjectURL(file));
    say("profile-notice", "'프로필 저장'을 누르면 사진이 올라가요.");
  }
});

// ---------- 포트폴리오 카드 ----------

async function loadProjects() {
  try {
    projects = await readTable("projects?select=*&order=sort_order.asc,id.asc");
    renderProjects();
  } catch (e) {
    say("project-notice", "카드를 불러오지 못했어요.", "error");
  }
}

function renderProjects() {
  const list = $("project-rows");
  list.textContent = "";

  if (projects.length === 0) {
    list.appendChild(makeEl("li", "empty-text", "아직 카드가 없어요. '카드 추가'를 눌러 보세요."));
    return;
  }

  projects.forEach((project, index) => {
    const li = makeEl("li", "row");

    const thumb = makeEl("div", "row-thumb");
    if (project.thumbnail_url) {
      const img = document.createElement("img");
      img.src = project.thumbnail_url;
      img.alt = "";
      thumb.appendChild(img);
    }

    const main = makeEl("div", "row-main");
    const likes = makeEl("span", "", "…");
    const meta = makeEl("p", "row-meta");
    meta.append("좋아요 ", likes, "개");
    if (project.file_url) meta.append(" · 첨부 파일 있음");
    main.append(
      makeEl("p", "row-category", [project.number, project.category].filter(Boolean).join(". ")),
      makeEl("p", "row-title", project.title),
      meta
    );

    const buttons = makeEl("div", "row-buttons");
    const up = makeButton("▲ 위로", "", () => moveProject(index, -1));
    const down = makeButton("▼ 아래로", "", () => moveProject(index, 1));
    up.disabled = index === 0;
    down.disabled = index === projects.length - 1;
    buttons.append(
      up,
      down,
      makeButton("수정", "", () => openEditor(project)),
      makeButton("좋아요 초기화", "danger", e => resetLikes(project, likes, e.currentTarget)),
      makeButton("삭제", "danger", e => deleteProject(project, e.currentTarget))
    );

    li.append(thumb, main, buttons);
    list.appendChild(li);

    countLikes(project.id)
      .then(n => { likes.textContent = n; })
      .catch(() => { likes.textContent = "?"; });
  });
}

// 순서 바꾸기: 옆 카드와 자리를 바꾸고, 순서 번호를 1, 2, 3…으로 다시 매긴다
async function moveProject(index, step) {
  const target = index + step;
  if (target < 0 || target >= projects.length) return;

  const ordered = projects.slice();
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  say("project-notice", "순서를 바꾸는 중이에요…");

  try {
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].sort_order !== i + 1) {
        await writeTable("PATCH", "projects?id=eq." + ordered[i].id, { sort_order: i + 1 });
      }
    }
    say("project-notice", "순서를 바꿨어요.", "ok");
  } catch (e) {
    say("project-notice", "순서를 바꾸지 못했어요. " + e.message, "error");
  }
  await loadProjects();
}

async function deleteProject(project, button) {
  if (!confirm("'" + project.title + "' 카드를 지울까요?\n이 카드의 좋아요와 올린 파일도 같이 지워져요.")) return;
  await withLock(button, async () => {
    try {
      await writeTable("DELETE", "projects?id=eq." + project.id);
      await removeStoredFile(project.thumbnail_url);
      await removeStoredFile(project.file_url);
      if (editing && editing.id === project.id) closeEditor();
      say("project-notice", "카드를 지웠어요.", "ok");
      await loadProjects();
    } catch (e) {
      say("project-notice", "지우지 못했어요. " + e.message, "error");
    }
  });
}

async function resetLikes(project, likesEl, button) {
  if (!confirm("'" + project.title + "' 카드의 좋아요를 0으로 되돌릴까요?")) return;
  await withLock(button, async () => {
    try {
      const res = await call(REST + "likes?project_id=eq." + project.id, { method: "DELETE" });
      if (!res.ok) throw new Error("(" + res.status + ")");
      likesEl.textContent = await countLikes(project.id);
      say("project-notice", "'" + project.title + "' 좋아요를 초기화했어요.", "ok");
    } catch (e) {
      say("project-notice", "초기화하지 못했어요. " + e.message, "error");
    }
  });
}

// ---------- 카드 추가·수정 폼 ----------

function fileLabel(url) {
  return url ? url.split("/").pop() : "없음";
}

function showEditorFiles() {
  $("pj-thumb-now").textContent = "지금: " + fileLabel(editorThumbUrl);
  $("pj-file-now").textContent = "지금: " + fileLabel(editorFileUrl);
  $("pj-thumb-clear").hidden = !editorThumbUrl;
  $("pj-file-clear").hidden = !editorFileUrl;
}

function openEditor(project) {
  editing = project || null;
  const p = project || {};
  $("editor-title").textContent = project ? "카드 수정" : "카드 추가";
  $("pj-number").value = p.number || "";
  $("pj-category").value = p.category || "";
  $("pj-title").value = p.title || "";
  $("pj-description").value = p.description || "";
  $("pj-tags").value = (p.tags || []).join(", ");
  $("pj-thumb-file").value = "";
  $("pj-file-file").value = "";
  editorThumbUrl = p.thumbnail_url || null;
  editorFileUrl = p.file_url || null;
  showEditorFiles();
  say("editor-notice", "");
  $("editor").hidden = false;
  $("editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEditor() {
  editing = null;
  $("editor").hidden = true;
}

async function saveProject() {
  say("editor-notice", "");
  const title = $("pj-title").value.trim();
  if (!title) {
    say("editor-notice", "제목을 적어 주세요.", "error");
    return;
  }

  const thumbFile = pickedFile("pj-thumb-file", IMAGE_TYPES, "editor-notice");
  if (thumbFile === false) return;
  const attachFile = pickedFile("pj-file-file", FILE_TYPES, "editor-notice");
  if (attachFile === false) return;

  const row = {
    number: $("pj-number").value.trim(),
    category: $("pj-category").value.trim(),
    title,
    description: $("pj-description").value.trim(),
    tags: $("pj-tags").value.split(",").map(s => s.trim()).filter(Boolean),
    thumbnail_url: editorThumbUrl,
    file_url: editorFileUrl
  };

  try {
    if (thumbFile || attachFile) say("editor-notice", "파일을 올리는 중이에요…");
    if (thumbFile) row.thumbnail_url = await uploadFile("projects", thumbFile);
    if (attachFile) row.file_url = await uploadFile("projects", attachFile);

    if (editing) {
      await writeTable("PATCH", "projects?id=eq." + editing.id, row);
      // 바뀌었거나 뺀 예전 파일은 보관함에서 지운다
      if (editing.thumbnail_url !== row.thumbnail_url) await removeStoredFile(editing.thumbnail_url);
      if (editing.file_url !== row.file_url) await removeStoredFile(editing.file_url);
    } else {
      // 새 카드는 맨 뒤에 붙인다
      row.sort_order = projects.reduce((max, p) => Math.max(max, p.sort_order), 0) + 1;
      await writeTable("POST", "projects", row);
    }
    closeEditor();
    say("project-notice", "카드를 저장했어요. 방문자 화면을 새로고침하면 보여요.", "ok");
    await loadProjects();
  } catch (e) {
    say("editor-notice", "저장하지 못했어요. " + e.message, "error");
  }
}

$("pj-thumb-clear").addEventListener("click", () => {
  editorThumbUrl = null;
  showEditorFiles();
});

$("pj-file-clear").addEventListener("click", () => {
  editorFileUrl = null;
  showEditorFiles();
});

$("pj-thumb-file").addEventListener("change", () => {
  say("editor-notice", "");
  pickedFile("pj-thumb-file", IMAGE_TYPES, "editor-notice");
});

$("pj-file-file").addEventListener("change", () => {
  say("editor-notice", "");
  pickedFile("pj-file-file", FILE_TYPES, "editor-notice");
});

// ---------- 방명록 ----------

async function loadGuestbook() {
  const list = $("guestbook-rows");
  try {
    const entries = await readTable("resume_guestbook?select=*&order=created_at.desc");
    list.textContent = "";
    if (entries.length === 0) {
      list.appendChild(makeEl("li", "empty-text", "아직 남긴 글이 없어요."));
      return;
    }
    entries.forEach(entry => {
      const li = makeEl("li", "gb-row");
      const body = makeEl("div");
      const head = makeEl("div", "gb-head");
      head.append(
        makeEl("span", "gb-nickname", entry.nickname),
        makeEl("span", "gb-date", formatDate(entry.created_at))
      );
      body.append(head, makeEl("p", "gb-message", entry.message));
      li.append(body, makeButton("삭제", "danger", e => deleteEntry(entry, e.currentTarget)));
      list.appendChild(li);
    });
  } catch (e) {
    say("guestbook-notice", "방명록을 불러오지 못했어요.", "error");
  }
}

async function deleteEntry(entry, button) {
  if (!confirm("'" + entry.nickname + "'님의 글을 지울까요?\n\n" + entry.message)) return;
  await withLock(button, async () => {
    try {
      await writeTable("DELETE", "resume_guestbook?id=eq." + entry.id);
      say("guestbook-notice", "글을 지웠어요.", "ok");
      await loadGuestbook();
    } catch (e) {
      say("guestbook-notice", "지우지 못했어요. " + e.message, "error");
    }
  });
}

// ---------- 버튼 연결 ----------

$("login-button").addEventListener("click", e => withLock(e.currentTarget, login));
$("login-password").addEventListener("keydown", e => {
  if (e.key === "Enter") withLock($("login-button"), login);
});
$("logout-button").addEventListener("click", logout);
$("not-admin-logout").addEventListener("click", logout);
$("profile-save").addEventListener("click", e => withLock(e.currentTarget, saveProfile));
$("project-add").addEventListener("click", () => openEditor(null));
$("editor-save").addEventListener("click", e => withLock(e.currentTarget, saveProject));
$("editor-cancel").addEventListener("click", closeEditor);

// ---------- 처음 열 때 ----------

async function start() {
  const saved = loadSession();
  if (!saved || !saved.access_token) {
    showLogin();
    return;
  }
  session = saved;
  try {
    await enter();
  } catch (e) {
    if (!$("login-box").hidden) return; // 이미 로그인 화면으로 돌아감
    showLogin("관리자 화면을 열지 못했어요. 다시 로그인해 주세요.");
  }
}

start();
