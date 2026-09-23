// =========================================
// BFCACHE GUARD
// If the browser restores this page from the back/forward cache (e.g. user
// pressed Back after unlocking, or after the project was deleted elsewhere),
// no script re-runs - so init() below wouldn't notice. Force a reload so it
// actually re-checks project/unlock status.
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
// PAGE ELEMENTS
// =========================================
const projectNameHeading = document.getElementById("projectNameHeading");
const selectionInstruction = document.getElementById("selectionInstruction");
const gallery = document.getElementById("gallery");
const bottomBar = document.getElementById("bottomBar");
const statusText = document.querySelector(".selection-status");
const selectedFilesContainer = document.getElementById("selectedFilesContainer");
const resetBtn = document.getElementById("resetBtn");
const copyBtn = document.getElementById("copyBtn");
const waBtn = document.getElementById("waBtn");

const passwordGate = document.getElementById("passwordGate");
const gateForm = document.getElementById("gateForm");
const gateText = document.getElementById("gateText");
const gatePassword = document.getElementById("gatePassword");
const gateError = document.getElementById("gateError");
const gateBtn = document.getElementById("gateBtn");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GATE_DEFAULT_TEXT = "Enter the password sent along with this link.";

// =========================================
// STATE
// =========================================
const projectId = new URLSearchParams(window.location.search).get("id");
let project = null; // { id, name, requiresPassword, unlocked, maxSelection, whatsappNumber }
let photos = []; // from server: { id, name, thumb, full, ... }
let selected = []; // IDs of selected photos, in selection order
let cardButtons = []; // Select button for each card, index matches photos
let MAX_SELECTION = 0;
let ADMIN_PHONE = "";

const photoName = (id) => {
  const photo = photos.find((p) => p.id === id);
  return photo ? photo.name : "";
};
const selectedNames = () => selected.map(photoName);

// =========================================
// STATUS VIEWS (loading, error, empty)
// =========================================
function showGallerySection() {
  passwordGate.classList.add("hidden");
  gallery.classList.remove("hidden");
}

// Replaces the gallery content with a single message (and a "Try again" button if provided)
function showGalleryMessage(text, retryHandler) {
  showGallerySection();
  bottomBar.classList.add("hidden");
  gallery.innerHTML = "";

  const box = document.createElement("div");
  box.className = "gallery-status";
  box.setAttribute("role", "status");

  const p = document.createElement("p");
  p.textContent = text;
  box.appendChild(p);

  if (retryHandler) {
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "btn-client-secondary gallery-retry";
    retryBtn.textContent = "Try Again";
    retryBtn.addEventListener("click", retryHandler);
    box.appendChild(retryBtn);
  }
  gallery.appendChild(box);
}

// =========================================
// PASSWORD SCREEN
// =========================================
function showGate(message) {
  gallery.classList.add("hidden");
  bottomBar.classList.add("hidden");
  passwordGate.classList.remove("hidden");
  selectionInstruction.textContent = "Photos are password-protected";
  gateText.textContent = message || GATE_DEFAULT_TEXT;
  gateError.classList.add("hidden");
  gatePassword.value = "";
  gatePassword.focus();
}

gatePassword.addEventListener("input", () => {
  gateError.classList.add("hidden");
});

gateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = gatePassword.value;
  if (!password) {
    gateError.textContent = "Enter the password first.";
    gateError.classList.remove("hidden");
    gatePassword.focus();
    return;
  }

  gateBtn.disabled = true;
  gateBtn.textContent = "Checking...";
  try {
    project = await api(`/api/client/${encodeURIComponent(projectId)}/unlock`, {
      method: "POST",
      body: { password },
    });
    startGallery();
  } catch (err) {
    gateError.textContent = err.message;
    gateError.classList.remove("hidden");
    if (err.status === 401) gatePassword.select();
  } finally {
    gateBtn.disabled = false;
    gateBtn.textContent = "Unlock Photos";
  }
});

// =========================================
// LOADING PROJECT & PHOTOS
// =========================================
function applyProjectInfo() {
  projectNameHeading.textContent = project.name;
  document.title = project.name;
}

async function init() {
  if (!projectId || !UUID_RE.test(projectId)) {
    projectNameHeading.textContent = "Invalid Link";
    selectionInstruction.textContent = "";
    showGalleryMessage(
      "This link is incomplete. Ask your photographer for the correct link.",
    );
    return;
  }

  showGalleryMessage("Loading...");
  try {
    project = await api(`/api/client/${encodeURIComponent(projectId)}`);
  } catch (err) {
    if (err.status === 404) {
      projectNameHeading.textContent = "Project Not Found";
      selectionInstruction.textContent = "";
      showGalleryMessage(
        "This link isn't recognized or the project has been deleted. Contact your photographer.",
      );
    } else {
      projectNameHeading.textContent = "Select Photos";
      showGalleryMessage(err.message, init);
    }
    return;
  }

  applyProjectInfo();
  if (project.unlocked) {
    startGallery();
  } else {
    showGate();
  }
}

// Called once the project is unlocked (no password, or password was correct)
function startGallery() {
  applyProjectInfo();
  MAX_SELECTION = project.maxSelection;
  ADMIN_PHONE = project.whatsappNumber;
  selectionInstruction.textContent = `Select up to ${MAX_SELECTION} photos`;
  loadPhotos();
}

async function loadPhotos() {
  showGalleryMessage("Loading photos...");
  try {
    const data = await api(
      `/api/client/${encodeURIComponent(projectId)}/photos`,
    );
    photos = data.photos;
  } catch (err) {
    if (err.status === 401) {
      // Password access expired (cookie expired): ask for the password again
      showGate("Session expired. Enter the password again to continue.");
      return;
    }
    showGalleryMessage(err.message, loadPhotos);
    return;
  }

  // Previous selections are only kept if the photo still exists in the folder
  selected = selected.filter((id) => photos.some((p) => p.id === id));

  if (photos.length === 0) {
    showGalleryMessage(
      "No photos in this folder yet. Contact your photographer to confirm the photos have been uploaded.",
    );
    return;
  }
  renderGallery();
}

// =========================================
// GALLERY & PHOTO SELECTION
// =========================================
function createPhotoCard(photo, index) {
  const card = document.createElement("div");
  card.className = "photo-card";

  const wrapper = document.createElement("div");
  wrapper.className = "image-wrapper";
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "button");
  wrapper.setAttribute("aria-label", `View photo ${photo.name} larger`);

  const showPlaceholder = () => {
    wrapper.innerHTML = "";
    const ph = document.createElement("div");
    ph.className = "image-placeholder";
    ph.textContent = "Preview not available yet";
    wrapper.appendChild(ph);
  };

  if (photo.thumb) {
    const img = document.createElement("img");
    img.alt = photo.name;
    img.loading = "lazy";
    img.decoding = "async";
    // No referrer so Google doesn't reject the image based on the page origin
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", showPlaceholder);
    img.src = photo.thumb;
    wrapper.appendChild(img);
  } else {
    // Newly uploaded photos sometimes don't have a Google thumbnail yet
    showPlaceholder();
  }

  wrapper.addEventListener("click", () => openLightbox(index));
  wrapper.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openLightbox(index);
    }
  });

  const info = document.createElement("div");
  info.className = "photo-info";

  const nameEl = document.createElement("span");
  nameEl.className = "file-name";
  nameEl.textContent = photo.name;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-select";
  button.addEventListener("click", () => toggleSelection(index));
  cardButtons[index] = button;

  info.appendChild(nameEl);
  info.appendChild(button);
  card.appendChild(wrapper);
  card.appendChild(info);
  return card;
}

function renderGallery() {
  showGallerySection();
  gallery.innerHTML = "";
  cardButtons = [];

  const fragment = document.createDocumentFragment();
  photos.forEach((photo, index) => fragment.appendChild(createPhotoCard(photo, index)));

  const spacer = document.createElement("div");
  spacer.className = "bottom-spacer";
  fragment.appendChild(spacer);
  gallery.appendChild(fragment);

  bottomBar.classList.remove("hidden");
  cardButtons.forEach((_, index) => syncCardButton(index));
  updateBottomBar();
}

function syncCardButton(index) {
  const button = cardButtons[index];
  if (!button) return;
  const isSelected = selected.includes(photos[index].id);
  button.classList.toggle("selected", isSelected);
  button.textContent = isSelected ? "Deselect" : "Select";
  button.setAttribute("aria-pressed", String(isSelected));
}

function updateBottomBar() {
  statusText.textContent = `Selected ${selected.length}/${MAX_SELECTION}`;
  if (selected.length === 0) {
    selectedFilesContainer.textContent = "No photos selected yet";
    selectedFilesContainer.style.color = "#9ca3af";
  } else {
    selectedFilesContainer.textContent = selectedNames().join(", ");
    selectedFilesContainer.style.color = "#111827";
  }
}

function toggleSelection(index) {
  const id = photos[index].id;
  const position = selected.indexOf(id);

  if (position >= 0) {
    selected.splice(position, 1);
  } else {
    if (selected.length >= MAX_SELECTION) {
      // Custom pop-up used instead of alert()
      showCustomDialog(
        "Maximum Reached",
        `You can select up to ${MAX_SELECTION} photos.`,
        "alert",
      );
      return;
    }
    selected.push(id);
  }

  syncCardButton(index);
  updateBottomBar();
  if (!lightbox.classList.contains("hidden")) updateLightbox();
}

resetBtn.addEventListener("click", function () {
  if (selected.length === 0) return;

  // Custom pop-up used instead of confirm()
  showCustomDialog(
    "Confirm Reset",
    "Are you sure you want to clear all selected photos?",
    "confirm",
    () => {
      selected = [];
      cardButtons.forEach((_, index) => syncCardButton(index));
      updateBottomBar();
      if (!lightbox.classList.contains("hidden")) updateLightbox();
    },
  );
});

// NOTE: this message is sent straight to the photographer's WhatsApp, so it's kept
// in Indonesian on purpose - everything else on this page is in English.
function generateMessage() {
  if (selected.length === 0) return null;
  const names = selectedNames();
  const fileList = names.map((file, i) => `${i + 1}. ${file}`).join("\n");
  return `Halo, berikut ${names.length} foto yang saya pilih:\n\n${fileList}\n\nTerima kasih.`;
}

copyBtn.addEventListener("click", function () {
  const message = generateMessage();
  if (!message) {
    showCustomDialog(
      "Notice",
      "Please select at least one photo first!",
      "alert",
    );
    return;
  }
  navigator.clipboard
    .writeText(message)
    .then(() => {
      const originalText = this.textContent;
      this.textContent = "Copied!";
      this.style.backgroundColor = "#e5e7eb";
      setTimeout(() => {
        this.textContent = originalText;
        this.style.backgroundColor = "#ffffff";
      }, 2000);
    })
    .catch(() => {
      showCustomDialog(
        "Copy Failed",
        "The browser denied clipboard access. Use the Send WhatsApp button instead.",
        "alert",
      );
    });
});

waBtn.addEventListener("click", function () {
  const message = generateMessage();
  if (!message) {
    showCustomDialog(
      "Notice",
      "Please select at least one photo first!",
      "alert",
    );
    return;
  }
  const waUrl = `https://wa.me/${ADMIN_PHONE}?text=${encodeURIComponent(message)}`;
  window.open(waUrl, "_blank");
});

// =========================================
// PHOTO PREVIEW LOGIC (LIGHTBOX)
// =========================================
const lightbox = document.getElementById("photoLightbox");
const lightboxImage = document.getElementById("lightboxImage");
const lightboxFileName = document.getElementById("lightboxFileName");
const lightboxSelectBtn = document.getElementById("lightboxSelectBtn");
const lightboxCloseBtn = document.getElementById("lightboxClose");
const lightboxPrevBtn = document.getElementById("lightboxPrev");
const lightboxNextBtn = document.getElementById("lightboxNext");

let currentPreviewIndex = 0;

// If the full-size version fails to load, fall back to the thumbnail so the preview isn't empty
lightboxImage.referrerPolicy = "no-referrer";
lightboxImage.addEventListener("error", () => {
  const photo = photos[currentPreviewIndex];
  if (photo && photo.thumb && lightboxImage.src !== photo.thumb) {
    lightboxImage.src = photo.thumb;
  }
});

function updateLightbox() {
  const photo = photos[currentPreviewIndex];
  const isSelected = selected.includes(photo.id);

  lightboxImage.src = photo.full || photo.thumb || "";
  lightboxImage.alt = photo.name;
  lightboxFileName.textContent = photo.name;

  lightboxSelectBtn.textContent = isSelected ? "Deselect" : "Select";
  lightboxSelectBtn.classList.toggle("selected", isSelected);

  lightboxPrevBtn.disabled = currentPreviewIndex === 0;
  lightboxNextBtn.disabled = currentPreviewIndex === photos.length - 1;

  // Preload the next photo in the background so switching feels instant
  const next = photos[currentPreviewIndex + 1];
  if (next && next.full) {
    const preload = new Image();
    preload.referrerPolicy = "no-referrer";
    preload.src = next.full;
  }
}

function openLightbox(index) {
  currentPreviewIndex = index;
  updateLightbox();
  lightbox.classList.remove("hidden");
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  lightboxImage.removeAttribute("src");
}

lightboxCloseBtn.addEventListener("click", closeLightbox);

// Clicking the dark area outside the photo closes the preview
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});

lightboxPrevBtn.addEventListener("click", () => {
  if (currentPreviewIndex > 0) {
    currentPreviewIndex--;
    updateLightbox();
  }
});

lightboxNextBtn.addEventListener("click", () => {
  if (currentPreviewIndex < photos.length - 1) {
    currentPreviewIndex++;
    updateLightbox();
  }
});

// The Select button inside the lightbox uses the same function as the card button,
// so the maximum limit and warning dialog stay a single source of truth
lightboxSelectBtn.addEventListener("click", () => {
  toggleSelection(currentPreviewIndex);
});

document.addEventListener("keydown", (e) => {
  if (lightbox.classList.contains("hidden")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft" && !lightboxPrevBtn.disabled)
    lightboxPrevBtn.click();
  if (e.key === "ArrowRight" && !lightboxNextBtn.disabled)
    lightboxNextBtn.click();
});

init();