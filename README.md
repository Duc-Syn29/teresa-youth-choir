# Teresa Youth Choir — Digital Memory Archive

Kho nhật ký số của Ca đoàn Giới trẻ Têrêsa từ năm 2015. Website công khai là HTML/CSS/JavaScript thuần để tải nhanh và dễ lưu trữ lâu dài; khu quản trị dùng Firebase Auth, Cloudflare Worker và R2 để xuất bản nội dung mà không đưa ảnh mới vào Git.

- **Tôn chỉ:** Hiệp nhất – Yêu thương – Phục vụ.
- **Lịch sinh hoạt:**
  - Tập hát lúc 19:30 thứ Năm hằng tuần.
  - Phục vụ Thánh lễ lúc 20:00 tối thứ Bảy, vào các tuần 1, 3 và 5 hằng tháng.

## Kiến trúc

- `data/index.json`: chỉ mục nhẹ để trang chủ dựng danh sách năm, thống kê và “Nhịp sống Têrêsa” mà không tải từng file năm.
- `data/{year}.json`: nội dung đầy đủ của một năm, theo `schemaVersion: 3`.
- `data/albums/{year}/*.json`: manifest album. File năm chỉ giữ số ảnh và ba ảnh xem trước; 100–200 ảnh chỉ được tải khi người xem mở album.
- `images/optimized/`: biến thể 480/1280/2048 px cho ảnh cục bộ. Ảnh gốc vẫn được giữ như bản lưu trữ.
- Cloudflare R2 `teresa-choir-images`: lưu ảnh tải từ trang quản trị. Worker nhận binding `MEDIA_BUCKET`.
- GitHub: nguồn xuất bản nội dung JSON. Worker cập nhật file năm và `data/index.json` trong cùng một commit để tránh trạng thái nửa chừng.

## Chạy cục bộ

Không mở trực tiếp bằng `file://`, vì trình duyệt sẽ chặn `fetch()` JSON.

```bash
python3 -m http.server 4173
```

Sau đó mở `http://127.0.0.1:4173/`.

## Kiểm tra trước khi xuất bản

```bash
npm install
npm run check
```

Lệnh này kiểm tra toàn bộ JSON, album manifest, test schema và cú pháp JavaScript. GitHub Actions cũng tự chạy cùng bộ kiểm tra trên pull request và branch `main`.

Các lệnh bảo trì:

```bash
# Xem kế hoạch chuyển dữ liệu, không ghi file
node scripts/migrate-data.mjs

# Chuyển schema và tách album; luôn chỉ định thư mục backup
node scripts/migrate-data.mjs --write --backup-dir /duong-dan/backup

# Tạo lại biến thể ảnh cục bộ và cập nhật JSON
npm run optimize:images
```

## Quy trình quản trị an toàn

1. Mở `admin.html` và đăng nhập bằng tài khoản Firebase được cho phép.
2. Chọn năm hoặc tạo năm mới.
3. Chỉnh từng phần. Mọi thay đổi được lưu vào **bản nháp cục bộ**, chưa ảnh hưởng website.
4. Bấm **Xem trước** để mở chính bản nháp trên giao diện thật.
5. Sửa hết lỗi trong khung kiểm tra dữ liệu.
6. Bấm **Xuất bản** một lần. Worker dùng revision để cảnh báo nếu một tab khác đã thay đổi cùng năm.
7. Khi cần, mở **Lịch sử** và đưa một revision cũ về bản nháp để xem trước trước khi xuất bản lại.

Mỗi người trong Ban điều hành là một phần tử độc lập có `id`, `name`, `photo`, `note`. Không nối nhiều người bằng dấu chấm, dấu phẩy hay dấu chấm giữa.

## Ảnh và album

- Ảnh mới được trình duyệt tạo tuần tự thành ba kích thước để hạn chế tăng RAM trên iPhone.
- Worker kiểm tra MIME bằng chữ ký file, lưu metadata vào R2 và trả về URL của từng biến thể.
- Trang năm chỉ tải ảnh preview. Dialog album hiển thị 8 ảnh mỗi đợt trên điện thoại và 20 ảnh trên laptop.
- Trang hoạt động cũng chỉ dựng một đợt ảnh; người xem chủ động bấm “Xem thêm”.
- Hoạt động chưa có ảnh vẫn giữ nguyên toàn bộ bài viết và dùng bìa biên tập theo chủ đề.

## Cấu hình Worker và R2

Các bước triển khai, secrets, binding, môi trường preview/production và cách rollback nằm trong [`cloudflare-worker/README.md`](cloudflare-worker/README.md).

Không đặt `GITHUB_TOKEN`, khóa Firebase hay khóa R2 trong source. Bucket thật của dự án là `teresa-choir-images`, binding trong Worker là `MEDIA_BUCKET`.

## Cấu trúc chính

```text
.
├── index.html
├── year.html
├── activity.html
├── admin.html
├── css/style.css
├── js/
│   ├── schema.js
│   ├── store.js
│   ├── main.js
│   ├── year.js
│   ├── activity.js
│   └── admin.js
├── data/
│   ├── index.json
│   ├── 2015.json ...
│   └── albums/{year}/*.json
├── cloudflare-worker/
├── scripts/
├── tests/
└── .github/workflows/validate.yml
```

## Nguyên tắc để dự án dùng lâu dài

- Chỉ thay đổi dữ liệu qua bản nháp → xem trước → kiểm tra → xuất bản.
- Không đưa token hoặc ảnh upload mới vào Git.
- Không xóa ảnh R2 đang được JSON tham chiếu.
- Không sửa ID hoạt động/thành viên đã có; ID ổn định giúp liên kết cũ tiếp tục hoạt động.
- Luôn chạy `npm run check` và xem giao diện mobile trước khi deploy production.
