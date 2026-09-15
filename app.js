const SUPABASE_URL = 'https://plygmheahsipkioxgcdq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1VS1EzGcGynCL1PCs2nn7A_t6vnsrg-';
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let sessionUser = null;
let profile = null;
let isSignUp = false;
let cache = { equipment: [], requests: [], maintenance: [], audit: [], profiles: [] };
const $ = (selector) => document.querySelector(selector);
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const role = () => profile?.role || 'requester';
const isAdmin = () => role() === 'administrator';
const canOperate = () => ['administrator', 'staff'].includes(role());

function showToast(message, error = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.style.background = error ? 'var(--orange)' : 'var(--navy)';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3200);
}
function setAuthMessage(message) { $('#auth-message').textContent = message; }
function formatDate(value) { return value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '-'; }
function initials(name) { return (name || 'User').split(' ').map((word) => word[0]).slice(0, 2).join('').toUpperCase(); }
function statusPill(status) { return `<span class="pill ${String(status).toLowerCase().replaceAll(' ', '-')}">${esc(status)}</span>`; }

async function loadProfile(user) {
  const { data, error } = await client.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: created, error: createError } = await client.from('profiles').insert({ id: user.id, full_name: user.user_metadata?.full_name || user.email.split('@')[0], email: user.email }).select().single();
    if (createError) throw createError;
    profile = created;
  } else profile = data;
}
async function loadData() {
  const equipment = await client.from('equipment').select('*').order('equipment_name');
  if (equipment.error) throw equipment.error;
  console.log('Equipment loaded:', equipment.data?.length, equipment.data);
  const [requests, maintenance, audit, profiles] = await Promise.all([
    client.from('borrowing_requests').select('*, equipment(asset_code, equipment_name), requester:profiles!requester_id(full_name), approver:profiles!approved_by(full_name)').order('created_at', { ascending: false }),
    client.from('maintenance').select('*, equipment(asset_code, equipment_name), requester:profiles!requested_by(full_name)').order('created_at', { ascending: false }),
    isAdmin() ? client.from('audit_logs').select('*, user:profiles(full_name)').order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
    isAdmin() ? client.from('profiles').select('*').order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null })
  ]);
  cache = {
    equipment: equipment.data || [],
    requests: requests.error ? [] : requests.data || [],
    maintenance: maintenance.error ? [] : maintenance.data || [],
    audit: audit.error ? [] : audit.data || [],
    profiles: profiles.error ? [] : profiles.data || []
  };
  renderSidebarEquipment();
}

function renderSidebarEquipment() {
  const container = $('#sidebar-equipment');
  if (!container) return;
  const available = cache.equipment.filter((item) => item.available_quantity > 0 && item.status !== 'Maintenance');
  container.innerHTML = available.map((item) => `<button class="nav-child" data-action="request-equipment" data-id="${item.id}"><span>${esc(item.asset_code)}</span> ${esc(item.equipment_name)} <small>(${item.available_quantity} avail)</small></button>`).join('') || '<p class="nav-empty">No available equipment</p>';
}

async function enterApp(user) {
  try {
    await loadProfile(user);
    sessionUser = user;
    $('#auth-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    $('#user-name').textContent = profile.full_name;
    $('#user-role').textContent = role().replace('administrator', 'Administrator').replace('requester', 'Requester').replace('staff', 'Laboratory staff');
    $('#user-initials').textContent = initials(profile.full_name);
    document.querySelectorAll('.admin-only').forEach((item) => item.classList.toggle('hidden', !isAdmin()));
    await navigate('overview');
  } catch (error) { setAuthMessage(error.message); }
}

async function navigate(view) {
  if (['audit', 'users'].includes(view) && !isAdmin()) return showToast('Access denied: administrators only.', true);
  try { await loadData(); } catch (error) { showToast(error.message, true); return; }
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  const page = $('#page-content');
  if (view === 'overview') renderOverview(page);
  if (view === 'equipment') renderEquipment(page);
  if (view === 'requests') renderRequests(page);
  if (view === 'maintenance') renderMaintenance(page);
  if (view === 'audit') renderAudit(page);
  if (view === 'users' && isAdmin()) renderUsers(page);
}
function heading(label, title, copy, button = '') { return `<div class="page-heading"><div><p class="eyebrow">${label}</p><h1>${title}</h1><p class="muted">${copy}</p></div>${button}</div>`; }
function renderOverview(page) {
  page.innerHTML = $('#overview-template').innerHTML;
  $('#heading-name').textContent = profile.full_name.split(' ')[0];
  $('#stat-available').textContent = cache.equipment.reduce((sum, item) => sum + item.available_quantity, 0);
  $('#stat-pending').textContent = cache.requests.filter((item) => item.status === 'Pending').length;
  $('#stat-maintenance').textContent = cache.maintenance.filter((item) => item.status !== 'Completed').length;
  $('#stat-audit').textContent = cache.audit.length;
  const rows = cache.requests.slice(0, 4).map((item) => `<div class="list-row"><div><strong>${esc(item.equipment?.equipment_name)}</strong><small>${esc(item.requester?.full_name || 'You')} · ${formatDate(item.request_date)}</small></div><div>${statusPill(item.status)}</div><small>Qty ${item.quantity}</small></div>`).join('');
  $('#recent-requests').innerHTML = rows || '<p class="muted">No borrowing requests yet.</p>';
}
function renderEquipment(page) {
  const availableCount = cache.equipment.filter((item) => item.available_quantity > 0 && item.status === 'Available').length;
  const addButton = isAdmin() ? '<button class="button primary" data-action="new-equipment">+ Add equipment</button>' : '';
  const rows = cache.equipment.map((item) => `<tr><td><strong>${esc(item.equipment_name)}</strong><small>${esc(item.asset_code)}</small></td><td>${esc(item.category || '-')}</td><td>${item.available_quantity} / ${item.quantity}</td><td>${statusPill(item.status)}</td><td><button class="action-button" data-action="request-equipment" data-id="${item.id}" ${item.available_quantity < 1 || item.status === 'Maintenance' ? 'disabled' : ''}>Request</button></td></tr>`).join('');
  page.innerHTML = heading('INVENTORY / CATALOG', 'Choose equipment', `${availableCount} item${availableCount === 1 ? '' : 's'} available to borrow. Select Request beside an available item.`, addButton) + `<div class="table-wrap"><table class="data-table"><thead><tr><th>Asset</th><th>Category</th><th>Availability</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5">No equipment has been added yet.</td></tr>'}</tbody></table></div>`;
}
function renderRequests(page) {
  const button = '<div class="heading-actions"><button class="button ghost" data-view-link="equipment">Choose equipment</button><button class="button primary" data-action="new-request">+ New request</button></div>';
  page.innerHTML = heading('TRANSACTIONS / BORROWING', 'Borrowing requests', 'Review the request lifecycle and move approved assets through release and return.', button) + `<div class="table-wrap"><table class="data-table"><thead><tr><th>Request</th><th>Requester</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>${cache.requests.map((item) => `<tr><td><strong>${esc(item.equipment?.asset_code)}</strong><small>${esc(item.equipment?.equipment_name)} · Qty ${item.quantity}</small></td><td>${esc(item.requester?.full_name || 'You')}</td><td>${formatDate(item.request_date)}</td><td>${statusPill(item.status)}</td><td>${requestActions(item)}</td></tr>`).join('') || '<tr><td colspan="5">No requests found.</td></tr>'}</tbody></table></div>`;
}
function requestActions(item) {
  if (isAdmin() && item.status === 'Pending') return `<button class="action-button" data-action="approve" data-id="${item.id}">Approve</button> <button class="action-button" data-action="reject" data-id="${item.id}">Reject</button>`;
  if (canOperate() && item.status === 'Approved') return `<button class="action-button" data-action="release" data-id="${item.id}">Release</button>`;
  if (canOperate() && item.status === 'Released') return `<button class="action-button" data-action="return" data-id="${item.id}">Process return</button>`;
  return '<span class="muted">—</span>';
}
function renderMaintenance(page) {
  page.innerHTML = heading('OPERATIONS / SERVICE', 'Maintenance', 'Track equipment issues without hiding them from the audit trail.', '<button class="button primary" data-action="new-maintenance">+ Log issue</button>') + `<div class="table-wrap"><table class="data-table"><thead><tr><th>Equipment</th><th>Issue</th><th>Requested by</th><th>Status</th><th>Action</th></tr></thead><tbody>${cache.maintenance.map((item) => `<tr><td><strong>${esc(item.equipment?.asset_code)}</strong><small>${esc(item.equipment?.equipment_name)}</small></td><td>${esc(item.issue_description)}</td><td>${esc(item.requester?.full_name || '—')}</td><td>${statusPill(item.status)}</td><td>${isAdmin() && item.status !== 'Completed' ? `<button class="action-button" data-action="complete-maintenance" data-id="${item.id}">Complete</button>` : '—'}</td></tr>`).join('') || '<tr><td colspan="5">No maintenance issues found.</td></tr>'}</tbody></table></div>`;
}
function renderAudit(page) {
  page.innerHTML = heading('CONTROL / EVIDENCE', 'Audit trail', 'Critical actions recorded with actor, module, and timestamp.') + `<div class="table-wrap"><table class="data-table"><thead><tr><th>Action</th><th>Module</th><th>Description</th><th>Actor</th><th>Time</th></tr></thead><tbody>${cache.audit.map((item) => `<tr><td>${statusPill(item.action)}</td><td>${esc(item.module)}</td><td>${esc(item.description || '-')}</td><td>${esc(item.user?.full_name || 'Unknown')}</td><td>${formatDate(item.created_at)}</td></tr>`).join('') || '<tr><td colspan="5">No audit events found.</td></tr>'}</tbody></table></div>`;
}
function renderUsers(page) {
  page.innerHTML = heading('CONTROL / USERS', 'User access', 'All registered accounts and their current system role.') + `<div class="table-wrap"><table class="data-table"><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead><tbody>${cache.profiles.map((item) => `<tr><td><strong>${esc(item.full_name)}</strong></td><td>${esc(item.email || '-')}</td><td>${statusPill(profileRoleLabel(item.role))}</td><td>${formatDate(item.created_at)}</td></tr>`).join('') || '<tr><td colspan="4">No profiles found.</td></tr>'}</tbody></table></div>`;
}

function openModal(title, body) {
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="modal"><div class="modal"><h2>${title}</h2>${body}<div class="modal-actions"><button class="button ghost" data-action="close-modal">Cancel</button><button class="button primary" data-action="modal-submit">Save</button></div></div></div>`);
}
function openRequestModal(selectedId = '') {
  const choices = cache.equipment.filter((item) => item.available_quantity > 0 && item.status !== 'Maintenance').map((item) => `<option value="${item.id}" ${String(item.id) === String(selectedId) ? 'selected' : ''}>${esc(item.asset_code)} · ${esc(item.equipment_name)} (${item.available_quantity} available)</option>`).join('');
  if (!choices) {
    showToast('No equipment is currently available to borrow.', true);
    return navigate('equipment');
  }
  openModal('New borrowing request', `<form id="request-form"><label>Equipment<select id="request-equipment" required>${choices}</select></label><label>Quantity<input id="request-quantity" type="number" min="1" value="1" required></label><label>Purpose<textarea id="request-purpose" rows="4" placeholder="What will this equipment support?" required></textarea></label><label>Expected return date<input id="request-return" type="date"></label></form>`);
}
function openMaintenanceModal() { openModal('Log maintenance issue', `<form id="maintenance-form"><label>Equipment<select id="maintenance-equipment" required>${cache.equipment.map((item) => `<option value="${item.id}">${esc(item.asset_code)} · ${esc(item.equipment_name)}</option>`).join('')}</select></label><label>Issue description<textarea id="maintenance-issue" rows="4" required placeholder="Describe the issue"></textarea></label></form>`); }
function openEquipmentModal() { openModal('Add new equipment', `<form id="equipment-form"><label>Asset code<input id="equipment-code" required placeholder="e.g. EQ-001"></label><label>Equipment name<input id="equipment-name" required placeholder="e.g. Microscope"></label><label>Category<select id="equipment-category"><option value="">— Select —</option><option>Microscopy</option><option>Spectroscopy</option><option>Centrifugation</option><option>PCR</option><option>General</option></select></label><label>Total quantity<input id="equipment-quantity" type="number" min="1" value="1" required></label><label>Status<select id="equipment-status"><option value="Available">Available</option><option value="In Use">In Use</option><option value="Maintenance">Maintenance</option><option value="Retired">Retired</option></select></label></form>`); }

async function submitRequest() {
  const equipmentId = Number($('#request-equipment').value);
  const quantity = Number($('#request-quantity').value);
  const equipment = cache.equipment.find((item) => item.id === equipmentId);
  if (!equipment || equipment.status === 'Maintenance' || quantity < 1 || quantity > equipment.available_quantity) return showToast('Requested quantity is not available.', true);
  const { error } = await client.from('borrowing_requests').insert({ requester_id: sessionUser.id, equipment_id: equipmentId, quantity, purpose: $('#request-purpose').value, expected_return_date: $('#request-return').value || null });
  if (error) return showToast(error.message, true);
  $('#modal').remove(); showToast('Request saved as Pending.'); navigate('requests');
}
async function changeRequest(id, nextStatus) {
  const updates = nextStatus === 'Approved'
    ? { status: nextStatus, approved_by: sessionUser.id, approved_at: new Date().toISOString() }
    : { status: nextStatus };
  const { data: request, error: requestError } = await client.from('borrowing_requests').select('*, equipment(asset_code)').eq('id', id).single();
  if (requestError) return showToast(requestError.message, true);
  const { error } = await client.from('borrowing_requests').update(updates).eq('id', id).eq('status', 'Pending');
  if (error) return showToast(error.message, true);
  const action = nextStatus.toUpperCase();
  await client.from('audit_logs').insert({ user_id: sessionUser.id, action, module: 'Borrowing', record_id: id, description: `${nextStatus} borrowing request for ${request.equipment.asset_code}` });
  showToast(`Request ${nextStatus.toLowerCase()}.`); navigate('requests');
}
async function callTransition(action, id, args = {}) {
  const { error } = await client.rpc(action, { p_request_id: id, ...args });
  if (error) return showToast(error.message, true);
  showToast(action === 'release_request' ? 'Equipment released.' : 'Return recorded.'); navigate('requests');
}
async function submitMaintenance() {
  const { error } = await client.from('maintenance').insert({ equipment_id: Number($('#maintenance-equipment').value), requested_by: sessionUser.id, issue_description: $('#maintenance-issue').value });
  if (error) return showToast(error.message, true);
  $('#modal').remove(); showToast('Maintenance issue logged.'); navigate('maintenance');
}
async function submitEquipment() {
  const { error } = await client.from('equipment').insert({ asset_code: $('#equipment-code').value.trim(), equipment_name: $('#equipment-name').value.trim(), category: $('#equipment-category').value || null, quantity: Number($('#equipment-quantity').value), available_quantity: Number($('#equipment-quantity').value), status: $('#equipment-status').value });
  if (error) return showToast(error.message, true);
  $('#modal').remove(); showToast('Equipment added.'); navigate('equipment');
}
async function completeMaintenance(id) {
  const { error } = await client.from('maintenance').update({ status: 'Completed', completed_at: new Date().toISOString() }).eq('id', id);
  if (error) return showToast(error.message, true);
  showToast('Maintenance marked complete.'); navigate('maintenance');
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action], [data-view-link]');
  if (!target) return;
  const action = target.dataset.action;
  if (target.dataset.viewLink) return navigate(target.dataset.viewLink);
  if (action === 'new-request') return openRequestModal();
  if (action === 'request-equipment') return openRequestModal(target.dataset.id);
  if (action === 'new-maintenance') return openMaintenanceModal();
  if (action === 'new-equipment') return openEquipmentModal();
  if (action === 'close-modal') return $('#modal')?.remove();
  if (action === 'modal-submit') {
    event.preventDefault();
    if ($('#request-form')) return submitRequest();
    if ($('#maintenance-form')) return submitMaintenance();
    if ($('#equipment-form')) return submitEquipment();
  }
  if (action === 'approve') return changeRequest(Number(target.dataset.id), 'Approved');
  if (action === 'reject') return changeRequest(Number(target.dataset.id), 'Rejected');
  if (action === 'release') return callTransition('release_request', Number(target.dataset.id));
  if (action === 'return') return callTransition('return_request', Number(target.dataset.id), { p_condition: 'Good' });
  if (action === 'complete-maintenance') return completeMaintenance(Number(target.dataset.id));
});
document.addEventListener('click', (event) => { const nav = event.target.closest('.nav-item'); if (nav) { if (nav.classList.contains('nav-parent')) { const children = $('#sidebar-equipment'); children.style.display = children.style.display === 'none' ? 'block' : 'none'; nav.classList.toggle('expanded'); return; } navigate(nav.dataset.view); } });

$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault(); setAuthMessage('');
  const email = $('#email').value; const password = $('#password').value;
  const selectedRole = $('#login-role').value;
  if (isSignUp && selectedRole !== 'requester') return setAuthMessage('New accounts start as Requester / Viewer. An administrator must assign Staff or Administrator access.');
  const response = isSignUp ? await client.auth.signUp({ email, password, options: { data: { full_name: $('#full-name').value } } }) : await client.auth.signInWithPassword({ email, password });
  if (response.error) return setAuthMessage(response.error.message);
  if (isSignUp && !response.data.session) return setAuthMessage('Account created. Check your email to confirm, then sign in.');
  if (response.data.user) {
    await loadProfile(response.data.user);
    if (!isSignUp && profile.role !== selectedRole) {
      const assignedRole = profile.role;
      await client.auth.signOut();
      profile = null;
      return setAuthMessage(`This account is assigned as ${profileRoleLabel(assignedRole)}. Select the role assigned to this account.`);
    }
    enterApp(response.data.user);
  }
});
function profileRoleLabel(value) { return value === 'administrator' ? 'Administrator' : value === 'staff' ? 'Laboratory Staff' : 'Requester / Viewer'; }
$('#toggle-signup').addEventListener('click', () => { isSignUp = !isSignUp; $('#name-field').classList.toggle('hidden', !isSignUp); $('#auth-submit').textContent = isSignUp ? 'Create account' : 'Sign in'; $('#toggle-signup').textContent = isSignUp ? 'Back to sign in' : 'Create account'; });
$('#sign-out').addEventListener('click', async () => { await client.auth.signOut(); location.reload(); });
client.auth.onAuthStateChange((_event, currentSession) => { if (currentSession && !sessionUser) enterApp(currentSession.user); });
(async () => { const { data } = await client.auth.getSession(); if (data.session) enterApp(data.session.user); })();
