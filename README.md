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
- Hồ sơ TNV công khai, bắt buộc họ tên, email, số điện thoại và trường/lớp/đơn vị; tạo mã hồ sơ `TNV-...`.
- Tài khoản chỉ được cấp sau khi quản trị xét hồ sơ.
- Quản trị hệ thống và quản trị đơn vị có phạm vi tách biệt; quản trị đơn vị không được sửa đơn vị khác.
- Tài khoản TNV chỉ hiển thị các chức năng nội bộ có luồng dữ liệu thật (tổng quan, nhiệm vụ).
- Không còn các mục UI: Đóng góp, Giấy chứng nhận của tôi, Tài liệu TNV, Thông báo của tôi.
- Tra cứu **Giấy chứng nhận** công khai, không yêu cầu đăng nhập; không có Giấy xác nhận trong Cổng TNV.

## Email hồ sơ
Worker đã có luồng gửi 2 email qua Resend: email tiếp nhận của đơn vị và email xác nhận cho người đăng ký. Để kích hoạt, cấu hình secret `RESEND_API_KEY` và biến `MAIL_FROM` (địa chỉ gửi đã xác minh). Nếu chưa cấu hình, việc nộp hồ sơ vẫn hoạt động và dữ liệu vẫn được lưu D1.

## Tra cứu GCN trung tâm
Có thể đặt biến `CERTIFICATE_LOOKUP_URL` trỏ tới endpoint tra cứu GCN của Cổng CTT trung tâm. Khi chưa cấu hình, Worker chỉ dùng bảng GCN cũ để tương thích và không gắn GCN vào tài khoản TNV.

## Deploy
```bash
npm install
npm run check
npx wrangler deploy
```

Không chạy lệnh reset database. `schema.sql` dành cho CSDL mới; CSDL hiện hữu được Worker bổ sung cấu trúc cần thiết khi chạy.
