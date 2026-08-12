# Teresa Youth Choir — Digital Memory Archive

Website tĩnh lưu giữ hành trình Ca đoàn Giới trẻ Têrêsa từ 2015 đến 2026. Dự án dùng HTML5, CSS3 và JavaScript thuần; không có backend hoặc bước build. Giao diện sử dụng bảng màu xanh nước biển nhạt và bộ ảnh thật của ca đoàn.

> Nội dung, tên nhân sự, địa chỉ và liên kết hiện tại là **dữ liệu mẫu**. Hãy thay bằng thông tin đã được ca đoàn xác nhận trước khi xuất bản.

## Chạy trên VS Code

1. Mở thư mục `TeresaYouthChoir` bằng VS Code.
2. Cài extension **Live Server** nếu chưa có.
3. Nhấp phải `index.html` → **Open with Live Server**.

Không mở `year.html` bằng giao thức `file://` vì trình duyệt sẽ chặn `fetch()` dữ liệu JSON. Live Server giải quyết việc này.

## Cập nhật nội dung

- Thông tin giới thiệu và liên kết mạng xã hội: sửa trong `index.html`.
- Nội dung khởi tạo mỗi năm: sửa file tương ứng trong `data/`, ví dụ `data/2026.json`.
- Logo thanh điều hướng: thay `images/logo.jpg` nhưng giữ nguyên tên file.
- Ảnh hero: thay `images/hero.jpg` nhưng giữ nguyên tên file.
- Ảnh sự kiện: đặt trong `images/gallery/`, sau đó cập nhật `src` trong JSON và trong gallery trang chủ.

Tất cả file năm dùng cùng một schema. Khi chỉnh JSON, lưu ý giữ dấu phẩy, dấu ngoặc và dấu nháy kép đúng cú pháp.

## Quản trị nội dung và ảnh

Mở `admin.html` qua Live Server để đăng nhập, thêm/sửa/xóa hoạt động, viết bài chi tiết, tải ảnh và chỉnh nội dung phần giới thiệu mỗi năm. Không mở trực tiếp bằng `file://`.

- Tài khoản khởi tạo: `admin`
- Mật khẩu khởi tạo: `teresa2026`
- Đổi mật khẩu ngay sau khi đăng nhập.

Dự án là **website tĩnh**, nên tài khoản, thay đổi nội dung và ảnh tải lên được lưu trong IndexedDB của chính trình duyệt/thiết bị quản trị. Chúng không tự xuất hiện ở thiết bị khác và không được ghi ngược lên GitHub Pages/Cloudflare Pages.

- Khi thêm ảnh, chọn một **chủ đề** bắt buộc; kho ảnh tự nhóm và lọc theo năm/chủ đề. Mỗi ảnh tối đa 25 MB.
- Mỗi hoạt động có thể đặt **ảnh trang mở đầu** riêng; ảnh này không làm thay đổi năm hoặc chủ đề của hoạt động.
- Khu quản trị có biểu mẫu cập nhật **Ban điều hành** và thống kê thành viên: tổng số, **In** (thêm mới) và **Out** (nghỉ).
- Nút **Hiện/Ẩn** bên cạnh ô mật khẩu giúp kiểm tra mật khẩu trước khi đăng nhập hoặc đổi mật khẩu.
- Nút **Xuất Word năm …** tạo tệp `.docx` chứa phần giới thiệu và mọi hoạt động của năm đang chọn.
- Trong biểu mẫu hoạt động, chọn một tệp `.docx` ở mục **Nhập bài viết Word** để chép nội dung vào bài viết chi tiết, kiểm tra rồi bấm Lưu.
- Nút **Sao lưu JSON** giữ đầy đủ dữ liệu gồm cả ảnh để có thể **Nhập sao lưu JSON** trên trình duyệt khác.

Muốn có tài khoản dùng chung, phân quyền thật và ảnh dùng chung sau khi deploy, cần bổ sung backend/storage (ví dụ Supabase hoặc Cloudflare).

## Deploy miễn phí

### GitHub Pages

Đưa toàn bộ nội dung thư mục này lên một repository GitHub, sau đó vào **Settings → Pages → Deploy from a branch**, chọn branch `main` và thư mục `/ (root)`.

### Cloudflare Pages

Kết nối repository trong Cloudflare Pages. Chọn preset **None**, bỏ trống build command và đặt output directory là `/`.

## Cấu trúc

```text
TeresaYouthChoir/
├── index.html
├── year.html
├── activity.html
├── admin.html
├── css/style.css
├── js/main.js
├── js/year.js
├── js/activity.js
├── js/admin.js
├── js/store.js
├── data/2015.json ... 2026.json
└── images/
    ├── hero.jpg
    └── gallery/
```

## Accessibility & hiệu năng

- Menu và lightbox hỗ trợ bàn phím.
- Có skip link, alt text và semantic landmarks.
- Tôn trọng cài đặt `prefers-reduced-motion`.
- Ảnh gallery trong trang năm được lazy-load.
