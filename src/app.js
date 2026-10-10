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
  limitToLast,
  orderByChild,
  orderByKey,
  push,
  query,
  ref,
  remove,
  startAt,
  endAt,
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
const authSubmitButton = document.querySelector("#auth-submit");
const authSubmitLabel = document.querySelector("#auth-submit-label");
const passwordInput = document.querySelector("#auth-password");
const passwordVisibilityButton = document.querySelector("#password-visibility");
const appMessage = document.querySelector("#app-message");
const cycleContent = document.querySelector("#cycle-content");
const setupWarning = document.querySelector("#firebase-setup-warning");
const tabs = [...document.querySelectorAll(".day-tab")];

let registerMode = false;
let currentUser = null;
let selectedDay = "today";
let historicalDate = null;
let yesterdayHistoryView = "history";
let cropBitmap = null;
let profilePhotoDataUrl = "";
let cameraStream = null;
let historyCameraStream = null;
let cropZoom = 1;
let cropCenter = { x: 0, y: 0 };
let cropDrag = null;

authModeToggle.addEventListener("click", () => {
  registerMode = !registerMode;
  document.querySelector("#auth-eyebrow").textContent = registerMode ? "A FRESH START" : "WELCOME BACK";
  document.querySelector("#auth-title").textContent = registerMode ? "Create your account" : "Sign in to your space";
  document.querySelector("#auth-subtitle").textContent = registerMode
    ? "Make room for small actions and honest reflection."
    : "Your progress is personal. Pick up where you left off.";
  passwordInput.autocomplete = registerMode ? "new-password" : "current-password";
  authSubmitLabel.textContent = registerMode ? "Create account" : "Sign in";
  document.querySelector("#auth-switch-copy").textContent = registerMode ? "Already have an account?" : "New to TrackBit?";
  authModeToggle.textContent = registerMode ? "Sign in" : "Create an account";
  authMessage.textContent = "";
});

passwordVisibilityButton.addEventListener("click", () => {
  const isVisible = passwordInput.type === "text";
  passwordInput.type = isVisible ? "password" : "text";
  passwordVisibilityButton.setAttribute("aria-pressed", String(!isVisible));
  passwordVisibilityButton.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
  passwordVisibilityButton.querySelector(".password-eye").hidden = !isVisible;
  passwordVisibilityButton.querySelector(".password-eye-off").hidden = isVisible;
});

authForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!firebaseConfigured) return;

  const email = authForm.elements.email.value.trim();
  const password = authForm.elements.password.value;
  setAuthLoading(true, authSubmitButton);
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
    setAuthLoading(false, authSubmitButton);
  }
});

googleSignInButton.addEventListener("click", async () => {
  setAuthLoading(true, googleSignInButton);
  authMessage.textContent = "";
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    authMessage.textContent = readableAuthError(error.code);
  } finally {
    setAuthLoading(false, googleSignInButton);
  }
});

const profileDialog = document.querySelector("#profile-dialog");
const logoutDialog = document.querySelector("#logout-dialog");
const accountMenu = document.querySelector("#account-menu");
const accountMenuToggle = document.querySelector("#account-menu-toggle");
const accountMenuPanel = document.querySelector("#account-menu-panel");
let originalProfileName = "";

accountMenuToggle.addEventListener("click", () => {
  const opening = accountMenuPanel.hidden;
  accountMenuPanel.hidden = !opening;
  accountMenuToggle.setAttribute("aria-expanded", String(opening));
  accountMenuToggle.setAttribute("aria-label", opening ? "Close account menu" : "Open account menu");
  if (opening) accountMenuPanel.querySelector("button")?.focus();
});

document.addEventListener("click", event => {
  if (!accountMenu.contains(event.target)) closeAccountMenu();
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || accountMenuPanel.hidden) return;
  closeAccountMenu();
  accountMenuToggle.focus();
});

function closeAccountMenu() {
  accountMenuPanel.hidden = true;
  accountMenuToggle.setAttribute("aria-expanded", "false");
  accountMenuToggle.setAttribute("aria-label", "Open account menu");
}

document.querySelector("#profile-open").addEventListener("click", async () => {
  closeAccountMenu();
  if (!currentUser) return;
  const user = currentUser;
  const profileName = getUserName(currentUser);
  originalProfileName = currentUser?.displayName?.trim() || profileName;
  document.querySelector("#profile-name").value = originalProfileName;
  document.querySelector("#profile-public-name").textContent = currentUser?.displayName?.trim() || profileName;
  document.querySelector("#profile-created-date").textContent = formatAccountCreated(currentUser?.metadata?.creationTime);
  document.querySelector("#profile-photo-fallback").textContent = profileName.slice(0, 1).toUpperCase();
  document.querySelector("#profile-message").textContent = "";
  updateProfileSaveButton();
  setProfilePhotoPreview(profilePhotoDataUrl || currentUser?.photoURL || "");
  profileDialog.showModal();
  await loadAccountPhoto(user);
  if (profileDialog.open && currentUser?.uid === user.uid) {
    setProfilePhotoPreview(profilePhotoDataUrl || user.photoURL || "");
  }
});

document.querySelector("#profile-name").addEventListener("input", event => {
  document.querySelector("#profile-public-name").textContent = event.currentTarget.value.trim() || "Your profile name";
  updateProfileSaveButton();
});

document.querySelector("#profile-cancel").addEventListener("click", () => profileDialog.close());

document.querySelector("#profile-photo-choose").addEventListener("click", () => {
  document.querySelector("#profile-photo-file").click();
});

document.querySelector("#profile-photo-file").addEventListener("change", async event => {
  const [file] = event.currentTarget.files || [];
  event.currentTarget.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
    document.querySelector("#profile-message").textContent = "Choose an image smaller than 10 MB.";
    return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 30_000_000) {
      bitmap.close();
      throw new Error("The image is too large to crop in this browser.");
    }
    await setCropImage(bitmap);
  } catch (error) {
    document.querySelector("#profile-message").textContent = "That image could not be opened. Choose another image and try again.";
    console.error(error);
  }
});

document.querySelector("#profile-camera-open").addEventListener("click", async event => {
  const button = event.currentTarget;
  const message = document.querySelector("#profile-message");
  message.textContent = "";
  button.disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access requires a supported browser on HTTPS or localhost.");
    }
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user" },
    });
    if (!profileDialog.open) {
      stopProfileCamera();
      return;
    }
    const video = document.querySelector("#profile-camera-video");
    video.srcObject = cameraStream;
    document.querySelector("#profile-camera-panel").hidden = false;
    await video.play();
  } catch (error) {
    message.textContent = error.name === "NotAllowedError"
      ? "Allow camera access in your browser, then try again."
      : error.name === "NotFoundError"
        ? "No camera was found. Upload a photo instead."
        : error.message || "The camera could not be opened. Upload a photo instead.";
    console.error(error);
    stopProfileCamera();
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#profile-camera-capture").addEventListener("click", async () => {
  const video = document.querySelector("#profile-camera-video");
  if (!video.videoWidth || !video.videoHeight) {
    document.querySelector("#profile-message").textContent = "The camera is not ready yet. Try again in a moment.";
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  try {
    const photoBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not capture the camera image.")), "image/jpeg", 0.92);
    });
    await setCropImage(await createImageBitmap(photoBlob));
    stopProfileCamera();
  } catch (error) {
    document.querySelector("#profile-message").textContent = "The camera photo could not be prepared. Please try again.";
    console.error(error);
  }
});

document.querySelector("#profile-camera-close").addEventListener("click", stopProfileCamera);

document.querySelector("#profile-crop-zoom").addEventListener("input", event => {
  cropZoom = Number(event.currentTarget.value);
  drawProfileCrop();
});

document.querySelector("#profile-crop-cancel").addEventListener("click", () => clearStagedProfilePhoto());

const cropCanvas = document.querySelector("#profile-crop-canvas");
cropCanvas.addEventListener("pointerdown", event => {
  if (!cropBitmap) return;
  cropDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  cropCanvas.setPointerCapture(event.pointerId);
});
cropCanvas.addEventListener("pointermove", event => {
  if (!cropBitmap || cropDrag?.pointerId !== event.pointerId) return;
  const cropSize = getProfileCropSize();
  const bounds = cropCanvas.getBoundingClientRect();
  cropCenter.x -= (event.clientX - cropDrag.x) * cropSize / bounds.width;
  cropCenter.y -= (event.clientY - cropDrag.y) * cropSize / bounds.height;
  cropDrag.x = event.clientX;
  cropDrag.y = event.clientY;
  drawProfileCrop();
});
cropCanvas.addEventListener("pointerup", () => { cropDrag = null; });
cropCanvas.addEventListener("pointercancel", () => { cropDrag = null; });
cropCanvas.addEventListener("keydown", event => {
  if (!cropBitmap) return;
  const movement = getProfileCropSize() * (event.shiftKey ? 0.1 : 0.03);
  const directions = {
    ArrowLeft: [-movement, 0],
    ArrowRight: [movement, 0],
    ArrowUp: [0, -movement],
    ArrowDown: [0, movement],
  };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  cropCenter.x += direction[0];
  cropCenter.y += direction[1];
  drawProfileCrop();
});

profileDialog.addEventListener("close", () => {
  stopProfileCamera();
  clearStagedProfilePhoto();
});
profileDialog.addEventListener("cancel", event => {
  if (document.querySelector("#profile-save").disabled) event.preventDefault();
});

document.querySelector("#profile-form").addEventListener("submit", async event => {
  event.preventDefault();
  const displayName = document.querySelector("#profile-name").value.trim();
  const saveButton = document.querySelector("#profile-save");
  if (!displayName || !currentUser) return;
  saveButton.disabled = true;
  document.querySelector("#profile-cancel").disabled = true;
  saveButton.textContent = "Saving profile...";
  const profileMessage = document.querySelector("#profile-message");
  profileMessage.textContent = "";
  let photoSaveError = null;
  try {
    if (cropBitmap) {
      try {
        const dataUrl = await createProfilePhotoDataUrl();
        await set(ref(db, userPath("profilePhoto")), dataUrl);
        profilePhotoDataUrl = dataUrl;
      } catch (error) {
        photoSaveError = error;
        console.error("Profile photo save failed.", error);
      }
    }
    await updateProfile(currentUser, { displayName });
    document.querySelector("#profile-public-name").textContent = displayName;
    document.querySelector("#welcome-title").textContent = `Your day, ${displayName.split(/[ ._-]/)[0]}.`;
    document.querySelector("#account-menu-name").textContent = displayName;
    updateAccountAvatar(profilePhotoDataUrl || currentUser.photoURL);
    originalProfileName = displayName;
    profileDialog.close();
    appMessage.textContent = photoSaveError
      ? `Your name was saved, but your profile photo was not. ${profilePhotoErrorMessage(photoSaveError)}`
      : "Profile updated.";
    appMessage.classList.toggle("is-error", Boolean(photoSaveError));
  } catch (error) {
    profileMessage.textContent = photoSaveError
      ? `Your profile name could not be saved. ${profilePhotoErrorMessage(photoSaveError)}`
      : error.code
        ? `Your profile name could not be saved (${error.code}). Check your connection and try again.`
        : "Your profile name could not be saved. Check your connection and try again.";
    console.error(error);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save profile";
    document.querySelector("#profile-cancel").disabled = false;
  }
});

function profilePhotoErrorMessage(error) {
  return error?.code
    ? `Realtime Database reported ${error.code}. Check your connection and the signed-in user's database rules.`
    : "Check your connection and try again.";
}

function updateProfileSaveButton() {
  const displayName = document.querySelector("#profile-name").value.trim();
  document.querySelector("#profile-save").hidden = displayName === originalProfileName && !cropBitmap;
}

function formatAccountCreated(creationTime) {
  if (!creationTime) return "Date unavailable";
  const date = new Date(creationTime);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function setProfilePhotoPreview(photoURL) {
  const image = document.querySelector("#profile-photo-current");
  const fallback = document.querySelector("#profile-photo-fallback");
  image.onerror = () => {
    image.hidden = true;
    fallback.hidden = false;
  };
  if (!photoURL) {
    image.removeAttribute("src");
    image.hidden = true;
    fallback.hidden = false;
    return;
  }
  image.src = photoURL;
  image.hidden = false;
  fallback.hidden = true;
}

function updateAccountAvatar(photoURL) {
  const avatar = document.querySelector("#profile-avatar");
  const fallback = document.querySelector("#profile-avatar-fallback");
  if (!photoURL) {
    avatar.removeAttribute("src");
    avatar.hidden = true;
    fallback.hidden = false;
    return;
  }
  avatar.onerror = () => {
    avatar.hidden = true;
    fallback.hidden = false;
  };
  avatar.src = photoURL;
  avatar.hidden = false;
  fallback.hidden = true;
}

async function loadAccountPhoto(user) {
  try {
    const snapshot = await get(ref(db, `users/${user.uid}/profilePhoto`));
    if (currentUser?.uid !== user.uid) return;
    const photo = snapshot.val();
    profilePhotoDataUrl = typeof photo === "string" && photo.startsWith("data:image/jpeg;base64,")
      ? photo
      : "";
    updateAccountAvatar(profilePhotoDataUrl || user.photoURL);
  } catch (error) {
    if (currentUser?.uid !== user.uid) return;
    console.error("Profile photo could not be loaded.", error);
    appMessage.textContent = "Your profile picture could not be loaded. Check your connection and try again.";
    appMessage.classList.add("is-error");
  }
}

async function setCropImage(bitmap) {
  if (cropBitmap) cropBitmap.close();
  cropBitmap = bitmap;
  cropZoom = 1;
  cropCenter = { x: bitmap.width / 2, y: bitmap.height / 2 };
  document.querySelector("#profile-crop-zoom").value = "1";
  document.querySelector("#profile-crop-panel").hidden = false;
  document.querySelector("#profile-message").textContent = "";
  updateProfileSaveButton();
  drawProfileCrop();
}

function getProfileCropSize() {
  return Math.min(cropBitmap.width, cropBitmap.height) / cropZoom;
}

function drawProfileCrop() {
  if (!cropBitmap) return;
  const cropSize = getProfileCropSize();
  cropCenter.x = Math.min(Math.max(cropCenter.x, cropSize / 2), cropBitmap.width - cropSize / 2);
  cropCenter.y = Math.min(Math.max(cropCenter.y, cropSize / 2), cropBitmap.height - cropSize / 2);
  const sourceX = cropCenter.x - cropSize / 2;
  const sourceY = cropCenter.y - cropSize / 2;
  const canvas = document.querySelector("#profile-crop-canvas");
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(cropBitmap, sourceX, sourceY, cropSize, cropSize, 0, 0, canvas.width, canvas.height);
  setProfilePhotoPreview(canvas.toDataURL("image/jpeg", 0.88));
}

async function createProfilePhotoDataUrl() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const cropSize = getProfileCropSize();
  canvas.getContext("2d").drawImage(
    cropBitmap,
    cropCenter.x - cropSize / 2,
    cropCenter.y - cropSize / 2,
    cropSize,
    cropSize,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  for (const quality of [0.78, 0.64, 0.5, 0.38]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const encodedBytes = Math.ceil((dataUrl.length - "data:image/jpeg;base64,".length) * 0.75);
    if (encodedBytes <= 80 * 1024) return dataUrl;
  }
  throw new Error("The cropped profile image could not be compressed small enough.");
}

function stopProfileCamera() {
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
  document.querySelector("#profile-camera-video").srcObject = null;
  document.querySelector("#profile-camera-panel").hidden = true;
}

function clearStagedProfilePhoto() {
  if (cropBitmap) cropBitmap.close();
  cropBitmap = null;
  cropDrag = null;
  document.querySelector("#profile-crop-panel").hidden = true;
  setProfilePhotoPreview(profilePhotoDataUrl || currentUser?.photoURL || "");
  updateProfileSaveButton();
}

document.querySelector("#sign-out").addEventListener("click", () => {
  closeAccountMenu();
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
    historicalDate = null;
    yesterdayHistoryView = "history";
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
    setAccountMenuIdentity(user);
    if (user) {
      profilePhotoDataUrl = "";
      const firstName = getUserName(user).split(/[ ._-]/)[0] || "there";
      document.querySelector("#welcome-title").textContent = `Your day, ${firstName}.`;
      updateAccountAvatar(user.photoURL);
      loadAccountPhoto(user);
      renderCycle();
    } else {
      profilePhotoDataUrl = "";
      updateAccountAvatar("");
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

function setAuthLoading(isLoading, activeButton) {
  authSubmitButton.disabled = isLoading || !firebaseConfigured;
  googleSignInButton.disabled = isLoading || !firebaseConfigured;
  authModeToggle.disabled = isLoading;
  activeButton.classList.toggle("is-loading", isLoading);
  activeButton.setAttribute("aria-busy", String(isLoading));

  if (activeButton === authSubmitButton) {
    authSubmitLabel.textContent = isLoading
      ? (registerMode ? "Creating account…" : "Signing in…")
      : (registerMode ? "Create account" : "Sign in");
  } else {
    activeButton.querySelector(".auth-action-label").textContent = isLoading
      ? "Connecting to Google…"
      : "Continue with Google";
  }
}

function getUserName(user) {
  return user?.displayName?.trim() || user?.email?.split("@")[0]?.split(/[._-]/)[0] || "there";
}

function setAccountMenuIdentity(user) {
  document.querySelector("#account-menu-name").textContent = user ? getUserName(user) : "Your profile";
  document.querySelector("#account-email").textContent = user?.email ?? "";
  document.querySelector("#profile-avatar-fallback").textContent = getUserName(user).slice(0, 1).toUpperCase();
}

function dateKey(date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && dateKey(parsed) === value;
}

function isPastOrTodayDateKey(value) {
  return isValidDateKey(value) && value <= dateKey(dateFor("today"));
}

function dateFor(day) {
  if (day === "yesterday" && historicalDate) return new Date(historicalDate);
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + ({ yesterday: -1, today: 0, tomorrow: 1 }[day] ?? 0));
  return date;
}

function latestPastDate() {
  const date = dateFor("today");
  date.setDate(date.getDate() - 1);
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

async function getRecentTaskHistory(endDate) {
  const tasksRef = ref(db, userPath("tasks"));
  try {
    const snapshot = await get(query(
      tasksRef,
      orderByChild("date"),
      endAt(dateKey(endDate)),
      limitToLast(100),
    ));
    return Object.entries(snapshot.val() || {}).map(([id, entry]) => ({ id, ...entry }));
  } catch (error) {
    if (!/index not defined/i.test(error?.message || "")) throw error;
    console.warn("Missing date index for tasks; filtering this user's records locally. Publish database.rules.json to restore indexed reads.");
    const snapshot = await get(tasksRef);
    return Object.entries(snapshot.val() || {})
      .filter(([, entry]) => typeof entry?.date === "string" && entry.date <= dateKey(endDate))
      .sort(([, left], [, right]) => left.date.localeCompare(right.date))
      .slice(-100)
      .map(([id, entry]) => ({ id, ...entry }));
  }
}

async function getSleep(date) {
  const snapshot = await get(ref(db, userPath("sleep", dateKey(date))));
  return snapshot.exists() ? snapshot.val() : null;
}

async function getDailyReflection(date) {
  const snapshot = await get(ref(db, userPath("reflections", dateKey(date))));
  return snapshot.exists() ? snapshot.val()?.note || "" : "";
}

async function getSleepHistory(endDate) {
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 13);
  const snapshot = await get(query(
    ref(db, userPath("sleep")),
    orderByKey(),
    startAt(dateKey(startDate)),
    endAt(dateKey(endDate)),
  ));
  return Object.entries(snapshot.val() || {})
    .map(([date, entry]) => ({
      date,
      hours: entry?.hours === null || entry?.hours === undefined ? Number.NaN : Number(entry.hours),
    }))
    .filter(entry => Number.isFinite(entry.hours) && entry.hours >= 0 && entry.hours <= 24);
}

function sleepChart(entries, endDate) {
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 13);
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return date;
  });
  const heading = `<div class="sleep-chart-heading"><h4>Sleep over the last 14 days</h4><p>${entries.length} ${entries.length === 1 ? "night" : "nights"} logged</p></div>`;
  if (!entries.length) {
    return `<div class="sleep-chart">${heading}<p class="sleep-chart-empty">Log your sleep to see your hours over time.</p></div>`;
  }

  const width = 720;
  const height = 198;
  const left = 44;
  const right = 704;
  const top = 16;
  const bottom = 158;
  const maxHours = Math.max(12, Math.ceil(Math.max(...entries.map(entry => entry.hours)) / 2) * 2);
  const y = hours => bottom - (hours / maxHours) * (bottom - top);
  const x = index => left + (index / (days.length - 1)) * (right - left);
  const grid = [0, 1, 2, 3].map(index => {
    const hours = maxHours * index / 3;
    const position = y(hours);
    return `<line class="sleep-chart-grid" x1="${left}" y1="${position}" x2="${right}" y2="${position}" /><text class="sleep-chart-axis" x="${left - 9}" y="${position + 3}" text-anchor="end">${formatAmount(hours)}</text>`;
  }).join("");
  const labels = [0, 4, 9, 13].map(index => {
    const date = days[index];
    return `<text class="sleep-chart-axis" x="${x(index)}" y="${bottom + 22}" text-anchor="middle">${escapeHtml(new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date))}</text>`;
  }).join("");
  const points = entries.map(entry => {
    const dayIndex = days.findIndex(date => dateKey(date) === entry.date);
    if (dayIndex < 0) return "";
    const date = new Date(`${entry.date}T12:00:00`);
    const tooltip = `${formatDate(date)}: ${formatAmount(entry.hours)} hours`;
    return `<circle class="sleep-chart-point" cx="${x(dayIndex)}" cy="${y(entry.hours)}" r="6"><title>${escapeHtml(tooltip)}</title></circle>`;
  }).join("");
  return `<div class="sleep-chart">${heading}<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Scatter plot of sleep hours for the last 14 days">${grid}${labels}${points}</svg></div>`;
}

async function renderCycle() {
  stopHistoryCamera();
  if (!currentUser) return;
  const dayDate = dateFor(selectedDay);
  const dayLabel = selectedDay[0].toUpperCase() + selectedDay.slice(1);
  document.querySelector("#today-label").textContent = formatDate(new Date());
  appMessage.textContent = "";
  appMessage.classList.remove("is-error");
  cycleContent.innerHTML = `<div class="loading-state"><span class="loading-dot"></span>Gathering your Bits</div>`;

  try {
    const sleepHistoryEnd = selectedDay === "tomorrow" ? dateFor("today") : dayDate;
    const [bits, tasks, sleep, sleepHistory, dailyReflection, recentTaskHistory] = await Promise.all([
      getEntries("bits", dayDate),
      getEntries("tasks", dayDate),
      getSleep(dayDate),
      getSleepHistory(sleepHistoryEnd),
      getDailyReflection(dayDate),
      selectedDay === "yesterday" ? getRecentTaskHistory(dateFor("today")) : Promise.resolve([]),
    ]);
    const historyLabel = selectedDay === "yesterday"
      ? (dateKey(dayDate) === dateKey(latestPastDate()) ? "Yesterday" : formatDate(dayDate))
      : dayLabel;
    const completed = bits.filter(bit => Number(bit.actualAmount) >= Number(bit.plannedAmount)).length;
    const heading = selectedDay === "yesterday" ? "Notice what happened." : selectedDay === "today" ? "Make today count." : "Set up a kinder tomorrow.";
    const subheading = selectedDay === "yesterday"
      ? "Review what happened, note what you learned, and browse earlier days."
      : selectedDay === "today"
        ? "Small, measurable actions are enough."
        : "Use recent experience to choose a realistic next step.";

    cycleContent.innerHTML = `
      <div class="section-heading">
        <div><p class="eyebrow">${escapeHtml(historyLabel.toUpperCase())} / ${escapeHtml(formatDate(dayDate).toUpperCase())}</p><h2>${heading}</h2><p>${subheading}</p></div>
        <div class="day-count"><strong>${completed}<span> / </span>${bits.length}</strong><small>Bits on track</small></div>
      </div>
      ${selectedDay === "tomorrow" ? '<section id="insight-panel" class="insight-panel"><div class="insight-heading"><span class="insight-spark" aria-hidden="true">✳</span><div><p class="eyebrow">YOUR PERSONAL REVIEW</p><h3>Make sense of your last seven days.</h3><p class="insight-copy">TrackBit will share your recent Bits, tasks, and sleep log with Google Gemini only when you request an analysis.</p><button id="run-analysis" class="button button-primary btn btn-primary" type="button">Analyze my progress <span aria-hidden="true">→</span></button><p id="analysis-message" class="analysis-message" role="status" aria-live="polite"></p></div></div><div id="analysis-result"></div></section>' : ""}
      <section class="tracking-section task-section">
        <div class="list-heading"><div><p class="eyebrow">${selectedDay === "yesterday" ? "RECORDED HISTORY" : "THE REST OF YOUR DAY"}</p><h3>${selectedDay === "yesterday" ? `${escapeHtml(historyLabel)} history` : selectedDay === "tomorrow" ? "Tomorrow's tasks" : "Today's tasks"}</h3></div><span>${tasks.filter(task => task.completed).length} of ${tasks.length} done</span></div>
        ${selectedDay === "yesterday" ? yesterdayHistorySection(tasks, historyLabel, recentTaskHistory, dayDate) : `${taskForm()}<div class="task-list">${tasks.length ? tasks.map(task => taskCard(task)).join("") : '<div class="empty-state"><span class="empty-mark" aria-hidden="true">+</span><p>No tasks yet. Add one above to make it easy to find.</p></div>'}</div>`}
      </section>
      <section class="bits-section">
        <div class="list-heading"><h3>${selectedDay === "yesterday" ? `${escapeHtml(historyLabel)}'s Bits` : selectedDay === "tomorrow" ? "Tomorrow's plan" : "Today's Bits"}</h3><span>${bits.length ? `${bits.length} ${bits.length === 1 ? "action" : "actions"}` : "A clean slate"}</span></div>
        <div id="bits-list" class="bits-list">${bits.length ? bits.map(bit => bitCard(bit, selectedDay === "yesterday")).join("") : emptyState(selectedDay, historyLabel)}</div>
      </section>
      ${selectedDay === "yesterday" ? reflectionDashboard(dayDate, dailyReflection) : ""}
      <section class="tracking-section sleep-section">
        <div class="list-heading"><div><p class="eyebrow">REST IS PART OF PROGRESS</p><h3>${selectedDay === "tomorrow" ? "Plan your sleep" : `${escapeHtml(historyLabel)}'s sleep`}</h3></div>${sleep?.hours !== undefined ? `<span>${formatAmount(sleep.hours)} hours recorded</span>` : ""}</div>
        ${sleepChart(sleepHistory, sleepHistoryEnd)}
        ${sleepForm(sleep)}
      </section>
      ${selectedDay === "yesterday" ? '<button id="plan-today" class="button button-primary btn btn-primary" type="button">Carry it into today <span aria-hidden="true">→</span></button>' : addBitForm()}
    `;

    bindBitCards();
    bindAddBitForm(dayDate);
    bindTaskControls(dayDate);
    if (selectedDay === "yesterday") bindYesterdayHistory(dayDate);
    bindSleepForm(dayDate);
    if (selectedDay === "yesterday") bindReflectionDashboard(dayDate, dailyReflection);
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
  const status = actual === ""
    ? "Not recorded"
    : Number(actual) >= planned
      ? "Completed"
      : Number(actual) > 0
        ? "In progress"
        : "No progress";
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

function emptyState(day, historyLabel = "Yesterday") {
  const message = day === "yesterday"
    ? `No Bits were planned on ${escapeHtml(historyLabel)}. That's part of the picture, too.`
    : day === "tomorrow"
      ? "Your next day starts with one small intention."
      : "Nothing planned yet. Choose one small thing that matters.";
  return `<div class="empty-state"><span class="empty-mark" aria-hidden="true">+</span><p>${message}</p></div>`;
}

function reflectionDashboard(date, note) {
  const dateLabel = escapeHtml(new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(date));
  return `
    <section class="reflection-dashboard" aria-label="Daily reflection">
      <div class="reflection-dashboard-heading">
        <p class="eyebrow">MAKE SPACE TO REFLECT</p>
        <h3>Your reflection for ${dateLabel}</h3>
        <p>Write honestly about what the day felt like. Your diary note is saved privately to your account.</p>
      </div>
      <label class="sr-only" for="daily-reflection-note">Diary note for ${dateLabel}</label>
      <textarea id="daily-reflection-note" class="text-input form-control daily-reflection-note" maxlength="4000" rows="6" placeholder="What stood out today? How did you feel? What would you like to remember?">${escapeHtml(note)}</textarea>
      <div class="reflection-journal-actions">
        <button id="save-daily-reflection" class="button button-primary btn btn-primary" type="button" disabled>Save diary note</button>
        <p id="daily-reflection-status" role="status" aria-live="polite">Only send your note to the AI assistant if you choose to ask for help.</p>
      </div>
      <section class="reflection-assistant" aria-labelledby="reflection-assistant-title">
        <div class="reflection-assistant-heading">
          <p class="eyebrow">A SUPPORTIVE SOUNDING BOARD</p>
          <h4 id="reflection-assistant-title">Reflect with TrackBit AI</h4>
          <p>Ask for a gentle prompt, a fresh perspective, or help finding a small next step.</p>
        </div>
        <p class="reflection-privacy">When you submit a question, Google Gemini receives this date’s task and Bit history, the note currently in the diary box, and your conversation to help answer. Nothing is sent to Gemini until you submit; Google’s data policies apply to submitted requests.</p>
        <div id="reflection-chat-log" class="reflection-chat-log" role="log" aria-live="polite" aria-relevant="additions">
          <p class="reflection-chat-message assistant-message">I’m here to help you reflect without judgment. What would you like to explore?</p>
        </div>
        <form id="reflection-chat-form" class="reflection-chat-form">
          <label class="sr-only" for="reflection-chat-input">Message the reflection assistant</label>
          <textarea id="reflection-chat-input" class="text-input form-control" rows="2" maxlength="1200" placeholder="What would you like support with?" required></textarea>
          <button class="button button-primary btn btn-primary" type="submit">Ask assistant <span aria-hidden="true">→</span></button>
        </form>
        <p id="reflection-chat-status" class="reflection-chat-status" role="status" aria-live="polite"></p>
      </section>
    </section>`;
}

function bindReflectionDashboard(date, savedNote) {
  const noteInput = document.querySelector("#daily-reflection-note");
  const saveButton = document.querySelector("#save-daily-reflection");
  const noteStatus = document.querySelector("#daily-reflection-status");
  const dayKey = dateKey(date);
  let originalNote = savedNote;
  let conversation = [];

  noteInput.addEventListener("input", () => {
    saveButton.disabled = noteInput.value === originalNote;
    noteStatus.textContent = noteInput.value === originalNote ? "Your diary note is saved." : "You have unsaved changes.";
  });

  saveButton.addEventListener("click", async () => {
    const note = noteInput.value.trim();
    saveButton.disabled = true;
    saveButton.textContent = "Saving note...";
    noteStatus.textContent = "Saving your private diary note.";
    try {
      const noteRef = ref(db, userPath("reflections", dayKey));
      if (note) {
        await set(noteRef, { note, updatedAt: serverTimestamp() });
      } else {
        await remove(noteRef);
      }
      originalNote = note;
      noteInput.value = note;
      noteStatus.textContent = note ? "Diary note saved to your account." : "Diary note cleared.";
    } catch (error) {
      noteStatus.textContent = isDatabasePermissionError(error)
        ? "Firebase denied access to your diary note. Check the Realtime Database rules and try again."
        : "Your diary note could not be saved. Check your connection and try again.";
      console.error("Daily reflection save failed.", error);
    } finally {
      saveButton.textContent = "Save diary note";
      saveButton.disabled = noteInput.value === originalNote;
    }
  });

  document.querySelector("#reflection-chat-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements[0];
    const question = input.value.trim();
    if (!question || !currentUser) return;

    const submitButton = form.querySelector("button[type='submit']");
    const status = document.querySelector("#reflection-chat-status");
    const chatLog = document.querySelector("#reflection-chat-log");
    const messages = [...conversation, { role: "user", text: question }];
    if (messages.length > 8) messages.splice(0, messages.length - 7);
    appendReflectionMessage(chatLog, "user", question);
    input.value = "";
    submitButton.disabled = true;
    submitButton.textContent = "Thinking...";
    form.setAttribute("aria-busy", "true");
    status.textContent = "Considering your reflection...";

    try {
      const token = await currentUser.getIdToken();
      const response = await fetch("/api/reflection.php", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          date: dayKey,
          userId: currentUser.uid,
          note: noteInput.value,
          messages,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "The reflection assistant is unavailable.");
      if (typeof result?.reply !== "string" || !result.reply.trim()) {
        throw new Error("The reflection assistant returned an unreadable response. Please try again.");
      }
      conversation = [...messages, { role: "model", text: result.reply }];
      appendReflectionMessage(chatLog, "assistant", result.reply);
      status.textContent = "";
    } catch (error) {
      status.textContent = error.message || "The reflection assistant is unavailable. Try again.";
      console.error("Reflection assistant request failed.", error);
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = 'Ask assistant <span aria-hidden="true">→</span>';
      form.removeAttribute("aria-busy");
      chatLog.scrollTop = chatLog.scrollHeight;
      input.focus();
    }
  });
}

function appendReflectionMessage(chatLog, role, text) {
  const message = document.createElement("p");
  message.className = `reflection-chat-message ${role === "user" ? "user-message" : "assistant-message"}`;
  message.textContent = text;
  chatLog.append(message);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function addBitForm() {
  return `<form id="add-bit-form" class="add-bit-form"><div class="add-bit-heading"><span class="add-mark" aria-hidden="true">+</span><div><h3>Add a Bit</h3><p>Make it specific enough to measure.</p></div></div><div class="add-bit-fields"><label class="sr-only" for="bit-title">Action</label><input id="bit-title" class="text-input form-control" name="title" maxlength="80" placeholder="e.g. Study networking" required /><label class="sr-only" for="bit-target">Planned amount</label><input id="bit-target" class="text-input form-control target-input" name="plannedAmount" type="number" min="0.1" step="0.1" placeholder="30" required /><label class="sr-only" for="bit-unit">Unit</label><select id="bit-unit" class="text-input form-control unit-input" name="unit"><option>minutes</option><option>pages</option><option>reps</option><option>glasses</option><option>sessions</option><option>times</option></select><button class="button button-primary btn btn-primary" type="submit">Add Bit <span aria-hidden="true">+</span></button></div></form>`;
}

function taskCard(task, reflectionMode = false) {
  const showReflection = reflectionMode || task.completed;
  const skipped = !task.completed && task.status === "skipped";
  const completedAt = Number(task.completedAt);
  const completedTime = task.completed && Number.isFinite(completedAt) && completedAt > 0
    ? ` · ${escapeHtml(new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(completedAt)))}`
    : "";
  const taskStatus = task.completed ? `Done${completedTime}` : skipped ? "Skipped" : "Not completed";
  const reminderStatus = task.reminderSentAt
    ? "Reminder sent"
    : task.reminderSkippedAt
      ? "Reminder unavailable"
      : task.completed
        ? "Due"
        : "Email reminder";
  const reminder = task.dueAt !== null && task.dueAt !== undefined && Number.isFinite(Number(task.dueAt))
    ? `<small class="task-due">${reminderStatus} · ${escapeHtml(formatReminderTime(task.dueAt, task.dueTimeZone))}</small>`
    : "";
  return `
    <article class="task-row ${reflectionMode ? "task-row-history" : ""} ${task.completed ? "task-row-complete" : ""} ${skipped ? "task-row-skipped" : ""}" data-task-id="${escapeHtml(task.id)}">
      <div class="task-row-main">
        <label class="task-check">
          <input class="task-toggle" type="checkbox" ${task.completed ? "checked" : ""} aria-label="Mark ${escapeHtml(task.title)} ${task.completed ? "not done" : "done"}" />
          <span class="task-title ${task.completed ? "is-complete" : ""}">${escapeHtml(task.title)}</span>
        </label>
        ${reflectionMode ? `<span class="task-history-status">${escapeHtml(taskStatus)}</span><button class="task-skip ${skipped ? "is-active" : ""}" type="button" aria-pressed="${skipped}" aria-label="${skipped ? "Mark task not skipped" : "Mark task skipped"}" title="${skipped ? "Mark not skipped" : "Mark skipped"}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg></button>` : ""}
        <button class="icon-button delete-task btn btn-outline-danger" type="button" aria-label="Delete ${escapeHtml(task.title)}" title="Delete task">×</button>
      </div>
      ${task.description ? `<p class="task-description">${escapeHtml(task.description)}</p>` : ""}
      ${reminder}
      ${showReflection ? `<div class="task-reflection"><label class="sr-only" for="task-reflection-${escapeHtml(task.id)}">Reflection for ${escapeHtml(task.title)}</label><textarea id="task-reflection-${escapeHtml(task.id)}" class="text-input form-control task-reflection-input" rows="2" maxlength="500" placeholder="What helped or got in the way? What did you learn?">${escapeHtml(task.reflection || "")}</textarea><button class="button button-small save-task-reflection btn btn-warning" type="button">Save reflection</button></div>` : ""}
    </article>`;
}

function yesterdayHistorySection(tasks, historyLabel, recentTasks, dayDate) {
  const activeDate = yesterdayHistoryView.startsWith("date:")
    ? yesterdayHistoryView.slice(5)
    : null;
  const addingHistory = yesterdayHistoryView === "add";
  const taskDates = [...new Set([
    ...recentTasks.map(task => task.date).filter(isValidDateKey),
    ...(isValidDateKey(activeDate) ? [activeDate] : []),
    dateKey(dayDate),
    dateKey(latestPastDate()),
    dateKey(dateFor("today")),
  ])].sort((left, right) => right.localeCompare(left));
  const tasksByDate = new Map();
  for (const task of recentTasks) {
    if (!tasksByDate.has(task.date)) tasksByDate.set(task.date, []);
    tasksByDate.get(task.date).push(task);
  }
  tasksByDate.set(dateKey(dayDate), tasks);

  const historyOverview = taskDates.map(date => {
    const dateTasks = tasksByDate.get(date) || [];
    const completed = dateTasks.filter(task => task.completed).length;
    const label = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })
      .format(new Date(`${date}T12:00:00`));
    return `<button class="history-day-card" type="button" data-history-date="${date}"><span><strong>${escapeHtml(label)} History</strong><small>${dateTasks.length} ${dateTasks.length === 1 ? "task" : "tasks"} · ${completed} done</small></span><span class="history-day-arrow" aria-hidden="true">→</span></button>`;
  }).join("");
  const activeTasks = activeDate ? tasksByDate.get(activeDate) || [] : tasks;
  const browseDate = `<label class="history-date-control" for="history-date"><span>Browse a date</span><input id="history-date" class="text-input form-control" type="date" max="${dateKey(dateFor("today"))}" value="${dateKey(dayDate)}" /></label>`;

  let panelContent;
  let panelLabel = "history-tab";
  if (addingHistory) {
    panelLabel = "add-history-tab";
    panelContent = `<form id="add-history-form" class="history-entry-card">
      <div class="history-entry-heading"><span class="history-entry-mark" aria-hidden="true">+</span><div><h4>Add to ${escapeHtml(historyLabel)} history</h4><p>Record a task you worked on that day.</p></div></div>
      <div class="history-scan-actions"><button id="history-scan-open" class="button button-quiet btn btn-outline-secondary" type="button"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3l1.5-2h7L17 7h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></svg> Scan with camera</button><span>Scan a note to prefill these fields. OCR can make mistakes, so review before saving.</span></div>
      <div id="history-camera-panel" class="history-camera-panel" hidden><video id="history-camera-video" autoplay playsinline muted aria-label="Camera preview"></video><div><button id="history-camera-capture" class="button button-primary btn btn-primary" type="button">Capture and scan</button><button id="history-camera-close" class="button button-quiet btn btn-outline-secondary" type="button">Close camera</button></div></div>
      <p id="history-scan-message" class="history-scan-message" role="status" aria-live="polite"></p>
      <label class="history-field-label" for="history-task-date">Date</label>
      <input id="history-task-date" class="text-input form-control" name="date" type="date" max="${dateKey(dateFor("today"))}" value="${dateKey(dayDate)}" required />
      <label class="history-field-label" for="history-task-title">Task title</label>
      <input id="history-task-title" class="text-input form-control" name="title" maxlength="120" placeholder="What did you work on?" required />
      <label class="history-field-label" for="history-task-description">Description <span>optional</span></label>
      <textarea id="history-task-description" class="text-input form-control" name="description" maxlength="1000" rows="3" placeholder="Add a few details about what you did"></textarea>
      <div class="history-entry-status">
        <label class="history-done-option"><input id="history-task-done" type="checkbox" name="completed" /><span>I completed this task</span></label>
        <button id="history-task-skipped" class="task-skip history-skip-option" type="button" aria-pressed="false"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg><span>Mark as skipped</span></button>
      </div>
      <p id="history-form-message" class="task-form-message" role="status" aria-live="polite"></p>
      <div class="history-entry-actions"><button class="button button-quiet btn btn-outline-secondary" type="button" data-history-cancel>Cancel</button><button class="button button-primary btn btn-primary" type="submit"><span class="history-submit-label">Save history</span></button></div>
    </form>`;
  } else if (activeDate) {
    const activeLabel = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" })
      .format(new Date(`${activeDate}T12:00:00`));
    panelContent = `<div class="history-detail-toolbar"><div class="history-detail-heading"><button class="history-back-button" type="button" data-history-back><span aria-hidden="true">←</span> All history</button><h4>${escapeHtml(activeLabel)}</h4></div>${browseDate}</div><div class="task-list">${activeTasks.length ? activeTasks.map(task => taskCard(task, true)).join("") : `<div class="empty-state"><span class="empty-mark" aria-hidden="true">+</span><p>No history recorded for ${escapeHtml(historyLabel)} yet. Add an entry when you're ready.</p></div>`}</div>`;
  } else {
    panelContent = `<div class="history-overview-toolbar"><div><h4>History by date</h4><p>Choose a day to review your tasks.</p></div>${browseDate}</div><div class="history-day-list">${historyOverview}</div>`;
  }

  return `
    <div id="history-tabs" class="history-tabs" role="tablist" aria-label="Task history by date">
      <button id="history-tab" class="history-tab ${!addingHistory ? "is-active" : ""}" type="button" role="tab" aria-selected="${!addingHistory}" aria-controls="history-panel">History</button>
      <button id="add-history-tab" class="history-tab history-add-tab ${addingHistory ? "is-active" : ""}" type="button" role="tab" aria-selected="${addingHistory}" aria-controls="history-panel"><span aria-hidden="true">+</span> Add History</button>
    </div>
    <section id="history-panel" class="history-panel" role="tabpanel" aria-labelledby="${panelLabel}">${panelContent}</section>`;
}

function bindYesterdayHistory(dayDate) {
  document.querySelector("#history-tab").addEventListener("click", () => {
    stopHistoryCamera();
    yesterdayHistoryView = "history";
    renderCycle();
  });
  document.querySelector("#history-panel").querySelectorAll(".history-day-card").forEach(button => {
    button.addEventListener("click", () => {
      historicalDate = new Date(`${button.dataset.historyDate}T12:00:00`);
      yesterdayHistoryView = `date:${button.dataset.historyDate}`;
      renderCycle();
    });
  });
  document.querySelector("#history-panel").querySelector("[data-history-back]")?.addEventListener("click", () => {
    yesterdayHistoryView = "history";
    renderCycle();
  });
  document.querySelector("#history-date")?.addEventListener("change", event => {
    if (!event.currentTarget.value) return;
    historicalDate = new Date(`${event.currentTarget.value}T12:00:00`);
    yesterdayHistoryView = `date:${dateKey(historicalDate)}`;
    renderCycle();
  });
  document.querySelector("#add-history-tab").addEventListener("click", () => {
    stopHistoryCamera();
    yesterdayHistoryView = "add";
    renderCycle();
  });

  const form = document.querySelector("#add-history-form");
  if (!form) return;
  const completedInput = form.elements.completed;
  const skippedButton = document.querySelector("#history-task-skipped");
  completedInput.addEventListener("change", () => {
    if (completedInput.checked) {
      skippedButton.setAttribute("aria-pressed", "false");
      skippedButton.classList.remove("is-active");
      skippedButton.querySelector("span").textContent = "Mark as skipped";
    }
  });
  skippedButton.addEventListener("click", () => {
    const markingSkipped = skippedButton.getAttribute("aria-pressed") !== "true";
    skippedButton.setAttribute("aria-pressed", String(markingSkipped));
    skippedButton.classList.toggle("is-active", markingSkipped);
    skippedButton.querySelector("span").textContent = markingSkipped ? "Marked skipped" : "Mark as skipped";
    if (markingSkipped) completedInput.checked = false;
  });
  form.elements.date.addEventListener("change", () => form.elements.date.setCustomValidity(""));
  form.querySelector("[data-history-cancel]").addEventListener("click", () => {
    stopHistoryCamera();
    yesterdayHistoryView = `date:${dateKey(dayDate)}`;
    renderCycle();
  });
  bindHistoryCamera(form);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const title = form.elements.title.value.trim();
    if (!title) {
      form.elements.title.setCustomValidity("Enter a task title.");
      form.elements.title.reportValidity();
      return;
    }
    form.elements.title.setCustomValidity("");
    const entryDate = form.elements.date.value;
    if (!isPastOrTodayDateKey(entryDate)) {
      form.elements.date.setCustomValidity("Choose a real date that is today or earlier.");
      form.elements.date.reportValidity();
      return;
    }
    form.elements.date.setCustomValidity("");
    const completed = completedInput.checked;
    const skipped = skippedButton.getAttribute("aria-pressed") === "true";
    const submitButton = form.querySelector("button[type='submit']");
    const submitLabel = form.querySelector(".history-submit-label");
    const message = document.querySelector("#history-form-message");
    submitButton.disabled = true;
    submitLabel.textContent = "Saving...";
    message.textContent = "Saving this history entry.";

    try {
      const entry = {
        title,
        description: form.elements.description.value.trim(),
        date: entryDate,
        completed,
        status: completed ? "completed" : skipped ? "skipped" : "pending",
        createdAt: serverTimestamp(),
      };
      if (completed) entry.completedAt = serverTimestamp();
      await set(push(ref(db, userPath("tasks"))), entry);
      historicalDate = new Date(`${entry.date}T12:00:00`);
      yesterdayHistoryView = `date:${entry.date}`;
      await renderCycle();
    } catch (error) {
      message.textContent = isDatabasePermissionError(error)
        ? "Firebase denied this history entry. Check the Realtime Database rules and try again."
        : "This history entry could not be saved. Check your connection and try again.";
      console.error("Yesterday history save failed.", error);
    } finally {
      submitButton.disabled = false;
      submitLabel.textContent = "Save history";
    }
  });
}

function stopHistoryCamera() {
  historyCameraStream?.getTracks().forEach(track => track.stop());
  historyCameraStream = null;
  const video = document.querySelector("#history-camera-video");
  if (video) video.srcObject = null;
  const panel = document.querySelector("#history-camera-panel");
  if (panel) panel.hidden = true;
}

function parseScannedHistory(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const monthPattern = "(January|February|March|April|May|June|July|August|September|October|November|December)";
  const dateExpressions = [
    new RegExp(`\\b${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "i"),
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthPattern}(?:,?\\s+(\\d{4}))?\\b`, "i"),
    /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/,
  ];
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  let scannedDate = "";
  let dateLineIndex = -1;
  let invalidDate = false;

  for (const [index, line] of lines.entries()) {
    for (const expression of dateExpressions) {
      const match = line.match(expression);
      if (!match) continue;
      let year;
      let month;
      let day;
      if (expression === dateExpressions[0]) {
        month = months.indexOf(match[1].toLowerCase()) + 1;
        day = Number(match[2]);
        year = Number(match[3] || dateFor("today").getFullYear());
      } else if (expression === dateExpressions[1]) {
        day = Number(match[1]);
        month = months.indexOf(match[2].toLowerCase()) + 1;
        year = Number(match[3] || dateFor("today").getFullYear());
      } else {
        year = Number(match[1]);
        month = Number(match[2]);
        day = Number(match[3]);
      }
      const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      dateLineIndex = index;
      if (isValidDateKey(candidate)) scannedDate = candidate;
      else invalidDate = true;
      break;
    }
    if (dateLineIndex === index) break;
  }

  const normalizedText = lines.join("\n");
  const skipped = /\b(skipped|skip|not done)\b|[☒✗✘]/i.test(normalizedText);
  const completed = !skipped && !/\bnot\s+(?:done|complete(?:d)?)\b/i.test(normalizedText)
    && (/\b(done|completed|complete|checked)\b/i.test(normalizedText) || /[✓✔☑]/.test(normalizedText));
  const titleLine = lines.find(line => /^title\s*:/i.test(line));
  const descriptionLine = lines.findIndex(line => /^description\s*:/i.test(line));
  const statusLine = lines.findIndex(line => /^status\s*:/i.test(line));
  const contentLines = lines.filter((line, index) =>
    index !== dateLineIndex &&
    !/^date\s*:/i.test(line) &&
    !/^status\s*:/i.test(line) &&
    !/^title\s*:/i.test(line) &&
    !/^description\s*:/i.test(line) &&
    !/^(done|completed|complete|checked|skipped|skip|not done|✓|✔|☑|☒|✗|✘)$/i.test(line)
  );
  const title = titleLine
    ? titleLine.replace(/^title\s*:/i, "").trim()
    : contentLines.shift() || "";
  const description = descriptionLine >= 0
    ? lines.slice(descriptionLine).filter((line, index) => descriptionLine + index !== dateLineIndex && descriptionLine + index !== statusLine)
      .join("\n").replace(/^description\s*:/i, "").trim()
    : contentLines.join("\n");

  return { date: scannedDate, title, description, completed, skipped, invalidDate };
}

function bindHistoryCamera(form) {
  const openButton = document.querySelector("#history-scan-open");
  const captureButton = document.querySelector("#history-camera-capture");
  const closeButton = document.querySelector("#history-camera-close");
  const panel = document.querySelector("#history-camera-panel");
  const video = document.querySelector("#history-camera-video");
  const message = document.querySelector("#history-scan-message");

  openButton.addEventListener("click", async () => {
    message.textContent = "";
    if (!navigator.mediaDevices?.getUserMedia) {
      message.textContent = "Camera access is unavailable. Open TrackBit over HTTPS in a browser that supports camera access.";
      return;
    }
    try {
      stopHistoryCamera();
      historyCameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      video.srcObject = historyCameraStream;
      panel.hidden = false;
      await video.play();
    } catch (error) {
      stopHistoryCamera();
      message.textContent = error.name === "NotAllowedError"
        ? "Camera permission was blocked. Allow camera access in your browser settings, then try again."
        : error.name === "NotFoundError"
          ? "No camera was found on this device."
          : "The camera could not be opened. Check browser permissions and try again.";
      console.error("History camera could not be opened.", error);
    }
  });

  closeButton.addEventListener("click", () => {
    stopHistoryCamera();
    message.textContent = "";
  });

  captureButton.addEventListener("click", async () => {
    if (!video.videoWidth || !video.videoHeight) {
      message.textContent = "The camera is not ready. Wait a moment and try again.";
      return;
    }
    const scale = Math.min(1, 1600 / video.videoWidth, 1600 / video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      stopHistoryCamera();
      message.textContent = "The camera image could not be prepared in this browser.";
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.86));
    stopHistoryCamera();
    if (!image) {
      message.textContent = "The camera image could not be prepared. Try capturing it again.";
      return;
    }

    captureButton.disabled = true;
    captureButton.textContent = "Scanning...";
    message.textContent = "Reading the note on this device. This may take a moment.";
    let worker;
    try {
      const { createWorker } = await import("https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/tesseract.esm.min.js");
      worker = await createWorker("eng");
      const { data } = await worker.recognize(image);
      const result = parseScannedHistory(data.text);
      if (result.title) form.elements.title.value = result.title.slice(0, 120);
      form.elements.description.value = result.description.slice(0, 1000);
      const dateInput = form.elements.date;
      if (result.date) {
        dateInput.value = isPastOrTodayDateKey(result.date) ? result.date : "";
      } else if (result.invalidDate) {
        dateInput.value = "";
      }
      form.elements.completed.checked = result.completed;
      const scannedSkipButton = document.querySelector("#history-task-skipped");
      scannedSkipButton.setAttribute("aria-pressed", String(result.skipped));
      scannedSkipButton.classList.toggle("is-active", result.skipped);
      scannedSkipButton.querySelector("span").textContent = result.skipped ? "Marked skipped" : "Mark as skipped";
      const dateMessage = result.date && !isPastOrTodayDateKey(result.date)
        ? " The scanned date is in the future; choose a date no later than today."
        : result.invalidDate
          ? " The scanned date is not valid; choose the correct date manually."
          : !result.date
            ? " No date was recognized; verify the selected date."
            : "";
      message.textContent = `Scan complete. Review and correct every field before saving.${dateMessage}`;
    } catch (error) {
      message.textContent = "The note could not be scanned. Check your connection and camera image, then try again or enter the details manually.";
      console.error("History note OCR failed.", error);
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch (error) {
          console.error("History OCR worker could not be stopped.", error);
        }
      }
      captureButton.disabled = false;
      captureButton.textContent = "Capture and scan";
    }
  });
}

function taskForm() {
  const reviewingHistory = selectedDay === "yesterday";
  const taskPlaceholder = reviewingHistory ? "Add a task you worked on" : "What do you want to get done?";
  const submitLabel = reviewingHistory ? "Add to history" : "Add task";
  return `<div class="task-entry"><form id="add-task-form" class="task-form ${reviewingHistory ? "task-form-history" : ""}"><label class="sr-only" for="task-title">New task</label><input id="task-title" class="text-input form-control" name="title" maxlength="120" placeholder="${taskPlaceholder}" required />${reviewingHistory ? "" : `<label class="task-due-field" for="task-due-at"><span>Email reminder (optional)</span><input id="task-due-at" class="text-input form-control" name="dueAt" type="datetime-local" min="${localDateTimeValue()}" /><small>Sent to your account email if the task is still incomplete.</small></label>`}<button class="button button-primary btn btn-primary" type="submit"><span class="task-submit-label"><span aria-hidden="true">+</span> ${submitLabel}</span></button></form><p id="task-form-message" class="task-form-message" role="status" aria-live="polite"></p></div>`;
}

function localDateTimeValue(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatReminderTime(timestamp, timeZone) {
  const options = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  };
  try {
    return new Intl.DateTimeFormat(undefined, options).format(new Date(Number(timestamp)));
  } catch (error) {
    console.warn("Invalid task reminder time zone; showing the browser's local time.", error);
    delete options.timeZone;
    return new Intl.DateTimeFormat(undefined, options).format(new Date(Number(timestamp)));
  }
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
  if (form) {
    const input = form.elements.title;
    const dueInput = form.elements.dueAt;
    const submitButton = form.querySelector("button[type='submit']");
    const submitLabel = submitButton.querySelector(".task-submit-label");
    const formMessage = document.querySelector("#task-form-message");
    dueInput.addEventListener("input", () => dueInput.setCustomValidity(""));
    form.addEventListener("submit", async event => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) {
      input.setCustomValidity("Enter a task name.");
      input.reportValidity();
      return;
    }
    input.setCustomValidity("");
    const dueAt = dueInput?.value ? new Date(dueInput.value).getTime() : null;
    if (dueInput?.value && (!Number.isFinite(dueAt) || dueAt <= Date.now())) {
      dueInput.setCustomValidity("Choose a future date and time for the reminder.");
      dueInput.reportValidity();
      return;
    }
    dueInput?.setCustomValidity("");
    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");
    submitLabel.textContent = "Adding task...";
    formMessage.textContent = "Saving your task.";
    try {
      const task = {
        title,
        date: dateKey(dueAt === null ? dayDate : new Date(dueAt)),
        completed: false,
        status: "pending",
        createdAt: serverTimestamp(),
      };
      if (dueAt !== null) {
        task.dueAt = dueAt;
        task.dueTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      }
      await set(push(ref(db, userPath("tasks"))), task);
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
  }

  cycleContent.querySelectorAll(".task-row").forEach(row => {
    const taskRef = ref(db, userPath("tasks", row.dataset.taskId));
    row.querySelector(".task-toggle").addEventListener("change", async event => {
      try {
        await update(taskRef, {
          completed: event.target.checked,
          status: event.target.checked ? "completed" : "pending",
          completedAt: event.target.checked ? serverTimestamp() : null,
        });
        renderCycle();
      } catch (error) {
        appMessage.textContent = "Task progress could not be updated. Try again.";
        console.error(error);
      }
    });
    row.querySelector(".task-skip")?.addEventListener("click", async event => {
      const skipButton = event.currentTarget;
      skipButton.disabled = true;
      try {
        const markingSkipped = skipButton.getAttribute("aria-pressed") !== "true";
        await update(taskRef, {
          completed: false,
          status: markingSkipped ? "skipped" : "pending",
          completedAt: null,
        });
        renderCycle();
      } catch (error) {
        appMessage.textContent = "The task status could not be updated. Try again.";
        console.error(error);
      } finally {
        skipButton.disabled = false;
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