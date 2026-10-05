# TNV/SFEC security release — 2026-10-01

Bản này nâng cấp theo hướng không phá dữ liệu hiện hữu. Không reset D1, không đổi ID và không xóa dữ liệu.

## Đã xử lý
- Khôi phục giao diện tài khoản khi phiên đăng nhập còn hiệu lực sau refresh.
- Bắt buộc đổi mật khẩu tạm ở backend trước khi dùng API khác.
- Chống gửi lặp form đăng nhập; có trạng thái đang đăng nhập.
- Rate limit đăng nhập theo IP và IP+tài khoản; chỉ ghi nhận thất bại, dùng cập nhật nguyên tử.
- Giới hạn tối đa 4 phiên gần nhất; rotate phiên sau đổi mật khẩu.
- Upload ảnh kiểm tra cả MIME, dung lượng và chữ ký file JPG/PNG/WEBP.
- Chống gửi trùng hồ sơ cho cùng cơ hội bằng cùng email khi hồ sơ cũ chưa bị từ chối.
- Mã hồ sơ luôn dùng random token; bỏ fallback timestamp.
- Ghi trạng thái gửi email để có thể kiểm tra khi dịch vụ email lỗi.
- Bổ sung security headers và CSP cho HTML.
- Bổ sung index cho tra cứu hồ sơ và tác vụ thường dùng.
- Bổ sung foreign key cho bảng điểm danh khi tạo CSDL mới.
- Bỏ thuật ngữ hạ tầng khỏi lỗi công khai và Việt hóa “Nhật ký thao tác”.

## Triển khai
Với CSDL hiện hữu, chạy migration `migrations/2026-10-01-security-hardening.sql` đúng một lần trước khi đưa Worker mới vào production. Worker vẫn giữ compatibility guard để các bản cũ không trắng trang nếu migration bị bỏ sót, nhưng migration là đường triển khai chính.

Không chạy lại `schema.sql` lên CSDL production đang có dữ liệu.
