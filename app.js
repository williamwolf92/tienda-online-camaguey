/* --- Dynamic loader: read productos.json and render product cards --- */

/* Cart is persisted to localStorage. The in-memory 'cart' is an array of
   { item: {name, priceValue, priceDisplay, image}, qty } objects. */

/* ── WhatsApp ──────────────────────────────────────────────────────────
   Número de destino en formato internacional, sin '+' ni espacios.
   Ejemplo: '34612345678' para España, '5491112345678' para Argentina.  */
const WHATSAPP_NUMBER = '5351110757';

/* ── Web3Forms ─────────────────────────────────────────────────────────
   Endpoint de envío por correo. El access_key ya viaja como input oculto
   dentro del formulario (#pedidoForm). */
const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';

const CART_STORAGE_KEY = 'mi_app_carrito_v1';
const cart = [];

/* Map<itemKey, badgeElement> – to update badges without re-rendering cards */
const productBadges = new Map();

function itemKey(item) {
  return `${item.name}|${item.priceValue}`;
}

function parsePrice(priceStr) {
  if (typeof priceStr === 'number') return priceStr;
  const m = String(priceStr).match(/([\d,.]+)/);
  return m ? Number(m[1].replace(',', '.')) : 0;
}

async function fetchTextWithFallback(path) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (res.ok) return await res.text();
  } catch (e) { /* continue */ }
  try {
    return await new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', path, true);
        xhr.overrideMimeType && xhr.overrideMimeType('text/plain; charset=utf-8');
        xhr.onreadystatechange = function () {
          if (xhr.readyState === 4) {
            if (xhr.status === 200 || (xhr.status === 0 && xhr.responseText)) resolve(xhr.responseText);
            else resolve(null);
          }
        };
        xhr.send();
      } catch (err) { resolve(null); }
    });
  } catch (e) { return null; }
}

/* Helper: create a product card element */
function createProductCard(item) {
  const card = document.createElement('div');
  card.className = 'product-card';

  /* Image area */
  const imgWrap = document.createElement('div');
  imgWrap.className = 'product-card-img-wrap';

  if (item.image) {
    const img = document.createElement('img');
    img.className = 'product-card-img';
    img.src = item.image;
    img.alt = item.name;
    img.loading = 'lazy';
    imgWrap.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'product-card-img-placeholder';
    placeholder.textContent = 'Sin imagen';
    imgWrap.appendChild(placeholder);
  }
  card.appendChild(imgWrap);

  /* Text body */
  const body = document.createElement('div');
  body.className = 'product-card-body';

  const name = document.createElement('div');
  name.className = 'product-card-name';
  name.textContent = item.name;

  const price = document.createElement('div');
  price.className = 'product-card-price';
  price.textContent = item.priceDisplay;

  body.appendChild(name);
  body.appendChild(price);
  card.appendChild(body);

  /* Action buttons */
  const actions = document.createElement('div');
  actions.className = 'product-card-actions';

  /* 🛒 add button */
  const addBtn = document.createElement('button');
  addBtn.className = 'card-btn-add';
  addBtn.setAttribute('aria-label', `Añadir ${item.name} al carrito`);

  const btnEmoji = document.createElement('span');
  btnEmoji.textContent = 'Agregar';

  const badge = document.createElement('span');
  badge.className = 'product-badge';
  badge.textContent = '0';
  badge.style.display = 'none';

  /* Register badge in map for later updates */
  productBadges.set(itemKey(item), badge);

  addBtn.appendChild(btnEmoji);
  addBtn.appendChild(badge);

  addBtn.addEventListener('click', () => {
    const existing = cart.find(c => c.item.name === item.name && c.item.priceValue === item.priceValue);
    if (existing) existing.qty++;
    else cart.push({ item, qty: 1 });
    renderCart();
    saveCartToStorage();
  });

  /* ✕ remove button */
  const removeBtn = document.createElement('button');
  removeBtn.className = 'card-btn-remove';
  removeBtn.setAttribute('aria-label', `Quitar ${item.name} del carrito`);
  removeBtn.textContent = '✕';

  removeBtn.addEventListener('click', () => {
    const idx = cart.findIndex(c => c.item.name === item.name && c.item.priceValue === item.priceValue);
    if (idx === -1) return;
    if (cart[idx].qty > 1) cart[idx].qty--;
    else cart.splice(idx, 1);
    renderCart();
    saveCartToStorage();
  });

  actions.appendChild(addBtn);
  actions.appendChild(removeBtn);
  card.appendChild(actions);

  return card;
}

/* Parse a CSV line respecting double-quoted fields (handles commas inside quotes and "" escapes) */
function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += char;
      }
    } else {
      if (char === '"') inQuotes = true;
      else if (char === ',') { fields.push(cur); cur = ''; }
      else cur += char;
    }
  }
  fields.push(cur);
  return fields.map(f => f.trim());
}

/* Parse the inventario.csv format: producto,precio,disponibilidad,foto */
async function loadAndRenderProducts() {
  const container = document.getElementById('menu-container');
  container.innerHTML = '';
  productBadges.clear();

  const showError = (msg) => {
    container.innerHTML = `<p class="load-error">${msg}</p>`;
  };

  try {
    const text = await fetchTextWithFallback('./inventario.csv');
    if (!text) {
      showError('El archivo inventario.csv no se pudo leer (offline o ruta incorrecta).');
      return;
    }

    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (!lines.length) {
      showError('El archivo inventario.csv no contiene datos.');
      return;
    }

    /* Detect and skip header row if present */
    const headerFields = parseCsvLine(lines[0]).map(f => f.toLowerCase());
    const hasHeader = headerFields[0] === 'producto';
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const fragment = document.createDocumentFragment();

    dataLines.forEach(line => {
      const [namePart, pricePart, disponibilidadPart, imagePart] = parseCsvLine(line);

      /* Solo mostrar el producto si disponibilidad es "Si" (no distingue mayúsculas/acentos) */
      const disponibilidad = (disponibilidadPart || '').trim().toLowerCase();
      if (disponibilidad !== 'si' && disponibilidad !== 'sí') return;

      const priceValue = Number(pricePart) || 0;
      const product = {
        name: (namePart || '').trim() || 'Producto',
        priceValue,
        priceDisplay: `$ ${priceValue.toFixed(2)}`,
        image: imagePart ? `img/${imagePart.trim()}` : ''
      };

      fragment.appendChild(createProductCard(product));
    });

    container.appendChild(fragment);

    /* Sync badges with any previously loaded cart */
    updateProductBadges();

  } catch (err) {
    showError(`Imposible leer inventario.csv: ${err.message}`);
    console.error(err);
  }
}

loadAndRenderProducts();

/* --- Barra de búsqueda: filtra las tarjetas de productos en tiempo real --- */
const searchInput = document.getElementById('search-input');
const searchMenuContainer = document.getElementById('menu-container');
let noResultsEl = null;

function normalizeText(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function filterProducts(query) {
  if (!searchMenuContainer) return;
  const q = normalizeText(query.trim());
  const cards = searchMenuContainer.querySelectorAll('.product-card');
  let visibleCount = 0;

  cards.forEach((card) => {
    const nameEl = card.querySelector('.product-card-name');
    const name = nameEl ? normalizeText(nameEl.textContent) : '';
    const matches = q === '' || name.includes(q);
    card.style.display = matches ? '' : 'none';
    if (matches) visibleCount++;
  });

  if (!noResultsEl) {
    noResultsEl = document.createElement('p');
    noResultsEl.id = 'search-no-results';
    noResultsEl.className = 'load-error';
    noResultsEl.textContent = 'No se encontraron productos.';
    searchMenuContainer.insertAdjacentElement('afterend', noResultsEl);
  }
  noResultsEl.style.display = (cards.length > 0 && visibleCount === 0) ? 'block' : 'none';
}

if (searchInput) {
  searchInput.addEventListener('input', () => filterProducts(searchInput.value));
}

/* --- Sidebar cart rendering and controls --- */
const cartSidebar   = document.getElementById('cart-sidebar');
const cartToggle    = document.getElementById('cart-toggle');
const cartItemsList = document.getElementById('cart-items-list');
const cartTotalEl   = document.getElementById('cart-total');
const cartBadge     = document.getElementById('cart-badge');
const orderBtn      = document.getElementById('order-btn');
const cartCloseBtn  = document.getElementById('cart-close-btn');

function openSidebar()  { document.body.classList.add('cart-open');    cartSidebar.setAttribute('aria-hidden', 'false'); }
function closeSidebar() { document.body.classList.remove('cart-open'); cartSidebar.setAttribute('aria-hidden', 'true');  }

cartToggle.addEventListener('click', () => {
  document.body.classList.contains('cart-open') ? closeSidebar() : openSidebar();
});
if (cartCloseBtn) cartCloseBtn.addEventListener('click', closeSidebar);

function formatCurrency(n) {
  return `$ ${Number(n).toFixed(2)}`;
}

function updateOrderBtn() {
  if (orderBtn) orderBtn.disabled = cart.length === 0;
}

/* Storage helpers */
function saveCartToStorage() {
  try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)); } catch (e) { /* ignore */ }
}

function loadCartFromStorage() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    cart.length = 0;
    parsed.forEach(entry => {
      if (entry && entry.item && typeof entry.qty === 'number') {
        cart.push({
          item: {
            name:         String(entry.item.name || 'Producto'),
            priceValue:   Number(entry.item.priceValue) || 0,
            priceDisplay: String(entry.item.priceDisplay || `$ ${(Number(entry.item.priceValue) || 0).toFixed(2)}`),
            image:        String(entry.item.image || '')
          },
          qty: Number(entry.qty)
        });
      }
    });
  } catch (e) { /* ignore */ }
}

/* Update every product-card badge to reflect current cart qty */
function updateProductBadges() {
  productBadges.forEach((badge, key) => {
    const entry = cart.find(c => itemKey(c.item) === key);
    const qty = entry ? entry.qty : 0;
    badge.textContent = String(qty);
    badge.style.display = qty > 0 ? 'inline-flex' : 'none';
  });
}

function renderCart() {
  cartItemsList.innerHTML = '';

  const totalQty = cart.reduce((s, c) => s + c.qty, 0);
  if (cartBadge) {
    cartBadge.textContent = String(totalQty);
    cartBadge.style.display = totalQty > 0 ? 'inline-flex' : 'none';
  }

  updateOrderBtn();
  updateProductBadges();

  if (cart.length === 0) {
    const li = document.createElement('li');
    li.className = 'cart-row';
    li.textContent = 'Carrito vacío. Pulse Agregar en los productos para añadirlos.';
    cartItemsList.appendChild(li);
    cartTotalEl.textContent = formatCurrency(0);
    saveCartToStorage();
    return;
  }

  const fragment = document.createDocumentFragment();

  cart.forEach((entry, idx) => {
    const row = document.createElement('li');
    row.className = 'cart-row';

    const left = document.createElement('div');
    left.className = 'cart-row-left';

    const name = document.createElement('div');
    name.className = 'cart-row-name';
    name.textContent = entry.item.name;

    const price = document.createElement('div');
    price.className = 'cart-row-price';
    price.textContent = entry.item.priceDisplay;

    left.appendChild(name);
    left.appendChild(price);

    const qtyWrap = document.createElement('div');
    qtyWrap.className = 'cart-qty';

    const decr = document.createElement('button');
    decr.className = 'qty-btn';
    decr.textContent = '-';
    decr.addEventListener('click', () => {
      if (entry.qty > 1) entry.qty--;
      else cart.splice(idx, 1);
      renderCart();
      saveCartToStorage();
    });

    const val = document.createElement('div');
    val.className = 'qty-val';
    val.textContent = entry.qty;

    const incr = document.createElement('button');
    incr.className = 'qty-btn';
    incr.textContent = '+';
    incr.addEventListener('click', () => {
      entry.qty++;
      renderCart();
      saveCartToStorage();
    });

    qtyWrap.appendChild(decr);
    qtyWrap.appendChild(val);
    qtyWrap.appendChild(incr);

    row.appendChild(left);
    row.appendChild(qtyWrap);
    fragment.appendChild(row);
  });

  cartItemsList.appendChild(fragment);

  const total = cart.reduce((s, c) => s + c.qty * c.item.priceValue, 0);
  cartTotalEl.textContent = formatCurrency(total);

  saveCartToStorage();
}

/* --- Cart modal (kept for compatibility, not triggered from cards) --- */
const cartModal       = document.getElementById('cart-modal');
const cartBackdrop    = document.getElementById('cart-backdrop');
const cartClose       = document.getElementById('cart-close');
const cartAddBtn      = document.getElementById('cart-add');
const cartCancel      = document.getElementById('cart-cancel');
const counterDecr     = document.getElementById('counter-decr');
const counterIncr     = document.getElementById('counter-incr');
const counterValueEl  = document.getElementById('counter-value');
const cartItemNameEl  = document.getElementById('cart-item-name');
const imgEl           = document.getElementById('cart-item-image');
const placeholderEl   = document.getElementById('cart-item-image-placeholder');

let currentSelecting  = null;
let currentQty        = 1;
let orderOpenTimeoutId = null;

function closeModalAnimated(modalEl, callback, duration = 180) {
  modalEl.classList.add('modal-exiting');
  setTimeout(() => {
    modalEl.classList.add('modal-hidden');
    modalEl.classList.remove('modal-exiting');
    modalEl.setAttribute('aria-hidden', 'true');
    if (callback) callback();
  }, duration);
}

function openCartModal(item) {
  currentSelecting = item;
  currentQty = 1;
  counterValueEl.textContent = '1';
  cartItemNameEl.textContent = `${item.name} - ${item.priceDisplay}`;

  if (imgEl && placeholderEl) {
    const hasImage = Boolean(item.image);
    imgEl.src            = hasImage ? item.image : '';
    imgEl.alt            = hasImage ? item.name : '';
    imgEl.style.display  = hasImage ? 'block' : 'none';
    placeholderEl.style.display = hasImage ? 'none' : 'flex';
  }

  cartModal.classList.remove('modal-hidden');
  cartModal.setAttribute('aria-hidden', 'false');
  closeSidebar();
}

function closeCartModal() {
  closeModalAnimated(cartModal, () => {
    currentSelecting = null;
    currentQty = 1;
  });
}

counterDecr.addEventListener('click', () => {
  if (currentQty > 1) currentQty--;
  counterValueEl.textContent = String(currentQty);
});
counterIncr.addEventListener('click', () => {
  currentQty++;
  counterValueEl.textContent = String(currentQty);
});
cartClose.addEventListener('click', closeCartModal);
cartBackdrop.addEventListener('click', closeCartModal);
cartCancel.addEventListener('click', closeCartModal);

cartAddBtn.addEventListener('click', () => {
  if (!currentSelecting) return;
  const existing = cart.find(c => c.item.name === currentSelecting.name && c.item.priceValue === currentSelecting.priceValue);
  if (existing) existing.qty += currentQty;
  else cart.push({ item: currentSelecting, qty: currentQty });
  renderCart();
  saveCartToStorage();
  closeCartModal();
});

/* --- Ordenar (formulario modal) --- */
const orderModal    = document.getElementById('order-modal');
const orderBackdrop = document.getElementById('order-backdrop');
const orderClose    = document.getElementById('order-close');
const orderCancel   = document.getElementById('order-cancel');
const formItems     = document.getElementById('form-items');
const formTotal     = document.getElementById('form-total');
const formDatetime  = document.getElementById('form-datetime');

if (orderBtn) orderBtn.disabled = true;

function formatLocalDateTimeForForm(date) {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  return `${d}/${m}/${y} - ${hours}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

function openOrderModal() {
  const lines    = cart.map(c => `${c.qty} x ${c.item.name} (${c.item.priceDisplay}) `).join('\n');
  const totalVal = cart.reduce((s, c) => s + c.item.priceValue * c.qty, 0);
  formItems.value = lines;
  formTotal.value = formatCurrency(totalVal);
  if (formDatetime) {
    try { formDatetime.value = formatLocalDateTimeForForm(new Date()); }
    catch (e) { formDatetime.value = ''; }
  }
  orderModal.classList.remove('modal-hidden');
  orderModal.setAttribute('aria-hidden', 'false');
  const nameInput = document.getElementById('cust-name');
  if (nameInput) nameInput.focus();
}

function closeOrderModal() {
  closeModalAnimated(orderModal);
}

if (orderBtn) {
  orderBtn.addEventListener('click', () => {
    closeSidebar();
    if (orderOpenTimeoutId) clearTimeout(orderOpenTimeoutId);
    orderOpenTimeoutId = setTimeout(() => {
      openOrderModal();
      orderOpenTimeoutId = null;
    }, 600);
  });
}
if (orderClose)    orderClose.addEventListener('click', closeOrderModal);
if (orderCancel)   orderCancel.addEventListener('click', closeOrderModal);
if (orderBackdrop) orderBackdrop.addEventListener('click', closeOrderModal);

/* --- Modal de confirmación de envío --- */
const confirmModal  = document.getElementById('confirm-modal');
const confirmYesBtn = document.getElementById('confirm-yes');
const confirmNoBtn  = document.getElementById('confirm-no');
let confirmCountdownId = null;

function openConfirmModal(onConfirm) {
  confirmModal.classList.remove('modal-hidden');
  confirmModal.setAttribute('aria-hidden', 'false');

  let secs = 5;
  confirmYesBtn.disabled = true;
  confirmYesBtn.textContent = `Sí (${secs})`;

  confirmCountdownId = setInterval(() => {
    secs--;
    if (secs > 0) {
      confirmYesBtn.textContent = `Sí (${secs})`;
    } else {
      clearInterval(confirmCountdownId);
      confirmYesBtn.disabled = false;
      confirmYesBtn.textContent = 'Sí';
    }
  }, 1000);

  function cleanup() {
    clearInterval(confirmCountdownId);
    confirmYesBtn.removeEventListener('click', handleYes);
    confirmNoBtn.removeEventListener('click', handleNo);
  }

  function handleYes() { cleanup(); onConfirm(); closeConfirmModal(); }
  function handleNo()  { cleanup(); closeConfirmModal(); }

  confirmYesBtn.addEventListener('click', handleYes);
  confirmNoBtn.addEventListener('click', handleNo);
}

function closeConfirmModal(callback) {
  confirmModal.classList.add('modal-exiting');
  setTimeout(() => {
    confirmModal.classList.add('modal-hidden');
    confirmModal.classList.remove('modal-exiting');
    confirmModal.setAttribute('aria-hidden', 'true');
    if (callback) callback();
  }, 180);
}

/* ── Toast de error ────────────────────────────────────────────────── */
const toastEl        = document.getElementById('toast');
const toastMessageEl = document.getElementById('toast-message');
let toastTimeoutId   = null;

function showToast(message, duration = 4000) {
  if (!toastEl || !toastMessageEl) return;
  toastMessageEl.textContent = message;
  toastEl.classList.remove('toast-hidden');
  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    toastEl.classList.add('toast-hidden');
  }, duration);
}

const pedidoForm   = document.getElementById('pedidoForm');

if (pedidoForm) {
  const submitBtn      = pedidoForm.querySelector('button[type="submit"]');
  const inputName      = document.getElementById('cust-name');
  const inputPhone     = document.getElementById('cust-phone');
  const inputPin       = document.getElementById('cust-pin');
  const inputAddress   = document.getElementById('cust-address');
  const deliveryRadios = Array.from(pedidoForm.querySelectorAll('input[name="Entrega"]'));

  function setSubmitState(enabled) {
    if (submitBtn) submitBtn.disabled = !enabled;
  }

  function updateAddressState() {
    if (!inputAddress) return;
    const domicileSelected = deliveryRadios.some(r => r.checked && r.value === 'Domicilio');
    inputAddress.disabled = !domicileSelected;
    if (!domicileSelected) inputAddress.value = '';
  }

  function validateFormInputs() {
    const nameOk     = inputName  && inputName.value.trim().length > 0;
    const phoneOk    = inputPhone && inputPhone.value.trim().length > 0;
    const pinOk      = inputPin   && String(inputPin.value).trim().length === 4;
    const deliveryOk = deliveryRadios.some(r => r.checked);
    const domicileSelected = deliveryRadios.some(r => r.checked && r.value === 'Domicilio');
    const addressOk  = !domicileSelected || (inputAddress && inputAddress.value.trim().length > 0);
    setSubmitState(nameOk && phoneOk && pinOk && deliveryOk && addressOk);
  }

  [inputName, inputPhone, inputPin, inputAddress].forEach(el => {
    if (!el) return;
    el.addEventListener('input', validateFormInputs);
    el.addEventListener('change', validateFormInputs);
  });
  deliveryRadios.forEach(r => r.addEventListener('change', () => {
    updateAddressState();
    validateFormInputs();
  }));

  updateAddressState();
  validateFormInputs();

  pedidoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submitBtn && submitBtn.disabled) return;

    openConfirmModal(async () => {
      /* Recopilar datos del formulario */
      const nombre    = inputName  ? inputName.value.trim()  : '';
      const telefono  = inputPhone ? inputPhone.value.trim() : '';
      const pin       = inputPin   ? inputPin.value.trim()   : '';
      const entrega   = deliveryRadios.find(r => r.checked)?.value || '';
      const direccion = (entrega === 'Domicilio' && inputAddress) ? inputAddress.value.trim() : '';
      /* Normalizar saltos de línea del textarea (evita \r\n en Windows) */
      const productos = formItems    ? formItems.value.replace(/\r\n|\r/g, '\n') : '';
      const total     = formTotal    ? formTotal.value    : '';
      const datetime  = formDatetime ? formDatetime.value : '';

      /* Construir texto del mensaje */
      const lineas = [
        '\u{1F6D2} *NUEVO PEDIDO*',
        '',
        `\u{1F464} Nombre: ${nombre}`,
        `\u{1F4F1} Telefono: ${telefono}`,
        `\u{1F511} PIN: ${pin}`,
        `\u{1F69A} Entrega: ${entrega}`,
      ];
      if (direccion) lineas.push(`\u{1F4CD} Direccion: ${direccion}`);
      lineas.push('');
      lineas.push('\u{1F4E6} *Productos:*');
      lineas.push(productos.trim());
      lineas.push('');
      lineas.push(`\u{1F4B0} *Total: ${total}*`);
      lineas.push(`\u{1F4C5} ${datetime}`);

      /* Unir con salto de línea y codificar para URL */
      const mensaje = lineas.join('\n');
      const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(mensaje)}`;

      /* Estado "enviando" en el botón mientras se contacta con Web3Forms */
      const originalBtnText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Enviando...';
      }

      try {
        /* Enviar el pedido por correo a través de Web3Forms.
           Se envía únicamente el mensaje ya compilado (el mismo texto que
           recibe WhatsApp), sin los campos individuales del formulario,
           para que el correo llegue limpio y legible. */
        const accessKey = pedidoForm.querySelector('input[name="access_key"]')?.value || '';
        const subject   = pedidoForm.querySelector('input[name="subject"]')?.value   || '';
        const fromName  = pedidoForm.querySelector('input[name="from_name"]')?.value || '';

        const formData = new FormData();
        formData.append('access_key', accessKey);
        formData.append('subject', subject);
        formData.append('from_name', fromName);
        formData.append('message', mensaje);

        const response = await fetch(WEB3FORMS_ENDPOINT, {
          method: 'POST',
          body: formData,
          headers: { Accept: 'application/json' },
        });

        let data = null;
        try { data = await response.json(); } catch (_) { /* respuesta no-JSON */ }

        if (!response.ok || !data || data.success !== true) {
          throw new Error((data && data.message) || 'Fallo en el envío del correo');
        }

        /* Envío correcto: vaciar carrito, persistir y abrir WhatsApp.
           No se muestra la pantalla de éxito de Web3Forms porque nunca
           se navega a su endpoint; todo ocurre vía fetch en segundo plano. */
        pedidoForm.reset();
        formItems.value = '';
        formTotal.value = formatCurrency(0);
        cart.length = 0;
        renderCart();
        saveCartToStorage();
        closeOrderModal();

        window.location.href = url;
      } catch (err) {
        /* Error de envío: no se abre WhatsApp, se muestra un toast y se
           deja el formulario intacto para que el usuario pueda reintentar. */
        showToast('No se pudo enviar el pedido. Por favor, inténtalo de nuevo.');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalBtnText;
        }
      }
    });
  });
}

/* Initialize */
loadCartFromStorage();
renderCart();