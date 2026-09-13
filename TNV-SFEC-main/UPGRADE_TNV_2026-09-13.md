# Nâng cấp TNV 2026-09-13

1. Giữ nguyên Worker `sfn-tnv-portal` và D1 hiện hữu.
2. Tạo R2 bucket `tnv-sfn-files` nếu chưa có. `wrangler.toml` đã bind thành `FILES`.
3. Đặt secret `RESEND_API_KEY` trên chính Worker TNV.
4. Resend cần xác minh domain `skyfirst.io.vn` để gửi từ `Sky First · Tình nguyện viên <tnv@skyfirst.io.vn>`.
5. Deploy: `npm install` rồi `npm run check` rồi `npm run deploy`.
6. Không cần chạy ALTER thủ công: Worker tự thêm `profile_photo_key` và `profile_photo_token` khi khởi động.
7. Email tiếp nhận hồ sơ mặc định: `nhansu.sfn@gmail.com`. Nếu `units.notification_email` cũ là `skyfirst.ec@gmail.com`, hệ thống tự chuyển sang email Nhân sự.
