# Worker quản trị Teresa

Worker là lớp bảo mật giữa trang quản trị và hai kho lưu trữ:

- GitHub lưu dữ liệu `data/<năm>.json`, `data/index.json` và các manifest album.
- Cloudflare R2 lưu ảnh gốc, ảnh cỡ vừa và thumbnail.
- Firebase chỉ xác minh danh tính; GitHub token và quyền R2 không xuất hiện ở trình duyệt.

## Production

Production dùng branch `main`, Worker `teresa-admin-api` và bucket có sẵn
`teresa-choir-images`.

Tạo encrypted secrets:

```sh
wrangler secret put GITHUB_TOKEN
wrangler secret put FIREBASE_API_KEY
wrangler secret put ADMIN_UIDS
```

`ADMIN_UIDS` là một hoặc nhiều Firebase UID, ngăn bằng dấu phẩy. Nếu chưa lấy
UID, Worker vẫn tương thích secret cũ `ADMIN_EMAIL`; UID an toàn hơn vì không đổi
khi người quản trị đổi email.

Fine-grained GitHub token chỉ nên cấp repository
`Duc-Syn29/teresa-youth-choir` với quyền **Contents: Read and write**.

Kiểm tra trước khi deploy:

```sh
wrangler types
wrangler deploy --dry-run
```

Không deploy Worker production khi mới thử giao diện. Mã nguồn hiện không tự
deploy; lệnh deploy phải được chạy chủ động sau khi kiểm thử.

## Preview

Preview tách dữ liệu khỏi website thật:

1. Tạo Git branch `preview` từ `main`.
2. Tạo bucket R2 `teresa-choir-images-preview`.
3. Cấu hình lại secrets cho environment vì Cloudflare không kế thừa secret:

   ```sh
   wrangler secret put GITHUB_TOKEN --env preview
   wrangler secret put FIREBASE_API_KEY --env preview
   wrangler secret put ADMIN_UIDS --env preview
   ```

4. Deploy bằng `wrangler deploy --env preview`.
5. Kết nối branch `preview` với Cloudflare Pages preview.

`POST /api/years/:year/publish` trên Worker preview tạo một commit nguyên tử vào
branch `main`. API này xuất bản JSON và manifest. Ảnh preview nằm ở bucket riêng,
vì vậy chỉ xuất bản khi ảnh đã dùng URL production hoặc đã được chuyển sang bucket
production. Không gọi route publish từ Worker production.

## Dữ liệu và commit nguyên tử

`PUT /api/years/:year` nhận envelope
`{ data, baseRevision, mode }` (vẫn nhận raw year JSON từ client cũ) và thực hiện
trong một Git commit duy nhất:

- `data/<year>.json`
- `data/index.json`
- `data/albums/<year>/<activity-id>.json`

Trong JSON của năm, mỗi hoạt động chỉ giữ chỉ mục nhẹ dạng
`album: { manifest, count, preview }`; tối đa ba ảnh xem trước được giữ cạnh nội
dung. Toàn bộ `images` được chuyển sang manifest `schemaVersion: 1`. Album tổng
hợp cũ dùng `data/albums/<year>/_gallery.json` cũng được giữ tương thích. Vì vậy
trang công khai không phải tải hàng trăm URL ảnh ngay khi mở một năm.

Nếu hai cửa sổ quản trị lưu cùng lúc, Worker cập nhật lại trên HEAD mới. Client có
thể gửi commit đã đọc qua header `If-Match`; Worker trả `409 STALE_DATA` thay vì
ghi đè dữ liệu mới hơn.

Schema hiện hành là `schemaVersion: 3`. Worker vẫn nhận dữ liệu cũ, chuẩn hóa ảnh
dạng chuỗi/dạng `{base,count}`, nhưng kiểm tra bắt buộc:

- năm hợp lệ và tự mở rộng theo năm hiện tại;
- mã hoạt động duy nhất;
- giới hạn độ dài, số hoạt động và số ảnh;
- đường dẫn ảnh an toàn;
- cấu trúc tổng quan, thành viên và Ban điều hành.

API phiên bản/nội dung:

- `GET /api/years/:year` — `{ data, revision }` hiện tại và commit ETag. Đây là
  route quản trị nên Worker bung các manifest thành `images` đầy đủ; trang công
  khai vẫn đọc JSON nhẹ trực tiếp từ GitHub/Pages.
- `GET /api/years/:year/history` — lịch sử thay đổi.
- `GET /api/years/:year/history/:sha` — đọc dữ liệu của một phiên bản để xem
  trước hoặc đưa vào bản nháp; Worker bung manifest của đúng commit đó để khi
  lưu lại không vô tình lấy ảnh từ phiên bản mới hơn.
- `POST /api/years/:year/restore` với `{ "commitSha": "..." }` — khôi phục.
- `POST /api/years/:year/publish` — đưa dữ liệu preview sang branch xuất bản.

## Ảnh R2 đa kích thước

Upload mới có thể gửi multipart với ba field:

- `original`: ảnh lưu trữ, tối đa 25 MB;
- `medium`: ảnh hiển thị/lightbox, tối đa 10 MB;
- `thumbnail` hoặc `thumb`: ảnh danh sách, tối đa 4 MB.

Các field chung gồm `year`, `topic`, `caption`, `alt`, `activityId`, `draftId`
và tùy chọn kích thước
`originalWidth`, `originalHeight`, `mediumWidth`, `mediumHeight`,
`thumbnailWidth`, `thumbnailHeight`.

Client cũ chỉ gửi `file` vẫn hoạt động; Worker dùng ảnh đó cho cả ba URL. Worker
kiểm tra magic bytes và chỉ nhận JPEG, PNG, WebP hoặc AVIF. SVG bị chặn dù trình
duyệt khai báo MIME là ảnh.

Khóa mới có dạng:

```text
media/<year>/<topic>/<uuid>/original.webp
media/<year>/<topic>/<uuid>/medium.webp
media/<year>/<topic>/<uuid>/thumb.webp
```

`GET /api/media?year=2020&topic=Thiện%20nguyện&limit=100&cursor=...` hỗ trợ phân
trang và trả `cursor`, `truncated`, `hasMore`, metadata, `original`, `medium`,
`thumbnail`. Xóa `id` của
ảnh gốc sẽ xóa cả ba biến thể. Ảnh cũ một object vẫn được liệt kê và xóa bình
thường.

`GET/HEAD /media/<R2-key>` hỗ trợ ETag, `If-None-Match`, byte range và cache một
năm. Nên giữ bucket private và gắn custom domain vào Worker, không trỏ
`R2_PUBLIC_BASE_URL` thẳng tới public bucket nếu muốn các kiểm tra/header này.

## Bảo mật và giới hạn tốc độ

- Các request ghi/xóa phải đến từ origin trong `ALLOWED_ORIGINS`.
- Preview có thể cho phép subdomain Pages qua `ALLOWED_ORIGIN_SUFFIXES`.
- `RATE_LIMITER` giới hạn theo IP trước xác thực và theo Firebase UID sau xác thực.
- API trả status rõ ràng: `401`, `403`, `409`, `413`, `415`, `422`, `429`, `503`.
- Không ghi token, email hoặc nội dung bài viết vào log.

Nếu namespace rate limit `1001`/`1002` đã được Worker khác dùng, đổi thành hai số
nguyên dương chưa sử dụng trong tài khoản. Wrangler cần phiên bản hỗ trợ Rate
Limiting binding.

## Quan sát vận hành

`wrangler.toml` bật Workers Logs. Mỗi request có:

- `X-Request-Id`;
- `Server-Timing`;
- log JSON gồm environment, route, status, thời gian và mã lỗi.

`GET /health` chỉ công bố trạng thái binding, environment, release và khoảng năm;
route này không kiểm tra hoặc tiết lộ secret. Dùng dashboard **Workers & Pages →
Worker → Observability** để lọc lỗi `4xx/5xx` và request chậm.

## CORS và URL Worker

Sau khi deploy, cập nhật endpoint trong `js/firebase-config.js` nếu URL Worker thay
đổi. Khi thêm domain hoặc Pages project mới, cập nhật `ALLOWED_ORIGINS`; đừng dùng
wildcard cho API quản trị.
