# Quản trị đơn giản — bản thử bước 1

Bước 1 ngày 10/10/2026: giao diện quản trị đơn giản và tối ưu ảnh mới trước khi tải lên R2.

## Cách đăng một sự kiện

1. Đăng nhập bằng tài khoản được cấp, chọn năm.
2. Trong **Sự kiện**, bấm **Thêm sự kiện**, điền tên, thời gian, giới thiệu ngắn và nội dung. Xuống dòng giữa các đoạn để bài dễ đọc.
3. Thêm ảnh JPG/PNG/WebP/AVIF. Ảnh được tối ưu tự động. Bấm **Dùng làm bìa** trên ảnh phù hợp hoặc tải một ảnh bìa riêng.
4. Bấm **Lưu hoạt động vào bản nháp**, rồi **Xem trước**. Chuyển giữa Điện thoại và Máy tính để kiểm tra.
5. Bấm **Đăng lên website** khi đã kiểm tra xong. Thao tác này đăng toàn bộ thay đổi của năm đang chọn.

Bản nháp tự lưu trên thiết bị đang dùng; chưa đồng bộ sang máy khác. Đóng trang khi đang tải ảnh có thể làm gián đoạn việc tải. Khi đang tải ảnh, nút đăng bài và đổi năm được khóa.

## Các mục khác

- **Giới thiệu năm**: sửa tiêu đề, lời giới thiệu, dấu ấn và chọn ảnh bìa năm.
- **Ban điều hành & ca viên**: tên, ảnh, ghi chú người phụ trách và thống kê ca viên.
- **Kho ảnh**: thêm và tìm ảnh theo chủ đề/sự kiện.
- **Kiểm tra & lịch sử**: kiểm tra ảnh bìa, đọc lỗi cần sửa, khôi phục phiên bản vào bản nháp. Công cụ sao lưu nằm trong mục nâng cao.

## Tối ưu ảnh trong bước này

Ảnh mới lưu hai tệp: ảnh thu nhỏ tối đa 480 px và ảnh web tối đa 2048 px (bìa tải riêng: 2560 px). Ảnh web được dùng chung cho nội dung và màn xem ảnh lớn. WebP được ưu tiên; trình duyệt không hỗ trợ xuất WebP dùng JPEG. Dung lượng phụ thuộc độ chi tiết của ảnh, không áp dụng mức KB cố định.

Nếu đọc/nén ảnh thất bại thì dừng tải, không đưa tệp gốc lên R2. Hiện giới hạn đầu vào 25 MB/tệp; RAW chưa được hỗ trợ, cần xuất JPG trước. Ảnh cũ trong R2 không thay đổi.

## Các bước tiếp theo

- Bộ xử lý RAW tự động: kiểm tra định dạng máy ảnh thực tế, giải mã trên dịch vụ xử lý, ảnh gốc ở vùng tạm riêng, kiểm tra ảnh web thành công rồi xóa tệp tạm.
- Tài khoản người biên tập và chủ quản trị: hiện phía trình duyệt vẫn chỉ cho email quản trị cấu hình; cần cập nhật cả trình duyệt và Worker để giao tài khoản riêng.
- Bản nháp đồng bộ, quản lý ảnh chèn theo đoạn, chống ảnh trùng, dung lượng album, thùng rác có thời hạn. Cần kiểm tra liên kết dữ liệu trước khi bổ sung tự động dọn ảnh.

## Kiểm tra đã thực hiện

- Toàn bộ dữ liệu hiện tại: 12 năm, 114 sự kiện, 107 album, không lỗi/cảnh báo cấu trúc.
- 24 kiểm tra tự động: gồm tải hai biến thể, kích thước bìa, chặn ảnh lỗi và RAW trước khi gửi mạng.
- Chrome mô phỏng 320/390/1440 px với tài khoản và API giả lập: năm mục không tràn ngang, tìm sự kiện, giữ nội dung khi chuyển mục, tự lưu, chọn bìa từ ảnh có sẵn, sửa nhân sự.
- Chưa thử đăng bài thật hoặc tải ảnh thật lên R2 trong phiên này; chưa kiểm tra trên iPhone vật lý.
