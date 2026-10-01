-- Nâng cấp bảo mật 2026-10-01. Không xóa bảng, không reset dữ liệu, không đổi ID.
ALTER TABLE volunteer_applications ADD COLUMN email_delivery_status TEXT;
ALTER TABLE volunteer_applications ADD COLUMN email_delivery_detail TEXT;
CREATE INDEX IF NOT EXISTS idx_applications_lookup ON volunteer_applications(application_code,email);
CREATE INDEX IF NOT EXISTS idx_applications_opp_email ON volunteer_applications(opportunity_id,email,status);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id,status,due_at);
