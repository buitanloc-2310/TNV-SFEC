# Sky First Volunteer Center — Production Final

## Bắt buộc giữ tương thích
- Không đổi `database_id`, không reset D1, không xóa Admin hiện hữu.
- Tài khoản/mật khẩu Admin cũ tiếp tục đăng nhập. Hash PBKDF2 cũ tự nâng sau đăng nhập thành công.
- Origin cho phép same-origin của deployment hiện tại và `APP_URL`, nên production/preview hợp lệ không bị khóa login.

## Hoàn thiện
- Hardening đỏ/cam: setup, rate limit, ảnh hồ sơ, internal errors, Origin/CSRF baseline, phân quyền nhiệm vụ.
- Mật khẩu mới dùng PBKDF2 100.000 vòng; tài khoản mới có cờ đổi mật khẩu lần đầu.
- Có API/UI đổi mật khẩu; đổi xong thu hồi các phiên khác.
- Audit log nền tảng + trang xem nhật ký cho System Admin.
- Schema compatibility chỉ chạy một lần mỗi Worker isolate, không lặp ở từng API call trong cùng isolate.
- Email và nhận diện chuyển sang xanh/navy Sky First.
- Tên giao diện: Trung Tâm Tình Nguyện Viên Sky First / Sky First Volunteer Center.
- Email nhận hồ sơ mặc định: tnv@skyfirst.io.vn; có thể override bằng ENV.
