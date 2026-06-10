const CSV_PATH = "data/lucky-draw.csv";
/** Total unique winners to pick this round (one per click). Change in code if needed. */
const PICK_COUNT = 10;
const STORAGE_KEY = "ipl2026-random-picker-v4";

// Lucky Draw sheet: column C = Full Name, column D = Email ID (participant).
// Column B (Email Address) is the submitter's login — ignore it; same laptop submits many people.
const NAME_COLUMNS = ["Full Name"];
const EMAIL_COLUMNS = ["Email ID"];
const LEAGUE_COLUMNS = ["Winner League", "League", "winner league"];
const TEAM_COLUMNS = ["Team Name", "Team", "team name"];

/** @typedef {{ name: string, email: string, league: string, team: string }} Person */

const state = {
  allPeople: /** @type {Person[]} */ ([]),
  pool: /** @type {Person[]} */ ([]),
  picked: /** @type {Person[]} */ ([]),
  animating: false,
};

const els = {
  statusLine: document.getElementById("status-line"),
  scrambleLabel: document.getElementById("scramble-label"),
  displayName: document.getElementById("display-name"),
  displayEmail: document.getElementById("display-email"),
  displayMeta: document.getElementById("display-meta"),
  pickBtn: document.getElementById("pick-btn"),
  hintLine: document.getElementById("hint-line"),
  pickedHeading: document.getElementById("picked-heading"),
  pickedList: document.getElementById("picked-list"),
  resetBtn: document.getElementById("reset-btn"),
  matrixCanvas: document.getElementById("matrix-canvas"),
};

function findColumn(row, candidates) {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const match = keys.find((key) => key.trim().toLowerCase() === candidate.toLowerCase());
    if (match && row[match]?.trim()) {
      return row[match].trim();
    }
  }
  return "";
}

function parseRows(rows) {
  const seen = new Set();
  const people = [];

  for (const row of rows) {
    const email = findColumn(row, EMAIL_COLUMNS).toLowerCase();
    const name = findColumn(row, NAME_COLUMNS);
    if (!email || !name) {
      continue;
    }
    if (seen.has(email)) {
      continue;
    }
    seen.add(email);
    people.push({
      name,
      email,
      league: findColumn(row, LEAGUE_COLUMNS),
      team: findColumn(row, TEAM_COLUMNS),
    });
  }

  return people;
}

function parseCsvText(text) {
  const result = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (result.errors.length > 0) {
    throw new Error(result.errors[0].message ?? "Failed to parse CSV");
  }
  return parseRows(result.data);
}

async function loadCsvFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}`);
  }
  return parseCsvText(await response.text());
}

function getRosterFingerprint(people) {
  return people
    .map((person) => person.email)
    .sort()
    .join("|");
}

function saveSession() {
  if (state.allPeople.length === 0) {
    return;
  }

  const payload = {
    fingerprint: getRosterFingerprint(state.allPeople),
    picked: state.picked,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota or private-mode errors.
  }
}

function loadSession(fingerprint) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const payload = JSON.parse(raw);
    if (payload.fingerprint !== fingerprint || !Array.isArray(payload.picked)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore private-mode errors.
  }
}

function restoreSession(session) {
  const validEmails = new Set(state.allPeople.map((person) => person.email));
  state.picked = session.picked.filter((person) => validEmails.has(person.email));
  const pickedEmails = new Set(state.picked.map((person) => person.email));
  state.pool = state.allPeople.filter((person) => !pickedEmails.has(person.email));

  const lastWinner = state.picked[state.picked.length - 1];
  if (lastWinner) {
    showPerson(lastWinner, isComplete() ? "Selection complete" : "Selected");
  } else {
    clearDisplay();
  }
}

function setPeople(people) {
  state.allPeople = people;

  if (people.length === 0) {
    state.pool = [];
    state.picked = [];
    els.statusLine.textContent = "No entries found in roster.";
    updateUi();
    return;
  }

  const fingerprint = getRosterFingerprint(people);
  const session = loadSession(fingerprint);

  if (session) {
    restoreSession(session);
    els.statusLine.textContent = "Session restored.";
  } else {
    state.pool = [...people];
    state.picked = [];
    clearDisplay();
    els.statusLine.textContent = "Ready.";
  }

  updateUi();
}

function resetPicks() {
  clearSession();
  state.pool = [...state.allPeople];
  state.picked = [];
  updateUi();
}

function getTargetCount() {
  if (state.allPeople.length === 0) {
    return PICK_COUNT;
  }
  return Math.min(PICK_COUNT, state.allPeople.length);
}

function isComplete() {
  return state.picked.length >= getTargetCount();
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function updateUi() {
  const target = getTargetCount();
  const total = state.allPeople.length;
  const remaining = state.pool.length;

  if (state.animating) {
    els.hintLine.textContent = "Decrypting candidate…";
  } else if (total === 0) {
    els.hintLine.textContent = "";
  } else if (isComplete()) {
    els.hintLine.textContent = "All winners selected.";
  } else {
    const next = state.picked.length + 1;
    els.hintLine.textContent = `Press Pick for winner ${next} of ${target}.`;
  }

  els.pickedHeading.textContent = `Winners (${state.picked.length}/${target})`;

  if (state.picked.length === 0) {
    els.pickedList.innerHTML = '<li class="text-[#00ff41]/40">No winners yet.</li>';
  } else {
    els.pickedList.innerHTML = state.picked
      .map((person, index) => {
        const meta =
          person.team || person.league
            ? `<span class="block text-xs text-[#00ff41]/50">${[person.team, person.league].filter(Boolean).join(" · ")}</span>`
            : "";
        return `<li><span class="text-[#00ff41]/60">${index + 1}.</span> ${escapeHtml(person.name)} — ${escapeHtml(person.email)}${meta}</li>`;
      })
      .join("");
  }

  const ready = total > 0 && !state.animating;
  els.pickBtn.disabled = !ready || isComplete() || remaining === 0;
  els.resetBtn.disabled = !ready || (state.picked.length === 0 && remaining === total);

  if (isComplete()) {
    els.scrambleLabel.textContent = "Selection complete";
    els.pickBtn.textContent = "Complete";
  } else {
    els.scrambleLabel.textContent = state.animating ? "Decrypting…" : "Awaiting selection";
    els.pickBtn.textContent = "Pick";
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showPerson(person, label) {
  els.scrambleLabel.textContent = label;
  els.displayName.textContent = person.name;
  els.displayEmail.textContent = person.email;
  const meta = [person.team, person.league].filter(Boolean).join(" · ");
  els.displayMeta.textContent = meta;
}

function clearDisplay() {
  els.displayName.textContent = "—";
  els.displayEmail.textContent = "—";
  els.displayMeta.textContent = "";
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function scrambleToWinner(winner) {
  state.animating = true;
  els.displayName.classList.add("scrambling");
  updateUi();

  const steps = [
    { count: 18, delay: 45 },
    { count: 10, delay: 80 },
    { count: 6, delay: 130 },
    { count: 4, delay: 200 },
    { count: 2, delay: 320 },
  ];

  for (const step of steps) {
    for (let i = 0; i < step.count; i += 1) {
      const flash = randomItem(state.pool.length > 0 ? state.pool : [winner]);
      showPerson(flash, "Decrypting…");
      await wait(step.delay);
    }
  }

  showPerson(winner, "Selected");
  els.displayName.classList.remove("scrambling");
  state.animating = false;
  updateUi();
}

async function pickNext() {
  if (state.animating || isComplete() || state.pool.length === 0) {
    return;
  }

  const index = Math.floor(Math.random() * state.pool.length);
  const winner = state.pool[index];
  state.pool.splice(index, 1);

  await scrambleToWinner(winner);
  state.picked.push(winner);
  saveSession();
  updateUi();
}

function initMatrixRain() {
  const canvas = els.matrixCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const chars = "アイウエオカキクケコ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let columns = 0;
  let drops = /** @type {number[]} */ ([]);
  let fontSize = 14;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    fontSize = Math.max(12, Math.floor(window.innerWidth / 90));
    columns = Math.floor(canvas.width / fontSize);
    drops = Array.from({ length: columns }, () => Math.random() * -100);
  }

  function draw() {
    ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0f0";
    ctx.font = `${fontSize}px monospace`;

    for (let i = 0; i < drops.length; i += 1) {
      const char = chars[Math.floor(Math.random() * chars.length)];
      const x = i * fontSize;
      const y = drops[i] * fontSize;
      ctx.fillText(char, x, y);

      if (y > canvas.height && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i] += 1;
    }

    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  draw();
}

async function bootstrap() {
  initMatrixRain();
  updateUi();

  try {
    const people = await loadCsvFromUrl(CSV_PATH);
    setPeople(people);
  } catch {
    els.statusLine.textContent = "Roster unavailable. Check data/lucky-draw.csv and redeploy.";
    state.allPeople = [];
    state.pool = [];
    updateUi();
  }
}

els.pickBtn.addEventListener("click", () => {
  void pickNext();
});

els.resetBtn.addEventListener("click", () => {
  if (state.animating) {
    return;
  }
  resetPicks();
  clearDisplay();
  els.scrambleLabel.textContent = "Awaiting selection";
  els.statusLine.textContent = "Ready.";
});

void bootstrap();
