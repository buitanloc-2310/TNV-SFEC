PRAGMA foreign_keys = ON;

-- =========================================================
-- SKY FIRST NETWORK (SFN)
-- CỔNG TÌNH NGUYỆN VIÊN
-- Cloudflare D1 Database Schema
-- =========================================================


-- 1. TÀI KHOẢN NGƯỜI DÙNG
-- Tài khoản do Quản trị viên cấp, không có đăng ký công khai.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,

  role TEXT NOT NULL DEFAULT 'volunteer'
    CHECK (role IN ('admin', 'volunteer')),

  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'locked')),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- 2. PHIÊN ĐĂNG NHẬP
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,

  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);


-- 3. ĐƠN VỊ THUỘC / TRỰC THUỘC SFN
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  name TEXT NOT NULL,
  code TEXT UNIQUE,

  description TEXT,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- 4. HỒ SƠ TÌNH NGUYỆN VIÊN
CREATE TABLE IF NOT EXISTS volunteer_profiles (
  user_id INTEGER PRIMARY KEY,

  phone TEXT,
  date_of_birth TEXT,

  unit_id INTEGER,

  bio TEXT,
  joined_at TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (unit_id)
    REFERENCES units(id)
    ON DELETE SET NULL
);


-- 5. CƠ HỘI / CHƯƠNG TRÌNH ĐĂNG KÝ
-- class     = lớp học
-- activity  = hoạt động
-- event     = sự kiện
-- training  = đào tạo / tập huấn
CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  type TEXT NOT NULL
    CHECK (type IN ('class', 'activity', 'event', 'training')),

  title TEXT NOT NULL,

  unit_id INTEGER,

  description TEXT,

  start_at TEXT,
  end_at TEXT,

  registration_deadline TEXT,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed', 'cancelled')),

  created_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (unit_id)
    REFERENCES units(id)
    ON DELETE SET NULL,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- 6. ĐĂNG KÝ THAM GIA
CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  opportunity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,

  note TEXT,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'approved',
        'rejected',
        'cancelled'
      )
    ),

  reviewed_by INTEGER,
  reviewed_at TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (opportunity_id, user_id),

  FOREIGN KEY (opportunity_id)
    REFERENCES opportunities(id)
    ON DELETE CASCADE,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (reviewed_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- 7. NHIỆM VỤ / PHÂN CÔNG
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id INTEGER NOT NULL,
  opportunity_id INTEGER,

  title TEXT NOT NULL,
  description TEXT,

  due_at TEXT,

  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'doing', 'done', 'cancelled')),

  assigned_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (opportunity_id)
    REFERENCES opportunities(id)
    ON DELETE SET NULL,

  FOREIGN KEY (assigned_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- 8. ĐIỂM DANH
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id INTEGER NOT NULL,
  opportunity_id INTEGER NOT NULL,

  attendance_date TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'present'
    CHECK (
      status IN (
        'present',
        'absent',
        'late',
        'excused'
      )
    ),

  note TEXT,

  confirmed_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (
    user_id,
    opportunity_id,
    attendance_date
  ),

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (opportunity_id)
    REFERENCES opportunities(id)
    ON DELETE CASCADE,

  FOREIGN KEY (confirmed_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- 9. GHI NHẬN ĐÓNG GÓP
CREATE TABLE IF NOT EXISTS contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id INTEGER NOT NULL,
  opportunity_id INTEGER,

  minutes INTEGER NOT NULL DEFAULT 0
    CHECK (minutes >= 0),

  note TEXT,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected')),

  verified_by INTEGER,
  verified_at TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (opportunity_id)
    REFERENCES opportunities(id)
    ON DELETE SET NULL,

  FOREIGN KEY (verified_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- 10. GIẤY CHỨNG NHẬN
CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id INTEGER NOT NULL,

  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,

  issued_at TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'valid'
    CHECK (status IN ('valid', 'revoked')),

  issued_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (issued_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- 11. THÔNG BÁO
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id INTEGER NOT NULL,

  title TEXT NOT NULL,
  message TEXT NOT NULL,

  is_read INTEGER NOT NULL DEFAULT 0
    CHECK (is_read IN (0, 1)),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);


-- 12. TÀI LIỆU TNV
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  title TEXT NOT NULL,
  description TEXT,

  file_url TEXT,

  unit_id INTEGER,

  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'published', 'archived')),

  created_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (unit_id)
    REFERENCES units(id)
    ON DELETE SET NULL,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- 13. YÊU CẦU HỖ TRỢ
CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id INTEGER NOT NULL,

  subject TEXT NOT NULL,
  message TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'processing', 'resolved', 'closed')),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);


-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_users_email
ON users(email);

CREATE INDEX IF NOT EXISTS idx_users_status
ON users(status);

CREATE INDEX IF NOT EXISTS idx_sessions_user
ON sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expires
ON sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_opportunities_type
ON opportunities(type);

CREATE INDEX IF NOT EXISTS idx_opportunities_status
ON opportunities(status);

CREATE INDEX IF NOT EXISTS idx_opportunities_unit
ON opportunities(unit_id);

CREATE INDEX IF NOT EXISTS idx_registrations_user
ON registrations(user_id);

CREATE INDEX IF NOT EXISTS idx_registrations_opportunity
ON registrations(opportunity_id);

CREATE INDEX IF NOT EXISTS idx_registrations_status
ON registrations(status);

CREATE INDEX IF NOT EXISTS idx_tasks_user
ON tasks(user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_status
ON tasks(status);

CREATE INDEX IF NOT EXISTS idx_attendance_user
ON attendance(user_id);

CREATE INDEX IF NOT EXISTS idx_attendance_opportunity
ON attendance(opportunity_id);

CREATE INDEX IF NOT EXISTS idx_contributions_user
ON contributions(user_id);

CREATE INDEX IF NOT EXISTS idx_certificates_user
ON certificates(user_id);

CREATE INDEX IF NOT EXISTS idx_certificates_code
ON certificates(code);

CREATE INDEX IF NOT EXISTS idx_notifications_user
ON notifications(user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_read
ON notifications(user_id, is_read);
