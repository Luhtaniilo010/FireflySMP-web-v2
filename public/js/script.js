const SERVER_IP = "fireflysmp.net";
const STATUS_ADDRESS = "fireflysmp.net:25677";
const STATUS_API = `https://api.mcstatus.io/v2/status/java/${STATUS_ADDRESS}?query=false&timeout=5`;

const copyServer = document.getElementById("copyServer");
copyServer?.addEventListener("click", async () => {
  await copyText(SERVER_IP);
  copyServer.classList.add("copied");
  setTimeout(() => copyServer.classList.remove("copied"), 1500);
});

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = value;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }
}

const playerBox = document.getElementById("playerBox");
const playerCount = document.getElementById("playerCount");
const playerStatusLabel = document.getElementById("playerStatusLabel");

async function updatePlayerCount() {
  if (!playerBox || !playerCount || !playerStatusLabel) return;
  playerBox.classList.remove("offline", "error");
  playerBox.classList.add("loading");
  playerCount.textContent = "...";
  playerStatusLabel.textContent = "CHECKING";

  try {
    const response = await fetch(STATUS_API, { cache: "no-store" });
    if (!response.ok) throw new Error(`Status API returned ${response.status}`);
    const data = await response.json();

    playerBox.classList.remove("loading");

    if (data.online && data.players) {
      playerCount.textContent = String(data.players.online ?? 0);
      playerStatusLabel.textContent = "ONLINE";
    } else {
      playerBox.classList.add("offline");
      playerCount.textContent = "0";
      playerStatusLabel.textContent = "OFFLINE";
    }
  } catch (error) {
    playerBox.classList.remove("loading");
    playerBox.classList.add("error");
    playerCount.textContent = "—";
    playerStatusLabel.textContent = "STATUS";
  }
}

updatePlayerCount();
setInterval(updatePlayerCount, 60_000);
window.FireflyAuth = {
  user: null,
  has(permission) {
    if (!this.user?.staff) return false;
    if (this.user.role === "Owner") return true;
    return Array.isArray(this.user.permissions) && this.user.permissions.includes(permission);
  }
};

const signInButton = document.getElementById("signInButton");
const signInHead = document.getElementById("signInHead");
const signInText = document.getElementById("signInText");

function getHeadUrl(username, size = 64) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(username)}/${size}`;
}

function ensureSignInModal() {
  let overlay = document.getElementById("signinOverlay");
  if (overlay) {
    const form = overlay.querySelector("#signinForm");
    if (form && !overlay.querySelector("#staffPinWrap")) {
      const error = overlay.querySelector("#signinError");
      const wrap = document.createElement("label");
      wrap.className = "staff-pin-wrap";
      wrap.id = "staffPinWrap";
      wrap.innerHTML = `
        <div class="staff-pin-head">
          <div class="staff-pin-lock">
            <span class="staff-pin-lock-top"></span>
            <span class="staff-pin-lock-body"></span>
          </div>
          <div>
            <strong>STAFF VERIFICATION</strong>
            <small>Staff account detected.</small>
          </div>
        </div>
        <label class="staff-pin-field">
          <span>8-DIGIT SECURITY PIN</span>
          <div class="staff-pin-input-shell">
            <input id="staffPin" type="password" inputmode="numeric" maxlength="8"
              pattern="[0-9]{8}" autocomplete="one-time-code" placeholder="••••••••">
            <span class="staff-pin-digits">8 DIGITS</span>
          </div>
        </label>
      `;
      error?.before(wrap);
    }
    return overlay;
  }

  overlay = document.createElement("div");
  overlay.className = "signin-overlay";
  overlay.id = "signinOverlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="signin-modal" role="dialog" aria-modal="true">
      <button class="signin-close" id="signinClose" type="button">×</button>
      <div class="signin-modal-icon"><span class="signin-cube-face"></span></div>
      <span class="signin-kicker">FIREFLYSMP ACCOUNT</span>
      <h2>Sign in</h2>
      <p>Enter your Minecraft username. Staff accounts are protected by an 8-digit PIN.</p>
      <form class="signin-form" id="signinForm">
        <label for="minecraftUsername">MINECRAFT USERNAME</label>
        <div class="signin-input-wrap">
          <input id="minecraftUsername" minlength="3" maxlength="16"
            pattern="[A-Za-z0-9_]{3,16}" placeholder="YourUsername" required>
          <div class="signin-preview" id="signinPreview"><span class="preview-placeholder"></span></div>
        </div>
        <div class="staff-pin-wrap" id="staffPinWrap">
          <div class="staff-pin-head">
            <div class="staff-pin-lock">
              <span class="staff-pin-lock-top"></span>
              <span class="staff-pin-lock-body"></span>
            </div>
            <div>
              <strong>STAFF VERIFICATION</strong>
              <small>Staff account detected.</small>
            </div>
          </div>

          <label class="staff-pin-field">
            <span>8-DIGIT SECURITY PIN</span>
            <div class="staff-pin-input-shell">
              <input id="staffPin" type="password" inputmode="numeric" maxlength="8"
                pattern="[0-9]{8}" autocomplete="one-time-code" placeholder="••••••••">
              <span class="staff-pin-digits">8 DIGITS</span>
            </div>
          </label>
        </div>
        <span class="signin-error" id="signinError"></span>
        <button class="signin-submit" id="signinSubmit" type="submit">CONTINUE</button>
      </form>
      <button class="signin-signout" id="signinSignout" type="button">SIGN OUT</button>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

const signinOverlay = ensureSignInModal();
const signinClose = signinOverlay.querySelector("#signinClose");
const signinForm = signinOverlay.querySelector("#signinForm");
const minecraftUsername = signinOverlay.querySelector("#minecraftUsername");
const signinPreview = signinOverlay.querySelector("#signinPreview");
const signinError = signinOverlay.querySelector("#signinError");
const signinSubmit = signinOverlay.querySelector("#signinSubmit");
const signinSignout = signinOverlay.querySelector("#signinSignout");
const staffPinWrap = signinOverlay.querySelector("#staffPinWrap");
const staffPin = signinOverlay.querySelector("#staffPin");

let staffCheckTimer = null;
let staffPinRequired = false;

function setPinRequired(required, role = "") {
  staffPinRequired = !!required;
  staffPinWrap?.classList.toggle("visible", staffPinRequired);

  if (staffPin) {
    staffPin.required = staffPinRequired;
    if (!staffPinRequired) staffPin.value = "";
  }

  const small = staffPinWrap?.querySelector(".staff-pin-head small");
  if (small) small.textContent = role ? `${role} account detected.` : "Staff account detected.";
}

async function checkStaffUsername(username) {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    setPinRequired(false);
    return;
  }

  try {
    const response = await fetch(`/api/auth/staff-check?username=${encodeURIComponent(username)}`, {
      cache: "no-store"
    });
    const data = await response.json();
    setPinRequired(!!data.requiresPin, data.role || "");
  } catch {
    setPinRequired(false);
  }
}

function setSignedInState(user) {
  if (!user || !signInButton || !signInHead || !signInText) return;

  signInButton.classList.add("signed-in");
  signInHead.innerHTML = `<img class="player-head-image" src="${getHeadUrl(user.username, 64)}" alt="" draggable="false">`;
  signInText.textContent = user.username;
  signinSignout?.classList.add("visible");

  updateControlButton(user);
  document.dispatchEvent(new CustomEvent("firefly-auth-changed", { detail: user }));
}

function setSignedOutState() {
  if (signInButton && signInHead && signInText) {
    signInButton.classList.remove("signed-in");
    signInHead.innerHTML = `<span class="default-player-head"></span>`;
    signInText.textContent = "SIGN IN";
  }

  signinSignout?.classList.remove("visible");
  document.getElementById("staffControlButton")?.remove();
  document.dispatchEvent(new CustomEvent("firefly-auth-changed", { detail: null }));
}

function updateControlButton(user) {
  document.getElementById("staffControlButton")?.remove();

  const canOpen =
    user?.staff &&
    (
      user.role === "Owner" ||
      user.permissions?.includes("access_control") ||
      user.permissions?.includes("edit_staff") ||
      user.permissions?.includes("manage_access")
    );

  if (!canOpen || !signInButton?.parentElement) return;

  const control = document.createElement("a");
  control.id = "staffControlButton";
  control.className = "header-button staff-control-button";
  control.href = "/control";
  control.textContent = "CONTROL";
  signInButton.parentElement.insertBefore(control, signInButton);
}

function openSignIn() {
  signinError.textContent = "";
  staffPin.value = "";
  setPinRequired(false);

  if (window.FireflyAuth.user) {
    minecraftUsername.value = window.FireflyAuth.user.username;
    signinPreview.innerHTML = `<img src="${getHeadUrl(window.FireflyAuth.user.username, 84)}" alt="">`;
    signinSubmit.style.display = "none";
    signinSignout.classList.add("visible");
  } else {
    minecraftUsername.value = "";
    signinPreview.innerHTML = `<span class="preview-placeholder"></span>`;
    signinSubmit.style.display = "";
    signinSignout.classList.remove("visible");
  }

  signinOverlay.classList.add("open");
  signinOverlay.setAttribute("aria-hidden", "false");
  setTimeout(() => minecraftUsername.focus(), 50);
}

function closeSignIn() {
  signinOverlay.classList.remove("open");
  signinOverlay.setAttribute("aria-hidden", "true");
  signinError.textContent = "";
}

signInButton?.addEventListener("click", openSignIn);
signinClose?.addEventListener("click", closeSignIn);

signinOverlay.addEventListener("click", event => {
  if (event.target === signinOverlay) closeSignIn();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && signinOverlay.classList.contains("open")) closeSignIn();
});

minecraftUsername.addEventListener("input", () => {
  const username = minecraftUsername.value.trim();

  signinError.textContent = "";

  clearTimeout(staffCheckTimer);
  staffCheckTimer = setTimeout(() => checkStaffUsername(username), 250);

  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    signinPreview.innerHTML = `<span class="preview-placeholder"></span>`;
    return;
  }

  signinPreview.innerHTML = `<img src="${getHeadUrl(username, 84)}" alt="">`;
});

staffPin.addEventListener("input", () => {
  staffPin.value = staffPin.value.replace(/\D/g, "").slice(0, 8);
});

signinForm.addEventListener("submit", async event => {
  event.preventDefault();

  const username = minecraftUsername.value.trim();
  signinError.textContent = "";

  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    signinError.textContent = "Enter a valid Minecraft username.";
    return;
  }

  await checkStaffUsername(username);

  if (staffPinRequired && !/^\d{8}$/.test(staffPin.value)) {
    signinError.textContent = "Enter your 8-digit staff PIN.";
    staffPin.focus();
    return;
  }

  signinSubmit.disabled = true;
  signinSubmit.textContent = "SIGNING IN...";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        pin: staffPinRequired ? staffPin.value : ""
      })
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.requiresPin) setPinRequired(true);
      throw new Error(data.error || "Sign in failed.");
    }

    window.FireflyAuth.user = data.user;
    setSignedInState(data.user);
    closeSignIn();
  } catch (error) {
    signinError.textContent = error.message;
  } finally {
    signinSubmit.disabled = false;
    signinSubmit.textContent = "CONTINUE";
  }
});

signinSignout.addEventListener("click", async () => {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
  } finally {
    window.FireflyAuth.user = null;
    setSignedOutState();
    closeSignIn();
  }
});

async function loadCurrentUser() {
  try {
    const response = await fetch("/api/auth/me", {
      credentials: "same-origin",
      cache: "no-store"
    });
    const data = await response.json();
    window.FireflyAuth.user = data.user || null;

    if (data.user) setSignedInState(data.user);
    else setSignedOutState();
  } catch {
    window.FireflyAuth.user = null;
    setSignedOutState();
  }
}

window.FireflyAuth.ready = loadCurrentUser();

document.getElementById("footerCopyIp")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const original = button.textContent;
  await copyText("fireflysmp.net");
  button.textContent = "COPIED!";
  setTimeout(() => button.textContent = original, 1200);
});

document.getElementById("footerCopyIpV3")?.addEventListener("click", async (event) => {
  const el = event.currentTarget;
  const old = el.innerHTML;
  try { await navigator.clipboard.writeText("fireflysmp.net"); } catch {}
  el.textContent = "COPIED!";
  setTimeout(() => el.innerHTML = old, 1100);
});

(() => {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;

  const update = () => topbar.classList.toggle("scrolled", window.scrollY > 12);
  update();
  window.addEventListener("scroll", update, { passive: true });
})();

document.querySelectorAll(".global-footer-ip").forEach(button => {
  button.addEventListener("click", async () => {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText("fireflysmp.net");
    } catch {}
    button.textContent = "COPIED!";
    setTimeout(() => button.textContent = original, 1100);
  });
});

document.querySelectorAll(".footer-v8-ip").forEach(button => {
  button.addEventListener("click", async () => {
    const strong = button.querySelector("strong");
    const small = button.querySelector("small");
    const oldStrong = strong?.textContent || "fireflysmp.net";
    const oldSmall = small?.textContent || "CLICK TO COPY";

    try {
      await navigator.clipboard.writeText("fireflysmp.net");
    } catch {}

    if (strong) strong.textContent = "COPIED!";
    if (small) small.textContent = "READY TO PASTE";

    setTimeout(() => {
      if (strong) strong.textContent = oldStrong;
      if (small) small.textContent = oldSmall;
    }, 1200);
  });
});

document.querySelectorAll(".footer-v9-copyip").forEach(button => {
  button.addEventListener("click", async () => {
    const old = button.textContent;

    try {
      await navigator.clipboard.writeText("fireflysmp.net");
    } catch {}

    button.textContent = "COPIED!";
    setTimeout(() => button.textContent = old, 1100);
  });
});

const languageButton = document.querySelector(".language-button");

if (languageButton) {
  const languageMenu = document.createElement("div");
  languageMenu.className = "language-menu";
  languageMenu.innerHTML = `
    <div class="language-menu-current">
      <strong>English</strong>
      <span>Current language</span>
    </div>

    <div class="language-menu-divider"></div>

    <div class="language-menu-soon">
      MORE LANGUAGES SOON
    </div>
  `;

  languageButton.parentElement.appendChild(languageMenu);

  languageButton.addEventListener("click", event => {
    event.stopPropagation();
    languageMenu.classList.toggle("open");
    languageButton.classList.toggle("open");
  });

  document.addEventListener("click", event => {
    if (
      !languageMenu.contains(event.target) &&
      !languageButton.contains(event.target)
    ) {
      languageMenu.classList.remove("open");
      languageButton.classList.remove("open");
    }
  });
}

const unavailableLinks = document.querySelectorAll('a[href="#"]');

if (unavailableLinks.length) {
  const toast = document.createElement("div");
  toast.className = "site-toast";
  document.body.appendChild(toast);
  let toastTimer;

  unavailableLinks.forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      const label = link.getAttribute("aria-label") || link.textContent.trim() || "This link";
      toast.textContent = `${label} is coming soon.`;
      toast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
    });
  });
}
