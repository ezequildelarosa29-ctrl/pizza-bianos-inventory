// ============================================================
//  PIZZA BIANOS – Main Application Logic
//  Full Firebase Firestore + Auth integration
// ============================================================

import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ──────────────────────────────────────────────────────────
//  GLOBALS
// ──────────────────────────────────────────────────────────
let currentUser    = null;
let currentUserDoc = null;
let stockChart     = null;
let salesChart     = null;

// Pagination state
const PAGE_SIZE = 10;
const pagination = {
  products: { page: 1, data: [] },
  stockin:  { page: 1, data: [] },
  stockout: { page: 1, data: [] },
  sales:    { page: 1, data: [] },
  users:    { page: 1, data: [] },
};

// Delete queue
let pendingDelete = { collection: null, id: null, callback: null };

// ──────────────────────────────────────────────────────────
//  UTILITY HELPERS
// ──────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function showToast(type, message, duration = 3500) {
  const container = $("toastContainer");
  const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || "ℹ️"}</span>
                     <span class="toast-message">${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(110%)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function showLoading(text = "Loading…") {
  $("loadingText").textContent = text;
  $("loadingOverlay").classList.add("active");
}

function hideLoading() {
  $("loadingOverlay").classList.remove("active");
}

function formatDate(val) {
  if (!val) return "—";
  if (val instanceof Timestamp) return val.toDate().toLocaleDateString("en-PH");
  if (val?.seconds) return new Date(val.seconds * 1000).toLocaleDateString("en-PH");
  if (typeof val === "string") return val;
  return "—";
}

function formatCurrency(n) {
  const num = parseFloat(n) || 0;
  return "₱ " + num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function isToday(val) {
  const today = todayStr();
  if (!val) return false;
  if (val instanceof Timestamp) return val.toDate().toISOString().split("T")[0] === today;
  if (val?.seconds) return new Date(val.seconds * 1000).toISOString().split("T")[0] === today;
  if (typeof val === "string") return val === today;
  return false;
}

function genId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

function escHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getInitials(name) {
  return (name || "U").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

// ──────────────────────────────────────────────────────────
//  AUTH GUARD
// ──────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  await loadCurrentUserDoc();
  initApp();
});

async function loadCurrentUserDoc() {
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    if (snap.exists()) {
      currentUserDoc = snap.data();
    } else {
      // Fallback if no Firestore user doc
      currentUserDoc = {
        username: currentUser.email?.split("@")[0] || "Admin",
        role: "Administrator",
        status: "Active"
      };
    }
  } catch {
    currentUserDoc = { username: "Admin", role: "Administrator", status: "Active" };
  }
}

// ──────────────────────────────────────────────────────────
//  APP INIT
// ──────────────────────────────────────────────────────────
function initApp() {
  setUserUI();
  setupNavigation();
  setupModals();
  setupLogout();
  setupMobileMenu();
  setupDeleteModal();

  // Load initial page
  navigateTo("dashboard");
}

function setUserUI() {
  const name = currentUserDoc?.username || currentUser?.email?.split("@")[0] || "Admin";
  const role = currentUserDoc?.role || "Administrator";
  const initials = getInitials(name);

  $("sidebarUserName").textContent = name;
  $("sidebarUserRole").textContent = role;
  $("sidebarAvatar").textContent   = initials;
  $("headerAdminName").textContent = name;
  $("headerAvatar").textContent    = initials;

  // Hide Users nav if not Administrator
  if (role !== "Administrator") {
    $("navUsers").style.display = "none";
  }
}

// ──────────────────────────────────────────────────────────
//  NAVIGATION
// ──────────────────────────────────────────────────────────
const PAGE_META = {
  dashboard: { title: "Dashboard",   breadcrumb: "Pizza Bianos › Dashboard" },
  products:  { title: "Products",    breadcrumb: "Pizza Bianos › Inventory › Products" },
  stockin:   { title: "Stock In",    breadcrumb: "Pizza Bianos › Inventory › Stock In" },
  stockout:  { title: "Stock Out",   breadcrumb: "Pizza Bianos › Inventory › Stock Out" },
  sales:     { title: "Sales",       breadcrumb: "Pizza Bianos › Commerce › Sales" },
  reports:   { title: "Reports",     breadcrumb: "Pizza Bianos › Analytics › Reports" },
  users:     { title: "Users & Settings", breadcrumb: "Pizza Bianos › Admin › Users" },
  settings:  { title: "Users & Settings", breadcrumb: "Pizza Bianos › Admin › Settings" },
};

function setupNavigation() {
  document.querySelectorAll(".nav-link[data-page]").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo(link.dataset.page);
      // Close mobile sidebar
      if (window.innerWidth <= 900) closeSidebar();
    });
  });

  // Dashboard "View All" links
  document.querySelectorAll("[data-page]").forEach(el => {
    if (!el.classList.contains("nav-link")) {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        navigateTo(el.dataset.page);
      });
    }
  });
}

function navigateTo(page) {
  // Settings → redirect to users page
  if (page === "settings") page = "users";

  // Hide all pages
  document.querySelectorAll(".page-content").forEach(p => p.classList.remove("active"));
  // Show target
  const target = $(`page-${page}`);
  if (target) target.classList.add("active");

  // Update nav active state
  document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
  const activeLink = document.querySelector(`.nav-link[data-page="${page}"]`);
  if (activeLink) activeLink.classList.add("active");

  // Update header
  const meta = PAGE_META[page] || { title: page, breadcrumb: `Pizza Bianos › ${page}` };
  $("pageTitle").textContent      = meta.title;
  $("pageBreadcrumb").textContent = meta.breadcrumb;

  // Load page data
  const loaders = {
    dashboard: loadDashboard,
    products:  loadProducts,
    stockin:   loadStockIn,
    stockout:  loadStockOut,
    sales:     loadSales,
    reports:   loadReports,
    users:     loadUsersAndSettings,
  };
  if (loaders[page]) loaders[page]();
}

// ──────────────────────────────────────────────────────────
//  MOBILE MENU
// ──────────────────────────────────────────────────────────
function setupMobileMenu() {
  $("menuToggle").addEventListener("click", () => {
    $("sidebar").classList.toggle("open");
    $("sidebarOverlay").classList.toggle("active");
  });
  $("sidebarOverlay").addEventListener("click", closeSidebar);
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sidebarOverlay").classList.remove("active");
}

// ──────────────────────────────────────────────────────────
//  MODALS
// ──────────────────────────────────────────────────────────
function setupModals() {
  // Close buttons with data-close
  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });
  // Close on overlay click
  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });
}

function openModal(id) {
  $(id).classList.add("active");
}

function closeModal(id) {
  $(id).classList.remove("active");
}

// ──────────────────────────────────────────────────────────
//  LOGOUT
// ──────────────────────────────────────────────────────────
function setupLogout() {
  $("logoutBtn").addEventListener("click", async () => {
    if (!confirm("Are you sure you want to logout?")) return;
    showLoading("Signing out…");
    await signOut(auth);
    window.location.href = "index.html";
  });
}

// ──────────────────────────────────────────────────────────
//  DELETE MODAL
// ──────────────────────────────────────────────────────────
function setupDeleteModal() {
  $("confirmDeleteBtn").addEventListener("click", async () => {
    if (!pendingDelete.id || !pendingDelete.collection) return;
    showLoading("Deleting…");
    try {
      await deleteDoc(doc(db, pendingDelete.collection, pendingDelete.id));
      closeModal("deleteModal");
      showToast("success", "Record deleted successfully.");
      if (pendingDelete.callback) pendingDelete.callback();
    } catch (err) {
      showToast("error", "Failed to delete: " + err.message);
    } finally {
      hideLoading();
      pendingDelete = { collection: null, id: null, callback: null };
    }
  });
}

function confirmDelete(colName, id, message, callback) {
  pendingDelete = { collection: colName, id, callback };
  $("deleteMessage").textContent = message || "Are you sure you want to delete this record? This action cannot be undone.";
  openModal("deleteModal");
}

// ──────────────────────────────────────────────────────────
//  DASHBOARD
// ──────────────────────────────────────────────────────────
async function loadDashboard() {
  showLoading("Loading dashboard…");
  try {
    const [products, stockIns, stockOuts, sales] = await Promise.all([
      getDocs(collection(db, "products")),
      getDocs(collection(db, "stockin")),
      getDocs(collection(db, "stockout")),
      getDocs(collection(db, "sales")),
    ]);

    const prodData  = products.docs.map(d => ({ id: d.id, ...d.data() }));
    const siData    = stockIns.docs.map(d => ({ id: d.id, ...d.data() }));
    const soData    = stockOuts.docs.map(d => ({ id: d.id, ...d.data() }));
    const saleData  = sales.docs.map(d => ({ id: d.id, ...d.data() }));

    // Stats
    const lowStockItems  = prodData.filter(p => (p.quantity || 0) <= (p.reorderLevel || 0));
    const siToday        = siData.filter(s => isToday(s.date));
    const soToday        = soData.filter(s => isToday(s.date));
    const salesToday     = saleData.filter(s => isToday(s.date));
    const salesTodayAmt  = salesToday.reduce((sum, s) => sum + (parseFloat(s.totalAmount) || 0), 0);

    $("statTotalProducts").textContent  = prodData.length;
    $("statLowStock").textContent       = lowStockItems.length;
    $("statStockInToday").textContent   = siToday.reduce((s, r) => s + (parseInt(r.quantity) || 0), 0);
    $("statStockOutToday").textContent  = soToday.reduce((s, r) => s + (parseInt(r.quantity) || 0), 0);
    $("statSalesToday").textContent     = formatCurrency(salesTodayAmt);

    // Low stock table
    renderLowStockTable(lowStockItems);

    // Chart
    buildStockChart(prodData);

    // Recent transactions (last 8)
    const allTrans = [
      ...siData.map(r => ({ ...r, _type: "in",   _label: `Stock In – ${r.product || ""}`,  _time: r.date })),
      ...soData.map(r => ({ ...r, _type: "out",  _label: `Stock Out – ${r.product || ""}`, _time: r.date })),
      ...saleData.map(r => ({ ...r, _type: "sale", _label: `Sale – ${r.customer || "Walk-in"}`, _time: r.date })),
    ].sort((a, b) => {
      const ta = a._time?.seconds || 0;
      const tb = b._time?.seconds || 0;
      return tb - ta;
    }).slice(0, 8);

    renderRecentTransactions(allTrans);

    // Low stock notification badge
    if (lowStockItems.length > 0) {
      const badge = $("notifBadge");
      badge.textContent = lowStockItems.length;
      badge.style.display = "flex";
    }

  } catch (err) {
    showToast("error", "Failed to load dashboard: " + err.message);
  } finally {
    hideLoading();
  }
}

function renderLowStockTable(items) {
  const tbody = $("lowStockTable");
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:28px;" class="text-muted">
      <i class="fa fa-check-circle text-success"></i> All stock levels are healthy!
    </td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(p => `
    <tr>
      <td class="td-bold">${escHtml(p.name)}</td>
      <td>${escHtml(p.category)}</td>
      <td class="text-danger text-bold">${p.quantity ?? 0} ${escHtml(p.unit || "")}</td>
      <td>${p.reorderLevel ?? 0} ${escHtml(p.unit || "")}</td>
      <td><span class="badge badge-danger">Low Stock</span></td>
    </tr>`).join("");
}

function renderRecentTransactions(items) {
  const container = $("recentTransactions");
  if (!items.length) {
    container.innerHTML = `<div class="empty-state" style="padding:30px 10px;">
      <div class="empty-icon">📋</div><p>No recent transactions</p></div>`;
    return;
  }
  const iconMap = { in: "in", out: "out", sale: "sale" };
  const emojiMap = { in: "⬇️", out: "⬆️", sale: "🧾" };
  container.innerHTML = items.map(t => `
    <div class="transaction-item">
      <div class="transaction-info">
        <div class="transaction-type-icon ${iconMap[t._type]}">${emojiMap[t._type]}</div>
        <div class="transaction-desc">
          <div class="name">${escHtml(t._label)}</div>
          <div class="time">${formatDate(t._time)}</div>
        </div>
      </div>
      <button class="btn-view-sm" onclick="App.viewRecord('${t._type}', '${t.id}')">View</button>
    </div>`).join("");
}

function buildStockChart(products) {
  const ctx = document.getElementById("stockChart");
  if (!ctx) return;

  // Take top 8 products by quantity
  const top = [...products].sort((a, b) => (b.quantity || 0) - (a.quantity || 0)).slice(0, 8);

  const labels = top.map(p => p.name || "—");
  const data   = top.map(p => p.quantity || 0);
  const reorder = top.map(p => p.reorderLevel || 0);

  const colors = [
    "#C0392B","#2980B9","#27AE60","#F39C12",
    "#8E44AD","#16A085","#D35400","#2C3E50"
  ];

  if (stockChart) stockChart.destroy();
  stockChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Current Stock",
          data,
          backgroundColor: colors.map(c => c + "CC"),
          borderColor: colors,
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: "Reorder Level",
          data: reorder,
          type: "line",
          borderColor: "#E74C3C",
          borderWidth: 2,
          borderDash: [5, 5],
          pointBackgroundColor: "#E74C3C",
          pointRadius: 4,
          fill: false,
          tension: 0.3,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", labels: { font: { family: "Inter", size: 12 }, usePointStyle: true } },
        tooltip: { mode: "index", intersect: false }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: "Inter", size: 11 } } },
        y: { beginAtZero: true, grid: { color: "#F1F3F5" }, ticks: { font: { family: "Inter", size: 11 } } }
      }
    }
  });
}

// ──────────────────────────────────────────────────────────
//  PRODUCTS
// ──────────────────────────────────────────────────────────
async function loadProducts() {
  showLoading("Loading products…");
  try {
    const snap = await getDocs(query(collection(db, "products"), orderBy("createdAt", "desc")));
    pagination.products.data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderProductsTable();
  } catch (err) {
    showToast("error", "Failed to load products: " + err.message);
  } finally {
    hideLoading();
  }
}

function renderProductsTable() {
  const search   = ($("productSearch")?.value || "").toLowerCase();
  const catFilter = $("productCategoryFilter")?.value || "";

  let filtered = pagination.products.data.filter(p => {
    const matchSearch = !search ||
      (p.name || "").toLowerCase().includes(search) ||
      (p.category || "").toLowerCase().includes(search) ||
      (p.supplier || "").toLowerCase().includes(search);
    const matchCat = !catFilter || p.category === catFilter;
    return matchSearch && matchCat;
  });

  const { page } = pagination.products;
  const total = filtered.length;
  const start = (page - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  const tbody = $("productsTableBody");
  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">
      <div class="empty-icon">📦</div>
      <h3>No products found</h3>
      <p>Add your first product to get started.</p>
    </div></td></tr>`;
  } else {
    tbody.innerHTML = slice.map((p, i) => {
      const isLow = (p.quantity || 0) <= (p.reorderLevel || 0);
      const badge = isLow
        ? `<span class="badge badge-danger">Low Stock</span>`
        : `<span class="badge badge-success">In Stock</span>`;
      return `<tr>
        <td class="text-muted">${start + i + 1}</td>
        <td class="td-bold">${escHtml(p.name)}</td>
        <td>${escHtml(p.category)}</td>
        <td>${escHtml(p.supplier || "—")}</td>
        <td class="${isLow ? "text-danger text-bold" : "td-bold"}">${p.quantity ?? 0}</td>
        <td>${escHtml(p.unit || "—")}</td>
        <td>${p.reorderLevel ?? 0}</td>
        <td>${badge}</td>
        <td>
          <div class="table-actions">
            <button class="action-btn edit" onclick="App.editProduct('${p.id}')" title="Edit">
              <i class="fa fa-pen-to-square"></i>
            </button>
            <button class="action-btn delete" onclick="App.deleteProduct('${p.id}','${escHtml(p.name)}')" title="Delete">
              <i class="fa fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>`;
    }).join("");
  }

  $("productsTableInfo").textContent = `Showing ${Math.min(start + 1, total)}–${Math.min(start + PAGE_SIZE, total)} of ${total} records`;
  renderPagination("productsPagination", total, page, (p) => {
    pagination.products.page = p;
    renderProductsTable();
  });
}

// Product search/filter live
document.addEventListener("DOMContentLoaded", () => {
  $("productSearch")?.addEventListener("input", () => {
    pagination.products.page = 1;
    renderProductsTable();
  });
  $("productCategoryFilter")?.addEventListener("change", () => {
    pagination.products.page = 1;
    renderProductsTable();
  });
});

// Add Product button
$("addProductBtn")?.addEventListener("click", () => {
  clearProductForm();
  $("productModalTitle").textContent = "Add Product";
  $("productId").value = "";
  openModal("productModal");
});

function clearProductForm() {
  ["productName","productCategory","productSupplier","productQuantity",
   "productUnit","productReorderLevel","productPrice","productDescription"].forEach(id => {
    const el = $(id);
    if (el) el.value = "";
  });
}

$("saveProductBtn")?.addEventListener("click", async () => {
  const name     = $("productName").value.trim();
  const category = $("productCategory").value;
  const qty      = parseInt($("productQuantity").value) || 0;
  const unit     = $("productUnit").value.trim();

  if (!name || !category || !unit) {
    showToast("warning", "Please fill in all required fields.");
    return;
  }

  showLoading("Saving product…");
  const id = $("productId").value;

  const data = {
    name,
    category,
    supplier:     $("productSupplier").value.trim(),
    quantity:     qty,
    unit,
    reorderLevel: parseInt($("productReorderLevel").value) || 0,
    price:        parseFloat($("productPrice").value) || 0,
    description:  $("productDescription").value.trim(),
    updatedAt:    serverTimestamp(),
  };

  try {
    if (id) {
      await updateDoc(doc(db, "products", id), data);
      showToast("success", "Product updated successfully.");
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "products"), data);
      showToast("success", "Product added successfully.");
    }
    closeModal("productModal");
    loadProducts();
  } catch (err) {
    showToast("error", "Failed to save product: " + err.message);
  } finally {
    hideLoading();
  }
});

// ──────────────────────────────────────────────────────────
//  STOCK IN
// ──────────────────────────────────────────────────────────
async function loadStockIn() {
  showLoading("Loading stock in records…");
  try {
    const snap = await getDocs(query(collection(db, "stockin"), orderBy("createdAt", "desc")));
    pagination.stockin.data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStockInTable();
  } catch (err) {
    showToast("error", "Failed to load stock in: " + err.message);
  } finally {
    hideLoading();
  }
}

function renderStockInTable() {
  const search     = ($("stockInSearch")?.value || "").toLowerCase();
  const dateFilter = $("stockInDateFilter")?.value || "";

  let filtered = pagination.stockin.data.filter(r => {
    const matchSearch = !search ||
      (r.product || "").toLowerCase().includes(search) ||
      (r.siNumber || "").toLowerCase().includes(search) ||
      (r.supplier || "").toLowerCase().includes(search);
    const matchDate = !dateFilter || r.date === dateFilter;
    return matchSearch && matchDate;
  });

  const { page } = pagination.stockin;
  const total = filtered.length;
  const start = (page - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  const tbody = $("stockInTableBody");
  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
      <div class="empty-icon">📥</div><h3>No stock in records</h3>
      <p>Record your first stock in to get started.</p></div></td></tr>`;
  } else {
    tbody.innerHTML = slice.map((r, i) => `
      <tr>
        <td class="text-muted">${start + i + 1}</td>
        <td class="td-mono">${escHtml(r.siNumber || "—")}</td>
        <td>${r.date || "—"}</td>
        <td class="td-bold">${escHtml(r.product || "—")}</td>
        <td class="td-bold text-success">${r.quantity ?? 0} ${escHtml(r.unit || "")}</td>
        <td>${escHtml(r.supplier || "—")}</td>
        <td>${escHtml(r.receivedBy || "—")}</td>
        <td>
          <div class="table-actions">
            <button class="action-btn view" onclick="App.viewStockIn('${r.id}')" title="View">
              <i class="fa fa-eye"></i>
            </button>
            <button class="action-btn delete" onclick="App.deleteStockIn('${r.id}')" title="Delete">
              <i class="fa fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>`).join("");
  }

  $("stockInTableInfo").textContent = `Showing ${Math.min(start + 1, total)}–${Math.min(start + PAGE_SIZE, total)} of ${total} records`;
  renderPagination("stockInPagination", total, page, (p) => {
    pagination.stockin.page = p;
    renderStockInTable();
  });
}

$("stockInSearch")?.addEventListener("input", () => { pagination.stockin.page = 1; renderStockInTable(); });
$("stockInDateFilter")?.addEventListener("change", () => { pagination.stockin.page = 1; renderStockInTable(); });

$("addStockInBtn")?.addEventListener("click", async () => {
  await populateProductDropdown("stockInProduct");
  $("stockInId").value = "";
  $("stockInModalTitle").textContent = "New Stock In";
  $("stockInDate").value  = todayStr();
  $("stockInQty").value   = "";
  $("stockInSupplier").value = "";
  $("stockInNotes").value = "";
  $("stockInProduct").value = "";
  openModal("stockInModal");
});

$("saveStockInBtn")?.addEventListener("click", async () => {
  const productSel = $("stockInProduct");
  const productId  = productSel.value;
  const productName = productSel.options[productSel.selectedIndex]?.text || "";
  const qty  = parseInt($("stockInQty").value);
  const date = $("stockInDate").value;

  if (!productId || !qty || !date) {
    showToast("warning", "Please fill in all required fields.");
    return;
  }

  showLoading("Saving stock in…");
  try {
    const data = {
      siNumber:   genId("SIN"),
      date,
      product:    productName,
      productId,
      quantity:   qty,
      unit:       productSel.options[productSel.selectedIndex]?.dataset.unit || "",
      supplier:   $("stockInSupplier").value.trim(),
      receivedBy: currentUserDoc?.username || "Admin",
      notes:      $("stockInNotes").value.trim(),
      createdAt:  serverTimestamp(),
      createdBy:  currentUser.uid,
    };
    await addDoc(collection(db, "stockin"), data);

    // Update product quantity
    const prodSnap = await getDoc(doc(db, "products", productId));
    if (prodSnap.exists()) {
      const newQty = (prodSnap.data().quantity || 0) + qty;
      await updateDoc(doc(db, "products", productId), { quantity: newQty, updatedAt: serverTimestamp() });
    }

    closeModal("stockInModal");
    showToast("success", "Stock In recorded successfully.");
    loadStockIn();
  } catch (err) {
    showToast("error", "Failed to save: " + err.message);
  } finally {
    hideLoading();
  }
});

// ──────────────────────────────────────────────────────────
//  STOCK OUT
// ──────────────────────────────────────────────────────────
async function loadStockOut() {
  showLoading("Loading stock out records…");
  try {
    const snap = await getDocs(query(collection(db, "stockout"), orderBy("createdAt", "desc")));
    pagination.stockout.data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStockOutTable();
  } catch (err) {
    showToast("error", "Failed to load stock out: " + err.message);
  } finally {
    hideLoading();
  }
}

function renderStockOutTable() {
  const search     = ($("stockOutSearch")?.value || "").toLowerCase();
  const dateFilter = $("stockOutDateFilter")?.value || "";

  let filtered = pagination.stockout.data.filter(r => {
    const matchSearch = !search ||
      (r.product || "").toLowerCase().includes(search) ||
      (r.soNumber || "").toLowerCase().includes(search) ||
      (r.customer || "").toLowerCase().includes(search);
    const matchDate = !dateFilter || r.date === dateFilter;
    return matchSearch && matchDate;
  });

  const { page } = pagination.stockout;
  const total = filtered.length;
  const start = (page - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  const tbody = $("stockOutTableBody");
  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">
      <div class="empty-icon">📤</div><h3>No stock out records</h3>
      <p>Record your first stock out to get started.</p></div></td></tr>`;
  } else {
    tbody.innerHTML = slice.map((r, i) => `
      <tr>
        <td class="text-muted">${start + i + 1}</td>
        <td class="td-mono">${escHtml(r.soNumber || "—")}</td>
        <td>${r.date || "—"}</td>
        <td class="td-bold">${escHtml(r.product || "—")}</td>
        <td>${escHtml(r.customer || "—")}</td>
        <td class="td-bold text-danger">${r.quantity ?? 0} ${escHtml(r.unit || "")}</td>
        <td>${escHtml(r.usedFor || "—")}</td>
        <td>${escHtml(r.requestedBy || "—")}</td>
        <td>
          <div class="table-actions">
            <button class="action-btn view" onclick="App.viewStockOut('${r.id}')" title="View">
              <i class="fa fa-eye"></i>
            </button>
            <button class="action-btn delete" onclick="App.deleteStockOut('${r.id}')" title="Delete">
              <i class="fa fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>`).join("");
  }

  $("stockOutTableInfo").textContent = `Showing ${Math.min(start + 1, total)}–${Math.min(start + PAGE_SIZE, total)} of ${total} records`;
  renderPagination("stockOutPagination", total, page, (p) => {
    pagination.stockout.page = p;
    renderStockOutTable();
  });
}

$("stockOutSearch")?.addEventListener("input", () => { pagination.stockout.page = 1; renderStockOutTable(); });
$("stockOutDateFilter")?.addEventListener("change", () => { pagination.stockout.page = 1; renderStockOutTable(); });

$("addStockOutBtn")?.addEventListener("click", async () => {
  await populateProductDropdown("stockOutProduct");
  $("stockOutId").value  = "";
  $("stockOutModalTitle").textContent = "New Stock Out";
  $("stockOutDate").value = todayStr();
  $("stockOutQty").value = "";
  $("stockOutCustomer").value = "";
  $("stockOutUsedFor").value = "";
  $("stockOutRequestedBy").value = currentUserDoc?.username || "";
  $("stockOutNotes").value = "";
  $("stockOutProduct").value = "";
  openModal("stockOutModal");
});

$("saveStockOutBtn")?.addEventListener("click", async () => {
  const productSel  = $("stockOutProduct");
  const productId   = productSel.value;
  const productName = productSel.options[productSel.selectedIndex]?.text || "";
  const qty  = parseInt($("stockOutQty").value);
  const date = $("stockOutDate").value;

  if (!productId || !qty || !date) {
    showToast("warning", "Please fill in all required fields.");
    return;
  }

  // Check available stock
  const prodSnap = await getDoc(doc(db, "products", productId));
  if (prodSnap.exists()) {
    const available = prodSnap.data().quantity || 0;
    if (qty > available) {
      showToast("error", `Insufficient stock! Available: ${available} ${prodSnap.data().unit || ""}`);
      return;
    }
  }

  showLoading("Saving stock out…");
  try {
    const data = {
      soNumber:    genId("SOT"),
      date,
      product:     productName,
      productId,
      quantity:    qty,
      unit:        productSel.options[productSel.selectedIndex]?.dataset.unit || "",
      customer:    $("stockOutCustomer").value.trim() || "Walk-in Customer",
      usedFor:     $("stockOutUsedFor").value.trim(),
      requestedBy: $("stockOutRequestedBy").value.trim(),
      notes:       $("stockOutNotes").value.trim(),
      createdAt:   serverTimestamp(),
      createdBy:   currentUser.uid,
    };
    await addDoc(collection(db, "stockout"), data);

    // Deduct product quantity
    if (prodSnap.exists()) {
      const newQty = (prodSnap.data().quantity || 0) - qty;
      await updateDoc(doc(db, "products", productId), { quantity: Math.max(0, newQty), updatedAt: serverTimestamp() });
    }

    closeModal("stockOutModal");
    showToast("success", "Stock Out recorded successfully.");
    loadStockOut();
  } catch (err) {
    showToast("error", "Failed to save: " + err.message);
  } finally {
    hideLoading();
  }
});

// ──────────────────────────────────────────────────────────
//  SALES
// ──────────────────────────────────────────────────────────
async function loadSales() {
  showLoading("Loading sales records…");
  try {
    const snap = await getDocs(query(collection(db, "sales"), orderBy("createdAt", "desc")));
    pagination.sales.data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSalesTable();
  } catch (err) {
    showToast("error", "Failed to load sales: " + err.message);
  } finally {
    hideLoading();
  }
}

function renderSalesTable() {
  const search     = ($("salesSearch")?.value || "").toLowerCase();
  const dateFilter = $("salesDateFilter")?.value || "";
  const payFilter  = $("salesPaymentFilter")?.value || "";

  let filtered = pagination.sales.data.filter(r => {
    const matchSearch = !search ||
      (r.customer || "").toLowerCase().includes(search) ||
      (r.invoiceNumber || "").toLowerCase().includes(search) ||
      (r.items || "").toLowerCase().includes(search);
    const matchDate    = !dateFilter || r.date === dateFilter;
    const matchPayment = !payFilter  || r.payment === payFilter;
    return matchSearch && matchDate && matchPayment;
  });

  const { page } = pagination.sales;
  const total = filtered.length;
  const start = (page - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  const tbody = $("salesTableBody");
  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
      <div class="empty-icon">🧾</div><h3>No sales records</h3>
      <p>Record your first sale to get started.</p></div></td></tr>`;
  } else {
    tbody.innerHTML = slice.map((r, i) => `
      <tr>
        <td class="text-muted">${start + i + 1}</td>
        <td class="td-mono">${escHtml(r.invoiceNumber || "—")}</td>
        <td>${r.date || "—"}</td>
        <td class="td-bold">${escHtml(r.customer || "Walk-in")}</td>
        <td>${r.itemCount ?? "—"}</td>
        <td class="td-bold text-success">${formatCurrency(r.totalAmount)}</td>
        <td><span class="badge badge-info">${escHtml(r.payment || "—")}</span></td>
        <td>
          <div class="table-actions">
            <button class="action-btn view" onclick="App.viewSale('${r.id}')" title="View">
              <i class="fa fa-eye"></i>
            </button>
            <button class="action-btn delete" onclick="App.deleteSale('${r.id}')" title="Delete">
              <i class="fa fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>`).join("");
  }

  $("salesTableInfo").textContent = `Showing ${Math.min(start + 1, total)}–${Math.min(start + PAGE_SIZE, total)} of ${total} records`;
  renderPagination("salesPagination", total, page, (p) => {
    pagination.sales.page = p;
    renderSalesTable();
  });
}

$("salesSearch")?.addEventListener("input", () => { pagination.sales.page = 1; renderSalesTable(); });
$("salesDateFilter")?.addEventListener("change", () => { pagination.sales.page = 1; renderSalesTable(); });
$("salesPaymentFilter")?.addEventListener("change", () => { pagination.sales.page = 1; renderSalesTable(); });

$("addSaleBtn")?.addEventListener("click", () => {
  $("saleId").value = "";
  $("saleModalTitle").textContent = "New Sale";
  $("saleDate").value = todayStr();
  $("saleCustomer").value = "";
  $("saleItems").value = "";
  $("saleItemCount").value = "";
  $("saleTotalAmount").value = "";
  $("salePayment").value = "";
  $("saleNotes").value = "";
  openModal("saleModal");
});

$("saveSaleBtn")?.addEventListener("click", async () => {
  const date   = $("saleDate").value;
  const amount = parseFloat($("saleTotalAmount").value);
  const payment = $("salePayment").value;

  if (!date || !amount || !payment) {
    showToast("warning", "Please fill in all required fields.");
    return;
  }

  showLoading("Saving sale…");
  try {
    const data = {
      invoiceNumber: genId("INV"),
      date,
      customer:      $("saleCustomer").value.trim() || "Walk-in Customer",
      items:         $("saleItems").value.trim(),
      itemCount:     parseInt($("saleItemCount").value) || 1,
      totalAmount:   amount,
      payment,
      notes:         $("saleNotes").value.trim(),
      createdAt:     serverTimestamp(),
      createdBy:     currentUser.uid,
    };
    await addDoc(collection(db, "sales"), data);
    closeModal("saleModal");
    showToast("success", "Sale recorded successfully.");
    loadSales();
  } catch (err) {
    showToast("error", "Failed to save sale: " + err.message);
  } finally {
    hideLoading();
  }
});

// ──────────────────────────────────────────────────────────
//  REPORTS
// ──────────────────────────────────────────────────────────
async function loadReports() {
  // Default date range: this month
  const now   = new Date();
  const from  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const to    = todayStr();
  $("reportDateFrom").value = from;
  $("reportDateTo").value   = to;
  await generateReports(from, to);
}

$("generateReportBtn")?.addEventListener("click", async () => {
  const from = $("reportDateFrom").value;
  const to   = $("reportDateTo").value;
  if (!from || !to) { showToast("warning", "Please select a date range."); return; }
  await generateReports(from, to);
});

async function generateReports(from, to) {
  showLoading("Generating reports…");
  try {
    const [siSnap, soSnap, saleSnap, prodSnap] = await Promise.all([
      getDocs(collection(db, "stockin")),
      getDocs(collection(db, "stockout")),
      getDocs(collection(db, "sales")),
      getDocs(collection(db, "products")),
    ]);

    const siData   = siSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.date >= from && r.date <= to);
    const soData   = soSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.date >= from && r.date <= to);
    const saleData = saleSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.date >= from && r.date <= to);
    const prodData = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lowStock = prodData.filter(p => (p.quantity || 0) <= (p.reorderLevel || 0));

    const totalSales = saleData.reduce((s, r) => s + (parseFloat(r.totalAmount) || 0), 0);

    $("rptStockInCount").textContent   = `${siData.length} records`;
    $("rptStockOutCount").textContent  = `${soData.length} records`;
    $("rptSalesCount").textContent     = `${saleData.length} records`;
    $("rptLowStockCount").textContent  = `${lowStock.length} items`;

    $("summaryStockIn").textContent  = siData.reduce((s, r) => s + (parseInt(r.quantity) || 0), 0) + " units";
    $("summaryStockOut").textContent = soData.reduce((s, r) => s + (parseInt(r.quantity) || 0), 0) + " units";
    $("summarySales").textContent    = formatCurrency(totalSales);
    $("summaryLowStock").textContent = lowStock.length + " items";

    buildSalesTrendChart(saleData, from, to);

    // Store for export
    window._reportData = { siData, soData, saleData, lowStock };

  } catch (err) {
    showToast("error", "Failed to generate reports: " + err.message);
  } finally {
    hideLoading();
  }
}

function buildSalesTrendChart(data, from, to) {
  const ctx = document.getElementById("salesTrendChart");
  if (!ctx) return;

  // Group by date
  const grouped = {};
  data.forEach(r => {
    grouped[r.date] = (grouped[r.date] || 0) + (parseFloat(r.totalAmount) || 0);
  });

  const labels = Object.keys(grouped).sort();
  const values = labels.map(k => grouped[k]);

  if (salesChart) salesChart.destroy();
  salesChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Sales (₱)",
        data: values,
        borderColor: "#C0392B",
        backgroundColor: "rgba(192,57,43,0.08)",
        borderWidth: 2.5,
        pointBackgroundColor: "#C0392B",
        pointRadius: 4,
        fill: true,
        tension: 0.4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => " ₱ " + c.raw.toLocaleString("en-PH", { minimumFractionDigits: 2 })
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: "Inter", size: 11 } } },
        y: {
          beginAtZero: true,
          grid: { color: "#F1F3F5" },
          ticks: {
            font: { family: "Inter", size: 11 },
            callback: v => "₱" + v.toLocaleString()
          }
        }
      }
    }
  });
}

$("closeReportDetail")?.addEventListener("click", () => {
  $("reportDetailSection").style.display = "none";
});

$("exportReportBtn")?.addEventListener("click", () => {
  if (!window._reportData) { showToast("warning", "Generate a report first."); return; }
  exportCSV(window._reportData);
});

function exportCSV({ siData, soData, saleData }) {
  const rows = [
    ["Type", "Date", "Reference", "Product/Customer", "Quantity/Amount", "Notes"],
    ...siData.map(r => ["Stock In", r.date, r.siNumber, r.product, r.quantity, r.notes || ""]),
    ...soData.map(r => ["Stock Out", r.date, r.soNumber, r.product, r.quantity, r.notes || ""]),
    ...saleData.map(r => ["Sale", r.date, r.invoiceNumber, r.customer, r.totalAmount, r.notes || ""]),
  ];
  const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `pizza-bianos-report-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("success", "Report exported as CSV.");
}

// ──────────────────────────────────────────────────────────
//  USERS & SETTINGS
// ──────────────────────────────────────────────────────────
async function loadUsersAndSettings() {
  await Promise.all([loadUsers(), loadSettings()]);
}

async function loadUsers() {
  showLoading("Loading users…");
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
    pagination.users.data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderUsersTable();
  } catch (err) {
    showToast("error", "Failed to load users: " + err.message);
  } finally {
    hideLoading();
  }
}

function renderUsersTable() {
  const search = ($("usersSearch")?.value || "").toLowerCase();
  const filtered = pagination.users.data.filter(u =>
    !search ||
    (u.username || "").toLowerCase().includes(search) ||
    (u.email || "").toLowerCase().includes(search) ||
    (u.role || "").toLowerCase().includes(search)
  );

  const tbody = $("usersTableBody");
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">
      <div class="empty-icon">👥</div><h3>No users found</h3></div></td></tr>`;
  } else {
    tbody.innerHTML = filtered.map((u, i) => {
      const isActive = u.status === "Active";
      const isCurrentUser = u.id === currentUser.uid;
      return `<tr>
        <td class="text-muted">${i + 1}</td>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="user-avatar" style="width:30px;height:30px;font-size:12px;">${getInitials(u.username)}</div>
            <span class="td-bold">${escHtml(u.username)}</span>
            ${isCurrentUser ? `<span class="badge badge-info" style="font-size:0.65rem;">You</span>` : ""}
          </div>
        </td>
        <td>${escHtml(u.email || "—")}</td>
        <td><span class="badge badge-gray">${escHtml(u.role)}</span></td>
        <td><span class="badge ${isActive ? "badge-success" : "badge-danger"}">${u.status}</span></td>
        <td>
          <div class="table-actions">
            <button class="action-btn edit" onclick="App.editUser('${u.id}')" title="Edit">
              <i class="fa fa-pen-to-square"></i>
            </button>
            ${!isCurrentUser ? `
            <button class="action-btn delete" onclick="App.deleteUser('${u.id}','${escHtml(u.username)}')" title="Delete">
              <i class="fa fa-trash"></i>
            </button>` : ""}
          </div>
        </td>
      </tr>`;
    }).join("");
  }
  $("usersTableInfo").textContent = `Showing ${filtered.length} users`;
}

$("usersSearch")?.addEventListener("input", renderUsersTable);

$("addUserBtn")?.addEventListener("click", () => {
  $("userId").value = "";
  $("userModalTitle").textContent = "Add User";
  $("userUsername").value = "";
  $("userEmail").value    = "";
  $("userPassword").value = "";
  $("userRole").value     = "";
  $("userStatus").value   = "Active";
  $("userPasswordField").querySelector("input").required = true;
  openModal("userModal");
});

$("saveUserBtn")?.addEventListener("click", async () => {
  const username = $("userUsername").value.trim();
  const email    = $("userEmail").value.trim();
  const password = $("userPassword").value;
  const role     = $("userRole").value;
  const status   = $("userStatus").value;
  const id       = $("userId").value;

  if (!username || !email || !role) {
    showToast("warning", "Please fill in all required fields.");
    return;
  }

  showLoading("Saving user…");
  try {
    if (id) {
      // Edit existing
      await updateDoc(doc(db, "users", id), { username, role, status, updatedAt: serverTimestamp() });
      showToast("success", "User updated successfully.");
    } else {
      // Create new Firebase Auth user + Firestore doc
      if (!password || password.length < 6) {
        showToast("warning", "Password must be at least 6 characters.");
        hideLoading();
        return;
      }
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "users", cred.user.uid), {
        username, email, role, status,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
      });
      showToast("success", "User created successfully.");
    }
    closeModal("userModal");
    loadUsers();
  } catch (err) {
    const errorMap = {
      "auth/email-already-in-use": "This email is already registered.",
      "auth/weak-password":        "Password must be at least 6 characters.",
      "auth/invalid-email":        "Please enter a valid email address.",
    };
    showToast("error", errorMap[err.code] || err.message);
  } finally {
    hideLoading();
  }
});

// Settings
async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "store"));
    if (snap.exists()) {
      const s = snap.data();
      $("settingsStoreName").value  = s.storeName  || "";
      $("settingsAddress").value    = s.address     || "";
      $("settingsContact").value    = s.contact     || "";
      $("settingsCurrency").value   = s.currency    || "PHP";
      $("settingsLowStock").value   = s.lowStockThreshold || 10;
    }
  } catch {}
}

$("saveSettingsBtn")?.addEventListener("click", async () => {
  showLoading("Saving settings…");
  try {
    await setDoc(doc(db, "settings", "store"), {
      storeName:          $("settingsStoreName").value.trim(),
      address:            $("settingsAddress").value.trim(),
      contact:            $("settingsContact").value.trim(),
      currency:           $("settingsCurrency").value,
      lowStockThreshold:  parseInt($("settingsLowStock").value) || 10,
      updatedAt:          serverTimestamp(),
    });
    showToast("success", "Settings saved successfully.");
  } catch (err) {
    showToast("error", "Failed to save settings: " + err.message);
  } finally {
    hideLoading();
  }
});

// ──────────────────────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────────────────────
async function populateProductDropdown(selectId) {
  const select = $(selectId);
  if (!select) return;
  try {
    const snap = await getDocs(query(collection(db, "products"), orderBy("name")));
    select.innerHTML = `<option value="">Select product</option>` +
      snap.docs.map(d => {
        const p = d.data();
        return `<option value="${d.id}" data-unit="${escHtml(p.unit || "")}">${escHtml(p.name)}</option>`;
      }).join("");
  } catch {}
}

function renderPagination(containerId, total, currentPage, onPageChange) {
  const container = $(containerId);
  if (!container) return;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) { container.innerHTML = ""; return; }

  let html = `<button ${currentPage === 1 ? "disabled" : ""} onclick="(${onPageChange})(${currentPage - 1})">
    <i class="fa fa-chevron-left"></i></button>`;

  for (let p = 1; p <= totalPages; p++) {
    if (
      p === 1 || p === totalPages ||
      (p >= currentPage - 1 && p <= currentPage + 1)
    ) {
      html += `<button class="${p === currentPage ? "active" : ""}" onclick="(${onPageChange})(${p})">${p}</button>`;
    } else if (p === currentPage - 2 || p === currentPage + 2) {
      html += `<button disabled>…</button>`;
    }
  }

  html += `<button ${currentPage === totalPages ? "disabled" : ""} onclick="(${onPageChange})(${currentPage + 1})">
    <i class="fa fa-chevron-right"></i></button>`;
  container.innerHTML = html;
}

// ──────────────────────────────────────────────────────────
//  PUBLIC API (called from HTML onclick)
// ──────────────────────────────────────────────────────────
window.App = {

  // Products
  async editProduct(id) {
    const snap = await getDoc(doc(db, "products", id));
    if (!snap.exists()) return;
    const p = snap.data();
    $("productId").value          = id;
    $("productName").value        = p.name        || "";
    $("productCategory").value    = p.category    || "";
    $("productSupplier").value    = p.supplier    || "";
    $("productQuantity").value    = p.quantity    ?? 0;
    $("productUnit").value        = p.unit        || "";
    $("productReorderLevel").value = p.reorderLevel ?? 0;
    $("productPrice").value       = p.price       || "";
    $("productDescription").value = p.description || "";
    $("productModalTitle").textContent = "Edit Product";
    openModal("productModal");
  },

  deleteProduct(id, name) {
    confirmDelete("products", id, `Delete product "${name}"? This action cannot be undone.`, loadProducts);
  },

  // Stock In
  viewStockIn(id) {
    const r = pagination.stockin.data.find(r => r.id === id);
    if (!r) return;
    $("viewModalTitle").textContent = "Stock In Details";
    $("viewModalBody").innerHTML = viewDetailHTML([
      ["SI Number",    r.siNumber],
      ["Date",         r.date],
      ["Product",      r.product],
      ["Quantity",     `${r.quantity} ${r.unit || ""}`],
      ["Supplier",     r.supplier],
      ["Received By",  r.receivedBy],
      ["Notes",        r.notes || "—"],
    ]);
    openModal("viewModal");
  },

  deleteStockIn(id) {
    confirmDelete("stockin", id, "Delete this stock in record? The product quantity will NOT be automatically reversed.", loadStockIn);
  },

  // Stock Out
  viewStockOut(id) {
    const r = pagination.stockout.data.find(r => r.id === id);
    if (!r) return;
    $("viewModalTitle").textContent = "Stock Out Details";
    $("viewModalBody").innerHTML = viewDetailHTML([
      ["SO Number",    r.soNumber],
      ["Date",         r.date],
      ["Product",      r.product],
      ["Quantity",     `${r.quantity} ${r.unit || ""}`],
      ["Customer",     r.customer],
      ["Used For",     r.usedFor],
      ["Requested By", r.requestedBy],
      ["Notes",        r.notes || "—"],
    ]);
    openModal("viewModal");
  },

  deleteStockOut(id) {
    confirmDelete("stockout", id, "Delete this stock out record? The product quantity will NOT be automatically reversed.", loadStockOut);
  },

  // Sales
  viewSale(id) {
    const r = pagination.sales.data.find(r => r.id === id);
    if (!r) return;
    $("viewModalTitle").textContent = "Sale Details";
    $("viewModalBody").innerHTML = viewDetailHTML([
      ["Invoice #",    r.invoiceNumber],
      ["Date",         r.date],
      ["Customer",     r.customer],
      ["Items",        r.items],
      ["# of Items",   r.itemCount],
      ["Total Amount", formatCurrency(r.totalAmount)],
      ["Payment",      r.payment],
      ["Notes",        r.notes || "—"],
    ]);
    openModal("viewModal");
  },

  deleteSale(id) {
    confirmDelete("sales", id, "Delete this sale record? This action cannot be undone.", loadSales);
  },

  // Users
  async editUser(id) {
    const snap = await getDoc(doc(db, "users", id));
    if (!snap.exists()) return;
    const u = snap.data();
    $("userId").value        = id;
    $("userUsername").value  = u.username || "";
    $("userEmail").value     = u.email    || "";
    $("userPassword").value  = "";
    $("userRole").value      = u.role     || "";
    $("userStatus").value    = u.status   || "Active";
    $("userModalTitle").textContent = "Edit User";
    openModal("userModal");
  },

  deleteUser(id, name) {
    confirmDelete("users", id, `Delete user "${name}"? This only removes the Firestore record, not the Firebase Auth account.`, loadUsers);
  },

  // Reports detail
  showReportDetail(type) {
    if (!window._reportData) return;
    const { siData, soData, saleData, lowStock } = window._reportData;
    const section = $("reportDetailSection");
    section.style.display = "block";
    section.scrollIntoView({ behavior: "smooth" });

    const headerEl = $("reportDetailHeader");
    const bodyEl   = $("reportDetailBody");
    const titleEl  = $("reportDetailTitle");

    if (type === "stockin") {
      titleEl.textContent = "Stock In Report";
      headerEl.innerHTML = `<th>#</th><th>Date</th><th>SI Number</th><th>Product</th><th>Quantity</th><th>Supplier</th><th>Received By</th>`;
      bodyEl.innerHTML = siData.map((r, i) =>
        `<tr><td>${i+1}</td><td>${r.date}</td><td class="td-mono">${escHtml(r.siNumber)}</td>
         <td class="td-bold">${escHtml(r.product)}</td><td>${r.quantity} ${escHtml(r.unit||"")}</td>
         <td>${escHtml(r.supplier||"—")}</td><td>${escHtml(r.receivedBy||"—")}</td></tr>`
      ).join("") || `<tr><td colspan="7" style="text-align:center;padding:20px;" class="text-muted">No records</td></tr>`;

    } else if (type === "stockout") {
      titleEl.textContent = "Stock Out Report";
      headerEl.innerHTML = `<th>#</th><th>Date</th><th>SO Number</th><th>Product</th><th>Quantity</th><th>Customer</th><th>Used For</th>`;
      bodyEl.innerHTML = soData.map((r, i) =>
        `<tr><td>${i+1}</td><td>${r.date}</td><td class="td-mono">${escHtml(r.soNumber)}</td>
         <td class="td-bold">${escHtml(r.product)}</td><td>${r.quantity} ${escHtml(r.unit||"")}</td>
         <td>${escHtml(r.customer||"—")}</td><td>${escHtml(r.usedFor||"—")}</td></tr>`
      ).join("") || `<tr><td colspan="7" style="text-align:center;padding:20px;" class="text-muted">No records</td></tr>`;

    } else if (type === "sales") {
      titleEl.textContent = "Sales Report";
      headerEl.innerHTML = `<th>#</th><th>Date</th><th>Invoice #</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th>`;
      bodyEl.innerHTML = saleData.map((r, i) =>
        `<tr><td>${i+1}</td><td>${r.date}</td><td class="td-mono">${escHtml(r.invoiceNumber)}</td>
         <td class="td-bold">${escHtml(r.customer)}</td><td>${escHtml(r.items||"—")}</td>
         <td class="td-bold text-success">${formatCurrency(r.totalAmount)}</td>
         <td><span class="badge badge-info">${escHtml(r.payment)}</span></td></tr>`
      ).join("") || `<tr><td colspan="7" style="text-align:center;padding:20px;" class="text-muted">No records</td></tr>`;

    } else if (type === "lowstock") {
      titleEl.textContent = "Low Stock Report";
      headerEl.innerHTML = `<th>#</th><th>Product</th><th>Category</th><th>Stock</th><th>Reorder Level</th><th>Status</th>`;
      bodyEl.innerHTML = lowStock.map((p, i) =>
        `<tr><td>${i+1}</td><td class="td-bold">${escHtml(p.name)}</td><td>${escHtml(p.category)}</td>
         <td class="text-danger text-bold">${p.quantity??0} ${escHtml(p.unit||"")}</td>
         <td>${p.reorderLevel??0}</td><td><span class="badge badge-danger">Low Stock</span></td></tr>`
      ).join("") || `<tr><td colspan="6" style="text-align:center;padding:20px;" class="text-muted">All stock levels healthy!</td></tr>`;
    }
  },

  viewRecord(type, id) {
    if (type === "in")   App.viewStockIn(id);
    else if (type === "out")  App.viewStockOut(id);
    else if (type === "sale") App.viewSale(id);
  },
};

// ──────────────────────────────────────────────────────────
//  VIEW DETAIL HTML HELPER
// ──────────────────────────────────────────────────────────
function viewDetailHTML(rows) {
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">` +
    rows.map(([label, val]) => `
      <div style="background:var(--gray-50);border-radius:var(--radius-md);padding:14px;">
        <div style="font-size:0.72rem;font-weight:700;color:var(--gray-500);letter-spacing:0.8px;text-transform:uppercase;margin-bottom:4px;">${escHtml(label)}</div>
        <div style="font-size:0.9rem;font-weight:600;color:var(--gray-800);">${escHtml(String(val ?? "—"))}</div>
      </div>`
    ).join("") + `</div>`;
}
