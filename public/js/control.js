const denied = document.getElementById("controlDenied");
const app = document.getElementById("controlApp");
const list = document.getElementById("staffAccessList");
const viewer = document.getElementById("controlViewer");
const addButton = document.getElementById("addStaffButton");

const overlay = document.getElementById("staffEditorOverlay");
const closeButton = document.getElementById("staffEditorClose");
const form = document.getElementById("staffEditorForm");
const heading = document.getElementById("staffEditorHeading");
const usernameInput = document.getElementById("staffUsername");
const displayInput = document.getElementById("staffDisplayName");
const roleInput = document.getElementById("staffRole");
const pinInput = document.getElementById("staffPinInput");
const orderInput = document.getElementById("staffOrder");
const visibleInput = document.getElementById("staffVisible");
const errorText = document.getElementById("staffEditorError");
const deleteButton = document.getElementById("deleteStaffButton");
const permissionInputs = [...form.querySelectorAll('.permission-editor input[type="checkbox"]')];

let members = [];
let viewerUser = null;
let editingUsername = null;

function canManageAccess() {
  return viewerUser?.role === "Owner" || viewerUser?.permissions?.includes("manage_access");
}

function canEditStaff() {
  return canManageAccess() || viewerUser?.permissions?.includes("edit_staff");
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function head(username) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(username)}/64`;
}

function permissionLabel(permission) {
  return {
    edit_wiki: "WIKI",
    edit_staff: "STAFF",
    access_control: "CONTROL",
    manage_access: "ACCESS"
  }[permission] || permission;
}

function render() {
  list.innerHTML = members
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map(member => {
      const perms = ["edit_wiki", "edit_staff", "access_control", "manage_access"];
      return `
        <article class="access-card">
          <img class="access-head" src="${head(member.username)}" alt="">
          <div class="access-person">
            <strong>${escapeHtml(member.displayName)}</strong>
            <span>${escapeHtml(member.username)}</span>
          </div>
          <span class="access-role">${escapeHtml(member.role.toUpperCase())}</span>
          <div class="access-permissions">
            ${perms.map(permission =>
              `<span class="permission-pill ${member.permissions.includes(permission) ? "on" : ""}">
                ${permissionLabel(permission)}
              </span>`
            ).join("")}
          </div>
          <button class="access-edit" data-edit="${escapeHtml(member.username)}" type="button">EDIT</button>
        </article>
      `;
    }).join("");

  list.querySelectorAll("[data-edit]").forEach(button => {
    button.addEventListener("click", () => openEditor(button.dataset.edit));
  });
}

function configureEditorRights() {
  const access = canManageAccess();

  roleInput.disabled = !access;
  pinInput.disabled = !access;
  permissionInputs.forEach(input => input.disabled = !access);

  addButton.hidden = !access;
  deleteButton.hidden = !access || !editingUsername;
}

function openEditor(username = null) {
  errorText.textContent = "";
  editingUsername = username;

  const member = username ? members.find(item => item.username.toLowerCase() === username.toLowerCase()) : null;

  heading.textContent = member ? `Edit: ${member.username}` : "Add staff member";
  usernameInput.value = member?.username || "";
  usernameInput.disabled = !!member;
  displayInput.value = member?.displayName || "";
  roleInput.value = member?.role || "Helper";
  pinInput.value = "";
  pinInput.placeholder = member ? "Leave blank to keep current" : "Required: 8 numbers";
  orderInput.value = member?.order ?? 100;
  visibleInput.checked = member?.visible !== false;

  permissionInputs.forEach(input => {
    input.checked = !!member?.permissions?.includes(input.value);
  });

  configureEditorRights();

  overlay.classList.add("open");
}

function closeEditor() {
  overlay.classList.remove("open");
  errorText.textContent = "";
}

addButton.addEventListener("click", () => openEditor());
closeButton.addEventListener("click", closeEditor);
overlay.addEventListener("click", event => {
  if (event.target === overlay) closeEditor();
});

pinInput.addEventListener("input", () => {
  pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 8);
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  errorText.textContent = "";

  const payload = {
    username: usernameInput.value.trim(),
    displayName: displayInput.value.trim(),
    role: roleInput.value,
    pin: pinInput.value,
    order: Number(orderInput.value || 100),
    visible: visibleInput.checked,
    permissions: permissionInputs.filter(input => input.checked).map(input => input.value)
  };

  try {
    const response = await fetch("/api/control/staff", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save staff member.");

    closeEditor();
    await loadPanel();
  } catch (error) {
    errorText.textContent = error.message;
  }
});

deleteButton.addEventListener("click", async () => {
  if (!editingUsername || !confirm(`Remove ${editingUsername} from website staff access?`)) return;

  try {
    const response = await fetch(`/api/control/staff/${encodeURIComponent(editingUsername)}`, {
      method: "DELETE",
      credentials: "same-origin"
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not remove staff member.");

    closeEditor();
    await loadPanel();
  } catch (error) {
    errorText.textContent = error.message;
  }
});

async function loadPanel() {
  try {
    if (window.FireflyAuth?.ready) await window.FireflyAuth.ready;

    const response = await fetch("/api/control/staff", {
      credentials: "same-origin",
      cache: "no-store"
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || "Access denied.");

    viewerUser = data.viewer;
    members = data.members || [];

    denied.hidden = true;
    app.hidden = false;
    viewer.textContent = `${viewerUser.username} • ${viewerUser.role}`;

    configureEditorRights();
    render();
  } catch {
    denied.hidden = false;
    app.hidden = true;
  }
}

document.addEventListener("firefly-auth-changed", loadPanel);
loadPanel();
