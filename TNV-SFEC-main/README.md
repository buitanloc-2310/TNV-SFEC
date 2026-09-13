# Cổng Tình nguyện viên Sky First

Phiên bản hoàn thiện giao diện công khai + khu vực nội bộ cho **Mạng lưới Giáo dục & Phát triển Cộng đồng Sky First (SFN)** và các đơn vị thuộc hệ thống.

## Giữ nguyên hạ tầng hiện hữu
- Worker: `sfn-tnv-portal`
- D1 binding: `DB`
- D1 database name: `tnv-sfec`
- D1 database ID: `d939abd6-c877-4234-be69-60b5a69d52a8`
- PBKDF2: **100000 iterations**
- Không reset/xóa dữ liệu, không đổi ID hiện hữu. Worker chỉ bổ sung cột/bảng mới theo hướng tương thích.

## Chức năng chính
- Website công khai: Trang chủ, Giới thiệu, Cơ hội TNV, Đơn vị, Quy trình, Tra cứu GCN.
- Cơ hội công khai không cần đăng nhập; 9 cơ hội SFEC được tự bổ sung nếu chưa tồn tại.
- Hồ sơ TNV công khai, bắt buộc họ tên, email, số điện thoại, trường/lớp/đơn vị và **ảnh cá nhân**; ảnh JPG/PNG/WEBP tối đa 5 MB được lưu trong R2; tạo mã hồ sơ `TNV-...`.
- Tài khoản chỉ được cấp sau khi quản trị xét hồ sơ.
- Quản trị hệ thống và quản trị đơn vị có phạm vi tách biệt; quản trị đơn vị không được sửa đơn vị khác.
- Tài khoản TNV chỉ hiển thị các chức năng nội bộ có luồng dữ liệu thật (tổng quan, nhiệm vụ).
- Không còn các mục UI: Đóng góp, Giấy chứng nhận của tôi, Tài liệu TNV, Thông báo của tôi.
- Tra cứu **Giấy chứng nhận** công khai, không yêu cầu đăng nhập; không có Giấy xác nhận trong Cổng TNV.

## Email hồ sơ
Worker gửi 2 email qua Resend: email tiếp nhận hồ sơ và email HTML xác nhận cho người đăng ký. Email tiếp nhận mặc định là `nhansu.sfn@gmail.com` (nếu dữ liệu cũ còn `skyfirst.ec@gmail.com` hệ thống cũng tự chuyển sang email Nhân sự). Người gửi mặc định là `Sky First · Tình nguyện viên <tnv@skyfirst.io.vn>`. Cấu hình secret `RESEND_API_KEY`; tên miền `skyfirst.io.vn` phải được xác minh trong Resend.

## Tra cứu GCN trung tâm
Có thể đặt biến `CERTIFICATE_LOOKUP_URL` trỏ tới endpoint tra cứu GCN của Cổng CTT trung tâm. Khi chưa cấu hình, Worker chỉ dùng bảng GCN cũ để tương thích và không gắn GCN vào tài khoản TNV.

## Deploy
```bash
npm install
npm run check
npx wrangler deploy
```

Không chạy lệnh reset database. `schema.sql` dành cho CSDL mới; CSDL hiện hữu được Worker bổ sung cấu trúc cần thiết khi chạy.


## Nâng cấp giao diện & kết nối 2026
- Favicon/manifest dùng logo Sky First Network, không còn phụ thuộc biểu tượng mặc định của trình duyệt.
- Bổ sung khu Hệ sinh thái Sky First và footer kết nối nhanh tới cổng chính, CTT, SFEC, Nhà Hán Ngữ và Member.
- Bổ sung tra cứu trạng thái hồ sơ TNV công khai bằng **mã hồ sơ + email đăng ký** để tránh lộ dữ liệu chỉ bằng mã.
- Chuẩn hóa typography/kerning/word-spacing để giảm lỗi hiển thị tiếng Việt bị tách chữ.
- Giữ nguyên Worker, D1 database ID và dữ liệu hiện hữu. Không có lệnh reset dữ liệu trong bản nâng cấp này.

### Cloudflare Builds
Nếu `wrangler.toml` nằm ngay tại Root directory đã chọn:
- Build command: để trống
- Deploy command: `npx wrangler deploy`
- Version command: `npx wrangler versions upload`
- Root directory: thư mục chứa trực tiếp `wrangler.toml`, `public/`, `src/`

### Tra cứu GCN trung tâm
Đặt biến `CERTIFICATE_LOOKUP_URL` về endpoint tra cứu GCN trung tâm của Sky First. Cổng TNV sẽ chuyển truy vấn GCN tới nguồn trung tâm thay vì tạo bản sao dữ liệu.


## R2 lưu ảnh hồ sơ
Bản nâng cấp dùng binding `FILES` với bucket `tnv-sfn-files`. Tạo bucket này trong Cloudflare R2 trước khi deploy nếu tài khoản chưa có. Ảnh không được public trực tiếp; email dùng URL có token riêng để tải ảnh từ Worker.

## Nâng cấp hồ sơ 2026-09-13
- Form đăng ký bắt buộc tải ảnh cá nhân và có xem trước ảnh.
- D1 tự bổ sung `profile_photo_key` và `profile_photo_token` theo hướng không xóa dữ liệu cũ.
- Quản trị viên xem được ảnh trong danh sách hồ sơ.
- Email xác nhận dùng template TNV nhiều màu với 4 ô thông tin và 4 ô hệ sinh thái Sky First.
- Email tiếp nhận: `nhansu.sfn@gmail.com`.
- Người gửi: `tnv@skyfirst.io.vn`.
