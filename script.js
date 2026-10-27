// Supabase 주소와 공개 키 (공개 키라서 파일에 넣어도 된다)
const SUPABASE_URL = "https://qfgsqjysvrsofyqkjyze.supabase.co";
const SUPABASE_KEY = "sb_publishable_gKTVpImP-kGU4dZ_6pX9xA_FfHinU32";
const API = SUPABASE_URL + "/rest/v1/";

// 브라우저에 저장해 두는 값의 이름
const CLIENT_ID_KEY = "resume_client_id";
const LIKED_KEY = "resume_liked";

// ---------- Supabase 부르기 ----------

// 표에서 읽어 오기
async function readTable(path) {
  const res = await fetch(API + path, {
    headers: { apikey: SUPABASE_KEY }
  });
  if (!res.ok) throw new Error(path + " 읽기 실패 (" + res.status + ")");
  return res.json();
}

// 표에 한 줄 넣기. 넣은 줄을 돌려받는다.
async function insertRow(table, row) {
  return fetch(API + table, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(row)
  });
}

// 카드 하나의 좋아요 수 세기 (줄은 받지 않고 개수만 받는다)
async function countLikes(projectId) {
  const res = await fetch(API + "likes?select=id&project_id=eq." + projectId, {
    method: "HEAD",
    headers: { apikey: SUPABASE_KEY, Prefer: "count=exact" }
  });
  const range = res.headers.get("content-range") || "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

// ---------- 브라우저 저장소 ----------

function loadStored(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function saveStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // 저장이 막힌 브라우저(시크릿 창 등)에서는 그냥 넘어간다
  }
}

// 이 브라우저의 이름표. 처음 한 번 만들어서 저장해 둔다.
function getClientId() {
  let id = loadStored(CLIENT_ID_KEY);
  if (!id) {
    id = window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    saveStored(CLIENT_ID_KEY, id);
  }
  return id;
}

// 이 브라우저에서 좋아요를 누른 카드 번호 목록
function getLikedIds() {
  try {
    return JSON.parse(loadStored(LIKED_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function addLikedId(projectId) {
  const ids = getLikedIds();
  if (!ids.includes(projectId)) ids.push(projectId);
  saveStored(LIKED_KEY, JSON.stringify(ids));
}

// ---------- 화면 그리기 도우미 ----------

// 태그 하나 만들기 (글자는 항상 textContent로 넣어 안전하게)
function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

// 아이콘 만들기
function makeIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#icon-" + name);
  svg.appendChild(use);
  return svg;
}

function setText(id, text) {
  document.getElementById(id).textContent = text || "";
}

// 여러 줄 글을 줄 단위로 나누기 (빈 줄은 뺀다)
function splitLines(text) {
  return (text || "").split("\n").map(s => s.trim()).filter(Boolean);
}

// ---------- 프로필 ----------

function renderProfile(p) {
  setText("profile-name", p.name);
  setText("profile-title", p.title);
  setText("profile-badge", p.career_badge);
  setText("contact-name", p.name);
  setText("contact-email", p.email);
  setText("contact-phone", p.phone);
  setText("contact-location", p.location);
  setText("profile-intro", p.intro);
  setText("profile-quote", p.quote);

  // 사진: 있으면 넣고, 없으면 회색 자리 그대로
  const photo = document.getElementById("profile-photo");
  photo.textContent = "";
  if (p.photo_url) {
    const img = document.createElement("img");
    img.src = p.photo_url;
    img.alt = (p.name || "") + " 프로필 사진";
    photo.appendChild(img);
  }

  renderHeadline(p.headline || "", p.name || "");
  renderLines("profile-education", p.education);
  renderLines("profile-experience", p.experience);
  renderSkills(p.skills);
}

// 한 줄 소개: 첫 쉼표 뒤에서 줄을 바꾸고, 이름까지를 파란 밑줄로 강조
function renderHeadline(text, name) {
  const box = document.getElementById("profile-headline");
  box.textContent = "";

  const comma = text.indexOf(",");
  let first = "";
  let second = text;
  if (comma !== -1) {
    first = text.slice(0, comma + 1);
    second = text.slice(comma + 1).trim();
  }

  if (first) {
    box.append(first, document.createElement("br"));
  }

  const nameAt = name ? second.indexOf(name) : -1;
  if (nameAt === -1) {
    box.append(second);
    return;
  }
  // 쉼표가 있으면 둘째 줄 처음부터 이름까지, 없으면 이름만 강조
  const start = first ? 0 : nameAt;
  const end = nameAt + name.length;
  box.append(second.slice(0, start));
  box.append(makeEl("mark", "", second.slice(start, end)));
  box.append(second.slice(end));
}

// EDUCATION · EXPERIENCE: 첫 줄은 굵게, 다음 줄부터는 회색
function renderLines(id, text) {
  const box = document.getElementById(id);
  box.textContent = "";
  splitLines(text).forEach((line, i) => {
    box.appendChild(makeEl("p", i === 0 ? "fact-main" : "fact-sub", line));
  });
}

// SKILLS: 쉼표나 줄바꿈으로 나눠 두 줄짜리 목록으로
function renderSkills(text) {
  const box = document.getElementById("profile-skills");
  box.textContent = "";
  (text || "").split(/[,\n]/).map(s => s.trim()).filter(Boolean).forEach(skill => {
    box.appendChild(makeEl("li", "", skill));
  });
}

// ---------- 포트폴리오 카드 ----------

function renderCards(projects) {
  const box = document.getElementById("cards");
  box.textContent = "";

  if (projects.length === 0) {
    box.appendChild(makeEl("p", "empty", "아직 등록된 프로젝트가 없습니다."));
    return;
  }

  const liked = getLikedIds();

  projects.forEach(project => {
    const card = makeEl("article", "card");

    // 카드 본문 전체가 하나의 버튼: 누르면 파일(없으면 썸네일)을 새 탭으로
    const open = makeEl("button", "card-open");
    open.type = "button";
    const link = project.file_url || project.thumbnail_url;
    if (link) {
      open.addEventListener("click", () => {
        window.open(link, "_blank", "noopener");
      });
    } else {
      open.disabled = true;
    }

    // 브라우저 창 모양 썸네일
    const browser = makeEl("div", "browser");
    const bar = makeEl("div", "browser-bar");
    bar.append(makeEl("i"), makeEl("i"), makeEl("i"));
    const shot = makeEl("div", "browser-shot");
    if (project.thumbnail_url) {
      const img = document.createElement("img");
      img.src = project.thumbnail_url;
      img.alt = project.title + " 썸네일";
      img.loading = "lazy";
      shot.appendChild(img);
    }
    browser.append(bar, shot);

    const category = [project.number, project.category].filter(Boolean).join(". ");
    open.append(
      browser,
      makeEl("p", "card-category", category),
      makeEl("h4", "card-title", project.title),
      makeEl("p", "card-desc", project.description)
    );

    // 아래쪽: 태그와 좋아요
    const foot = makeEl("div", "card-foot");
    const tags = makeEl("div", "tags");
    (project.tags || []).forEach(t => tags.appendChild(makeEl("span", "tag", t)));

    const like = makeEl("button", "like");
    like.type = "button";
    like.setAttribute("aria-label", "좋아요");
    const count = makeEl("span", "", "0");
    like.append(makeIcon("heart"), count);
    if (liked.includes(project.id)) like.classList.add("is-liked");
    like.addEventListener("click", () => pressLike(project.id, like, count));

    foot.append(tags, like);
    card.append(open, foot);
    box.appendChild(card);

    showLikeCount(project.id, count);
  });
}

// 좋아요 수를 읽어 와서 보여 주기.
// 읽는 사이에 좋아요를 눌렀을 수 있으니, 지금 숫자보다 작으면 바꾸지 않는다.
function showLikeCount(projectId, count) {
  countLikes(projectId)
    .then(n => { count.textContent = Math.max(n, Number(count.textContent)); })
    .catch(() => {});
}

// 좋아요 누르기: 이 브라우저에서 카드마다 한 번만
async function pressLike(projectId, button, count) {
  if (button.classList.contains("is-liked") || button.disabled) return;
  button.disabled = true;

  try {
    const res = await insertRow("likes", { project_id: projectId, client_id: getClientId() });
    if (res.ok) {
      count.textContent = Number(count.textContent) + 1;
      button.classList.add("is-liked");
      addLikedId(projectId);
      showLikeCount(projectId, count);
    } else if (res.status === 409) {
      // 이미 이 브라우저에서 눌렀던 카드 (저장소가 지워졌던 경우)
      button.classList.add("is-liked");
      addLikedId(projectId);
    }
  } catch (e) {
    // 인터넷이 끊긴 경우 등: 다시 누를 수 있게 둔다
  }
  button.disabled = false;
}

// ---------- 방명록 ----------

function formatDate(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function makeGuestbookItem(entry) {
  const li = makeEl("li");
  const head = makeEl("div", "gb-head");
  head.append(
    makeEl("span", "gb-nickname", entry.nickname),
    makeEl("span", "gb-date", formatDate(entry.created_at))
  );
  li.append(head, makeEl("p", "gb-message", entry.message));
  return li;
}

function renderGuestbook(entries) {
  const list = document.getElementById("gb-list");
  list.textContent = "";
  entries.forEach(entry => list.appendChild(makeGuestbookItem(entry)));
}

async function submitGuestbook() {
  const nicknameInput = document.getElementById("gb-nickname");
  const messageInput = document.getElementById("gb-message");
  const button = document.getElementById("gb-submit");
  const notice = document.getElementById("gb-notice");
  if (button.disabled) return;

  const nickname = nicknameInput.value.trim();
  const message = messageInput.value.trim();
  notice.textContent = "";

  if (!nickname || !message) {
    notice.textContent = "별명과 한마디를 모두 적어 주세요.";
    return;
  }

  button.disabled = true;
  try {
    const res = await insertRow("resume_guestbook", { nickname, message });
    if (!res.ok) throw new Error();
    const rows = await res.json();
    document.getElementById("gb-list").prepend(makeGuestbookItem(rows[0]));
    messageInput.value = "";
  } catch (e) {
    notice.textContent = "남기지 못했어요. 잠시 뒤 다시 눌러 주세요.";
  }
  button.disabled = false;
}

document.getElementById("gb-submit").addEventListener("click", submitGuestbook);

// 한마디 칸에서 Enter를 눌러도 남기기
document.getElementById("gb-message").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.isComposing) submitGuestbook();
});

// ---------- 처음 열 때 모두 읽어 오기 ----------

async function start() {
  const error = document.getElementById("load-error");
  try {
    const [profiles, projects, entries] = await Promise.all([
      readTable("profile?select=*&id=eq.1"),
      readTable("projects?select=*&order=sort_order.asc,id.asc"),
      readTable("resume_guestbook?select=*&order=created_at.desc")
    ]);
    if (profiles[0]) {
      renderProfile(profiles[0]);
      document.title = (profiles[0].name || "") + " 포트폴리오";
    }
    renderCards(projects);
    renderGuestbook(entries);
  } catch (e) {
    error.textContent = "내용을 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.";
  }
}

start();
