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

Mở `admin.html` trên website đã deploy. Đăng nhập bằng **Firebase Email/Password** với email quản trị được cho phép. Mọi thay đổi năm, hoạt động, ban điều hành và số liệu thành viên được Worker xác minh rồi ghi vào file `data/` trên GitHub.

- Ảnh tải lên được lưu tại `images/uploads/<năm>/<chủ-đề>/`; ảnh bìa hoạt động dùng chính đường dẫn này nên hiển thị cho mọi thiết bị.
- Worker chỉ chấp nhận Firebase token của email quản trị và dùng GitHub token được lưu dưới dạng Cloudflare Secret. Không đưa GitHub token vào source hoặc trình duyệt.
- Mỗi commit do quản trị tạo sẽ kích hoạt Cloudflare Pages tự triển khai lại website.
- Nút **Xuất Word năm …** tạo tệp `.docx`; **Sao lưu JSON** xuất dữ liệu năm để lưu dự phòng.

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
