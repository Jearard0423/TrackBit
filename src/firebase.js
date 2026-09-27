import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-analytics.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";
import { firebaseConfig, firebaseConfigured } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
auth.languageCode = "it";
export const provider = new GoogleAuthProvider();
export const db = getDatabase(app);
export const analyticsReady = isSupported()
	.then(supported => supported ? getAnalytics(app) : null)
	.catch(() => null);
export { firebaseConfigured };