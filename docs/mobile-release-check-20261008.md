# Kiểm tra hiển thị trước triển khai — 08/10/2026

## Phạm vi và kết quả

- 127 trang: trang chủ, 12 trang năm (2015–2026) và 114 trang sự kiện.
- Kích thước 320, 390, 430 và 1440 px: không tràn ngang; các mục tổng quan, Ban điều hành, thành viên, hoạt động và album đều hiện đủ.
- Đối chiếu chữ của toàn bộ 114 bài với JSON nguồn: không mất hoặc đổi nội dung khi tách phần mở đầu và chèn ảnh.
- Kiểm tra 5.830 URL R2 đang được tham chiếu, gồm các biến thể ảnh: tất cả trả về thành công và đúng loại ảnh.
- Mở album ở từng năm có ảnh; kiểm tra tải album theo từng nhóm trên điện thoại.
- Kiểm tra ảnh thực và thao tác trên các trang năm 2022, 2025, 2026 cùng các bài bóng đá 2017, MV Muôn Đời Tạ Ơn 2020, Ban điều hành 2024 và hòa nhạc 2026: menu, tìm kiếm, mở/đóng album và ảnh lớn, chuyển ảnh đều đạt.
- Kiểm tra mục lục trên điện thoại: mở đúng mục Ban điều hành và Album.
- `npm run check`: dữ liệu hợp lệ, 20 bài kiểm thử đạt, cú pháp JavaScript và Worker đạt.
- `git diff --check`: đạt.

## Điều chỉnh khi chuẩn bị triển khai

Đồng nhất phiên bản CSS/JavaScript trong các trang. Gắn phiên bản phát hành vào cache công khai để trình duyệt đã lưu dữ liệu cũ tải lại index, năm và album sau cập nhật. Vẫn dùng cache cũ khi mạng lỗi; không xoá hoặc thay đổi cache bản nháp quản trị. Kiểm tra trình duyệt có cache cũ xác nhận ba loại dữ liệu công khai được làm mới và bản nháp được giữ nguyên.

## Giới hạn

Kiểm tra giao diện dùng Chrome với kích thước màn hình điện thoại và thao tác cảm ứng giả lập; chưa kiểm tra trực tiếp trên thiết bị iPhone/Safari. Những bài chưa có ảnh riêng hoặc chỉ có một ảnh vẫn giữ nguyên số ảnh hiện có. Việc đối chiếu lịch sử và ảnh bìa 2015 còn được ghi rõ trong báo cáo rà soát ảnh.
