# Giao diện Trung Tâm Tình Nguyện Viên Sky First

Tên tiếng Anh: Sky First Volunteer Center.

## Nội dung & giao diện
- Trang chủ mới: navy, xanh dương, trắng và điểm nhấn xanh mint; dùng logo có sẵn.
- Nội dung rõ vai trò Trung tâm, quy trình xét duyệt, hỗ trợ và cam kết khi tham gia.
- Cơ hội: tìm theo từ khóa kết hợp lọc loại; số lượng lấy từ dữ liệu API.
- Đơn vị: số lượng theo danh sách thực tế, không tự tạo số liệu thành tích.
- Tra cứu hồ sơ: nhãn riêng cho mã và email, hướng dẫn khi thiếu mã.
- Thêm phần hỏi đáp; quyền lợi ghi theo chương trình, không cam kết chứng nhận tự động.
- Đồng bộ biểu mẫu, tài khoản TNV, bảng quản trị, menu di động và footer.
- Bổ sung điều hướng bàn phím, trạng thái menu, giới hạn focus trong modal và Escape để đóng.
- Thông báo sau gửi hồ sơ không khẳng định email đã gửi khi chưa biết trạng thái gửi.
- Tên các cổng khác trong hệ sinh thái giữ đúng tên của nơi được liên kết.

## Kiểm tra
8 kiểm tra tự động đạt: 5 kiểm tra xác thực/phiên/mật khẩu và 3 kiểm tra tìm kiếm/lọc, escape dữ liệu và đếm đơn vị. Kiểm tra cú pháp JavaScript, liên kết neo, ID và selector. Chưa kiểm tra hình ảnh thực tế trên trình duyệt: môi trường không tải được Chromium. Chưa triển khai lên Cloudflare hoặc kiểm tra CSDL thật.

## Đưa lên website
Thay file cùng đường dẫn trong repository, giữ cấu hình DB/R2/secrets đang dùng, rồi deploy lại. Dùng thư mục chứa package.json, wrangler.toml, src/ và public/ làm gốc dự án. Không chạy lại schema.sql trên CSDL đang sử dụng.
