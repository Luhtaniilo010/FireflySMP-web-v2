const staffGrid = document.getElementById("staffGrid");

const roleOrder = ["Owner", "Admin", "Developer", "Moderator", "Helper"];

function skinUrl(ign) {
  return `https://mc-heads.net/body/${encodeURIComponent(ign)}/220`;
}

function roleClass(role) {
  return `role-${String(role).toLowerCase()}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}


function headUrl(ign) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(ign)}/96`;
}

function createCompactStaff(member) {
  const item = document.createElement("div");
  item.className = "staff-compact-member";
  item.innerHTML = `
    <img src="${headUrl(member.username)}" alt="${escapeHtml(member.username)} head" loading="lazy" draggable="false">
    <strong>${escapeHtml(member.displayName || member.username)}</strong>
  `;
  return item;
}

function createStaffCard(member) {
  const card = document.createElement("article");
  card.className = "simple-staff-card";
  card.innerHTML = `
    <div class="staff-skin-area">
      <span class="staff-firefly one"></span>
      <span class="staff-firefly two"></span>
      <img
        class="staff-skin"
        src="${skinUrl(member.username)}"
        alt="${escapeHtml(member.username)} Minecraft skin"
        loading="lazy"
        draggable="false"
      >
    </div>
    <div class="staff-info">
      <span class="staff-role ${roleClass(member.role)}">${escapeHtml(member.role.toUpperCase())}</span>
      <strong>${escapeHtml(member.displayName || member.username)}</strong>
      <small>${escapeHtml(member.username)}</small>
    </div>
  `;
  return card;
}

async function renderStaff() {
  if (!staffGrid) return;

  try {
    const response = await fetch("/api/staff", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load staff.");
    const data = await response.json();

    const members = data.members || [];
    staffGrid.className = "staff-rank-list";
    staffGrid.innerHTML = "";

    roleOrder.forEach(role => {
      const roleMembers = members.filter(member => member.role === role);

      const section = document.createElement("section");
      section.className = `staff-rank-section rank-section-${role.toLowerCase()}`;

      const heading = document.createElement("div");
      heading.className = "staff-rank-heading";
      heading.innerHTML = `
        <span class="rank-line"></span>
        <h2>${role.toUpperCase()}</h2>
        <span class="rank-count">${roleMembers.length}</span>
        <span class="rank-line"></span>
      `;
      section.appendChild(heading);

      if (roleMembers.length) {
        const row = document.createElement("div");
        const compactRole = role === "Moderator" || role === "Helper";
        row.className = compactRole ? "staff-compact-row" : "staff-rank-row";
        roleMembers.forEach(member => row.appendChild(
          compactRole ? createCompactStaff(member) : createStaffCard(member)
        ));
        section.appendChild(row);
      } else {
        const empty = document.createElement("div");
        empty.className = "staff-rank-empty";
        empty.innerHTML = `<span>TEAM POSITIONS</span><strong>To be announced</strong>`;
        section.appendChild(empty);
      }

      staffGrid.appendChild(section);
    });
  } catch (error) {
    staffGrid.innerHTML = `<div class="staff-rank-empty"><strong>Staff list unavailable.</strong></div>`;
  }
}

renderStaff();
