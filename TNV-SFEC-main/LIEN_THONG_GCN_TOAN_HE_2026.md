# Liên thông GCN toàn hệ Sky First — 2026

Bản này giữ nguyên dữ liệu hiện hữu và không yêu cầu reset D1.

## Luồng tra cứu tại skyfirst.io.vn/certificate
1. Dữ liệu GCN trực tiếp của website Sky First (Firestore).
2. Cổng Thông tin Sky First: https://ctt.skyfirst.io.vn/api/lookup/certificate
3. SFEC: https://ctt.sfec.skyfirst.io.vn/api/lookup/certificate
4. Cổng TNV: https://tnv.skyfirst.io.vn/api/public/certificates/lookup
5. Cổng Thành viên: https://member.skyfirst.io.vn/api/public/verify (chỉ nhận kết quả type=certificate)
6. Nhà Hán Ngữ: https://ctt.nhahanngu.io.vn/api/lookup/certificate

Các cổng Worker được bổ sung CORS chỉ cho API tra cứu công khai để website chính có thể đọc kết quả. Không thay đổi bảng dữ liệu, không xóa tài khoản, không chạy bootstrap lại.

## Lưu ý triển khai
- Deploy lại source của CTT, SFEC, TNV, Member và website chính.
- Không chạy SETUP_D1_CONSOLE.sql của Member.
- Không cần migration mới cho thay đổi liên thông này.
- Nếu một cổng tạm lỗi, website chính tiếp tục thử các nguồn còn lại thay vì dừng toàn bộ.
