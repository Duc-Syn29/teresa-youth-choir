# Worker quản trị Teresa

Worker là lớp bảo mật giữa trang quản trị và hai kho lưu trữ:

- GitHub: các file nội dung `data/<năm>.json` và chỉ mục nhẹ `data/index.json`.
- Cloudflare R2: tất cả ảnh mới tải từ `admin.html`.

Trình duyệt không bao giờ nhận GitHub token hay R2 access key. Worker xác minh Firebase ID token, chỉ cho email quản trị thực hiện thao tác ghi/xóa.

## Thiết lập một lần trên Cloudflare

1. Dùng R2 bucket `teresa-choir-images` trong **R2 Object Storage**.
2. Vào Worker `teresa-admin-api` > **Settings** > **Bindings** > thêm R2 bucket với variable name `MEDIA_BUCKET`, chọn bucket `teresa-choir-images`.
3. Trong **Settings** > **Variables and Secrets**, tạo encrypted secrets:

   - `GITHUB_TOKEN`: fine-grained token chỉ cấp repo `Duc-Syn29/teresa-youth-choir`, quyền **Contents: Read and write**.
   - `FIREBASE_API_KEY`
   - `ADMIN_EMAIL`

4. Giữ variables thường trong `wrangler.toml`: `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`.
5. Deploy Worker. Mặc định ảnh được công khai qua URL Worker `/media/<R2-key>`, nên chưa cần public bucket. Nếu đã gắn custom domain trực tiếp cho bucket, đặt thêm `R2_PUBLIC_BASE_URL` (ví dụ `https://media.cadoangioitreteresa.org`) để URL ảnh dùng domain đó.
6. Cập nhật `endpoint` trong `js/firebase-config.js` nếu URL Worker thay đổi.

## Cách dữ liệu được đồng bộ

- `PUT /api/years/:year` lưu file năm và tái tạo phần năm đó trong `data/index.json`.
- `POST /api/media` ghi ảnh vào `media/<year>/<topic>/…` trên R2, lưu metadata ảnh kèm object và trả URL hiển thị ngay.
- `GET /media/:key` là route công khai, cache ảnh một năm; các API `/api/*` còn lại yêu cầu Firebase admin token.
- Ảnh cũ ở `images/uploads/` vẫn hiển thị và có thể xóa từ quản trị để quá trình chuyển đổi không làm mất tư liệu.
