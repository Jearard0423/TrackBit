import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  equalTo,
  get,
  orderByChild,
  push,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";
import { auth, db, firebaseConfigured, provider } from "./firebase.js";

const authView = document.querySelector("#auth-view");
const appView = document.querySelector("#app-view");
const accountActions = document.querySelector("#account-actions");
const authForm = document.querySelector("#auth-form");
const authMessage = document.querySelector("#auth-message");
const authModeToggle = document.querySelector("#auth-mode-toggle");
const googleSignInButton = document.querySelector("#google-sign-in");
const appMessage = document.querySelector("#app-message");
const cycleContent = document.querySelector("#cycle-content");
const setupWarning = document.querySelector("#firebase-setup-warning");
const tabs = [...document.querySelectorAll(".day-tab")];

let registerMode = false;
let currentUser = null;
let selectedDay = "today";

authModeToggle.addEventListener("click", () => {
  registerMode = !registerMode;
  document.querySelector("#auth-eyebrow").textContent = registerMode ? "A FRESH START" : "WELCOME BACK";
  document.querySelector("#auth-title").textContent = registerMode ? "Create your account" : "Sign in to your space";
  document.querySelector("#auth-subtitle").textContent = registerMode
    ? "Make room for small actions and honest reflection."
    : "Your progress is personal. Pick up where you left off.";
  document.querySelector("#auth-password").autocomplete = registerMode ? "new-password" : "current-password";
  document.querySelector("#auth-submit").innerHTML = registerMode
    ? 'Create account <span aria-hidden="true">→</span>'
    : 'Sign in <span aria-hidden="true">→</span>';
  document.querySelector("#auth-switch-copy").textContent = registerMode ? "Already have an account?" : "New to TrackBit?";
  authModeToggle.textContent = registerMode ? "Sign in" : "Create an account";
  authMessage.textContent = "";
});

authForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!firebaseConfigured) return;

  const email = authForm.elements.email.value.trim();
  const password = authForm.elements.password.value;
  const button = document.querySelector("#auth-submit");
  button.disabled = true;
  authMessage.textContent = "";

  try {
    if (registerMode) {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    authMessage.textContent = readableAuthError(error.code);
  } finally {
    button.disabled = false;
  }
});

googleSignInButton.addEventListener("click", async () => {
  googleSignInButton.disabled = true;
  authMessage.textContent = "";
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    authMessage.textContent = readableAuthError(error.code);
  } finally {
    googleSignInButton.disabled = false;
  }
});

const profileDialog = document.querySelector("#profile-dialog");
const logoutDialog = document.querySelector("#logout-dialog");

document.querySelector("#profile-open").addEventListener("click", () => {
  document.querySelector("#profile-name").value = getUserName(currentUser);
  document.querySelector("#profile-email").value = currentUser?.email || "";
  document.querySelector("#profile-message").textContent = "";
  profileDialog.showModal();
});

document.querySelector("#profile-cancel").addEventListener("click", () => profileDialog.close());

document.querySelector("#profile-form").addEventListener("submit", async event => {
  event.preventDefault();
  const displayName = document.querySelector("#profile-name").value.trim();
  const saveButton = document.querySelector("#profile-save");
  if (!displayName || !currentUser) return;
  saveButton.disabled = true;
  saveButton.textContent = "Saving profile...";
  document.querySelector("#profile-message").textContent = "";
  try {
    await updateProfile(currentUser, { displayName });
    document.querySelector("#welcome-title").textContent = `Your day, ${displayName.split(/[ ._-]/)[0]}.`;
    profileDialog.close();
    appMessage.textContent = "Profile updated.";
  } catch (error) {
    document.querySelector("#profile-message").textContent = "Your profile could not be updated. Please try again.";
    console.error(error);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save profile";
  }
});

document.querySelector("#sign-out").addEventListener("click", () => {
  document.querySelector("#logout-message").textContent = "";
  logoutDialog.showModal();
});

document.querySelector("#logout-cancel").addEventListener("click", () => logoutDialog.close());

document.querySelector("#logout-confirm").addEventListener("click", async event => {
  const button = event.currentTarget;
  const label = button.querySelector(".logout-button-label");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  label.textContent = "Signing out...";
  document.querySelector("#logout-message").textContent = "Ending your session securely.";
  try {
    await signOut(auth);
    logoutDialog.close();
  } catch (error) {
    document.querySelector("#logout-message").textContent = "We couldn't sign you out. Check your connection and try again.";
    console.error(error);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    label.textContent = "Sign out";
  }
});

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    selectedDay = tab.dataset.day;
    tabs.forEach(item => {
      const active = item === tab;
      item.classList.toggle("is-active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    renderCycle();
  });
}

if (!firebaseConfigured) {
  setupWarning.hidden = false;
  document.querySelector("#auth-submit").disabled = true;
  googleSignInButton.disabled = true;
}

if (firebaseConfigured) {
  onAuthStateChanged(auth, user => {
    currentUser = user;
    authView.hidden = Boolean(user);
    appView.hidden = !user;
    accountActions.hidden = !user;
    document.querySelector("#account-email").textContent = user?.email ?? "";
    if (user) {
      const firstName = getUserName(user).split(/[ ._-]/)[0] || "there";
      document.querySelector("#welcome-title").textContent = `Your day, ${firstName}.`;
      renderCycle();
    }
  });
}

function readableAuthError(code) {
  const messages = {
    "auth/email-already-in-use": "That email already has an account. Try signing in.",
    "auth/invalid-credential": "That email and password combination was not recognized.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/popup-closed-by-user": "Google sign-in was closed before it finished.",
    "auth/popup-blocked": "Allow popups for this site, then try Google sign-in again.",
    "auth/account-exists-with-different-credential": "An account already exists with this email. Sign in using its original method.",
    "auth/weak-password": "Choose a password with at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
  };
  return messages[code] || "We couldn't complete that request. Please try again.";
}

function getUserName(user) {
  return user?.displayName?.trim() || user?.email?.split("@")[0]?.split(/[._-]/)[0] || "there";
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFor(day) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + ({ yesterday: -1, today: 0, tomorrow: 1 }[day] ?? 0));
  return date;
}

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(date);
}

function userPath(...segments) {
  return `users/${currentUser.uid}/${segments.join("/")}`;
}

function bitsRef() {
  return ref(db, userPath("bits"));
}

async function getEntries(node, date) {
  const entriesRef = ref(db, userPath(node));
  try {
    const snapshot = await get(query(entriesRef, orderByChild("date"), equalTo(dateKey(date))));
    return Object.entries(snapshot.val() || {}).map(([id, entry]) => ({ id, ...entry }));
  } catch (error) {
    if (!/index not defined/i.test(error?.message || "")) throw error;
    console.warn(`Missing date index for ${node}; filtering this user's records locally. Publish database.rules.json to restore indexed reads.`);
    const snapshot = await get(entriesRef);
    return Object.entries(snapshot.val() || {})
      .filter(([, entry]) => entry.date === dateKey(date))
      .map(([id, entry]) => ({ id, ...entry }));
  }
}

async function getSleep(date) {
  const snapshot = await get(ref(db, userPath("sleep", dateKey(date))));
  return snapshot.exists() ? snapshot.val() : null;
}

async function renderCycle() {
  if (!currentUser) return;
  const dayDate = dateFor(selectedDay);
  const dayLabel = selectedDay[0].toUpperCase() + selectedDay.slice(1);
  document.querySelector("#today-label").textContent = formatDate(new Date());
  appMessage.textContent = "";
  cycleContent.innerHTML = `<div class="loading-state"><span class="loading-dot"></span>Gathering your Bits</div>`;

  try {
    const [bits, tasks, sleep] = await Promise.all([
      getEntries("bits", dayDate),
      getEntries("tasks", dayDate),
      getSleep(dayDate),
    ]);
    const completed = bits.filter(bit => Number(bit.actualAmount) >= Number(bit.plannedAmount)).length;
    const heading = selectedDay === "yesterday" ? "Notice what happened." : selectedDay === "today" ? "Make today count." : "Set up a kinder tomorrow.";
    const subheading = selectedDay === "yesterday"
      ? "Progress is information, not a verdict."
      : selectedDay === "today"
        ? "Small, measurable actions are enough."
        : "Use recent experience to choose a realistic next step.";

    cycleContent.innerHTML = `
      <div class="section-heading">
        <div><p class="eyebrow">${escapeHtml(dayLabel.toUpperCase())} / ${escapeHtml(formatDate(dayDate).toUpperCase())}</p><h2>${heading}</h2><p>${subheading}</p></div>
        <div class="day-count"><strong>${completed}<span> / </span>${bits.length}</strong><small>Bits on track</small></div>
      </div>
      ${selectedDay === "tomorrow" ? '<section id="insight-panel" class="insight-panel"><div class="insight-heading"><span class="insight-spark" aria-hidden="true">✳</span><div><p class="eyebrow">YOUR PERSONAL REVIEW</p><h3>Make sense of your last seven days.</h3><p class="insight-copy">TrackBit will share your recent Bits, tasks, and sleep log with Google Gemini only when you request an analysis.</p><button id="run-analysis" class="button button-primary btn btn-primary" type="button">Analyze my progress <span aria-hidden="true">→</span></button><p id="analysis-message" class="analysis-message" role="status" aria-live="polite"></p></div></div><div id="analysis-result"></div></section>' : ""}
      <section class="tracking-section task-section">
        <div class="list-heading"><div><p class="eyebrow">THE REST OF YOUR DAY</p><h3>${selectedDay === "yesterday" ? "Yesterday's tasks" : selectedDay === "tomorrow" ? "Tomorrow's tasks" : "Today's tasks"}</h3></div><span>${tasks.filter(task => task.completed).length} of ${tasks.length} done</span></div>
        ${taskForm()}
        <div class="task-list">${tasks.length ? tasks.map(taskCard).join("") : '<div class="empty-state"><span class="empty-mark" aria-hidden="true">+</span><p>No tasks yet. Add one above to make it easy to find.</p></div>'}</div>
      </section>
      <section class="bits-section">
        <div class="list-heading"><h3>${selectedDay === "yesterday" ? "Yesterday's Bits" : selectedDay === "tomorrow" ? "Tomorrow's plan" : "Today's Bits"}</h3><span>${bits.length ? `${bits.length} ${bits.length === 1 ? "action" : "actions"}` : "A clean slate"}</span></div>
        <div id="bits-list" class="bits-list">${bits.length ? bits.map(bit => bitCard(bit, selectedDay === "yesterday")).join("") : emptyState(selectedDay)}</div>
      </section>
      <section class="tracking-section sleep-section">
        <div class="list-heading"><div><p class="eyebrow">REST IS PART OF PROGRESS</p><h3>${selectedDay === "tomorrow" ? "Plan your sleep" : `${dayLabel}'s sleep`}</h3></div>${sleep?.hours !== undefined ? `<span>${formatAmount(sleep.hours)} hours recorded</span>` : ""}</div>
        ${sleepForm(sleep)}
      </section>
      ${selectedDay === "yesterday" ? '<button id="plan-today" class="button button-primary btn btn-primary" type="button">Carry it into today <span aria-hidden="true">→</span></button>' : addBitForm()}
    `;

    bindBitCards();
    bindAddBitForm(dayDate);
    bindTaskControls(dayDate);
    bindSleepForm(dayDate);
    document.querySelector("#plan-today")?.addEventListener("click", () => tabs[1].click());
    document.querySelector("#run-analysis")?.addEventListener("click", () => loadProgressAnalysis(dayDate));
    return true;
  } catch (error) {
    const message = databaseReadErrorMessage(error);
    cycleContent.innerHTML = `
      <div class="notice notice-error" role="alert">${escapeHtml(message)}</div>
      <section class="tracking-section task-section">
        <div class="list-heading"><div><p class="eyebrow">THE REST OF YOUR DAY</p><h3>${escapeHtml(dayLabel)}'s tasks</h3></div></div>
        ${taskForm()}
        <div class="empty-state"><span class="empty-mark" aria-hidden="true">!</span><p>Task history is unavailable until the Firebase data issue above is fixed.</p></div>
      </section>`;
    bindTaskControls(dayDate);
    console.error(error);
    return false;
  }
}

function databaseReadErrorMessage(error) {
  if (isDatabasePermissionError(error)) {
    return "Realtime Database denied access. Publish the owner-only rules from database.rules.json in Firebase Console → Realtime Database → Rules, then reload.";
  }
  if (/index not defined/i.test(error?.message || "")) {
    return "Firebase is missing the date indexes. Publish database.rules.json in Firebase Console → Realtime Database → Rules, then reload.";
  }
  const detail = error?.message || error?.code;
  return detail
    ? `We could not load your data: ${detail}`
    : "We could not load your data. Check your connection and Firebase setup, then try again.";
}

function isDatabasePermissionError(error) {
  return error?.code === "PERMISSION_DENIED"
    || error?.code === "permission-denied"
    || /permission denied/i.test(error?.message || "");
}

function bitCard(bit, reflectionMode) {
  const planned = Number(bit.plannedAmount) || 0;
  const actual = bit.actualAmount === null || bit.actualAmount === undefined ? "" : Number(bit.actualAmount);
  const ratio = planned > 0 ? Math.min(100, Math.round((Number(actual || 0) / planned) * 100)) : 0;
  const status = actual === "" ? "Not started" : Number(actual) >= planned ? "Completed" : "In progress";
  const unit = escapeHtml(bit.unit || "times");
  return `
    <article class="bit-card" data-bit-id="${escapeHtml(bit.id)}">
      <div class="bit-main">
        <div class="bit-symbol" aria-hidden="true">${status === "Completed" ? "✓" : status === "In progress" ? "◒" : "·"}</div>
        <div class="bit-name"><h4>${escapeHtml(bit.title)}</h4><p>${escapeHtml(status)} <span>·</span> planned ${formatAmount(planned)} ${unit}</p></div>
        <div class="bit-progress" aria-label="${ratio}% complete"><div><span style="width:${ratio}%"></span></div><small>${ratio}%</small></div>
        <label class="actual-field"><span>ACTUAL</span><span class="actual-input-wrap"><input class="actual-input form-control" aria-label="Actual amount for ${escapeHtml(bit.title)}" type="number" min="0" step="0.1" value="${actual}" placeholder="0" /><small>${unit}</small></span></label>
        <button class="icon-button save-actual btn btn-outline-success" type="button" aria-label="Save actual amount" title="Save actual amount">↵</button>
        <button class="icon-button delete-bit btn btn-outline-danger" type="button" aria-label="Delete ${escapeHtml(bit.title)}" title="Delete Bit">×</button>
      </div>
      ${reflectionMode || selectedDay !== "tomorrow" ? `<details class="reflection-details" ${reflectionMode ? "open" : ""}><summary>${reflectionMode ? "What influenced this?" : "Add a note for your future self"}</summary><div class="reflection-fields"><label class="sr-only" for="reason-${escapeHtml(bit.id)}">Reason</label><select id="reason-${escapeHtml(bit.id)}" class="text-input form-control reason-input"><option value="">Choose a reason</option>${["No time", "Too tired", "Forgot", "Lost motivation", "Unexpected event", "Distracted", "Other"].map(reason => `<option ${bit.reason === reason ? "selected" : ""}>${reason}</option>`).join("")}</select><label class="sr-only" for="reflection-${escapeHtml(bit.id)}">Reflection</label><textarea id="reflection-${escapeHtml(bit.id)}" class="text-input form-control reflection-input" rows="2" placeholder="What did you notice?">${escapeHtml(bit.reflection || "")}</textarea><button class="button button-small save-reflection btn btn-warning" type="button">Save reflection</button></div></details>` : ""}
    </article>`;
}

function emptyState(day) {
  const message = day === "yesterday"
    ? "No Bits were planned yesterday. That's part of the picture, too."
    : day === "tomorrow"
      ? "Your next day starts with one small intention."
      : "Nothing planned yet. Choose one small thing that matters.";
  return `<div class="empty-state"><span class="empty-mark" aria-hidden="true">+</span><p>${message}</p></div>`;
}

function addBitForm() {
  return `<form id="add-bit-form" class="add-bit-form"><div class="add-bit-heading"><span class="add-mark" aria-hidden="true">+</span><div><h3>Add a Bit</h3><p>Make it specific enough to measure.</p></div></div><div class="add-bit-fields"><label class="sr-only" for="bit-title">Action</label><input id="bit-title" class="text-input form-control" name="title" maxlength="80" placeholder="e.g. Study networking" required /><label class="sr-only" for="bit-target">Planned amount</label><input id="bit-target" class="text-input form-control target-input" name="plannedAmount" type="number" min="0.1" step="0.1" placeholder="30" required /><label class="sr-only" for="bit-unit">Unit</label><select id="bit-unit" class="text-input form-control unit-input" name="unit"><option>minutes</option><option>pages</option><option>reps</option><option>glasses</option><option>sessions</option><option>times</option></select><button class="button button-primary btn btn-primary" type="submit">Add Bit <span aria-hidden="true">+</span></button></div></form>`;
}

function taskCard(task) {
  return `<article class="task-row ${task.completed ? "task-row-complete" : ""}" data-task-id="${escapeHtml(task.id)}"><div class="task-row-main"><label class="task-check"><input class="task-toggle" type="checkbox" ${task.completed ? "checked" : ""} aria-label="Mark ${escapeHtml(task.title)} ${task.completed ? "incomplete" : "complete"}" /><span class="task-title ${task.completed ? "is-complete" : ""}">${escapeHtml(task.title)}</span></label><button class="icon-button delete-task btn btn-outline-danger" type="button" aria-label="Delete ${escapeHtml(task.title)}" title="Delete task">×</button></div>${task.completed ? `<div class="task-reflection"><label class="sr-only" for="task-reflection-${escapeHtml(task.id)}">Reflection for ${escapeHtml(task.title)}</label><textarea id="task-reflection-${escapeHtml(task.id)}" class="text-input form-control task-reflection-input" rows="2" maxlength="500" placeholder="What helped you get this done? What did you learn?">${escapeHtml(task.reflection || "")}</textarea><button class="button button-small save-task-reflection btn btn-warning" type="button">Save reflection</button></div>` : ""}</article>`;
}

function taskForm() {
  return `<div class="task-entry"><form id="add-task-form" class="task-form"><label class="sr-only" for="task-title">New task</label><input id="task-title" class="text-input form-control" name="title" maxlength="120" placeholder="What do you want to get done?" required /><button class="button button-primary btn btn-primary" type="submit"><span class="task-submit-label"><span aria-hidden="true">+</span> Add task</span></button></form><p id="task-form-message" class="task-form-message" role="status" aria-live="polite"></p></div>`;
}

function sleepForm(sleep) {
  const planning = selectedDay === "tomorrow";
  const amountKey = planning ? "targetHours" : "hours";
  const amountLabel = planning ? "Sleep target" : "Hours slept";
  const quality = sleep?.quality ?? "";
  return `<form id="sleep-form" class="sleep-form"><label class="sleep-hours-field" for="sleep-hours"><span>${amountLabel}</span><span class="sleep-input-wrap"><input id="sleep-hours" class="text-input form-control" name="hours" type="number" min="0" max="24" step="0.25" value="${sleep?.[amountKey] ?? ""}" placeholder="7.5" required /><small>hours</small></span></label>${planning ? "" : `<label class="sleep-quality-field" for="sleep-quality"><span>HOW RESTED?</span><select id="sleep-quality" class="text-input form-control" name="quality"><option value="">Optional</option>${[1, 2, 3, 4, 5].map(score => `<option value="${score}" ${Number(quality) === score ? "selected" : ""}>${score} / 5</option>`).join("")}</select></label>`}<button class="button button-primary btn btn-primary" type="submit">${planning ? "Save sleep target" : "Save sleep"}</button></form>`;
}

function bindAddBitForm(dayDate) {
  const form = document.querySelector("#add-bit-form");
  if (!form) return;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const formData = new FormData(form);
    const title = String(formData.get("title")).trim();
    const plannedAmount = Number(formData.get("plannedAmount"));
    if (!title || !Number.isFinite(plannedAmount) || plannedAmount <= 0) return;
    try {
      await set(push(bitsRef()), {
        title,
        date: dateKey(dayDate),
        plannedAmount,
        actualAmount: null,
        unit: String(formData.get("unit")),
        reason: "",
        reflection: "",
        createdAt: serverTimestamp(),
      });
      renderCycle();
    } catch (error) {
      appMessage.textContent = "That Bit could not be saved. Check your connection and try again.";
      console.error(error);
    }
  });
}

function bindBitCards() {
  cycleContent.querySelectorAll(".bit-card").forEach(card => {
    const bitId = card.dataset.bitId;
    const bitRef = ref(db, userPath("bits", bitId));
    card.querySelector(".save-actual")?.addEventListener("click", async () => {
      const value = card.querySelector(".actual-input").value;
      try {
        await update(bitRef, { actualAmount: value === "" ? null : Number(value), updatedAt: serverTimestamp() });
        renderCycle();
      } catch (error) {
        appMessage.textContent = "Your actual amount could not be saved. Try again.";
        console.error(error);
      }
    });
    card.querySelector(".save-reflection")?.addEventListener("click", async () => {
      try {
        await update(bitRef, {
          reason: card.querySelector(".reason-input").value,
          reflection: card.querySelector(".reflection-input").value.trim(),
          updatedAt: serverTimestamp(),
        });
        appMessage.textContent = "Reflection saved.";
      } catch (error) {
        appMessage.textContent = "Your reflection could not be saved. Try again.";
        console.error(error);
      }
    });
    card.querySelector(".delete-bit")?.addEventListener("click", async () => {
      try {
        await remove(bitRef);
        renderCycle();
      } catch (error) {
        appMessage.textContent = "That Bit could not be removed. Try again.";
        console.error(error);
      }
    });
  });
}

function bindTaskControls(dayDate) {
  const form = document.querySelector("#add-task-form");
  const input = form.elements.title;
  const submitButton = form.querySelector("button[type='submit']");
  const submitLabel = submitButton.querySelector(".task-submit-label");
  const formMessage = document.querySelector("#task-form-message");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) {
      input.setCustomValidity("Enter a task name.");
      input.reportValidity();
      return;
    }
    input.setCustomValidity("");
    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");
    submitLabel.textContent = "Adding task...";
    formMessage.textContent = "Saving your task.";
    try {
      await set(push(ref(db, userPath("tasks"))), {
        title,
        date: dateKey(dayDate),
        completed: false,
        createdAt: serverTimestamp(),
      });
      const dashboardLoaded = await renderCycle();
      if (!dashboardLoaded) {
        document.querySelector("#task-form-message").textContent = "Task saved. Fix the Firebase data issue above to load your task history.";
      }
    } catch (error) {
      const detail = error?.message || error?.code;
      formMessage.textContent = isDatabasePermissionError(error)
        ? "Firebase denied this task. Publish the owner-only rules from database.rules.json in Realtime Database settings, then retry."
        : detail ? `Task could not be saved: ${detail}` : "Task could not be saved. Check your connection and try again.";
      console.error(error);
    } finally {
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-busy");
      submitLabel.innerHTML = '<span aria-hidden="true">+</span> Add task';
    }
  });

  cycleContent.querySelectorAll(".task-row").forEach(row => {
    const taskRef = ref(db, userPath("tasks", row.dataset.taskId));
    row.querySelector(".task-toggle").addEventListener("change", async event => {
      try {
        await update(taskRef, {
          completed: event.target.checked,
          completedAt: event.target.checked ? serverTimestamp() : null,
        });
        renderCycle();
      } catch (error) {
        appMessage.textContent = "Task progress could not be updated. Try again.";
        console.error(error);
      }
    });
    row.querySelector(".delete-task").addEventListener("click", async () => {
      try {
        await remove(taskRef);
        renderCycle();
      } catch (error) {
        appMessage.textContent = "That task could not be removed. Try again.";
        console.error(error);
      }
    });
    row.querySelector(".save-task-reflection")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Saving...";
      try {
        await update(taskRef, {
          reflection: row.querySelector(".task-reflection-input").value.trim(),
          reflectionUpdatedAt: serverTimestamp(),
        });
        appMessage.textContent = "Task reflection saved.";
        button.textContent = "Saved";
      } catch (error) {
        appMessage.textContent = "Your task reflection could not be saved. Try again.";
        button.textContent = "Save reflection";
        console.error(error);
      } finally {
        button.disabled = false;
      }
    });
  });
}

function bindSleepForm(dayDate) {
  const form = document.querySelector("#sleep-form");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const formData = new FormData(form);
    const hours = Number(formData.get("hours"));
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) return;
    const planning = selectedDay === "tomorrow";
    const sleepData = {
      date: dateKey(dayDate),
      [planning ? "targetHours" : "hours"]: hours,
      updatedAt: serverTimestamp(),
    };
    if (!planning && formData.get("quality")) sleepData.quality = Number(formData.get("quality"));
    try {
      await update(ref(db, userPath("sleep", dateKey(dayDate))), sleepData);
      appMessage.textContent = planning ? "Sleep target saved." : "Sleep log saved.";
      renderCycle();
    } catch (error) {
      appMessage.textContent = "Your sleep entry could not be saved. Try again.";
      console.error(error);
    }
  });
}

async function loadProgressAnalysis(targetDate) {
  const panel = document.querySelector("#insight-panel");
  const button = document.querySelector("#run-analysis");
  const message = document.querySelector("#analysis-message");
  const resultContainer = document.querySelector("#analysis-result");
  button.disabled = true;
  button.innerHTML = '<span class="loading-dot" aria-hidden="true"></span> Reviewing your week';
  message.textContent = "";
  resultContainer.innerHTML = "";
  try {
    const token = await currentUser.getIdToken();
    const response = await fetch("/api/insights.php", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ targetDate: dateKey(targetDate), userId: currentUser.uid }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Insight service unavailable");
    const analysis = result.analysis;
    resultContainer.innerHTML = `<div class="analysis-body"><p class="analysis-summary">${escapeHtml(analysis.summary)}</p>${analysis.patterns.length ? `<div class="analysis-patterns"><h4>What stands out</h4><ul>${analysis.patterns.map(pattern => `<li>${escapeHtml(pattern)}</li>`).join("")}</ul></div>` : ""}${analysis.suggestions.length ? `<div class="analysis-suggestions"><h4>Small next steps</h4><div class="suggestion-list">${analysis.suggestions.map((suggestion, index) => `<article class="suggestion" data-suggestion="${index}"><div><h4>${escapeHtml(suggestion.title)}</h4><p>${escapeHtml(suggestion.basis)}</p></div><strong>${formatAmount(suggestion.plannedAmount)} <small>${escapeHtml(suggestion.unit)}</small></strong><div class="suggestion-actions"><button class="button button-small accept-suggestion btn btn-warning" type="button">Add to tomorrow</button></div></article>`).join("")}</div></div>` : ""}</div>`;
    resultContainer.querySelectorAll(".suggestion").forEach((row, index) => {
      const suggestion = analysis.suggestions[index];
      row.querySelector(".accept-suggestion").addEventListener("click", async () => {
        try {
          await set(push(bitsRef()), {
            title: suggestion.title,
            date: dateKey(targetDate),
            plannedAmount: suggestion.plannedAmount,
            actualAmount: null,
            unit: suggestion.unit,
            reason: "",
            reflection: "",
            createdAt: serverTimestamp(),
          });
          renderCycle();
        } catch (error) {
          appMessage.textContent = "That suggestion could not be added. Try again.";
          console.error(error);
        }
      });
    });
  } catch (error) {
    message.textContent = error.message || "Progress analysis is temporarily unavailable.";
  } finally {
    button.disabled = false;
    button.innerHTML = 'Analyze my progress <span aria-hidden="true">→</span>';
  }
}

function formatAmount(amount) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(amount);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}