const ADMIN_EMAIL = 'skyfirst.ec@gmail.com';
const SESSION_DAYS = 7;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith('/api/')) {
        return await api(request, env, url);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error('SFN TNV Portal Error:', error);

      return json(
        {
          ok: false,
          error: 'Lỗi hệ thống.',
          details: String(
            error?.message ||
            error?.stack ||
            error
          )
        },
        500
      );
    }
  }
};

async function api(request, env, url) {
  const method = request.method.toUpperCase();

  /* ======================================================
     TRẠNG THÁI HỆ THỐNG
  ====================================================== */

  if (url.pathname === '/api/status' && method === 'GET') {
    const admin = await env.DB
      .prepare(`
        SELECT id
        FROM users
        WHERE role = 'admin'
        LIMIT 1
      `)
      .first();

    return json({
      ok: true,
      setupRequired: !admin
    });
  }

  /* ======================================================
     KHỞI TẠO QUẢN TRỊ VIÊN ĐẦU TIÊN
  ====================================================== */

  if (url.pathname === '/api/setup' && method === 'POST') {
    const existing = await env.DB
      .prepare(`
        SELECT id
        FROM users
        WHERE role = 'admin'
        LIMIT 1
      `)
      .first();

    if (existing) {
      return json(
        {
          ok: false,
          error: 'Hệ thống đã được thiết lập.'
        },
        409
      );
    }

    const body = await readJson(request);

    const email = normalizeEmail(body.email);
    const fullName = clean(body.fullName, 120);
    const password = String(body.password || '');

    if (email !== ADMIN_EMAIL) {
      return json(
        {
          ok: false,
          error: 'Email Quản trị viên không hợp lệ.'
        },
        403
      );
    }

    if (!fullName) {
      return json(
        {
          ok: false,
          error: 'Vui lòng nhập họ và tên.'
        },
        400
      );
    }

    const passwordError = validatePassword(password);

    if (passwordError) {
      return json(
        {
          ok: false,
          error: passwordError
        },
        400
      );
    }

    const { hash, salt } = await hashPassword(password);

    try {
      await env.DB
        .prepare(`
          INSERT INTO users (
            email,
            full_name,
            role,
            password_hash,
            salt,
            status
          )
          VALUES (?, ?, 'admin', ?, ?, 'active')
        `)
        .bind(
          email,
          fullName,
          hash,
          salt
        )
        .run();
    } catch (error) {
      if (
        String(error)
          .toLowerCase()
          .includes('unique')
      ) {
        return json(
          {
            ok: false,
            error: 'Email Quản trị viên đã tồn tại.'
          },
          409
        );
      }

      throw error;
    }

    return json({
      ok: true,
      message: 'Khởi tạo hệ thống thành công.'
    });
  }

  /* ======================================================
     ĐĂNG NHẬP
  ====================================================== */

  if (url.pathname === '/api/login' && method === 'POST') {
    const body = await readJson(request);

    const email = normalizeEmail(body.email);
    const password = String(body.password || '');

    const user = await env.DB
      .prepare(`
        SELECT *
        FROM users
        WHERE email = ?
        LIMIT 1
      `)
      .bind(email)
      .first();

    if (
      !user ||
      user.status !== 'active' ||
      !user.salt ||
      !(await verifyPassword(
        password,
        user.salt,
        user.password_hash
      ))
    ) {
      return json(
        {
          ok: false,
          error: 'Email hoặc mật khẩu không đúng.'
        },
        401
      );
    }

    await env.DB
      .prepare(`
        DELETE FROM sessions
        WHERE expires_at <= ?
      `)
      .bind(new Date().toISOString())
      .run();

    const token = randomToken(32);
    const tokenHash = await hashSessionToken(token);

    const expiresAt = new Date(
      Date.now() + SESSION_DAYS * 86400000
    ).toISOString();

    await env.DB
      .prepare(`
        INSERT INTO sessions (
          user_id,
          token_hash,
          expires_at
        )
        VALUES (?, ?, ?)
      `)
      .bind(
        user.id,
        tokenHash,
        expiresAt
      )
      .run();

    return json(
      {
        ok: true,
        user: publicUser(user)
      },
      200,
      {
        'Set-Cookie': sessionCookie(
          token,
          SESSION_DAYS
        )
      }
    );
  }

  /* ======================================================
     ĐĂNG XUẤT
  ====================================================== */

  if (url.pathname === '/api/logout' && method === 'POST') {
    const token = getCookie(
      request,
      'sfn_session'
    );

    if (token) {
      const tokenHash = await hashSessionToken(token);

      await env.DB
        .prepare(`
          DELETE FROM sessions
          WHERE token_hash = ?
        `)
        .bind(tokenHash)
        .run();
    }

    return json(
      {
        ok: true
      },
      200,
      {
        'Set-Cookie': sessionCookie('', -1)
      }
    );
  }

  /* ======================================================
     XÁC THỰC
  ====================================================== */

  const user = await requireUser(
    request,
    env
  );

  if (!user) {
    return json(
      {
        ok: false,
        error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'
      },
      401
    );
  }

  /* ======================================================
     HỒ SƠ NGƯỜI DÙNG
  ====================================================== */

  if (url.pathname === '/api/me' && method === 'GET') {
    return json({
      ok: true,
      user: publicUser(user)
    });
  }

  /* ======================================================
     DASHBOARD
  ====================================================== */

  if (
    url.pathname === '/api/dashboard' &&
    method === 'GET'
  ) {
    const [
      registrations,
      tasks,
      contributions,
      certificates
    ] = await Promise.all([
      env.DB
        .prepare(`
          SELECT COUNT(*) AS total
          FROM registrations
          WHERE user_id = ?
            AND status = 'approved'
        `)
        .bind(user.id)
        .first(),

      env.DB
        .prepare(`
          SELECT COUNT(*) AS total
          FROM tasks
          WHERE user_id = ?
            AND status NOT IN ('done', 'cancelled')
        `)
        .bind(user.id)
        .first(),

      env.DB
        .prepare(`
          SELECT COALESCE(SUM(minutes), 0) AS total
          FROM contributions
          WHERE user_id = ?
            AND status = 'verified'
        `)
        .bind(user.id)
        .first(),

      env.DB
        .prepare(`
          SELECT COUNT(*) AS total
          FROM certificates
          WHERE user_id = ?
            AND status = 'valid'
        `)
        .bind(user.id)
        .first()
    ]);

    return json({
      ok: true,
      stats: {
        activities:
          Number(registrations?.total || 0),

        tasks:
          Number(tasks?.total || 0),

        minutes:
          Number(contributions?.total || 0),

        certificates:
          Number(certificates?.total || 0)
      }
    });
  }

  /* ======================================================
     CƠ HỘI TÌNH NGUYỆN
  ====================================================== */

  if (
    url.pathname === '/api/opportunities' &&
    method === 'GET'
  ) {
    const requestedType =
      url.searchParams.get('type');

    const allowedTypes = [
      'class',
      'activity',
      'event',
      'training'
    ];

    const type = allowedTypes.includes(requestedType)
      ? requestedType
      : null;

    let query;

    if (type) {
      query = env.DB
        .prepare(`
          SELECT
            o.id,
            o.type,
            o.title,
            o.description,
            o.start_at,
            o.end_at,
            o.registration_deadline,
            o.status,
            o.unit_id,
            u.name AS unit_name,
            u.code AS unit_code
          FROM opportunities o
          LEFT JOIN units u
            ON u.id = o.unit_id
          WHERE o.status = 'open'
            AND o.type = ?
          ORDER BY
            COALESCE(o.start_at, o.created_at) ASC
        `)
        .bind(type);
    } else {
      query = env.DB.prepare(`
        SELECT
          o.id,
          o.type,
          o.title,
          o.description,
          o.start_at,
          o.end_at,
          o.registration_deadline,
          o.status,
          o.unit_id,
          u.name AS unit_name,
          u.code AS unit_code
        FROM opportunities o
        LEFT JOIN units u
          ON u.id = o.unit_id
        WHERE o.status = 'open'
        ORDER BY
          COALESCE(o.start_at, o.created_at) ASC
      `);
    }

    const { results } = await query.all();

    return json({
      ok: true,
      items: results || []
    });
  }

  /* ======================================================
     ĐĂNG KÝ THAM GIA
  ====================================================== */

  if (
    url.pathname === '/api/registrations' &&
    method === 'POST'
  ) {
    const body = await readJson(request);

    const opportunityId =
      Number(body.opportunityId);

    if (
      !Number.isInteger(opportunityId) ||
      opportunityId < 1
    ) {
      return json(
        {
          ok: false,
          error: 'Nội dung đăng ký không hợp lệ.'
        },
        400
      );
    }

    const opportunity = await env.DB
      .prepare(`
        SELECT
          id,
          registration_deadline
        FROM opportunities
        WHERE id = ?
          AND status = 'open'
        LIMIT 1
      `)
      .bind(opportunityId)
      .first();

    if (!opportunity) {
      return json(
        {
          ok: false,
          error: 'Nội dung này hiện không mở đăng ký.'
        },
        404
      );
    }

    if (opportunity.registration_deadline) {
      const deadline =
        Date.parse(opportunity.registration_deadline);

      if (
        Number.isFinite(deadline) &&
        deadline < Date.now()
      ) {
        return json(
          {
            ok: false,
            error: 'Đã hết thời hạn đăng ký.'
          },
          409
        );
      }
    }

    try {
      await env.DB
        .prepare(`
          INSERT INTO registrations (
            opportunity_id,
            user_id,
            note,
            status
          )
          VALUES (?, ?, ?, 'pending')
        `)
        .bind(
          opportunityId,
          user.id,
          clean(body.note, 1000) || null
        )
        .run();
    } catch (error) {
      if (
        String(error)
          .toLowerCase()
          .includes('unique')
      ) {
        return json(
          {
            ok: false,
            error: 'Bạn đã đăng ký nội dung này.'
          },
          409
        );
      }

      throw error;
    }

    return json({
      ok: true,
      message:
        'Đăng ký đã được ghi nhận và đang chờ xét duyệt.'
    });
  }

  /* ======================================================
     NHIỆM VỤ
  ====================================================== */

  if (
    url.pathname === '/api/tasks' &&
    method === 'GET'
  ) {
    const { results } = await env.DB
      .prepare(`
        SELECT
          id,
          opportunity_id,
          title,
          description,
          due_at,
          status,
          created_at
        FROM tasks
        WHERE user_id = ?
        ORDER BY
          CASE status
            WHEN 'doing' THEN 0
            WHEN 'todo' THEN 1
            WHEN 'done' THEN 2
            ELSE 3
          END,
          due_at ASC
      `)
      .bind(user.id)
      .all();

    return json({
      ok: true,
      items: results || []
    });
  }

  /* ======================================================
     GIẤY CHỨNG NHẬN
  ====================================================== */

  if (
    url.pathname === '/api/certificates' &&
    method === 'GET'
  ) {
    const { results } = await env.DB
      .prepare(`
        SELECT
          code,
          title,
          issued_at,
          status,
          file_url
        FROM certificates
        WHERE user_id = ?
        ORDER BY issued_at DESC
      `)
      .bind(user.id)
      .all();

    return json({
      ok: true,
      items: results || []
    });
  }

  /* ======================================================
     THÔNG BÁO
  ====================================================== */

  if (
    url.pathname === '/api/notifications' &&
    method === 'GET'
  ) {
    const { results } = await env.DB
      .prepare(`
        SELECT
          id,
          title,
          message,
          is_read,
          created_at
        FROM notifications
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 100
      `)
      .bind(user.id)
      .all();

    return json({
      ok: true,
      items: results || []
    });
  }

  /* ======================================================
     TÀI LIỆU
  ====================================================== */

  if (
    url.pathname === '/api/documents' &&
    method === 'GET'
  ) {
    const { results } = await env.DB
      .prepare(`
        SELECT
          d.id,
          d.title,
          d.description,
          d.file_url,
          d.created_at,
          d.unit_id,
          u.name AS unit_name
        FROM documents d
        LEFT JOIN units u
          ON u.id = d.unit_id
        WHERE d.status = 'active'
        ORDER BY d.created_at DESC
      `)
      .all();

    return json({
      ok: true,
      items: results || []
    });
  }

  /* ======================================================
     HỖ TRỢ
  ====================================================== */

  if (
    url.pathname === '/api/support' &&
    method === 'POST'
  ) {
    const body = await readJson(request);

    const subject =
      clean(body.subject, 180);

    const message =
      clean(body.message, 3000);

    if (!subject || !message) {
      return json(
        {
          ok: false,
          error:
            'Vui lòng nhập tiêu đề và nội dung hỗ trợ.'
        },
        400
      );
    }

    await env.DB
      .prepare(`
        INSERT INTO support_tickets (
          user_id,
          subject,
          message,
          status
        )
        VALUES (?, ?, ?, 'open')
      `)
      .bind(
        user.id,
        subject,
        message
      )
      .run();

    return json({
      ok: true,
      message: 'Yêu cầu hỗ trợ đã được gửi.'
    });
  }

  /* ======================================================
     QUẢN TRỊ
  ====================================================== */

  if (url.pathname.startsWith('/api/admin/')) {
    if (user.role !== 'admin') {
      return json(
        {
          ok: false,
          error:
            'Bạn không có quyền thực hiện thao tác này.'
        },
        403
      );
    }

    /* DANH SÁCH TÀI KHOẢN */

    if (
      url.pathname === '/api/admin/users' &&
      method === 'GET'
    ) {
      const { results } = await env.DB
        .prepare(`
          SELECT
            id,
            email,
            full_name,
            role,
            status,
            created_at,
            updated_at
          FROM users
          ORDER BY created_at DESC
        `)
        .all();

      return json({
        ok: true,
        items: results || []
      });
    }

    /* CẤP TÀI KHOẢN TNV */

    if (
      url.pathname === '/api/admin/users' &&
      method === 'POST'
    ) {
      const body = await readJson(request);

      const email =
        normalizeEmail(body.email);

      const fullName =
        clean(body.fullName, 120);

      const password =
        String(body.password || '');

      if (
        !isValidEmail(email) ||
        !fullName
      ) {
        return json(
          {
            ok: false,
            error:
              'Vui lòng nhập họ tên và email hợp lệ.'
          },
          400
        );
      }

      const passwordError =
        validatePassword(password);

      if (passwordError) {
        return json(
          {
            ok: false,
            error: passwordError
          },
          400
        );
      }

      const { hash, salt } =
        await hashPassword(password);

      try {
        await env.DB
          .prepare(`
            INSERT INTO users (
              email,
              full_name,
              role,
              password_hash,
              salt,
              status
            )
            VALUES (
              ?,
              ?,
              'volunteer',
              ?,
              ?,
              'active'
            )
          `)
          .bind(
            email,
            fullName,
            hash,
            salt
          )
          .run();
      } catch (error) {
        if (
          String(error)
            .toLowerCase()
            .includes('unique')
        ) {
          return json(
            {
              ok: false,
              error:
                'Email này đã có tài khoản.'
            },
            409
          );
        }

        throw error;
      }

      return json({
        ok: true,
        message:
          'Tài khoản tình nguyện viên đã được cấp.'
      });
    }

    /* DANH SÁCH ĐƠN VỊ */

    if (
      url.pathname === '/api/admin/units' &&
      method === 'GET'
    ) {
      const { results } = await env.DB
        .prepare(`
          SELECT
            id,
            name,
            code,
            description,
            status,
            created_at
          FROM units
          ORDER BY name ASC
        `)
        .all();

      return json({
        ok: true,
        items: results || []
      });
    }

    /* TẠO ĐƠN VỊ */

    if (
      url.pathname === '/api/admin/units' &&
      method === 'POST'
    ) {
      const body = await readJson(request);

      const name =
        clean(body.name, 180);

      const code =
        clean(body.code, 50)
          .toUpperCase();

      if (!name) {
        return json(
          {
            ok: false,
            error:
              'Vui lòng nhập tên đơn vị.'
          },
          400
        );
      }

      try {
        await env.DB
          .prepare(`
            INSERT INTO units (
              name,
              code,
              description,
              status
            )
            VALUES (?, ?, ?, 'active')
          `)
          .bind(
            name,
            code || null,
            clean(
              body.description,
              1500
            ) || null
          )
          .run();
      } catch (error) {
        if (
          String(error)
            .toLowerCase()
            .includes('unique')
        ) {
          return json(
            {
              ok: false,
              error:
                'Mã đơn vị đã tồn tại.'
            },
            409
          );
        }

        throw error;
      }

      return json({
        ok: true,
        message: 'Đơn vị đã được tạo.'
      });
    }

    /* TẠO NỘI DUNG ĐĂNG KÝ */

    if (
      url.pathname === '/api/admin/opportunities' &&
      method === 'POST'
    ) {
      const body = await readJson(request);

      const type =
        String(body.type || '');

      const title =
        clean(body.title, 180);

      const allowedTypes = [
        'class',
        'activity',
        'event',
        'training'
      ];

      if (
        !allowedTypes.includes(type) ||
        !title
      ) {
        return json(
          {
            ok: false,
            error:
              'Loại hoặc tên nội dung không hợp lệ.'
          },
          400
        );
      }

      let unitId = null;

      if (
        body.unitId !== undefined &&
        body.unitId !== null &&
        body.unitId !== ''
      ) {
        unitId = Number(body.unitId);

        if (
          !Number.isInteger(unitId) ||
          unitId < 1
        ) {
          return json(
            {
              ok: false,
              error:
                'Đơn vị không hợp lệ.'
            },
            400
          );
        }

        const unit = await env.DB
          .prepare(`
            SELECT id
            FROM units
            WHERE id = ?
              AND status = 'active'
            LIMIT 1
          `)
          .bind(unitId)
          .first();

        if (!unit) {
          return json(
            {
              ok: false,
              error:
                'Không tìm thấy đơn vị.'
            },
            404
          );
        }
      }

      const startAt =
        nullableText(body.startAt);

      const endAt =
        nullableText(body.endAt);

      const registrationDeadline =
        nullableText(
          body.registrationDeadline
        );

      if (
        startAt &&
        endAt &&
        Number.isFinite(Date.parse(startAt)) &&
        Number.isFinite(Date.parse(endAt)) &&
        Date.parse(startAt) > Date.parse(endAt)
      ) {
        return json(
          {
            ok: false,
            error:
              'Thời gian kết thúc phải sau thời gian bắt đầu.'
          },
          400
        );
      }

      await env.DB
        .prepare(`
          INSERT INTO opportunities (
            type,
            title,
            unit_id,
            description,
            start_at,
            end_at,
            registration_deadline,
            status,
            created_by
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            'open',
            ?
          )
        `)
        .bind(
          type,
          title,
          unitId,
          clean(
            body.description,
            1500
          ) || null,
          startAt,
          endAt,
          registrationDeadline,
          user.id
        )
        .run();

      return json({
        ok: true,
        message:
          'Nội dung đăng ký đã được tạo.'
      });
    }

    /* DANH SÁCH ĐĂNG KÝ */

    if (
      url.pathname ===
        '/api/admin/registrations' &&
      method === 'GET'
    ) {
      const { results } = await env.DB
        .prepare(`
          SELECT
            r.id,
            r.status,
            r.note,
            r.created_at,

            u.id AS user_id,
            u.full_name,
            u.email,

            o.id AS opportunity_id,
            o.title AS opportunity_title,
            o.type AS opportunity_type

          FROM registrations r

          JOIN users u
            ON u.id = r.user_id

          JOIN opportunities o
            ON o.id = r.opportunity_id

          ORDER BY
            CASE r.status
              WHEN 'pending' THEN 0
              ELSE 1
            END,
            r.created_at DESC
        `)
        .all();

      return json({
        ok: true,
        items: results || []
      });
    }

    /* DUYỆT / TỪ CHỐI */

    const registrationMatch =
      url.pathname.match(
        /^\/api\/admin\/registrations\/(\d+)$/
      );

    if (
      registrationMatch &&
      method === 'PATCH'
    ) {
      const registrationId =
        Number(registrationMatch[1]);

      const body =
        await readJson(request);

      const status =
        String(body.status || '');

      if (
        ![
          'approved',
          'rejected',
          'cancelled'
        ].includes(status)
      ) {
        return json(
          {
            ok: false,
            error:
              'Trạng thái xét duyệt không hợp lệ.'
          },
          400
        );
      }

      const result = await env.DB
        .prepare(`
          UPDATE registrations
          SET
            status = ?,
            reviewed_by = ?,
            reviewed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bind(
          status,
          user.id,
          registrationId
        )
        .run();

      if (!result.meta?.changes) {
        return json(
          {
            ok: false,
            error:
              'Không tìm thấy đăng ký.'
          },
          404
        );
      }

      return json({
        ok: true,
        message:
          'Đã cập nhật trạng thái đăng ký.'
      });
    }
  }

  /* ======================================================
     API KHÔNG TỒN TẠI
  ====================================================== */

  return json(
    {
      ok: false,
      error: 'Không tìm thấy chức năng.'
    },
    404
  );
}

/* ========================================================
   AUTH
======================================================== */

async function requireUser(
  request,
  env
) {
  const token =
    getCookie(
      request,
      'sfn_session'
    );

  if (!token) {
    return null;
  }

  const tokenHash =
    await hashSessionToken(token);

  const row = await env.DB
    .prepare(`
      SELECT u.*
      FROM sessions s

      JOIN users u
        ON u.id = s.user_id

      WHERE s.token_hash = ?
        AND s.expires_at > ?
        AND u.status = 'active'

      LIMIT 1
    `)
    .bind(
      tokenHash,
      new Date().toISOString()
    )
    .first();

  return row || null;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    status: user.status
  };
}

/* ========================================================
   VALIDATION
======================================================== */

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email
  );
}

function clean(value, max) {
  return String(value || '')
    .trim()
    .slice(0, max);
}

function nullableText(value) {
  const text =
    String(value || '').trim();

  return text || null;
}

function validatePassword(password) {
  if (password.length < 10) {
    return 'Mật khẩu phải có ít nhất 10 ký tự.';
  }

  if (!/[A-Z]/.test(password)) {
    return 'Mật khẩu cần có ít nhất 1 chữ hoa.';
  }

  if (!/[a-z]/.test(password)) {
    return 'Mật khẩu cần có ít nhất 1 chữ thường.';
  }

  if (!/[0-9]/.test(password)) {
    return 'Mật khẩu cần có ít nhất 1 chữ số.';
  }

  return '';
}

/* ========================================================
   REQUEST
======================================================== */

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function getCookie(
  request,
  name
) {
  const cookieHeader =
    request.headers.get('Cookie') || '';

  for (const part of cookieHeader.split(';')) {
    const [key, ...value] =
      part.trim().split('=');

    if (key === name) {
      try {
        return decodeURIComponent(
          value.join('=')
        );
      } catch {
        return '';
      }
    }
  }

  return '';
}

/* ========================================================
   SESSION
======================================================== */

function sessionCookie(
  token,
  days
) {
  const maxAge =
    days < 0
      ? 0
      : days * 86400;

  return [
    `sfn_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAge}`
  ].join('; ');
}

function randomToken(bytes) {
  const array =
    new Uint8Array(bytes);

  crypto.getRandomValues(array);

  return base64Url(array);
}

async function hashSessionToken(token) {
  const data =
    new TextEncoder().encode(token);

  const digest =
    await crypto.subtle.digest(
      'SHA-256',
      data
    );

  return base64Url(
    new Uint8Array(digest)
  );
}

function base64Url(bytes) {
  let binary = '';

  for (const byte of bytes) {
    binary +=
      String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/* ========================================================
   PASSWORD
======================================================== */

async function hashPassword(
  password,
  saltBase64
) {
  const salt =
    saltBase64
      ? decodeBase64(saltBase64)
      : crypto.getRandomValues(
          new Uint8Array(16)
        );

  const key =
    await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(
        password
      ),
      'PBKDF2',
      false,
      ['deriveBits']
    );

  const bits =
    await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt,
        iterations: 100000
      },
      key,
      256
    );

  return {
    hash: base64(
      new Uint8Array(bits)
    ),
    salt: base64(salt)
  };
}

async function verifyPassword(
  password,
  salt,
  expected
) {
  if (!salt || !expected) {
    return false;
  }

  const calculated =
    await hashPassword(
      password,
      salt
    );

  return timingSafe(
    calculated.hash,
    expected
  );
}

function base64(bytes) {
  let binary = '';

  for (const byte of bytes) {
    binary +=
      String.fromCharCode(byte);
  }

  return btoa(binary);
}

function decodeBase64(value) {
  return Uint8Array.from(
    atob(value),
    character =>
      character.charCodeAt(0)
  );
}

function timingSafe(a, b) {
  if (
    typeof a !== 'string' ||
    typeof b !== 'string' ||
    a.length !== b.length
  ) {
    return false;
  }

  let result = 0;

  for (
    let index = 0;
    index < a.length;
    index++
  ) {
    result |=
      a.charCodeAt(index) ^
      b.charCodeAt(index);
  }

  return result === 0;
}

/* ========================================================
   RESPONSE
======================================================== */

function json(
  data,
  status = 200,
  headers = {}
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        'Content-Type':
          'application/json; charset=utf-8',
        'Cache-Control':
          'no-store',
        ...headers
      }
    }
  );
}
