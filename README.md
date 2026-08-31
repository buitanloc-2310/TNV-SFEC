# Cổng Tình nguyện viên Sky First (SFN)

Cổng làm việc dành cho tình nguyện viên của **Mạng lưới Giáo dục & Phát triển Cộng đồng Sky First (SFN)**.

## Kiến trúc

- Frontend: HTML/CSS/JavaScript thuần trong `public/`.
- Backend: Cloudflare Worker trong `src/index.js`.
- Database: Cloudflare D1, schema tại `schema.sql`.
- Logo: file chính thức tại `public/assets/logo-sfn.png`.
- Không có đăng ký tài khoản công khai. Tài khoản TNV do Quản trị viên tạo.
- Quản trị viên gốc: `skyfirst.ec@gmail.com`.
- Mật khẩu Quản trị viên được tự đặt ở lần thiết lập đầu tiên và chỉ lưu dạng PBKDF2 hash trong D1.

## Triển khai

1. Cài Node.js và chạy `npm install`.
2. Đăng nhập Cloudflare: `npx wrangler login`.
3. Tạo D1: `npx wrangler d1 create sfn-tnv`.
4. Thay `REPLACE_WITH_D1_DATABASE_ID` trong `wrangler.toml` bằng ID D1 thật.
5. Khởi tạo database: `npm run db:init:remote`.
6. Deploy: `npm run deploy`.
7. Gắn custom domain `tnv.skyfirst.io.vn` trong Cloudflare.
8. Mở trang lần đầu, chọn **Thiết lập Quản trị viên**, dùng đúng email `skyfirst.ec@gmail.com` và tự đặt mật khẩu mạnh.

## Bảo mật

Không đưa mật khẩu vào GitHub, HTML, JavaScript hay README. Phiên đăng nhập dùng cookie `HttpOnly`, `Secure`, `SameSite=Strict`. Password dùng PBKDF2-SHA256 với salt ngẫu nhiên.

## Liên hệ SFN

- Website: https://www.skyfirst.io.vn
- Email: skyfirst.ec@gmail.com
- Hotline/Zalo: 0924 910 210
