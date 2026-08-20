const API = "/api";

let wikiData = { categories: [], pages: [] };
let draftData = {};
let currentUser = null;
let currentPageId = location.hash.replace("#", "") || "welcome";

const nav = document.getElementById("wikiNav");
const pageContent = document.getElementById("wikiPageContent");
const breadcrumb = document.getElementById("wikiBreadcrumb");
const toc = document.getElementById("wikiToc");
const prevButton = document.getElementById("wikiPrevButton");
const nextButton = document.getElementById("wikiNextButton");
const prevTitle = document.getElementById("wikiPrevTitle");
const nextTitle = document.getElementById("wikiNextTitle");
const mobileTitle = document.getElementById("wikiMobilePageTitle");

const editorOverlay = document.getElementById("wikiEditorOverlay");
const categoryOverlay = document.getElementById("wikiCategoryOverlay");
const editId = document.getElementById("wikiEditId");
const editCategory = document.getElementById("wikiEditCategory");
const editTitle = document.getElementById("wikiEditTitle");
const editDescription = document.getElementById("wikiEditDescription");
const editContent = document.getElementById("wikiEditContent");
const editorTitle = document.getElementById("wikiEditorTitle");

function canEditWiki() {
  if (!currentUser?.staff) return false;
  return currentUser.role === "Owner" || currentUser.permissions?.includes("edit_wiki");
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function escapeHtml(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function inlineFormat(text) {
  let out = escapeHtml(text);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`(.+?)`/g, '<span class="wiki-inline-code">$1</span>');
  return out;
}

function slugify(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function renderMarkdown(text = "") {
  const lines = String(text).split("\n");
  let html = "";
  let inList = false;

  function closeList() {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      closeList();
      continue;
    }

    if (line.startsWith("## ")) {
      closeList();
      const title = line.slice(3);
      html += `<h2 id="${slugify(title)}">${inlineFormat(title)}</h2>`;
      continue;
    }

    if (line.startsWith("### ")) {
      closeList();
      const title = line.slice(4);
      html += `<h3 id="${slugify(title)}">${inlineFormat(title)}</h3>`;
      continue;
    }

    if (line.startsWith("- ")) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inlineFormat(line.slice(2))}</li>`;
      continue;
    }

    if (line.startsWith(">")) {
      closeList();
      const tip = /^>\s*TIP:/i.test(line);
      const note = line.replace(/^>\s*(TIP:|NOTE:)?\s*/i, "");
      html += `
        <div class="wiki-callout">
          <span class="wiki-callout-icon">${tip ? "TIP" : "!"}</span>
          <div>
            <strong>${tip ? "Tip" : "Note"}</strong>
            <p>${inlineFormat(note)}</p>
          </div>
        </div>
      `;
      continue;
    }

    closeList();
    html += `<p>${inlineFormat(line)}</p>`;
  }

  closeList();
  return html;
}

function getPage(id) {
  return wikiData.pages.find(page => page.id === id) || wikiData.pages[0];
}

function orderedPages() {
  const ordered = [];
  for (const category of wikiData.categories) {
    ordered.push(...wikiData.pages.filter(page => page.category === category));
  }
  for (const page of wikiData.pages) if (!ordered.includes(page)) ordered.push(page);
  return ordered;
}

function renderNav() {
  nav.innerHTML = wikiData.categories.map(category => {
    const pages = wikiData.pages.filter(page => page.category === category);
    return `
      <div class="wiki-nav-group">
        <button class="wiki-nav-group-title" type="button">
          <span>${escapeHtml(category)}</span><i>⌄</i>
        </button>
        <div class="wiki-nav-links">
          ${pages.map((page, index) => `
            <a class="wiki-nav-link ${page.id === currentPageId ? "active" : ""}"
               href="#${page.id}" data-page="${page.id}">
              <span class="wiki-nav-icon">${String(index + 1).padStart(2, "0")}</span>
              ${escapeHtml(page.title)}
            </a>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");

  nav.querySelectorAll(".wiki-nav-group-title").forEach(button => {
    button.addEventListener("click", () => button.closest(".wiki-nav-group").classList.toggle("collapsed"));
  });
}

function renderPage() {
  if (!wikiData.pages.length) {
    pageContent.innerHTML = "<p>No wiki pages yet.</p>";
    return;
  }

  const page = getPage(currentPageId);
  currentPageId = page.id;

  const pages = orderedPages();
  const index = pages.findIndex(p => p.id === page.id);
  const hasDraft = !!draftData[page.id];

  pageContent.innerHTML = `
    <header class="wiki-page-heading">
      <small>${escapeHtml(page.category.toUpperCase())}</small>
      <h1>${escapeHtml(page.title)}</h1>
      <p>${escapeHtml(page.description)}</p>
      ${canEditWiki() ? `
        <div class="wiki-edit-toolbar">
          <button id="wikiEditCurrentPage" type="button">EDIT PAGE</button>
          <button id="wikiAddPage" class="wiki-add-page-button" type="button">+ NEW PAGE</button>
          <button id="wikiManageCategories" type="button">CATEGORIES</button>
          ${hasDraft ? `<span class="wiki-draft-status">DRAFT SAVED</span>` : ""}
        </div>
      ` : ""}
    </header>
    <div class="wiki-content">${renderMarkdown(page.content)}</div>
  `;

  breadcrumb.innerHTML = `${escapeHtml(page.category)} <span>›</span> ${escapeHtml(page.title)}`;
  mobileTitle.textContent = page.title;

  prevButton.disabled = index <= 0;
  nextButton.disabled = index >= pages.length - 1;
  prevTitle.textContent = index > 0 ? pages[index - 1].title : "—";
  nextTitle.textContent = index < pages.length - 1 ? pages[index + 1].title : "—";

  prevButton.onclick = () => index > 0 && navigateToPage(pages[index - 1].id);
  nextButton.onclick = () => index < pages.length - 1 && navigateToPage(pages[index + 1].id);

  renderToc();
  renderNav();

  document.getElementById("wikiEditCurrentPage")?.addEventListener("click", () => openEditor(page.id));
  document.getElementById("wikiAddPage")?.addEventListener("click", () => openEditor(null));
  document.getElementById("wikiManageCategories")?.addEventListener("click", openCategoryManager);
}

function renderToc() {
  const headings = [...pageContent.querySelectorAll(".wiki-content h2, .wiki-content h3")];
  toc.innerHTML = headings.length
    ? headings.map(h => `<a class="wiki-toc-link" href="#${h.id}">${escapeHtml(h.textContent)}</a>`).join("")
    : `<span class="wiki-toc-link">No sections yet</span>`;
}

function navigateToPage(id) {
  currentPageId = id;
  history.pushState(null, "", `#${id}`);
  renderPage();
  closeMobileSidebar();
}

window.addEventListener("hashchange", () => {
  const id = location.hash.replace("#", "");
  if (wikiData.pages.some(page => page.id === id)) {
    currentPageId = id;
    renderPage();
  }
});

const searchInput = document.getElementById("wikiSearch");
const searchResults = document.getElementById("wikiSearchResults");

searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim().toLowerCase();

  if (!query) {
    searchResults.classList.remove("open");
    searchResults.innerHTML = "";
    return;
  }

  const matches = wikiData.pages.filter(page =>
    `${page.title} ${page.description} ${page.content} ${page.category}`.toLowerCase().includes(query)
  ).slice(0, 8);

  searchResults.innerHTML = matches.length
    ? matches.map(page => `
        <button class="wiki-search-result" type="button" data-page="${page.id}">
          <strong>${escapeHtml(page.title)}</strong>
          <span>${escapeHtml(page.category)}</span>
        </button>
      `).join("")
    : `<button class="wiki-search-result" type="button"><strong>No results</strong></button>`;

  searchResults.classList.add("open");

  searchResults.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      navigateToPage(button.dataset.page);
      searchInput.value = "";
      searchResults.classList.remove("open");
    });
  });
});

document.addEventListener("keydown", event => {
  if (event.key === "/" && document.activeElement !== searchInput) {
    event.preventDefault();
    searchInput.focus();
  }
});

const sidebar = document.getElementById("wikiSidebar");
const sidebarOverlay = document.getElementById("wikiSidebarOverlay");

function closeMobileSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("open");
}

document.getElementById("wikiMobileMenu").addEventListener("click", () => {
  sidebar.classList.add("open");
  sidebarOverlay.classList.add("open");
});

document.getElementById("wikiMobileClose").addEventListener("click", closeMobileSidebar);
sidebarOverlay.addEventListener("click", closeMobileSidebar);

function fillCategorySelect(selected) {
  editCategory.innerHTML = wikiData.categories
    .map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    .join("");

  if (selected && wikiData.categories.includes(selected)) editCategory.value = selected;
}

function openEditor(pageId) {
  if (!canEditWiki()) return;

  const page = pageId ? getPage(pageId) : null;
  const draft = pageId ? draftData[pageId] : null;
  const source = draft || page;

  editorTitle.textContent = page ? `Edit: ${page.title}` : "Create new page";
  editId.value = source?.id || "";
  editId.disabled = !!page;
  fillCategorySelect(source?.category || wikiData.categories[0]);
  editTitle.value = source?.title || "";
  editDescription.value = source?.description || "";
  editContent.value = source?.content || "";
  document.getElementById("wikiDeletePage").style.display = page ? "" : "none";
  openModal(editorOverlay);
}

function editorPayload() {
  return {
    id: editId.value.trim(),
    category: editCategory.value,
    title: editTitle.value.trim(),
    description: editDescription.value.trim(),
    content: editContent.value
  };
}

document.getElementById("wikiSaveDraft").addEventListener("click", async () => {
  try {
    const result = await api("/wiki/draft", { method: "POST", body: JSON.stringify(editorPayload()) });
    draftData[result.draft.id] = result.draft;
    closeModal(editorOverlay);
    renderPage();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById("wikiPublishPage").addEventListener("click", async () => {
  try {
    const result = await api("/wiki/publish", { method: "POST", body: JSON.stringify(editorPayload()) });
    wikiData = result.wiki;
    delete draftData[result.page.id];
    currentPageId = result.page.id;
    history.replaceState(null, "", `#${currentPageId}`);
    closeModal(editorOverlay);
    renderPage();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById("wikiDeletePage").addEventListener("click", async () => {
  const id = editId.value.trim();
  if (!id || !confirm(`Delete wiki page "${id}"?`)) return;

  try {
    const result = await api(`/wiki/page/${encodeURIComponent(id)}`, { method: "DELETE" });
    wikiData = result.wiki;
    delete draftData[id];
    currentPageId = wikiData.pages[0]?.id || "";
    history.replaceState(null, "", currentPageId ? `#${currentPageId}` : "#");
    closeModal(editorOverlay);
    renderPage();
  } catch (error) {
    alert(error.message);
  }
});

const categoryList = document.getElementById("wikiCategoryList");

function renderCategoryManager() {
  categoryList.innerHTML = wikiData.categories.map(category => `
    <div class="wiki-category-row" data-category="${escapeHtml(category)}">
      <input type="text" value="${escapeHtml(category)}">
      <button class="wiki-category-rename" type="button">RENAME</button>
      <button class="wiki-category-delete" type="button">DELETE</button>
    </div>
  `).join("");

  categoryList.querySelectorAll(".wiki-category-row").forEach(row => {
    const original = row.dataset.category;
    const input = row.querySelector("input");

    row.querySelector(".wiki-category-rename").addEventListener("click", async () => {
      const to = input.value.trim();
      if (!to || to === original) return;

      try {
        const result = await api("/wiki/categories", {
          method: "POST",
          body: JSON.stringify({ action: "rename", from: original, to })
        });
        wikiData = result.wiki;
        renderCategoryManager();
        renderPage();
      } catch (error) {
        alert(error.message);
      }
    });

    row.querySelector(".wiki-category-delete").addEventListener("click", async () => {
      if (!confirm(`Delete category "${original}"? Pages will move to General.`)) return;

      try {
        const result = await api("/wiki/categories", {
          method: "POST",
          body: JSON.stringify({ action: "delete", name: original, replacement: "General" })
        });
        wikiData = result.wiki;
        renderCategoryManager();
        renderPage();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function openCategoryManager() {
  if (!canEditWiki()) return;
  renderCategoryManager();
  openModal(categoryOverlay);
}

document.getElementById("wikiAddCategory").addEventListener("click", async () => {
  const input = document.getElementById("wikiNewCategory");
  const name = input.value.trim();
  if (!name) return;

  try {
    const result = await api("/wiki/categories", {
      method: "POST",
      body: JSON.stringify({ action: "add", name })
    });
    wikiData = result.wiki;
    input.value = "";
    renderCategoryManager();
    renderPage();
  } catch (error) {
    alert(error.message);
  }
});

function openModal(modal) {
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal(modal) {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

document.querySelectorAll("[data-close-modal]").forEach(button => {
  button.addEventListener("click", () => {
    const modal = button.dataset.closeModal === "editor" ? editorOverlay : categoryOverlay;
    closeModal(modal);
  });
});

[editorOverlay, categoryOverlay].forEach(modal => {
  modal.addEventListener("click", event => {
    if (event.target === modal) closeModal(modal);
  });
});

async function refreshAuth() {
  try {
    const auth = await api("/auth/me");
    currentUser = auth.user || null;
    draftData = {};

    if (canEditWiki()) {
      const editorData = await api("/wiki/editor");
      draftData = editorData.drafts || {};
    }

    renderPage();
  } catch {
    currentUser = null;
    draftData = {};
    renderPage();
  }
}

document.addEventListener("firefly-auth-changed", event => {
  currentUser = event.detail || null;
  refreshAuth();
});

async function initWiki() {
  try {
    wikiData = await api("/wiki");

    if (!wikiData.pages.some(page => page.id === currentPageId)) {
      currentPageId = wikiData.pages[0]?.id || "";
    }

    if (window.FireflyAuth?.ready) await window.FireflyAuth.ready;
    await refreshAuth();
  } catch (error) {
    pageContent.innerHTML = `
      <div class="wiki-callout">
        <span class="wiki-callout-icon">!</span>
        <div>
          <strong>Wiki backend is not running</strong>
          <p>Start the website with <span class="wiki-inline-code">npm start</span>.</p>
        </div>
      </div>
    `;
  }
}

initWiki();
