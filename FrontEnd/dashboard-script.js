// =========================================
// BFCACHE GUARD
// If the browser restores this page from the back/forward cache (e.g. user
// pressed Back to get here), no script re-runs - so a session change that
// happened elsewhere (logout, expired cookie) wouldn't be noticed. Force a
// reload so init() below actually re-checks the session.
// =========================================
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    location.reload();
  }
});

// =========================================
// CUSTOM DIALOG (POP-UP) LOGIC
// =========================================
const customDialog = document.getElementById("customDialog");
const dialogTitle = document.getElementById("dialogTitle");
const dialogMessage = document.getElementById("dialogMessage");
const dialogCancelBtn = document.getElementById("dialogCancelBtn");
const dialogConfirmBtn = document.getElementById("dialogConfirmBtn");

let confirmActionCallback = null;

function showCustomDialog(title, message, type = "alert", callback = null) {
  dialogTitle.textContent = title;
  dialogMessage.textContent = message;
  confirmActionCallback = callback;

  if (type === "confirm") {
    dialogCancelBtn.classList.remove("hidden");
    dialogConfirmBtn.textContent = "Confirm";
  } else {
    dialogCancelBtn.classList.add("hidden");
    dialogConfirmBtn.textContent = "OK";
  }
  customDialog.classList.remove("hidden");
}

dialogCancelBtn.addEventListener("click", () => {
  customDialog.classList.add("hidden");
  confirmActionCallback = null;
});

dialogConfirmBtn.addEventListener("click", () => {
  customDialog.classList.add("hidden");
  if (confirmActionCallback) {
    confirmActionCallback();
  }
});

// =========================================
// SESSION & PROJECT DATA (from backend)
// =========================================
const LOGIN_URL = "login.html";

let projects = [];

function goToLogin() {
  location.replace(LOGIN_URL);
}

function formatDateEN(date) {
  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// The actual client link that can be opened (relative to this folder right
// now; after deploying, this automatically becomes https://real-domain/client.html?id=...)
function buildClientUrl(projectId) {
  return new URL(
    `client.html?id=${encodeURIComponent(projectId)}`,
    window.location.href,
  ).href;
}

// =========================================
// ADMIN DASHBOARD LOGIC
// =========================================
const newClientBtn = document.getElementById("newClientBtn");
const newProjectModal = document.getElementById("newProjectModal");
const cancelModalBtn = document.getElementById("cancelModalBtn");
const newProjectForm = document.getElementById("newProjectForm");
const projectTableBody = document.getElementById("projectTableBody");
const welcomeName = document.getElementById("welcomeName");
const logoutBtn = document.getElementById("logoutBtn");
const formError = document.getElementById("formError");
const submitProjectBtn = document.getElementById("submitProjectBtn");
const modalTitle = document.getElementById("modalTitle");
const projectPasswordLabel = document.getElementById("projectPasswordLabel");
const projectPasswordInput = document.getElementById("projectPassword");
const removePasswordRow = document.getElementById("removePasswordRow");
const removePasswordCheckbox = document.getElementById("removePassword");

// null = the modal is in "create" mode; otherwise the id of the project being edited.
let editingProjectId = null;

function showMessageRow(text, retryHandler) {
  projectTableBody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 4;
  cell.className = "table-message";
  cell.appendChild(document.createTextNode(text));

  if (retryHandler) {
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "btn-action";
    retryBtn.textContent = "Try Again";
    retryBtn.addEventListener("click", retryHandler);
    cell.appendChild(retryBtn);
  }

  row.appendChild(cell);
  projectTableBody.appendChild(row);
}

function renderProjects() {
  projectTableBody.innerHTML = "";

  if (projects.length === 0) {
    showMessageRow('No projects yet. Click "+ New Client" to create one.');
    return;
  }

  // Server already sorts: newest first
  projects.forEach((project) => {
    const row = document.createElement("tr");
    row.dataset.id = project.id;

    const clientUrl = buildClientUrl(project.id);

    const nameCell = document.createElement("td");
    nameCell.dataset.label = "Folder Name";
    nameCell.textContent = project.name;

    const dateCell = document.createElement("td");
    dateCell.dataset.label = "Date Created";
    dateCell.textContent = formatDateEN(new Date(project.createdAt));

    const linkCell = document.createElement("td");
    linkCell.dataset.label = "Client Link";
    const linkAnchor = document.createElement("a");
    linkAnchor.href = clientUrl;
    linkAnchor.target = "_blank";
    linkAnchor.rel = "noopener";
    linkAnchor.className = "client-link";
    linkAnchor.textContent = clientUrl.replace(/^https?:\/\//, "");
    linkCell.appendChild(linkAnchor);

    const actionCell = document.createElement("td");
    actionCell.dataset.label = "Actions";
    actionCell.innerHTML = `
      <div class="action-buttons">
        <button class="btn-action btn-copy">Copy Link</button>
        <button class="btn-action btn-preview">Preview</button>
        <button class="btn-action btn-edit">Edit</button>
        <button class="btn-action btn-delete">Delete</button>
      </div>
    `;

    row.appendChild(nameCell);
    row.appendChild(dateCell);
    row.appendChild(linkCell);
    row.appendChild(actionCell);
    projectTableBody.appendChild(row);
  });
}

async function loadProjects() {
  showMessageRow("Loading projects...");
  try {
    const data = await api("/api/projects");
    projects = data.projects;
    renderProjects();
  } catch (err) {
    if (err.status === 401) return goToLogin();
    showMessageRow(err.message, loadProjects);
  }
}

// Check the session first: not logged in = go to login page; logged in = show dashboard.
async function init() {
  try {
    const { admin } = await api("/api/auth/me");
    welcomeName.textContent = admin.name || admin.email;
    document.body.classList.remove("is-checking");
  } catch (err) {
    if (err.status === 401) return goToLogin();
    // Server unreachable: show the page with a message and a retry button
    document.body.classList.remove("is-checking");
    showMessageRow(err.message, init);
    return;
  }
  loadProjects();
}

// ---- Logout ----
logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    await api("/api/auth/logout", { method: "POST" });
    goToLogin();
  } catch (err) {
    logoutBtn.disabled = false;
    showCustomDialog("Logout Failed", err.message, "alert");
  }
});

// ---- New project form ----
function showFormError(message) {
  formError.textContent = message;
  formError.classList.remove("hidden");
}

function clearFormError() {
  formError.textContent = "";
  formError.classList.add("hidden");
}

function closeProjectModal() {
  newProjectModal.classList.add("hidden");
  newProjectForm.reset();
  clearFormError();
  editingProjectId = null;
  projectPasswordInput.disabled = false;
}

function openCreateModal() {
  clearFormError();
  editingProjectId = null;
  modalTitle.textContent = "Create New Project";
  submitProjectBtn.textContent = "Create Project";
  projectPasswordLabel.textContent = "Password (Optional)";
  projectPasswordInput.placeholder = "Leave blank if not needed";
  removePasswordRow.classList.add("hidden");
  removePasswordCheckbox.checked = false;
  newProjectModal.classList.remove("hidden");
  document.getElementById("projectName").focus();
}

function openEditModal(project) {
  clearFormError();
  editingProjectId = project.id;
  modalTitle.textContent = `Edit "${project.name}"`;
  submitProjectBtn.textContent = "Save Changes";

  document.getElementById("projectName").value = project.name;
  document.getElementById("driveLink").value = project.driveFolderLink;
  document.getElementById("whatsappNum").value = project.whatsappNumber;
  document.getElementById("maxSelection").value = project.maxSelection;

  projectPasswordLabel.textContent = project.hasPassword
    ? "New Password (leave blank to keep current one)"
    : "Password (Optional)";
  projectPasswordInput.placeholder = project.hasPassword
    ? "Leave blank to keep the current password"
    : "Leave blank if not needed";
  removePasswordCheckbox.checked = false;
  removePasswordRow.classList.toggle("hidden", !project.hasPassword);

  newProjectModal.classList.remove("hidden");
  document.getElementById("projectName").focus();
}

newClientBtn.addEventListener("click", openCreateModal);

cancelModalBtn.addEventListener("click", closeProjectModal);

// Unchecking "remove password" isn't possible while it's disabled, and typing a new
// password while "remove password" is checked would be contradictory, so the two
// are mutually exclusive.
removePasswordCheckbox.addEventListener("change", () => {
  projectPasswordInput.disabled = removePasswordCheckbox.checked;
  if (removePasswordCheckbox.checked) projectPasswordInput.value = "";
});

newProjectForm.addEventListener("input", clearFormError);

newProjectForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearFormError();

  const name = document.getElementById("projectName").value.trim();
  const driveLink = document.getElementById("driveLink").value.trim();
  const whatsappRaw = document.getElementById("whatsappNum").value.trim();
  const password = document.getElementById("projectPassword").value;
  const maxSelectionRaw = document.getElementById("maxSelection").value;

  const maxSelection = parseInt(maxSelectionRaw, 10);
  if (
    !name ||
    !driveLink ||
    !whatsappRaw ||
    !maxSelectionRaw ||
    isNaN(maxSelection) ||
    maxSelection < 1
  ) {
    showFormError("Please fill in all required fields with valid values.");
    return;
  }

  const isEditing = editingProjectId !== null;

  // WhatsApp number is normalized by the server (0812..., +62812..., 812... are all accepted).
  const payload = {
    name,
    driveFolderLink: driveLink,
    whatsappNumber: whatsappRaw,
    maxSelection,
  };
  if (isEditing) {
    // Edit mode: only touch the password field if the admin actually typed a new one
    // or explicitly asked to remove it - an untouched, blank field means "leave it as is".
    if (removePasswordCheckbox.checked) {
      payload.clientPassword = "";
    } else if (password) {
      payload.clientPassword = password;
    }
  } else if (password) {
    payload.clientPassword = password;
  }

  submitProjectBtn.disabled = true;
  submitProjectBtn.textContent = isEditing ? "Saving..." : "Creating...";
  try {
    const data = isEditing
      ? await api(`/api/projects/${encodeURIComponent(editingProjectId)}`, {
          method: "PATCH",
          body: payload,
        })
      : await api("/api/projects", { method: "POST", body: payload });

    if (isEditing) {
      const idx = projects.findIndex((p) => p.id === editingProjectId);
      if (idx !== -1) projects[idx] = data.project;
    } else {
      projects.unshift(data.project);
    }
    renderProjects();
    closeProjectModal();

    if (data.driveWarning) {
      // Project saved, but Google couldn't confirm the folder yet (e.g. Google having issues)
      showCustomDialog(
        isEditing ? "Project Updated, Folder Not Verified" : "Project Created, Folder Not Verified",
        `Project "${data.project.name}" was saved, but the Drive folder couldn't be checked. ${data.driveWarning}`,
        "alert",
      );
    } else {
      showCustomDialog(
        "Success",
        isEditing
          ? `Project "${data.project.name}" was updated successfully.`
          : `Project "${data.project.name}" was created successfully. The client link is now available in the table.`,
        "alert",
      );
    }
  } catch (err) {
    if (err.status === 401) return goToLogin();
    // Modal stays open and the fields keep their values, so they can be fixed and resubmitted
    showFormError(err.message);
  } finally {
    submitProjectBtn.disabled = false;
    submitProjectBtn.textContent = isEditing ? "Save Changes" : "Create Project";
  }
});

// ---- Table actions ----
projectTableBody.addEventListener("click", (e) => {
  const target = e.target;
  const row = target.closest("tr");
  const projectId = row ? row.dataset.id : null;

  if (target.classList.contains("btn-copy")) {
    if (!projectId) return;
    const clientUrl = buildClientUrl(projectId);
    navigator.clipboard
      .writeText(clientUrl)
      .then(() => {
        showCustomDialog(
          "Success",
          "Link copied to clipboard!",
          "alert",
        );
      })
      .catch(() => {
        showCustomDialog(
          "Copy Failed",
          "The browser denied clipboard access. Copy it manually from the Client Link column.",
          "alert",
        );
      });
  } else if (target.classList.contains("btn-preview")) {
    if (!projectId) return;
    window.open(buildClientUrl(projectId), "_blank");
  } else if (target.classList.contains("btn-edit")) {
    if (!projectId) return;
    const project = projects.find((p) => p.id === projectId);
    if (project) openEditModal(project);
  } else if (target.classList.contains("btn-delete")) {
    if (!projectId) return;
    showCustomDialog(
      "Delete Project",
      "Are you sure you want to delete this project? The link already shared with the client will stop working.",
      "confirm",
      async () => {
        try {
          await api(`/api/projects/${encodeURIComponent(projectId)}`, {
            method: "DELETE",
          });
          projects = projects.filter((p) => p.id !== projectId);
          renderProjects();
        } catch (err) {
          if (err.status === 401) return goToLogin();
          if (err.status === 404) {
            // Already gone from the server (e.g. deleted from another tab): sync the view
            projects = projects.filter((p) => p.id !== projectId);
            renderProjects();
            return;
          }
          showCustomDialog("Delete Failed", err.message, "alert");
        }
      },
    );
  }
});

init();