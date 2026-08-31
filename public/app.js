const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

let currentUser = null;
let currentType = 'activity';

const labels = {
  class: 'Các lớp học',
  activity: 'Hoạt động',
  event: 'Sự kiện',
  training: 'Đào tạo / Tập huấn'
};

const statusLabels = {
  todo: 'Chưa thực hiện',
  doing: 'Đang thực hiện',
  done: 'Hoàn thành',
  cancelled: 'Đã hủy',
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
  valid: 'Còn hiệu lực',
  revoked: 'Đã thu hồi',
  active: 'Đang hoạt động',
  locked: 'Đã khóa'
};


/* ========================================================
   API
======================================================== */

async function api(path, options = {}) {
  const config = {
    credentials: 'same-origin',
    ...options
  };

  if (
    config.body &&
    typeof config.body === 'string'
  ) {
    config.headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
  }

  const response = await fetch(path, config);

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    if (response.status === 401) {
      currentUser = null;
    }

    throw new Error(
      data.error ||
      'Không thể xử lý yêu cầu.'
    );
  }

  return data;
}


/* ========================================================
   GIAO DIỆN CHUNG
======================================================== */

function toast(message) {
  const element = $('#toast');

  if (!element) return;

  element.textContent = message;
  element.classList.add('show');

  clearTimeout(window.__toastTimer);

  window.__toastTimer = setTimeout(
    () => element.classList.remove('show'),
    3200
  );
}


function showAuth() {
  $('#authView')?.classList.remove('hidden');
  $('#appView')?.classList.add('hidden');
}


function showApp() {
  $('#authView')?.classList.add('hidden');
  $('#appView')?.classList.remove('hidden');
}


function roleName(role) {
  return role === 'admin'
    ? 'Quản trị viên'
    : 'Tình nguyện viên';
}


function statusName(status) {
  return statusLabels[status] || status || '—';
}


function escapeHtml(value) {
  return String(value ?? '')
    .replace(
      /[&<>'"]/g,
      (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      })[character]
    );
}


function formatDate(value) {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(
    'vi-VN',
    {
      dateStyle: 'short',
      timeStyle: 'short'
    }
  ).format(date);
}


function closeModal(modal) {
  if (!modal) return;

  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}


function openModal(modal) {
  if (!modal) return;

  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}


/* ========================================================
   KHỞI ĐỘNG
======================================================== */

async function init() {
  try {
    const status = await api('/api/status');

    $('#showSetup')?.classList.toggle(
      'hidden',
      !status.setupRequired
    );
  } catch (error) {
    toast(error.message);
  }

  try {
    const response = await api('/api/me');

    currentUser = response.user;

    await enterApp();
  } catch {
    showAuth();
  }
}


async function enterApp() {
  if (!currentUser) return;

  showApp();

  $('#userName').textContent =
    currentUser.fullName || '';

  $('#userRole').textContent =
    roleName(currentUser.role);

  $('#profileName').textContent =
    currentUser.fullName || '—';

  $('#profileEmail').textContent =
    currentUser.email || '—';

  $('#profileRole').textContent =
    roleName(currentUser.role);

  $('#profileStatus').textContent =
    statusName(currentUser.status);

  $('#adminMenuBtn')?.classList.toggle(
    'hidden',
    currentUser.role !== 'admin'
  );

  await Promise.allSettled([
    loadDashboard(),
    loadOpportunities(),
    loadTasks(),
    loadCertificates(),
    loadNotifications(),
    loadDocuments()
  ]);

  if (currentUser.role === 'admin') {
    await loadUnits();
  }
}


/* ========================================================
   ĐĂNG NHẬP
======================================================== */

$('#loginForm')?.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    const button =
      event.submitter;

    try {
      if (button) button.disabled = true;

      const response =
        await api(
          '/api/login',
          {
            method: 'POST',

            body: JSON.stringify({
              email:
                $('#loginEmail').value,

              password:
                $('#loginPassword').value
            })
          }
        );

      currentUser = response.user;

      $('#loginPassword').value = '';

      await enterApp();

    } catch (error) {
      toast(error.message);

    } finally {
      if (button) button.disabled = false;
    }
  }
);


/* ========================================================
   SETUP ADMIN
======================================================== */

$('#showSetup')?.addEventListener(
  'click',
  () => {
    $('#loginPane').classList.add(
      'hidden'
    );

    $('#setupPane').classList.remove(
      'hidden'
    );
  }
);


$('#backLogin')?.addEventListener(
  'click',
  () => {
    $('#setupPane').classList.add(
      'hidden'
    );

    $('#loginPane').classList.remove(
      'hidden'
    );
  }
);


$('#setupForm')?.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    const password =
      $('#setupPassword').value;

    const passwordConfirm =
      $('#setupPassword2').value;

    if (password !== passwordConfirm) {
      toast(
        'Hai mật khẩu chưa trùng khớp.'
      );

      return;
    }

    const button =
      event.submitter;

    try {
      if (button) button.disabled = true;

      await api(
        '/api/setup',
        {
          method: 'POST',

          body: JSON.stringify({
            fullName:
              $('#setupName').value,

            email:
              $('#setupEmail').value,

            password
          })
        }
      );

      toast(
        'Khởi tạo hệ thống thành công. Hãy đăng nhập.'
      );

      event.target.reset();

      $('#setupEmail').value =
        'skyfirst.ec@gmail.com';

      $('#setupPane').classList.add(
        'hidden'
      );

      $('#loginPane').classList.remove(
        'hidden'
      );

      $('#showSetup').classList.add(
        'hidden'
      );

      $('#loginEmail').value =
        'skyfirst.ec@gmail.com';

    } catch (error) {
      toast(error.message);

    } finally {
      if (button) button.disabled = false;
    }
  }
);


/* ========================================================
   ĐĂNG XUẤT
======================================================== */

$('#logoutBtn')?.addEventListener(
  'click',
  async () => {
    try {
      await api(
        '/api/logout',
        {
          method: 'POST'
        }
      );
    } catch {
      /* Vẫn thoát giao diện nếu request lỗi */
    } finally {
      currentUser = null;

      closeModal(
        $('#adminModal')
      );

      closeModal(
        $('#registerModal')
      );

      showAuth();
    }
  }
);


/* ========================================================
   MENU
======================================================== */

$('.dropdown-toggle')?.addEventListener(
  'click',
  () => {
    $('#registerMenu')
      ?.classList.toggle('show');
  }
);


$('#menuBtn')?.addEventListener(
  'click',
  () => {
    $('#sidebar')
      ?.classList.toggle('open');
  }
);


$$('.nav-link[href^="#"]').forEach(
  (link) => {
    link.addEventListener(
      'click',
      () => {
        $('#sidebar')
          ?.classList.remove('open');
      }
    );
  }
);


/* ========================================================
   MODAL
======================================================== */

$$('.modal-close').forEach(
  (button) => {
    button.addEventListener(
      'click',
      () => {
        closeModal(
          button.closest('.modal')
        );
      }
    );
  }
);


$$('.modal').forEach(
  (modal) => {
    modal.addEventListener(
      'click',
      (event) => {
        if (event.target === modal) {
          closeModal(modal);
        }
      }
    );
  }
);


document.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Escape') return;

    $$('.modal.show').forEach(
      closeModal
    );

    $('#sidebar')
      ?.classList.remove('open');
  }
);


/* ========================================================
   DASHBOARD
======================================================== */

async function loadDashboard() {
  try {
    const response =
      await api('/api/dashboard');

    const stats =
      response.stats || {};

    $('#statActivities').textContent =
      Number(stats.activities || 0)
        .toLocaleString('vi-VN');

    $('#statTasks').textContent =
      Number(stats.tasks || 0)
        .toLocaleString('vi-VN');

    const hours =
      Number(stats.minutes || 0) / 60;

    $('#statHours').textContent =
      `${hours.toLocaleString(
        'vi-VN',
        {
          maximumFractionDigits: 1
        }
      )} giờ`;

    $('#statCertificates').textContent =
      Number(stats.certificates || 0)
        .toLocaleString('vi-VN');

  } catch (error) {
    toast(error.message);
  }
}


/* ========================================================
   CƠ HỘI
======================================================== */

async function loadOpportunities() {
  try {
    const response =
      await api('/api/opportunities');

    const items =
      response.items || [];

    const container =
      $('#opportunityList');

    if (!items.length) {
      container.innerHTML =
        '<div class="empty">Chưa có nội dung đang mở.</div>';

      renderCalendar([]);

      return;
    }

    container.innerHTML =
      items.map(
        (item) => `
          <article class="op-card">

            <span class="badge">
              ${escapeHtml(
                labels[item.type] ||
                item.type
              )}
            </span>

            <h3>
              ${escapeHtml(item.title)}
            </h3>

            ${
              item.unit_name
                ? `
                  <p>
                    <strong>Đơn vị:</strong>
                    ${escapeHtml(
                      item.unit_name
                    )}
                  </p>
                `
                : ''
            }

            ${
              item.description
                ? `
                  <p>
                    ${escapeHtml(
                      item.description
                    )}
                  </p>
                `
                : ''
            }

            ${
              item.start_at
                ? `
                  <small>
                    Bắt đầu:
                    ${escapeHtml(
                      formatDate(
                        item.start_at
                      )
                    )}
                  </small>
                `
                : ''
            }

            ${
              item.registration_deadline
                ? `
                  <small>
                    Hạn đăng ký:
                    ${escapeHtml(
                      formatDate(
                        item.registration_deadline
                      )
                    )}
                  </small>
                `
                : ''
            }

            <button
              class="btn secondary"
              type="button"
              data-opp="${Number(item.id)}"
              data-type="${escapeHtml(
                item.type
              )}"
            >
              Đăng ký
            </button>

          </article>
        `
      ).join('');

    container
      .querySelectorAll('[data-opp]')
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              openRegister(
                button.dataset.type,
                Number(
                  button.dataset.opp
                )
              );
            }
          );
        }
      );

    renderCalendar(items);

  } catch (error) {
    toast(error.message);
  }
}


$('#refreshOpp')?.addEventListener(
  'click',
  loadOpportunities
);


/* ========================================================
   LỊCH HOẠT ĐỘNG
======================================================== */

function renderCalendar(items) {
  const container =
    $('#calendarList');

  if (!container) return;

  const upcoming =
    (items || [])
      .filter(
        (item) => item.start_at
      )
      .sort(
        (a, b) =>
          new Date(a.start_at) -
          new Date(b.start_at)
      );

  if (!upcoming.length) {
    container.innerHTML =
      '<div class="empty">Chưa có lịch hoạt động sắp tới.</div>';

    return;
  }

  container.innerHTML =
    upcoming.map(
      (item) => `
        <div class="list-item">

          <b>
            ${escapeHtml(item.title)}
          </b>

          <small>
            ${escapeHtml(
              labels[item.type] ||
              item.type
            )}

            ·

            ${escapeHtml(
              formatDate(
                item.start_at
              )
            )}
          </small>

        </div>
      `
    ).join('');
}


/* ========================================================
   NHIỆM VỤ
======================================================== */

async function loadTasks() {
  try {
    const response =
      await api('/api/tasks');

    const items =
      response.items || [];

    const container =
      $('#taskList');

    if (!items.length) {
      container.innerHTML =
        '<div class="empty">Chưa có nhiệm vụ được giao.</div>';

      return;
    }

    container.innerHTML =
      items.map(
        (item) => `
          <div class="list-item">

            <b>
              ${escapeHtml(item.title)}
            </b>

            ${
              item.description
                ? `
                  <p>
                    ${escapeHtml(
                      item.description
                    )}
                  </p>
                `
                : ''
            }

            <small>
              Trạng thái:
              ${escapeHtml(
                statusName(
                  item.status
                )
              )}

              ${
                item.due_at
                  ? `
                    · Hạn:
                    ${escapeHtml(
                      formatDate(
                        item.due_at
                      )
                    )}
                  `
                  : ''
              }
            </small>

          </div>
        `
      ).join('');

  } catch (error) {
    toast(error.message);
  }
}


/* ========================================================
   GIẤY CHỨNG NHẬN
======================================================== */

async function loadCertificates() {
  try {
    const response =
      await api('/api/certificates');

    const items =
      response.items || [];

    const container =
      $('#certificateList');

    if (!items.length) {
      container.innerHTML =
        '<div class="empty">Chưa có giấy chứng nhận.</div>';

      return;
    }

    container.innerHTML =
      items.map(
        (item) => `
          <div class="list-item">

            <b>
              ${escapeHtml(item.title)}
            </b>

            <small>
              Mã:
              ${escapeHtml(item.code)}

              · Ngày cấp:
              ${escapeHtml(
                formatDate(
                  item.issued_at
                )
              )}

              ·
              ${escapeHtml(
                statusName(
                  item.status
                )
              )}
            </small>

          </div>
        `
      ).join('');

  } catch (error) {
    toast(error.message);
  }
}


/* ========================================================
   THÔNG BÁO
======================================================== */

async function loadNotifications() {
  try {
    const response =
      await api('/api/notifications');

    const items =
      response.items || [];

    const container =
      $('#notificationList');

    if (!items.length) {
      container.innerHTML =
        '<div class="empty">Chưa có thông báo mới.</div>';

      return;
    }

    container.innerHTML =
      items.map(
        (item) => `
          <div class="list-item">

            <b>
              ${escapeHtml(item.title)}
            </b>

            <p>
              ${escapeHtml(
                item.message
              )}
            </p>

            <small>
              ${escapeHtml(
                formatDate(
                  item.created_at
                )
              )}
            </small>

          </div>
        `
      ).join('');

  } catch (error) {
    toast(error.message);
  }
}


/* ========================================================
   TÀI LIỆU
======================================================== */

async function loadDocuments() {
  try {
    const response =
      await api('/api/documents');

    const items =
      response.items || [];

    const container =
      $('#documentList');

    if (!items.length) {
      container.innerHTML =
        '<div class="empty">Chưa có tài liệu được phát hành.</div>';

      return;
    }

    container.innerHTML =
      items.map(
        (item) => `
          <div class="list-item">

            <b>
              ${escapeHtml(item.title)}
            </b>

            ${
              item.description
                ? `
                  <p>
                    ${escapeHtml(
                      item.description
                    )}
                  </p>
                `
                : ''
            }

            ${
              item.unit_name
                ? `
                  <small>
                    Đơn vị:
                    ${escapeHtml(
                      item.unit_name
                    )}
                  </small>
                `
                : ''
            }

            ${
              safeUrl(item.file_url)
                ? `
                  <a
                    class="text-btn"
                    href="${escapeHtml(
                      safeUrl(
                        item.file_url
                      )
                    )}"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Xem tài liệu
                  </a>
                `
                : ''
            }

          </div>
        `
      ).join('');

  } catch (error) {
    toast(error.message);
  }
}


function safeUrl(value) {
  if (!value) return '';

  try {
    const url =
      new URL(
        value,
        window.location.origin
      );

    if (
      url.protocol !== 'https:' &&
      url.protocol !== 'http:'
    ) {
      return '';
    }

    return url.href;

  } catch {
    return '';
  }
}


/* ========================================================
   HỖ TRỢ
======================================================== */

$('#supportForm')?.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    const button =
      event.submitter;

    try {
      if (button) button.disabled = true;

      const response =
        await api(
          '/api/support',
          {
            method: 'POST',

            body: JSON.stringify({
              subject:
                $('#supportSubject').value,

              message:
                $('#supportMessage').value
            })
          }
        );

      toast(
        response.message ||
        'Yêu cầu hỗ trợ đã được gửi.'
      );

      event.target.reset();

    } catch (error) {
      toast(error.message);

    } finally {
      if (button) button.disabled = false;
    }
  }
);


/* ========================================================
   ĐĂNG KÝ
======================================================== */

$$(
  '.subnav button, .quick button, .open-register'
).forEach(
  (button) => {
    button.addEventListener(
      'click',
      () => {
        openRegister(
          button.dataset.type
        );
      }
    );
  }
);


async function openRegister(
  type,
  selectedId = null
) {
  if (!labels[type]) {
    toast(
      'Loại đăng ký không hợp lệ.'
    );

    return;
  }

  currentType = type;

  $('#registerTitle').textContent =
    `Đăng ký ${labels[type]}`;

  $('#registerDesc').textContent =
    'Chọn nội dung hiện đang mở đăng ký.';

  const select =
    $('#registerOpportunity');

  select.innerHTML =
    '<option value="">Đang tải...</option>';

  openModal(
    $('#registerModal')
  );

  try {
    const response =
      await api(
        `/api/opportunities?type=${
          encodeURIComponent(type)
        }`
      );

    const items =
      response.items || [];

    if (!items.length) {
      select.innerHTML =
        '<option value="">Hiện chưa có nội dung mở đăng ký</option>';

      return;
    }

    select.innerHTML =
      `
        <option value="">
          — Chọn nội dung —
        </option>
      ` +
      items.map(
        (item) => `
          <option value="${Number(item.id)}">
            ${escapeHtml(item.title)}
            ${
              item.unit_name
                ? ` — ${escapeHtml(
                    item.unit_name
                  )}`
                : ''
            }
          </option>
        `
      ).join('');

    if (selectedId) {
      select.value =
        String(selectedId);
    }

  } catch (error) {
    select.innerHTML =
      '<option value="">Không tải được dữ liệu</option>';

    toast(error.message);
  }
}


$('#registerForm')?.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    const opportunityId =
      Number(
        $('#registerOpportunity').value
      );

    if (
      !Number.isInteger(
        opportunityId
      ) ||
      opportunityId < 1
    ) {
      toast(
        'Vui lòng chọn nội dung đăng ký.'
      );

      return;
    }

    const button =
      event.submitter;

    try {
      if (button) button.disabled = true;

      const response =
        await api(
          '/api/registrations',
          {
            method: 'POST',

            body: JSON.stringify({
              opportunityId,

              note:
                $('#registerNote').value
            })
          }
        );

      toast(
        response.message ||
        'Đăng ký đã được gửi.'
      );

      closeModal(
        $('#registerModal')
      );

      $('#registerNote').value = '';

      await loadDashboard();

      if (
        currentUser?.role === 'admin'
      ) {
        await loadAdminRegistrations();
      }

    } catch (error) {
      toast(error.message);

    } finally {
      if (button) button.disabled = false;
    }
  }
);


/* ========================================================
   QUẢN TRỊ
======================================================== */

$('#adminMenuBtn')?.addEventListener(
  'click',
  async () => {
    if (
      currentUser?.role !== 'admin'
    ) {
      return;
    }

    openModal(
      $('#adminModal')
    );

    await Promise.allSettled([
      loadUnits(),
      loadAdminRegistrations()
    ]);
  }
);


/* ========================================================
   ADMIN - CẤP TÀI KHOẢN
======================================================== */

$('#createUserForm')?.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    const button =
      event.submitter;

    try {
      if (button) button.disabled = true;

      const response =
        await api(
          '/api/admin/users',
          {
            method: 'POST',

            body: JSON.stringify({
              fullName:
                $('#newUserName').value,

              email:
                $('#newUserEmail').value,

              password:
                $('#newUserPassword').value
            })
          }
        );

      toast(
        response.message ||
        'Đã cấp tài khoản tình nguyện viên.'
      );

      event.target.reset();

    } catch (error) {
      toast(error.message);

    } finally {
      if (button) button.disabled = false;
    }
  }
);


/* ========================================================
   ADMIN - ĐƠN VỊ
======================================================== */

async function loadUnits() {
  if (
    currentUser?.role !== 'admin'
  ) {
    return;
  }

  try {
    const response =
      await api('/api/admin/units');

    const items =
      response.items || [];

    const select =
      $('#newOppUnit');

    if (!select) return;

    const selected =
      select.value;

    select.innerHTML =
      `
        <option value="">
          Không chỉ định
        </option>
      ` +
      items
        .filter(
          (item) =>
            item.status === 'active'
        )
        .map(
          (item) => `
            <option value="${Number(item.id)}">
              ${escapeHtml(item.name)}
              ${
                item.code
                  ? ` (${escapeHtml(
                      item.code
                    )})`
                  : ''
              }
            </option>
          `
        ).join('');

    if (
      [...select.options]
        .some(
          (option) =>
            option.value === selected
        )
    ) {
      select.value = selected;
    }

  } catch (error) {
    toast(error.message);
  }
}


$('#createUnitForm')?.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    const button =
      event.submitter;

    try {
      if (button) button.disabled = true;

      await api(
        '/api/admin/units',
        {
          method: 'POST',

          body: JSON.stringify({
            name:
              $('#newUnitName').value,

            code:
              $('#newUnitCode').value,

            description:
              $('#newUnitDescription').value
          })
        }
      );

      toast(
        'Đã thêm đơn vị.'
      );

      event.target.reset();

      await loadUnits();

    } catch (error) {
      toast(error.message);

    } finally {
      if (button) button.disabled = false;
    }
  }
);


/* ========================================================
   ADMIN - TẠO NỘI DUNG
======================================================== */

$('#createOpportunityForm')
  ?.addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();

      const button =
        event.submitter;

      const unitValue =
        $('#newOppUnit').value;

      const unitId =
        unitValue
          ? Number(unitValue)
          : null;

      try {
        if (button) {
          button.disabled = true;
        }

        const response =
          await api(
            '/api/admin/opportunities',
            {
              method: 'POST',

              body: JSON.stringify({
                type:
                  $('#newOppType').value,

                title:
                  $('#newOppTitle').value,

                unitId,

                description:
                  $('#newOppDescription').value,

                startAt:
                  toIsoOrNull(
                    $('#newOppStart').value
                  ),

                endAt:
                  toIsoOrNull(
                    $('#newOppEnd').value
                  ),

                registrationDeadline:
                  toIsoOrNull(
                    $('#newOppDeadline').value
                  )
              })
            }
          );

        toast(
          response.message ||
          'Đã mở nội dung đăng ký.'
        );

        event.target.reset();

        await Promise.allSettled([
          loadOpportunities(),
          loadUnits()
        ]);

      } catch (error) {
        toast(error.message);

      } finally {
        if (button) {
          button.disabled = false;
        }
      }
    }
  );


function toIsoOrNull(value) {
  if (!value) return null;

  const date = new Date(value);

  if (
    Number.isNaN(date.getTime())
  ) {
    return null;
  }

  return date.toISOString();
}


/* ========================================================
   ADMIN - ĐĂNG KÝ CHỜ DUYỆT
======================================================== */

async function loadAdminRegistrations() {
  if (
    currentUser?.role !== 'admin'
  ) {
    return;
  }

  try {
    const response =
      await api(
        '/api/admin/registrations'
      );

    const items =
      response.items || [];

    const container =
      $('#adminRegistrationList');

    if (!container) return;

    if (!items.length) {
      container.innerHTML =
        '<div class="empty">Chưa có đăng ký.</div>';

      return;
    }

    container.innerHTML =
      items.map(
        (item) => `
          <div class="list-item">

            <b>
              ${escapeHtml(
                item.full_name
              )}
            </b>

            <p>
              ${escapeHtml(
                item.opportunity_title
              )}
            </p>

            <small>
              ${escapeHtml(
                item.email
              )}

              ·

              ${escapeHtml(
                statusName(
                  item.status
                )
              )}
            </small>

            ${
              item.note
                ? `
                  <p>
                    Ghi chú:
                    ${escapeHtml(
                      item.note
                    )}
                  </p>
                `
                : ''
            }

            ${
              item.status === 'pending'
                ? `
                  <div class="admin-actions">

                    <button
                      type="button"
                      class="btn secondary"
                      data-registration-action="approved"
                      data-registration-id="${Number(item.id)}"
                    >
                      Duyệt
                    </button>

                    <button
                      type="button"
                      class="text-btn"
                      data-registration-action="rejected"
                      data-registration-id="${Number(item.id)}"
                    >
                      Từ chối
                    </button>

                  </div>
                `
                : ''
            }

          </div>
        `
      ).join('');

    container
      .querySelectorAll(
        '[data-registration-action]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            async () => {
              await reviewRegistration(
                Number(
                  button.dataset
                    .registrationId
                ),

                button.dataset
                  .registrationAction
              );
            }
          );
        }
      );

  } catch (error) {
    toast(error.message);
  }
}


async function reviewRegistration(
  registrationId,
  status
) {
  if (
    !Number.isInteger(
      registrationId
    )
  ) {
    return;
  }

  try {
    await api(
      `/api/admin/registrations/${registrationId}`,
      {
        method: 'PATCH',

        body: JSON.stringify({
          status
        })
      }
    );

    toast(
      status === 'approved'
        ? 'Đã duyệt đăng ký.'
        : 'Đã từ chối đăng ký.'
    );

    await Promise.allSettled([
      loadAdminRegistrations(),
      loadDashboard()
    ]);

  } catch (error) {
    toast(error.message);
  }
}


$('#refreshRegistrations')
  ?.addEventListener(
    'click',
    loadAdminRegistrations
  );


/* ========================================================
   KHỞI CHẠY
======================================================== */

init();
